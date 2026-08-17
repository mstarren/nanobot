"""Tests for the approval gate (policy, smart triage, request lifecycle)."""

from __future__ import annotations

from typing import Any

import pytest

from nanobot.security.approval_gate import (
    TRIAGE_APPROVE,
    TRIAGE_DENY,
    TRIAGE_ESCALATE,
    ApprovalGate,
    _looks_hardline,
    _reasoning_detail,
    _redact_sensitive,
    approval_prompt_text,
)


class FakeProvider:
    def __init__(self, answer: str) -> None:
        self._answer = answer
        self.last_messages: list[dict[str, Any]] | None = None

    async def chat(self, messages, model=None, max_tokens=None, temperature=None, **kw):
        self.last_messages = messages
        return type("R", (), {"content": self._answer})()


class FakeRuntime:
    def __init__(self, provider: Any, model: str = "test-model") -> None:
        self.provider = provider
        self.model = model


def make_gate(**kwargs: Any) -> ApprovalGate:
    return ApprovalGate(**kwargs)


def test_policy_layer_gates_exec_and_destructive_names() -> None:
    gate = make_gate()
    assert gate.needs_approval("exec", {"command": "echo hi"}) is True
    assert gate.needs_approval("read_file", {"path": "/x"}) is False
    assert gate.needs_approval("delete_path", {"path": "/x"}) is True


def test_hardline_floor_is_always_gated() -> None:
    assert _looks_hardline("exec", {"command": "rm " + "-rf /"}) is True
    # Even an empty tool list cannot bypass the hardline floor.
    gate = make_gate(gate_tools=[])
    assert gate.needs_approval("exec", {"command": "rm " + "-rf /"}) is True


def test_sensitive_arguments_are_redacted_for_review_surfaces() -> None:
    arguments = {
        "api_token": "top-secret",
        "nested": {"password": "hunter2"},
        "command": (
            "TOKEN=inline-secret PASSWORD=\"my secret words\" "
            "curl --api-key cli-secret -H 'Authorization: Bearer sk-live-123' "
            "-u user:pass example.test"
        ),
    }
    redacted = _redact_sensitive(arguments)
    assert redacted["api_token"] == "[REDACTED]"
    assert redacted["nested"]["password"] == "[REDACTED]"
    assert "top-secret" not in str(redacted)
    assert "inline-secret" not in redacted["command"]
    assert "my secret words" not in redacted["command"]
    assert "cli-secret" not in redacted["command"]
    assert "sk-live-123" not in redacted["command"]
    assert "user:pass" not in redacted["command"]


@pytest.mark.parametrize(
    "command",
    [
        "rm -rf / # cleanup",
        "echo ok && sudo rm -rf /*",
        "printf 'ok\\n'\nrm -rf /",
        "bash -c 'rm -rf /'",
        "rm -rf /; echo done",
    ],
)
def test_hardline_floor_handles_wrappers_and_chaining(command: str) -> None:
    assert _looks_hardline("exec", {"command": command}) is True


def test_gate_all_gates_every_tool() -> None:
    gate = make_gate(gate_tools=["all"])
    assert gate.needs_approval("read_file", {"path": "/x"}) is True


@pytest.mark.parametrize(
    ("answer", "expected"),
    [
        ("APPROVE", TRIAGE_APPROVE),
        ("DENY", TRIAGE_DENY),
        ("ESCALATE", TRIAGE_ESCALATE),
        ("garbage", TRIAGE_ESCALATE),
    ],
)
async def test_smart_triage_verdict_parsing(answer: str, expected: str) -> None:
    gate = make_gate()
    provider = FakeProvider(answer)
    verdict, reason, raw = await gate.smart_triage(
        FakeRuntime(provider), "exec", {"command": "echo hi"}
    )
    assert verdict == expected
    # The system prompt must declare the tool call untrusted input.
    system_prompt = provider.last_messages[0]["content"]
    assert "UNTRUSTED INPUT" in system_prompt
    # … and must demand a verdict + one-sentence explanation so the surfaced
    # reason describes what was assessed, not just the verdict word.
    assert "one-sentence explanation" in system_prompt


async def test_smart_triage_failure_escalates_fail_closed() -> None:
    class BoomProvider:
        async def chat(self, *args: Any, **kwargs: Any) -> Any:
            raise RuntimeError("boom")

    gate = make_gate()
    verdict, reason, raw = await gate.smart_triage(
        FakeRuntime(BoomProvider()), "exec", {"command": "x"}
    )
    assert verdict == TRIAGE_ESCALATE


async def test_smart_triage_disabled_escalates() -> None:
    gate = make_gate(smart_mode=False)
    verdict, reason, raw = await gate.smart_triage(
        FakeRuntime(FakeProvider("APPROVE")), "exec", {"command": "echo hi"}
    )
    assert verdict == TRIAGE_ESCALATE


def test_reasoning_detail_uses_last_paragraph() -> None:
    """The CoT fallback must surface the conclusion, not the opening
    task-restatement paragraph."""
    response = type(
        "R",
        (),
        {
            "reasoning_content": (
                "We need to assess the tool call: `exec: echo hi`\n\n"
                "The command only prints text and has no side effects, so it is safe."
            )
        },
    )()
    detail = _reasoning_detail(response)
    assert "prints text and has no side effects" in detail
    assert "We need to assess" not in detail


def test_reasoning_detail_handles_empty_trace() -> None:
    response = type("R", (), {"reasoning_content": ""})()
    assert _reasoning_detail(response) == ""


async def test_request_lifecycle_approve() -> None:
    gate = make_gate()
    req = gate.create_request(
        tool_name="exec",
        arguments={"command": "echo hi"},
        verdict=TRIAGE_ESCALATE,
        reason="uncertain",
        triage_raw="ESCALATE",
        channel="websocket",
        chat_id="c1",
        session_key="s1",
    )
    prompt = approval_prompt_text(req)
    assert "Approval required" in prompt
    assert '"command": "echo hi"' in prompt
    ok, _ = gate.respond(req.id, "approve")
    assert ok
    assert gate.pending_payload() == []


async def test_request_lifecycle_deny() -> None:
    gate = make_gate()
    req = gate.create_request(
        tool_name="exec",
        arguments={},
        verdict=TRIAGE_DENY,
        reason="dangerous",
        triage_raw="DENY",
        channel="websocket",
        chat_id="c1",
        session_key="s1",
    )
    ok, _ = gate.respond(req.id, "deny")
    assert ok
    assert await gate.wait(req) is False


async def test_respond_unknown_or_double_is_rejected() -> None:
    gate = make_gate()
    assert gate.respond("nope", "approve")[0] is False
    req = gate.create_request(
        tool_name="exec",
        arguments={},
        verdict=TRIAGE_ESCALATE,
        reason="r",
        triage_raw="ESCALATE",
        channel="websocket",
        chat_id="c1",
        session_key="s1",
    )
    assert gate.respond(req.id, "approve")[0] is True
    assert gate.respond(req.id, "approve")[0] is False


async def test_timeout_counts_as_denial() -> None:
    gate = make_gate(timeout_seconds=0.05)
    req = gate.create_request(
        tool_name="exec",
        arguments={},
        verdict=TRIAGE_ESCALATE,
        reason="r",
        triage_raw="ESCALATE",
        channel="websocket",
        chat_id="c1",
        session_key="s1",
    )
    assert await gate.wait(req) is False
    assert gate.pending_payload() == []


async def test_pending_payload_shape_includes_expiry() -> None:
    gate = make_gate(timeout_seconds=300)
    gate.create_request(
        tool_name="exec",
        arguments={"command": "ls"},
        verdict=TRIAGE_ESCALATE,
        reason="uncertain",
        triage_raw="ESCALATE",
        channel="websocket",
        chat_id="c1",
        session_key="s1",
    )
    payload = gate.pending_payload()
    assert len(payload) == 1
    assert payload[0]["tool_name"] == "exec"
    assert payload[0]["arguments"] == {"command": "ls"}
    assert 0 < payload[0]["expires_in_seconds"] <= 300
    # The request payload itself (used for the persisted audit record) also
    # carries a live expiry so the WebUI can render countdowns after the fact.
    assert "expires_in_seconds" in payload[0]
