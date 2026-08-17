"""Tests for the todo tool (Hermes parity task list)."""

from __future__ import annotations

import json

from nanobot.agent.tools.context import (
    RequestContext,
    request_context,
)
from nanobot.agent.tools.registry import ToolRegistry
from nanobot.agent.tools.todo import (
    MAX_TODO_CONTENT_CHARS,
    MAX_TODO_ITEMS,
    TODO_INJECTION_HEADER,
    TodoStore,
    TodoTool,
    todo_payload_from_result,
)


def _payload(result: str) -> dict:
    return json.loads(result)


class TestTodoStore:
    def test_write_replaces_and_reads(self) -> None:
        store = TodoStore()
        items = store.write([
            {"id": "1", "content": "first", "status": "pending"},
            {"id": "2", "content": "second", "status": "in_progress"},
        ])
        assert [i["id"] for i in items] == ["1", "2"]
        assert store.read() == items

    def test_merge_updates_by_id_and_appends(self) -> None:
        store = TodoStore()
        store.write([
            {"id": "1", "content": "first", "status": "pending"},
            {"id": "2", "content": "second", "status": "pending"},
        ])
        merged = store.write([
            {"id": "2", "status": "completed"},
            {"id": "3", "content": "third", "status": "pending"},
        ], merge=True)
        by_id = {i["id"]: i for i in merged}
        assert by_id["1"]["status"] == "pending"
        assert by_id["2"]["status"] == "completed"
        assert by_id["2"]["content"] == "second"
        assert by_id["3"]["content"] == "third"
        assert [i["id"] for i in merged] == ["1", "2", "3"]

    def test_merge_ignores_items_without_id(self) -> None:
        store = TodoStore()
        store.write([{"id": "1", "content": "first", "status": "pending"}])
        merged = store.write([{"content": "no id", "status": "pending"}], merge=True)
        assert len(merged) == 1

    def test_normalizes_invalid_status_and_missing_fields(self) -> None:
        store = TodoStore()
        items = store.write([
            {"id": "1", "status": "bogus"},
            {"id": "2", "content": "  ", "status": "pending"},
            {"id": "", "content": "no id", "status": "completed"},
        ])
        by_id = {i["id"]: i for i in items}
        assert by_id["1"]["status"] == "pending"
        assert by_id["1"]["content"] == "(no description)"
        assert by_id["2"]["content"] == "(no description)"
        assert by_id["?"]["content"] == "no id"

    def test_dedupes_by_id_keeping_last_position(self) -> None:
        store = TodoStore()
        items = store.write([
            {"id": "a", "content": "old", "status": "pending"},
            {"id": "b", "content": "bee", "status": "pending"},
            {"id": "a", "content": "new", "status": "completed"},
        ])
        assert [i["id"] for i in items] == ["b", "a"]
        assert items[-1]["content"] == "new"

    def test_caps_item_content(self) -> None:
        store = TodoStore()
        items = store.write([{"id": "1", "content": "x" * 10000, "status": "pending"}])
        assert len(items[0]["content"]) <= MAX_TODO_CONTENT_CHARS

    def test_caps_total_items(self) -> None:
        store = TodoStore()
        many = [
            {"id": str(i), "content": f"task {i}", "status": "pending"}
            for i in range(MAX_TODO_ITEMS + 50)
        ]
        items = store.write(many)
        assert len(items) == MAX_TODO_ITEMS
        assert items[0]["id"] == "0"

    def test_format_for_injection_only_active_items(self) -> None:
        store = TodoStore()
        store.write([
            {"id": "1", "content": "done task", "status": "completed"},
            {"id": "2", "content": "active task", "status": "in_progress"},
            {"id": "3", "content": "pending task", "status": "pending"},
            {"id": "4", "content": "cancelled task", "status": "cancelled"},
        ])
        rendered = store.format_for_injection()
        assert rendered is not None
        assert rendered.startswith(TODO_INJECTION_HEADER)
        assert "done task" not in rendered
        assert "cancelled task" not in rendered
        assert "- [>] 2. active task (in_progress)" in rendered
        assert "- [ ] 3. pending task (pending)" in rendered

    def test_format_for_injection_none_when_empty_or_all_done(self) -> None:
        assert TodoStore().format_for_injection() is None
        store = TodoStore()
        store.write([{"id": "1", "content": "done", "status": "completed"}])
        assert store.format_for_injection() is None


class TestTodoTool:
    def test_description_advises_todo_lists_for_complex_requests(self) -> None:
        description = TodoTool().description.lower()
        assert "complex tasks" in description
        assert "3+ steps" in description
        assert "multiple tasks" in description
        assert "merge=true" in description
        assert "one item in_progress at a time" in description
        assert "mark items completed immediately when done" in description
        assert "cancel it and add a revised item" in description

    def test_schema_exposes_todos_and_merge(self) -> None:
        schema = TodoTool().parameters
        props = schema["properties"]
        assert set(props) == {"todos", "milestones", "merge"}
        assert props["todos"]["type"] == "array"
        item_props = props["todos"]["items"]["properties"]
        assert set(item_props) == {"id", "content", "status"}
        assert item_props["status"]["enum"] == [
            "pending", "in_progress", "completed", "cancelled",
        ]
        assert props["merge"]["type"] == "boolean"
        assert props["milestones"]["type"] == "array"

    def test_milestones_progress_sequentially_and_inject_active_only(self) -> None:
        store = TodoStore()
        store.write([], milestones=[
            {"id": "prepare", "name": "Prepare", "todos": [{"id": "a", "content": "inspect", "status": "completed"}]},
            {"id": "build", "name": "Build", "todos": [{"id": "b", "content": "implement", "status": "pending"}]},
        ])
        assert store.active_milestone_index() == 1
        rendered = store.format_for_injection()
        assert rendered is not None
        assert "Current milestone: Build" in rendered
        assert "implement" in rendered
        assert "inspect" not in rendered

    def test_future_in_progress_is_normalized_to_pending(self) -> None:
        store = TodoStore()
        store.write([], milestones=[
            {"id": "one", "name": "One", "todos": [{"id": "a", "content": "a", "status": "pending"}]},
            {"id": "two", "name": "Two", "todos": [{"id": "b", "content": "b", "status": "in_progress"}]},
        ])
        assert store.read_milestones()[1]["todos"][0]["status"] == "pending"

    async def test_execute_milestones_without_legacy_todos(self) -> None:
        tool = TodoTool()
        written = _payload(await tool.execute(milestones=[
            {"id": "prepare", "name": "Prepare", "todos": [
                {"id": "inspect", "content": "Inspect", "status": "pending"},
            ]},
        ]))
        assert written["active_milestone"] == "prepare"
        assert written["milestones"][0]["name"] == "Prepare"
        assert written["todos"][0]["id"] == "inspect"

    def test_milestone_plan_is_bounded_by_total_item_cap(self) -> None:
        store = TodoStore()
        milestones = [
            {"id": str(index), "todos": [
                {"id": f"{index}-{task}", "content": "x", "status": "pending"}
                for task in range(256)
            ]}
            for index in range(64)
        ]
        store.write([], milestones=milestones)
        assert len(store.read()) == MAX_TODO_ITEMS

    async def test_execute_write_and_read(self) -> None:
        tool = TodoTool()
        written = _payload(await tool.execute(todos=[
            {"id": "1", "content": "plan", "status": "pending"},
            {"id": "2", "content": "build", "status": "in_progress"},
        ]))
        assert written["summary"] == {
            "total": 2, "pending": 1, "in_progress": 1,
            "completed": 0, "cancelled": 0,
        }
        assert [t["id"] for t in written["todos"]] == ["1", "2"]

        read = _payload(await tool.execute())
        assert read == written

    async def test_execute_merge_update(self) -> None:
        tool = TodoTool()
        await tool.execute(todos=[{"id": "1", "content": "plan", "status": "pending"}])
        merged = _payload(await tool.execute(
            todos=[{"id": "1", "status": "completed"}], merge=True,
        ))
        assert merged["todos"][0]["status"] == "completed"
        assert merged["todos"][0]["content"] == "plan"
        assert merged["summary"]["completed"] == 1

    async def test_execute_rejects_non_list_todos(self) -> None:
        tool = TodoTool()
        result = await tool.execute(todos="not a list")
        assert "todos must be a list" in result

    async def test_sessions_are_isolated(self) -> None:
        tool = TodoTool()
        with request_context(RequestContext(
            channel="test", chat_id="a", session_key="session-a",
        )):
            await tool.execute(todos=[{"id": "1", "content": "a plan", "status": "pending"}])
        with request_context(RequestContext(
            channel="test", chat_id="b", session_key="session-b",
        )):
            read = _payload(await tool.execute())
            assert read["todos"] == []
        with request_context(RequestContext(
            channel="test", chat_id="c", session_key="session-a",
        )):
            read = _payload(await tool.execute())
            assert [t["id"] for t in read["todos"]] == ["1"]

    async def test_registry_executes_tool(self) -> None:
        registry = ToolRegistry()
        registry.register(TodoTool())
        definitions = registry.get_definitions()
        assert definitions[0]["function"]["name"] == "todo"
        result = await registry.execute("todo", {
            "todos": [{"id": "1", "content": "x", "status": "pending"}],
        })
        assert isinstance(result, str)
        assert json.loads(result)["summary"]["total"] == 1


class TestTodoPayloadFromResult:
    def test_parses_result_string(self) -> None:
        payload = todo_payload_from_result(
            json.dumps({"todos": [{"id": "1", "content": "x", "status": "pending"}],
                        "summary": {"total": 1}})
        )
        assert payload is not None
        assert payload["todos"][0]["id"] == "1"

    def test_accepts_dict_and_rejects_garbage(self) -> None:
        assert todo_payload_from_result({"todos": []}) is not None
        assert todo_payload_from_result("nope") is None
        assert todo_payload_from_result(None) is None
