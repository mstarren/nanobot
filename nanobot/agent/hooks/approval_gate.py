"""Agent hook that gates risky tool calls behind smart triage + user approval.

Wiring (proof of concept):

- ``create_approval_gate_hook`` is registered as an ``AgentTurnHookFactory``
  by the gateway composition layer (``cli/gateway_runtime.py``).
- Before a gated tool executes, the hook runs smart triage (auxiliary LLM).
  APPROVE lets the call through; DENY/ESCALATE emit a user-visible prompt
  (reason + full tool call) and block until the user responds through the
  WebUI (``/api/approval/respond``).  Denial raises ``ApprovalDeniedError``,
  which the runner converts into a non-fatal tool error the model can adapt
  to.  Expiry (timeout) counts as denial.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from typing import Any

from loguru import logger

from nanobot.agent.hook import AgentHook, AgentTurnHookContext
from nanobot.bus.events import OUTBOUND_META_AGENT_UI, OutboundMessage
from nanobot.bus.outbound_events import ProgressEvent
from nanobot.providers.base import ToolCallRequest
from nanobot.security.approval_gate import (
    TRIAGE_APPROVE,
    ApprovalDeniedError,
    _looks_hardline,
    approval_prompt_text,
    approval_ui_payload,
    get_approval_gate,
)


def _attach_approval_info(
    tool_call: Any,
    *,
    status: str,
    verdict: str,
    reason: str,
    triage_raw: str,
    request_id: str | None,
    expires_in_seconds: float | None = None,
) -> None:
    """Attach structured approval info to the tool call.

    The runner's tool-event emitter picks this up, so the approval record
    (call, triage LLM response, status, decision) persists with the session's
    tool events and is expandable in the WebUI after the fact.
    """
    info: dict[str, Any] = {
        "status": status,
        "verdict": verdict,
        "reason": reason,
        "triage_raw": triage_raw,
        "request_id": request_id,
        "decided_at_ms": int(time.time() * 1000),
    }
    if expires_in_seconds is not None:
        info["expires_in_seconds"] = expires_in_seconds
    try:
        tool_call.approval_info = info
    except Exception:  # noqa: BLE001 - metadata must never break the gate
        pass


class ApprovalGateHook(AgentHook):
    """Block gated tool calls until smart triage or the user approves."""

    def __init__(
        self,
        *,
        bus: Any,
        channel: str,
        chat_id: str,
        session_key: str,
        runtime_getter: Callable[[str], Any] | None = None,
    ) -> None:
        super().__init__(reraise=True)
        self._bus = bus
        self._channel = channel
        self._chat_id = chat_id
        self._session_key = session_key or ""
        self._runtime_getter = runtime_getter

    async def before_execute_tool(
        self,
        context: Any,
        tool_call: ToolCallRequest,
        tool: Any,
        params: Any,
    ) -> None:
        gate = get_approval_gate()
        if gate is None:
            return
        arguments = (
            tool_call.arguments
            if tool_call.arguments is not None
            else params
        )
        if not gate.needs_approval(tool_call.name, arguments):
            return

        if gate.yolo_mode and not _looks_hardline(tool_call.name, arguments):
            # Yolo mode: skip triage and the human prompt, approve outright.
            # The hardline DENY floor still applies and is always reviewed.
            logger.info(
                "Approval gate: yolo mode auto-approved tool={} call_id={}",
                tool_call.name,
                tool_call.id,
            )
            _attach_approval_info(
                tool_call,
                status="auto_approved",
                verdict=TRIAGE_APPROVE,
                reason="YOLO mode is enabled — approved without review.",
                triage_raw="",
                request_id=None,
            )
            return

        runtime = self._runtime(session_key=self._session_key)
        if runtime is None:
            logger.warning(
                "Approval gate: no runtime for tool={} — allowing (fail-open)",
                tool_call.name,
            )
            return

        verdict, reason, triage_raw = await gate.smart_triage(
            runtime,
            tool_call.name,
            arguments,
        )
        if verdict == TRIAGE_APPROVE:
            logger.info(
                "Approval gate: smart-approved tool={} call_id={}",
                tool_call.name,
                tool_call.id,
            )
            _attach_approval_info(
                tool_call,
                status="auto_approved",
                verdict=verdict,
                reason=reason,
                triage_raw=triage_raw,
                request_id=None,
            )
            return

        request = gate.create_request(
            tool_name=tool_call.name,
            arguments=arguments,
            verdict=verdict,
            reason=reason,
            triage_raw=triage_raw,
            channel=self._channel,
            chat_id=self._chat_id,
            session_key=self._session_key,
        )
        _attach_approval_info(
            tool_call,
            status="pending",
            verdict=verdict,
            reason=reason,
            triage_raw=triage_raw,
            request_id=request.id,
            expires_in_seconds=request.payload().get("expires_in_seconds"),
        )
        await self._emit_prompt(request)
        try:
            approved = await gate.wait(request)
        except asyncio.CancelledError:
            gate.deny_request(request.id)
            _attach_approval_info(
                tool_call,
                status="cancelled",
                verdict=verdict,
                reason=reason,
                triage_raw=triage_raw,
                request_id=request.id,
                expires_in_seconds=request.payload().get("expires_in_seconds"),
            )
            raise
        if approved:
            _attach_approval_info(
                tool_call,
                status="approved",
                verdict=verdict,
                reason=reason,
                triage_raw=triage_raw,
                request_id=request.id,
                expires_in_seconds=request.payload().get("expires_in_seconds"),
            )
            return
        # Denied (either by the user or by expiry — timeout counts as denial).
        _attach_approval_info(
            tool_call,
            status="denied",
            verdict=verdict,
            reason=reason,
            triage_raw=triage_raw,
            request_id=request.id,
            expires_in_seconds=request.payload().get("expires_in_seconds"),
        )
        raise ApprovalDeniedError(
            f"tool '{tool_call.name}' was not approved by the user"
            + (f" ({reason})" if reason else "")
        )

    async def _emit_prompt(self, request: Any) -> None:
        """Publish a progress frame with the reason + full tool call."""
        if self._bus is None:
            return
        text = approval_prompt_text(request)
        try:
            await self._bus.publish_outbound(
                OutboundMessage(
                    channel=self._channel,
                    chat_id=self._chat_id,
                    content=text,
                    metadata={
                        OUTBOUND_META_AGENT_UI: approval_ui_payload(request),
                    },
                    event=ProgressEvent(content=text),
                )
            )
        except Exception:  # noqa: BLE001 - the gate must not crash the turn
            logger.exception("Approval gate: failed to emit approval prompt")

    def _runtime(self, *, session_key: str) -> Any | None:
        if self._runtime_getter is None:
            return None
        try:
            return self._runtime_getter(session_key)
        except Exception:  # noqa: BLE001
            logger.exception("Approval gate: runtime lookup failed")
            return None


def create_approval_gate_hook(
    context: AgentTurnHookContext,
    *,
    bus: Any = None,
    runtime_getter: Callable[[str], Any] | None = None,
) -> AgentHook | None:
    """Create the per-turn approval gate hook (no-op when unconfigured)."""
    if get_approval_gate() is None:
        return None
    return ApprovalGateHook(
        bus=bus,
        channel=context.channel,
        chat_id=context.chat_id,
        session_key=context.session_key or "",
        runtime_getter=runtime_getter,
    )
