"""Tests for structured tool progress events (todo payload attachment)."""

from __future__ import annotations

import json

from nanobot.agent.hook import AgentHookContext
from nanobot.providers.base import ToolCallRequest
from nanobot.utils.progress_events import build_tool_event_finish_payloads


def test_todo_finish_payload_carries_parsed_todos() -> None:
    result = json.dumps({
        "todos": [
            {"id": "1", "content": "plan", "status": "pending"},
            {"id": "2", "content": "build", "status": "in_progress"},
        ],
        "summary": {"total": 2, "pending": 1, "in_progress": 1,
                    "completed": 0, "cancelled": 0},
    })
    context = AgentHookContext(
        iteration=0,
        messages=[],
        tool_calls=[ToolCallRequest(id="call_todo", name="todo", arguments={"todos": []})],
        tool_results=[result],
        tool_events=[{"name": "todo", "status": "ok", "detail": result}],
    )

    payloads = build_tool_event_finish_payloads(context)
    assert len(payloads) == 1
    payload = payloads[0]
    assert payload["phase"] == "end"
    assert payload["name"] == "todo"
    assert payload["todos"] == [
        {"id": "1", "content": "plan", "status": "pending"},
        {"id": "2", "content": "build", "status": "in_progress"},
    ]
    assert payload["result"] == result


def test_non_todo_finish_payload_has_no_todos_key() -> None:
    context = AgentHookContext(
        iteration=0,
        messages=[],
        tool_calls=[ToolCallRequest(id="call_1", name="grep", arguments={"pattern": "x"})],
        tool_results=["ok"],
        tool_events=[{"name": "grep", "status": "ok", "detail": "ok"}],
    )

    payloads = build_tool_event_finish_payloads(context)
    assert "todos" not in payloads[0]
