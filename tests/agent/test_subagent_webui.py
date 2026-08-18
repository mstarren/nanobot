"""Tests for the WebUI-facing subagent surface: live progress frames, task
records, per-task cancel, and approval-gate composition into subagent runs."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from nanobot.agent.hook import CompositeHook
from nanobot.agent.hooks.approval_gate import ApprovalGateHook
from nanobot.agent.subagent import SubagentManager, SubagentStatus
from nanobot.bus.events import OUTBOUND_META_AGENT_UI, OutboundMessage
from nanobot.bus.outbound_events import ProgressEvent
from nanobot.bus.queue import MessageBus
from nanobot.providers.base import GenerationSettings, LLMProvider
from nanobot.security.approval_gate import configure_approval_gate, get_approval_gate
from nanobot.utils.llm_runtime import LLMRuntime


def _runtime() -> LLMRuntime:
    provider = MagicMock(spec=LLMProvider)
    provider.generation = GenerationSettings()
    return LLMRuntime.capture(provider, "test", context_window_tokens=128_000)


def _manager(tmp_path: Path) -> SubagentManager:
    return SubagentManager(
        workspace=tmp_path,
        bus=MessageBus(),
        max_tool_result_chars=16_000,
    )


def _status(**overrides: object) -> SubagentStatus:
    defaults: dict[str, object] = {
        "task_id": "abc12345",
        "label": "researcher",
        "task_description": "investigate",
        "started_at": 1.0,
        "started_wall_ms": 1_000.0,
    }
    defaults.update(overrides)
    return SubagentStatus(**defaults)  # type: ignore[arg-type]


async def test_publish_progress_emits_agent_ui_frame(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    status = _status(phase="awaiting_tools", iteration=2, tool_events=[{"name": "exec", "status": "ok"}])
    origin = {"channel": "websocket", "chat_id": "chat-1", "session_key": "websocket:chat-1"}

    await manager._publish_progress(origin, status)

    msg: OutboundMessage = await manager.bus.consume_outbound()
    assert msg.channel == "websocket"
    assert msg.chat_id == "chat-1"
    blob = msg.metadata[OUTBOUND_META_AGENT_UI]
    assert blob["kind"] == "subagent"
    assert blob["data"]["task_id"] == "abc12345"
    assert blob["data"]["phase"] == "awaiting_tools"
    assert blob["data"]["iteration"] == 2
    assert isinstance(msg.event, ProgressEvent)
    assert msg.event.tool_events == [{"name": "exec", "status": "ok"}]


async def test_publish_progress_skips_non_routable_origins(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    # CLI-originated runs have no routable chat surface; nothing is published.
    await manager._publish_progress(
        {"channel": "cli", "chat_id": "direct", "session_key": None},
        _status(),
    )
    assert manager.bus.outbound_size == 0


async def test_spawn_publishes_initial_progress_frame(tmp_path: Path) -> None:
    from unittest.mock import AsyncMock

    manager = _manager(tmp_path)
    provider = MagicMock(spec=LLMProvider)
    provider.generation = GenerationSettings()
    provider.chat_with_retry = AsyncMock(return_value=MagicMock(content="done"))
    runtime = LLMRuntime.capture(provider, "test", context_window_tokens=128_000)

    spawned = await manager.spawn(
        "do the thing",
        label="worker",
        origin_channel="websocket",
        origin_chat_id="chat-9",
        session_key="websocket:chat-9",
        runtime=runtime,
    )
    task_id = next(iter(manager._task_statuses))  # single task just spawned

    msg: OutboundMessage = await manager.bus.consume_outbound()
    blob = msg.metadata[OUTBOUND_META_AGENT_UI]
    assert blob["kind"] == "subagent"
    assert blob["data"]["task_id"] == task_id
    assert blob["data"]["phase"] == "initializing"

    # Let the background run finish, then cancel/clean up whatever is left.
    task = manager._running_tasks.get(task_id)
    if task is not None:
        try:
            await asyncio.wait_for(task, timeout=5)
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
    assert task_id in manager.task_records()
    assert manager.task_records()[task_id]["final_status"] in ("ok", "error")


async def test_cancel_task_cancels_running_task(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    sleeper = asyncio.create_task(asyncio.sleep(60))
    manager._running_tasks["t1"] = sleeper  # type: ignore[assignment]

    assert manager.cancel_task("t1") is True
    with pytest.raises(asyncio.CancelledError):
        await sleeper
    assert manager.cancel_task("t1") is False  # already cancelled/done
    assert manager.cancel_task("missing") is False


def test_task_records_are_bounded_and_store_final_result(tmp_path: Path) -> None:
    manager = _manager(tmp_path)
    manager._max_task_records = 2
    for i in range(3):
        status = _status(task_id=f"id{i:08x}", phase="done")
        manager._store_record(
            f"id{i:08x}",
            origin={"channel": "websocket", "chat_id": "c", "session_key": "websocket:c"},
            label=f"label-{i}",
            task=f"task-{i}",
            status=status,
            final_result=f"result-{i}",
            final_status="ok",
        )

    records = manager.task_records()
    assert set(records.keys()) == {"id00000001", "id00000002"}
    assert records["id00000001"]["final_result"] == "result-1"
    assert records["id00000001"]["final_status"] == "ok"
    assert records["id00000001"]["session_key"] == "websocket:c"


async def test_run_hook_composes_approval_gate(tmp_path: Path) -> None:
    import nanobot.security.approval_gate as approval_gate_module

    configure_approval_gate(gate_tools=["exec"], timeout_seconds=5)
    try:
        assert get_approval_gate() is not None
        manager = _manager(tmp_path)
        hook = manager._build_run_hook(
            "abc12345",
            _status(),
            {"channel": "websocket", "chat_id": "c", "session_key": "websocket:c"},
            _runtime(),
        )
        assert isinstance(hook, CompositeHook)
        assert any(isinstance(h, ApprovalGateHook) for h in hook._hooks)
    finally:
        approval_gate_module._gate = None


async def test_run_hook_without_gate_is_plain_subagent_hook(tmp_path: Path) -> None:
    import nanobot.security.approval_gate as approval_gate_module

    approval_gate_module._gate = None
    manager = _manager(tmp_path)
    hook = manager._build_run_hook(
        "abc12345",
        _status(),
        {"channel": "websocket", "chat_id": "c", "session_key": "websocket:c"},
        _runtime(),
    )
    assert not isinstance(hook, CompositeHook)


async def test_error_path_stores_record_and_publishes(tmp_path: Path) -> None:
    """A subagent whose runner fails must still produce a record + final frame."""
    manager = _manager(tmp_path)

    async def boom(spec: object) -> str:
        raise RuntimeError("provider exploded")

    manager.runner.run = boom  # type: ignore[method-assign]
    status = _status()
    origin = {"channel": "websocket", "chat_id": "c", "session_key": "websocket:c"}

    result = await manager._run_subagent(
        "abc12345", "task", "label", origin, status, _runtime(),
        announce=False,
    )

    assert "Error: provider exploded" in result
    assert status.phase == "error"
    record = manager.task_records()["abc12345"]
    assert record["final_status"] == "error"
    assert record["error"] == "provider exploded"
    # Two frames were published: the initial one (phase ``initializing``) and
    # the final one (phase ``error``). Drain to the final frame.
    await manager.bus.consume_outbound()  # initial frame
    msg: OutboundMessage = await manager.bus.consume_outbound()
    blob = msg.metadata[OUTBOUND_META_AGENT_UI]
    assert blob["data"]["phase"] == "error"


# -- WebUI HTTP routes --------------------------------------------------------


class _FakeSubagentManager:
    """Minimal stand-in for SubagentManager used by the route handlers."""

    def __init__(self) -> None:
        self.status = _status(
            task_id="run1", label="live", phase="awaiting_tools", iteration=3,
        )
        self.record = {
            "task_id": "rec1",
            "label": "finished",
            "phase": "done",
            "iteration": 1,
            "tool_events": [],
            "usage": {},
            "stop_reason": None,
            "error": None,
            "started_wall_ms": 100.0,
            "finished_wall_ms": 200.0,
            "final_result": "ok result",
            "final_status": "ok",
        }

    def runtime_statuses(self) -> dict[str, object]:
        return {"run1": self.status}

    def task_records(self) -> dict[str, dict[str, object]]:
        return {"rec1": self.record}

    def cancel_task(self, task_id: str) -> bool:
        return task_id == "run1"


def _http_handler_with_subagents(
    manager: _FakeSubagentManager,
) -> object:
    from nanobot.webui.ws_http import GatewayHTTPHandler

    handler = object.__new__(GatewayHTTPHandler)
    handler._subagent_manager = lambda: manager
    handler._log = MagicMock()
    handler.check_api_token = lambda request: True  # type: ignore[method-assign]
    return handler


def _json(response: object) -> dict[str, object]:
    import json

    return json.loads(response.body.decode("utf-8"))  # type: ignore[attr-defined]


async def test_subagent_route_mutation_path() -> None:
    from nanobot.webui.ws_http import GatewayHTTPHandler

    path = GatewayHTTPHandler._webui_mutation_path("subagent.stop", {"task_id": "abc12345"})
    assert path == "/api/subagents/abc12345/stop"
    bad = GatewayHTTPHandler._webui_mutation_path("subagent.stop", {"task_id": "bad id!"})
    assert bad.status_code == 400


def test_subagent_route_is_mutation() -> None:
    from nanobot.webui.ws_http import GatewayHTTPHandler

    handler = object.__new__(GatewayHTTPHandler)
    handler.settings_routes = MagicMock()
    handler.settings_routes.is_mutation_path = lambda path: False
    assert handler._is_webui_mutation_path("/api/subagents/abc12345/stop")
    assert not handler._is_webui_mutation_path("/api/subagents/abc12345")


async def test_subagents_list_route() -> None:
    handler = _http_handler_with_subagents(_FakeSubagentManager())
    response = handler._handle_subagents_list(MagicMock())
    payload = _json(response)
    assert payload["available"] is True
    ids = [item["task_id"] for item in payload["subagents"]]
    assert "run1" in ids and "rec1" in ids


async def test_subagent_detail_routes() -> None:
    handler = _http_handler_with_subagents(_FakeSubagentManager())

    live = _json(handler._handle_subagent_detail(MagicMock(), "run1"))
    assert live["running"] is True
    assert live["phase"] == "awaiting_tools"

    record = _json(handler._handle_subagent_detail(MagicMock(), "rec1"))
    assert record["running"] is False
    assert record["final_result"] == "ok result"

    missing = handler._handle_subagent_detail(MagicMock(), "nope")
    assert missing.status_code == 404


async def test_subagent_stop_route() -> None:
    handler = _http_handler_with_subagents(_FakeSubagentManager())
    stopped = _json(await handler._handle_subagent_stop(MagicMock(), "run1"))
    assert stopped == {"ok": True, "cancelled": True, "task_id": "run1"}
    noop = _json(await handler._handle_subagent_stop(MagicMock(), "rec1"))
    assert noop["cancelled"] is False
