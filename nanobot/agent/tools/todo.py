"""Todo tool: session task list for complex multi-step work.

A faithful port of the Hermes Agent ``todo`` tool (NousResearch/hermes-agent,
``tools/todo_tool.py``): an in-memory task list the agent uses to decompose
complex tasks, track progress, and maintain focus across a session.

Behavioral guidance lives entirely in the tool schema description — the model
is advised to write out a to-do list whenever a request is complex (3+ steps)
or bundles multiple tasks. Every call returns the full current list, so the
model can re-read its plan at any point.

Design (mirrors Hermes):
- Single ``todo`` tool: provide ``todos`` to write, omit to read.
- ``merge=false`` (default) replaces the whole list; ``merge=true`` updates
  existing items by id and appends new ones.
- Items are ``{id, content, status}`` with status in
  ``pending | in_progress | completed | cancelled``; list order is priority.
- State lives per session key in a bounded in-memory registry (one list per
  conversation), matching Hermes' per-AIAgent TodoStore.
"""

from __future__ import annotations

import json
import threading
from collections import OrderedDict
from typing import Any, cast

from nanobot.agent.tools.base import Tool, tool_parameters
from nanobot.agent.tools.context import current_request_session_key

# Valid status values for todo items (Hermes parity).
VALID_STATUSES = {"pending", "in_progress", "completed", "cancelled"}
MAX_MILESTONE_NAME_CHARS = 200
MAX_MILESTONES = 64
MAX_TASKS_PER_MILESTONE = 256

# Bounds on persisted todo state (Hermes parity). The todo list is a planning
# aid the model re-reads after every turn, so unbounded item content or count
# defeats the compaction it rides through. Generous relative to real plans — a
# todo item is a short task description, and active lists are a handful of
# items, not hundreds.
MAX_TODO_CONTENT_CHARS = 4000
MAX_TODO_ITEMS = 256
_TRUNCATION_MARKER = "\u2026 [truncated]"

# Upper bound on stores kept alive per gateway process. One store per session
# key; when the cap is exceeded the least recently used session's list is
# dropped so a busy gateway can't leak memory across many short conversations.
_MAX_STORES = 512

# Stable header for the re-injected task list (Hermes parity). Kept as a
# module constant so future context-compression hooks can recognize rows that
# were synthesized by the runtime rather than written by the user.
TODO_INJECTION_HEADER = (
    "[Your active task list was preserved across context compression]"
)


class TodoStore:
    """In-memory todo list. One instance per session.

    Items are ordered — list position is priority. Each item has:
      - id: unique string identifier (agent-chosen)
      - content: task description
      - status: pending | in_progress | completed | cancelled
    """

    def __init__(self) -> None:
        self._milestones: list[dict[str, Any]] = []

    def write(
        self,
        todos: list[dict[str, Any]],
        merge: bool = False,
        milestones: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, str]]:
        """Replace or merge a flat plan, optionally grouped into milestones."""
        incoming = milestones if milestones is not None else [
            {"id": "default", "name": "Tasks", "todos": todos}
        ]
        normalized = self._normalize_milestones(incoming)
        if merge and milestones is None:
            incoming_items = normalized[0]["todos"] if normalized else []
            existing_items = {i["id"]: i for i in self._items}
            for item in incoming_items:
                old = existing_items.get(item["id"])
                if old is None:
                    if item["id"] != "?":
                        self._milestones[0]["todos"].append(item)
                    continue
                raw = next((r for r in (todos or []) if str(r.get("id", "")).strip() == item["id"]), {})
                if raw.get("content"):
                    old["content"] = item["content"]
                if raw.get("status") in VALID_STATUSES:
                    old["status"] = str(raw["status"]).strip().lower()
            self._trim_total_items()
            self._enforce_progression()
            return self.read()
        if not merge:
            self._milestones = normalized
        else:
            existing = {m["id"]: m for m in self._milestones}
            for milestone in normalized:
                current = existing.get(milestone["id"])
                if current is None:
                    self._milestones.append(milestone)
                    existing[milestone["id"]] = milestone
                    continue
                current["name"] = milestone["name"] or current["name"]
                by_id = {item["id"]: item for item in current["todos"]}
                for item in milestone["todos"]:
                    if item["id"] in by_id:
                        by_id[item["id"]].update(item)
                    else:
                        current["todos"].append(item)
                current["todos"] = current["todos"][:MAX_TASKS_PER_MILESTONE]
        self._trim_total_items()
        self._enforce_progression()
        return self.read()

    def _trim_total_items(self) -> None:
        remaining = MAX_TODO_ITEMS
        for milestone in self._milestones:
            milestone["todos"] = milestone["todos"][:remaining]
            remaining -= len(milestone["todos"])
            if remaining <= 0:
                remaining = 0

    def read_milestones(self) -> list[dict[str, Any]]:
        return [
            {"id": m["id"], "name": m["name"], "todos": [i.copy() for i in m["todos"]]}
            for m in self._milestones
        ]

    def active_milestone_index(self) -> int | None:
        for index, milestone in enumerate(self._milestones):
            if any(i["status"] in {"pending", "in_progress"} for i in milestone["todos"]):
                return index
        return None

    def _normalize_milestones(self, milestones: list[dict[str, Any]]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        total_items = 0
        for position, raw in enumerate(milestones[:MAX_MILESTONES]):
            if not isinstance(raw, dict):
                continue
            milestone_id = str(raw.get("id", "") or f"milestone-{position + 1}").strip()
            if not milestone_id or milestone_id in seen:
                continue
            seen.add(milestone_id)
            name = str(raw.get("name", "") or f"Milestone {position + 1}").strip()
            tasks = raw.get("todos", raw.get("tasks", []))
            if not isinstance(tasks, list) or total_items >= MAX_TODO_ITEMS:
                tasks = []
            else:
                tasks = self._dedupe_by_id(tasks)[:MAX_TASKS_PER_MILESTONE]
                tasks = tasks[:MAX_TODO_ITEMS - total_items]
            normalized_tasks = [
                self._validate(item) for item in tasks if isinstance(item, dict)
            ]
            total_items += len(normalized_tasks)
            result.append({
                "id": milestone_id,
                "name": name[:MAX_MILESTONE_NAME_CHARS],
                "todos": normalized_tasks,
            })
        return result

    def _enforce_progression(self) -> None:
        active = self.active_milestone_index()
        found = False
        for index, milestone in enumerate(self._milestones):
            for item in milestone["todos"]:
                if item["status"] != "in_progress":
                    continue
                if index != active or found:
                    item["status"] = "pending"
                else:
                    found = True

    @property
    def _items(self) -> list[dict[str, str]]:
        return [i for m in self._milestones for i in m["todos"]]

    def read(self) -> list[dict[str, str]]:
        """Return a copy of the current list."""
        return [item.copy() for item in self._items]

    def has_items(self) -> bool:
        """Check if there are any items in the list."""
        return bool(self._items)

    def format_for_injection(self) -> str | None:
        """Render the todo list for post-compaction injection.

        Returns a human-readable string to append to the compressed message
        history, or None if the list is empty.
        """
        active_index = self.active_milestone_index()
        if active_index is None:
            return None
        milestone = self._milestones[active_index]

        # Status markers for compact display (Hermes parity).
        markers = {
            "completed": "[x]",
            "in_progress": "[>]",
            "pending": "[ ]",
            "cancelled": "[~]",
        }

        # Only inject pending/in_progress items — completed/cancelled ones
        # cause the model to re-do finished work after compression.
        active_items = [
            item for item in milestone["todos"]
            if item["status"] in {"pending", "in_progress"}
        ]
        if not active_items:
            return None

        lines = [
            TODO_INJECTION_HEADER,
            f"## Current milestone: {milestone['name']}",
            "Do not begin work from a future milestone until the current milestone is complete.",
        ]
        for item in active_items:
            marker = markers.get(item["status"], "[?]")
            lines.append(f"- {marker} {item['id']}. {item['content']} ({item['status']})")

        return "\n".join(lines)

    @staticmethod
    def _cap_content(content: str) -> str:
        """Truncate oversized todo content to MAX_TODO_CONTENT_CHARS.

        A single huge item would otherwise inflate the re-injection block
        without bound. Keep the head — the actionable part of a task
        description — plus a marker.
        """
        if len(content) > MAX_TODO_CONTENT_CHARS:
            keep = MAX_TODO_CONTENT_CHARS - len(_TRUNCATION_MARKER)
            return content[:keep] + _TRUNCATION_MARKER
        return content

    @staticmethod
    def _validate(item: dict[str, Any]) -> dict[str, str]:
        """Validate and normalize a todo item.

        Ensures required fields exist and status is valid.
        Returns a clean dict with only {id, content, status}.
        """
        if not isinstance(item, dict):
            return {"id": "?", "content": "(invalid item)", "status": "pending"}

        item_id = str(item.get("id", "")).strip()
        if not item_id:
            item_id = "?"

        content = str(item.get("content", "")).strip()
        if not content:
            content = "(no description)"
        else:
            content = TodoStore._cap_content(content)

        status = str(item.get("status", "pending")).strip().lower()
        if status not in VALID_STATUSES:
            status = "pending"

        return {"id": item_id, "content": content, "status": status}

    @staticmethod
    def _dedupe_by_id(todos: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Collapse duplicate ids, keeping the last occurrence in its position."""
        last_index: dict[str, int] = {}
        for i, item in enumerate(todos):
            if not isinstance(item, dict):
                # Non-dict items get a synthetic key so _validate can handle them
                last_index[f"__invalid_{i}"] = i
                continue
            item_id = str(item.get("id", "")).strip() or "?"
            last_index[item_id] = i
        return [todos[i] for i in sorted(last_index.values())]


# --- Session-scoped store registry -----------------------------------------

_stores: "OrderedDict[str, TodoStore]" = OrderedDict()
_stores_lock = threading.Lock()


def _store_for_session(session_key: str | None) -> TodoStore:
    """Return (creating if needed) the TodoStore for a session key.

    The registry is bounded: the least recently used session's list is evicted
    when the cap is exceeded, so one busy gateway never accumulates unbounded
    per-conversation state.
    """
    key = session_key or "default"
    with _stores_lock:
        store = _stores.get(key)
        if store is None:
            store = TodoStore()
            _stores[key] = store
        else:
            _stores.move_to_end(key)
        while len(_stores) > _MAX_STORES:
            _stores.popitem(last=False)
        return store


def todo_store() -> TodoStore:
    """Return the current request's session-scoped TodoStore."""
    return _store_for_session(current_request_session_key())


def _todo_payload(items: list[dict[str, str]], milestones: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Build the canonical tool result: flat compatibility plus full plan."""
    pending = sum(1 for i in items if i["status"] == "pending")
    in_progress = sum(1 for i in items if i["status"] == "in_progress")
    completed = sum(1 for i in items if i["status"] == "completed")
    cancelled = sum(1 for i in items if i["status"] == "cancelled")
    return {
        "todos": items,
        "milestones": milestones or [],
        "active_milestone": next(
            (
                m["id"]
                for m in milestones or []
                if any(i["status"] in {"pending", "in_progress"} for i in m["todos"])
            ),
            None,
        ),
        "summary": {
            "total": len(items),
            "pending": pending,
            "in_progress": in_progress,
            "completed": completed,
            "cancelled": cancelled,
        },
    }


def todo_payload_from_result(result: Any) -> dict[str, Any] | None:
    """Parse ``{todos, summary}`` back out of a tool result string.

    Used by progress-event builders so the WebUI can render the task list from
    the ``todo`` tool's completion payload without re-parsing raw JSON.
    """
    if isinstance(result, dict):
        if isinstance(result.get("todos"), list):
            return cast(dict[str, Any], result)
        return None
    if isinstance(result, str) and result.strip():
        try:
            data = json.loads(result)
        except (json.JSONDecodeError, TypeError):
            return None
        if isinstance(data, dict) and isinstance(data.get("todos"), list):
            return cast(dict[str, Any], data)
    return None


@tool_parameters({
    "type": "object",
    "properties": {
        "todos": {
            "type": "array",
            "description": "Legacy flat task items. Use milestones for ordered plans. Omit to read current list.",
            "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "Unique item identifier"},
                        "content": {"type": "string", "description": "Task description"},
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "completed", "cancelled"],
                            "description": "Current status",
                        },
                    },
                },
        },
        "milestones": {
            "type": "array",
            "description": "Ordered milestones. Each contains id, name, and a todos array.",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "todos": {"type": "array"},
                },
            },
        },
        "merge": {
            "type": "boolean",
            "description": (
                "true: update existing items by id, add new ones. "
                "false (default): replace the entire list."
            ),
            "default": False,
        },
    },
    "required": [],
})
class TodoTool(Tool):
    """Manage the session task list: write out a to-do list for complex work.

    The schema description below is the behavioral contract (Hermes parity):
    it advises the model to write out a to-do list whenever a request is
    complex (3+ steps) or bundles multiple tasks, and tells it how to keep the
    list truthful (one in_progress item, mark completed immediately, cancel
    and replace on failure).
    """

    name = "todo"

    description = (
        "Manage your ordered task list and milestones for the current session. Use for complex tasks "
        "with 3+ steps or when the user provides multiple tasks. "
        "Call with no parameters to read the current list.\n\n"
        "Writing:\n"
        "- Provide 'todos' array to create/update items\n"
        "- merge=false (default): replace the entire list with a fresh plan\n"
        "- merge=true: update existing items by id, add any new ones\n\n"
        "For larger plans, provide milestones: [{id, name, todos: [items]}]. "
        "Only the active milestone may be worked on; complete or cancel it before the next starts.\n\n"
        "Each item: {id: string, content: string, "
        "status: pending|in_progress|completed|cancelled}\n"
        "List order is priority. Only ONE item in_progress at a time.\n"
        "Mark items completed immediately when done. If something fails, "
        "cancel it and add a revised item.\n\n"
        "Always returns the full current list."
    )

    async def execute(
        self,
        todos: list[dict[str, Any]] | None = None,
        merge: bool = False,
        milestones: list[dict[str, Any]] | None = None,
    ) -> str:
        """Read or write the session's todo list.

        Args:
            todos: if provided, write these items. If None, read current list.
            merge: if True, update by id. If False (default), replace entire list.

        Returns:
            JSON string with the full current list and summary metadata.
        """
        store = todo_store()

        if todos is not None or milestones is not None:
            # Guard: LLM sometimes sends todos as a JSON string instead of a list
            if isinstance(todos, str):
                try:
                    todos = json.loads(todos)
                except (json.JSONDecodeError, TypeError):
                    return json.dumps({
                        "error": "todos must be a list of objects, got unparseable string"
                    }, ensure_ascii=False)
            if todos is None:
                todos = []
            if not isinstance(todos, list):
                return json.dumps({
                    "error": f"todos must be a list, got {type(todos).__name__}"
                }, ensure_ascii=False)
            items = store.write(todos, merge, milestones=milestones)
        else:
            items = store.read()

        return json.dumps(_todo_payload(items, store.read_milestones()), ensure_ascii=False)
