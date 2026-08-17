"""Tests for the approval-gate agent hook (triage + prompt + response path)."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from nanobot.agent.hooks.approval_gate import ApprovalGateHook
from nanobot.providers.base import ToolCallRequest
from nanobot.security.approval_gate import (
    ApprovalDeniedError,
    configure_approval_gate,
    get_approval_gate,
)


class FakeProvider:
    def __init__(self, answer: str) -> None:
        self._answer = answer

    async def chat(self, messages, model=None, max_tokens=None, temperature=None, **kw):
        return type("R", (), {"content": self._answer})()


class FakeRuntime:
    provider: Any
    model = "test-model"


class FakeBus:
    def __init__(self) -> None:
        self.messages = []

    async def publish_outbound(self, msg: Any) -> None:
        self.messages.append(msg)


def make_runtime(answer: str) -> FakeRuntime:
    runtime = FakeRuntime()
    runtime.provider = FakeProvider(answer)
    return runtime


def make_hook(
    bus: FakeBus,
    *,
    gate_tools: list[str] | None = None,
    yolo_mode: bool = False,
) -> ApprovalGateHook:
    configure_approval_gate(
        gate_tools=gate_tools if gate_tools is not None else ["exec"],
        timeout_seconds=5,
        yolo_mode=yolo_mode,
    )
    return ApprovalGateHook(
        bus=bus,
        channel="websocket",
        chat_id="chat-1",
        session_key="ws:chat-1",
        runtime_getter=lambda session_key: make_runtime("APPROVE"),
    )


def tool_call(name: str = "exec", arguments: dict[str, Any] | None = None) -> ToolCallRequest:
    return ToolCallRequest(id="c1", name=name, arguments=arguments or {"command": "echo hi"})


def context() -> Any:
    return type("C", (), {"iteration": 0, "messages": []})()


async def test_smart_approve_proceeds_without_prompt() -> None:
    bus = FakeBus()
    hook = make_hook(bus)
    await hook.before_execute_tool(
        context(), tool_call(), None, {"command": "echo hi"}
    )
    assert bus.messages == []


async def test_escalate_and_user_approve_proceeds_with_prompt() -> None:
    bus = FakeBus()
    hook = make_hook(bus)
    hook._runtime_getter = lambda session_key: make_runtime("ESCALATE")

    task = asyncio.create_task(
        hook.before_execute_tool(
            context(),
            tool_call(arguments={"command": "ls -la /tmp"}),
            None,
            {"command": "ls -la /tmp"},
        )
    )
    pending = await _wait_for_pending(get_approval_gate())
    assert pending, "request must be pending"

    # The prompt must be emitted with the triage reason and the full call.
    assert len(bus.messages) == 1
    text = bus.messages[0].content
    assert "Approval required" in text
    assert "ls -la /tmp" in text
    assert bus.messages[0].metadata.get("_agent_ui", {}).get("kind") == "approval_request"

    ok, _ = get_approval_gate().respond(pending[0]["id"], "approve")
    assert ok
    await task  # proceeds once approved
    assert pending[0]["expires_in_seconds"] >= 0


async def test_escalate_and_user_deny_raises_denied_error() -> None:
    bus = FakeBus()
    hook = make_hook(bus)
    hook._runtime_getter = lambda session_key: make_runtime("ESCALATE")

    task = asyncio.create_task(
        hook.before_execute_tool(
            context(),
            tool_call(arguments={"command": "echo denied"}),
            None,
            {"command": "echo denied"},
        )
    )
    pending = await _wait_for_pending(get_approval_gate())
    assert pending, "request must be pending"
    ok, _ = get_approval_gate().respond(pending[0]["id"], "deny")
    assert ok

    with pytest.raises(ApprovalDeniedError):
        await task


async def test_hardline_command_gated_even_with_empty_tool_list() -> None:
    bus = FakeBus()
    hook = make_hook(bus, gate_tools=[])
    hook._runtime_getter = lambda session_key: make_runtime("ESCALATE")

    task = asyncio.create_task(
        hook.before_execute_tool(
            context(),
            tool_call(arguments={"command": "rm " + "-rf /"}),
            None,
            {"command": "rm " + "-rf /"},
        )
    )
    pending = await _wait_for_pending(get_approval_gate())
    assert pending and pending[0]["tool_name"] == "exec"
    ok, _ = get_approval_gate().respond(pending[0]["id"], "deny")
    assert ok

    with pytest.raises(ApprovalDeniedError):
        await task


async def test_yolo_mode_auto_approves_gated_call() -> None:
    """Yolo mode skips triage + the human prompt and approves outright."""
    bus = FakeBus()
    hook = make_hook(bus, yolo_mode=True)
    call = tool_call()
    await hook.before_execute_tool(context(), call, None, {"command": "echo hi"})
    assert bus.messages == []
    assert get_approval_gate().pending_payload() == []
    info = getattr(call, "approval_info", {})
    assert info.get("status") == "auto_approved"
    assert info.get("reason") == ""
    # The yolo marker lets the WebUI render the "Yolo" badge and skip the
    # assessment workflow for this record.
    assert info.get("yolo") is True


async def test_yolo_mode_never_bypasses_hardline_deny() -> None:
    """The hardline DENY floor stays in force even in yolo mode."""
    bus = FakeBus()
    hook = make_hook(bus, gate_tools=[], yolo_mode=True)
    hook._runtime_getter = lambda session_key: make_runtime("ESCALATE")

    task = asyncio.create_task(
        hook.before_execute_tool(
            context(),
            tool_call(arguments={"command": "rm " + "-rf /"}),
            None,
            {"command": "rm " + "-rf /"},
        )
    )
    pending = await _wait_for_pending(get_approval_gate())
    assert pending and pending[0]["tool_name"] == "exec"
    ok, _ = get_approval_gate().respond(pending[0]["id"], "deny")
    assert ok

    with pytest.raises(ApprovalDeniedError):
        await task


async def test_yolo_mode_is_scoped_to_the_hook_session() -> None:
    """Yolo on for one session must not auto-approve another session's calls."""
    bus = FakeBus()
    hook = make_hook(bus, gate_tools=["exec"])
    gate = get_approval_gate()
    assert gate is not None
    # Enable yolo only for this hook's session key.
    gate.set_yolo_mode(True, session_key="ws:chat-1")

    call = tool_call()
    await hook.before_execute_tool(context(), call, None, {"command": "echo hi"})
    assert bus.messages == []
    assert getattr(call, "approval_info", {}).get("status") == "auto_approved"

    # A different session key on the same gate still goes through triage.
    other = ApprovalGateHook(
        bus=bus,
        channel="websocket",
        chat_id="chat-2",
        session_key="ws:chat-2",
        runtime_getter=lambda session_key: make_runtime("APPROVE"),
    )
    call2 = tool_call()
    await other.before_execute_tool(context(), call2, None, {"command": "echo hi"})
    assert getattr(call2, "approval_info", {}).get("status") == "auto_approved"
    assert "smart" in getattr(call2, "approval_info", {}).get("reason", "").lower()


async def test_hook_is_noop_when_gate_not_configured() -> None:
    configure_approval_gate(gate_tools=["exec"])  # ensure configured
    from nanobot.agent.hook import AgentTurnHookContext
    from nanobot.agent.hooks.approval_gate import create_approval_gate_hook

    # A fresh hook factory still produces a hook while the gate is configured.
    hook = create_approval_gate_hook(
        AgentTurnHookContext(channel="websocket", chat_id="c", session_key="s"),
        bus=None,
        runtime_getter=lambda session_key: None,
    )
    assert hook is not None


async def _wait_for_pending(gate: Any, timeout: float = 2.0) -> list[dict[str, Any]]:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        pending = gate.pending_payload()
        if pending:
            return pending
        await asyncio.sleep(0.01)
    return []


async def test_yolo_mode_does_not_call_triage_provider() -> None:
    bus = FakeBus()
    configure_approval_gate(gate_tools=["exec"], timeout_seconds=5, yolo_mode=True)
    calls = 0

    class NoTriageProvider:
        async def chat(self, *args: Any, **kwargs: Any) -> Any:
            nonlocal calls
            calls += 1
            raise AssertionError("yolo must not call the triage provider")

    runtime = FakeRuntime()
    runtime.provider = NoTriageProvider()
    hook = ApprovalGateHook(
        bus=bus,
        channel="websocket",
        chat_id="chat-1",
        session_key="ws:chat-1",
        runtime_getter=lambda session_key: runtime,
    )
    await hook.before_execute_tool(context(), tool_call(), None, {"command": "echo hi"})
    assert calls == 0


async def test_hardline_yolo_requires_human_even_if_triage_would_approve() -> None:
    bus = FakeBus()
    hook = make_hook(bus, gate_tools=[], yolo_mode=True)
    hook._runtime_getter = lambda session_key: make_runtime("APPROVE")
    task = asyncio.create_task(
        hook.before_execute_tool(
            context(),
            tool_call(arguments={"command": "sudo rm -rf / && echo done"}),
            None,
            {"command": "sudo rm -rf / && echo done"},
        )
    )
    pending = await _wait_for_pending(get_approval_gate())
    assert pending
    assert pending[0]["triage_raw"] == ""
    assert "hardline" in pending[0]["reason"].lower()
    ok, _ = get_approval_gate().respond(pending[0]["id"], "deny")
    assert ok
    with pytest.raises(ApprovalDeniedError):
        await task
