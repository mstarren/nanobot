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
    reset_approval_gate,
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


def make_hook(bus: FakeBus, *, gate_tools: list[str] | None = None) -> ApprovalGateHook:
    configure_approval_gate(gate_tools=gate_tools if gate_tools is not None else ["exec"], timeout_seconds=5)
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


async def test_hardline_command_bypasses_approve_triage() -> None:
    bus = FakeBus()
    hook = make_hook(bus, gate_tools=[])
    task = asyncio.create_task(
        hook.before_execute_tool(
            context(),
            tool_call(arguments={"command": "rm " + "-rf /"}),
            None,
            {"command": "rm " + "-rf /"},
        )
    )
    pending = await _wait_for_pending(get_approval_gate())
    assert pending and pending[0]["reason"].startswith("hardline command")
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


async def test_missing_runtime_escalates_to_human() -> None:
    bus = FakeBus()
    configure_approval_gate(gate_tools=["exec"], timeout_seconds=5)
    hook = ApprovalGateHook(
        bus=bus,
        channel="websocket",
        chat_id="chat-1",
        session_key="ws:chat-1",
        runtime_getter=lambda session_key: None,
    )
    task = asyncio.create_task(
        hook.before_execute_tool(context(), tool_call(), None, {"command": "echo hi"})
    )
    pending = await _wait_for_pending(get_approval_gate())
    assert pending and "no triage runtime" in pending[0]["reason"]
    ok, _ = get_approval_gate().respond(pending[0]["id"], "deny")
    assert ok
    with pytest.raises(ApprovalDeniedError):
        await task


async def test_hook_factory_returns_hook_when_gate_is_configured() -> None:
    bus = FakeBus()
    make_hook(bus)
    from nanobot.agent.hook import AgentTurnHookContext
    from nanobot.agent.hooks.approval_gate import create_approval_gate_hook

    hook = create_approval_gate_hook(
        AgentTurnHookContext(channel="websocket", chat_id="c", session_key="s"),
        bus=bus,
        runtime_getter=lambda session_key: None,
    )
    assert hook is not None
    reset_approval_gate()


async def test_hook_factory_is_noop_when_gate_not_configured() -> None:
    reset_approval_gate()
    from nanobot.agent.hook import AgentTurnHookContext
    from nanobot.agent.hooks.approval_gate import create_approval_gate_hook

    hook = create_approval_gate_hook(
        AgentTurnHookContext(channel="websocket", chat_id="c", session_key="s"),
        bus=None,
        runtime_getter=lambda session_key: None,
    )
    assert hook is None


async def _wait_for_pending(gate: Any, timeout: float = 2.0) -> list[dict[str, Any]]:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        pending = gate.pending_payload()
        if pending:
            return pending
        await asyncio.sleep(0.01)
    return []
