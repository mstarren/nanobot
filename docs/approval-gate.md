# Approval Gate (Human-in-the-Loop Tool Approval)

The approval gate protects risky tool calls with a layered, fail-closed review
pipeline: a deterministic policy layer decides *what* needs review, a smart
triage LLM filters false positives, and a human can approve or deny anything
that reaches them through the WebUI.

It is a **proof-of-concept** feature: the policy and surfaces work end to end,
but the operator-facing configuration is environment-variable only and there is
no persistence for pending requests across gateway restarts.

## How it works

1. **Policy layer** (`ApprovalGate.needs_approval`) — a tool call is gated if:
   - it matches the hardline floor (e.g. `rm -rf /`, `mkfs`, `dd of=/dev/…`,
     fork bombs, shutdown/poweroff/reboot) — this is unbypassable even when no
     tools are configured, or
   - the tool name is destructive (`delete`, `remove`, `wipe`, `drop`,
     `destroy`, `unlink`), or
   - the tool is in `NANOBOT_APPROVAL_GATE_TOOLS` (or `all` is set).
2. **Smart triage** — an auxiliary LLM call (temperature 0, small output
   budget) classifies the call as `APPROVE`, `DENY`, or `ESCALATE`. The tool
   call is wrapped in `<tool_call>` delimiters and treated as **untrusted
   input** in the triage system prompt; shell comments are stripped. Any
   triage failure or ambiguity **escalates to a human** (fail-closed).
3. **Human review** — `DENY`/`ESCALATE` verdicts publish a user-visible prompt
   (triage reason + full tool call) and block the tool call until the user
   responds through the WebUI popup (`/api/approval/list`,
   `/api/approval/respond`) or the request times out. **Timeout counts as
   denial.**
4. **Agent adaptation** — a denied call is returned to the model as a
   non-fatal tool error (`Tool call DENIED by the user approval gate: …`), so
   the agent can change its approach instead of failing the turn.

Every gated call leaves a structured audit record in the session's activity
timeline (expandable in the WebUI): the tool call, the triage verdict and raw
response, the approval status, and the tool result.

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `NANOBOT_APPROVAL_GATE_TOOLS` | `exec` | Comma-separated tool names to gate, or `all` to gate every tool. The destructive-name heuristic and the hardline floor apply regardless. |
| `NANOBOT_APPROVAL_SMART` | `1` | `1`/`0` — enable the smart-triage LLM. When disabled, every gated call escalates straight to the user. |
| `NANOBOT_APPROVAL_TIMEOUT_SECONDS` | `600` | How long a pending request waits before it is treated as denied. |
| `NANOBOT_APPROVAL_MODEL` | unset | Optional model override for the triage call. Defaults to the session's model. |
| `NANOBOT_APPROVAL_SMART_POLICY` | unset | Operator-written rules appended to the triage system prompt (trusted, unlike the tool-call text). |

> **Note:** when the gateway runs with the gate enabled (the default), every
> gated tool call incurs one auxiliary triage LLM call before it runs, plus a
> blocking wait when the verdict is `DENY`/`ESCALATE`.

## Security model

- **Fail-closed**: triage errors, disabled triage, and timeouts all escalate or
  deny; they never silently approve.
- **Unbypassable floor**: the hardline patterns are evaluated before any
  configuration and can never be turned off — **including in yolo mode**.
- **Anti-injection hygiene**: the tool call is untrusted input to the triage
  model; operator policy only ever lives in the system prompt.
- **Headless sessions** (cron, CLI, non-WebUI channels) have no interactive
  response path: an escalated call blocks until the timeout and is then
  denied. Plan automation accordingly (`NANOBOT_APPROVAL_TIMEOUT_SECONDS`).

## Yolo mode (WebUI pill)

Yolo mode is a runtime toggle surfaced as a **YOLO pill in the composer**, to
the right of the workspace access mode. While ON, gated tool calls are
**auto-approved without triage or a human prompt**; the approval record is
still attached to the tool event (status `auto_approved`, reason "YOLO mode
is enabled — approved without review.").

- Toggled live from the WebUI via `POST /api/approval/yolo` (`{enabled,
  session}`); no restart required. The toggle is **session-scoped**: pass the
  session key (e.g. `websocket:<chat_id>`) to flip yolo mode for that session
  only; omit it to change the default for sessions without an explicit
  override. State is reported in the settings payload (`approval.yolo_mode`
  default + `approval.yolo_sessions` overrides) and resets when the gateway
  restarts.
- The hardline DENY floor still applies: hardline commands are always
  reviewed, never auto-approved by yolo mode.
- Yolo mode does not change triage behavior for any call that is not gated
  by the policy layer.

## Known limitations (POC)

- Pending requests live in gateway process memory; a restart drops them.
- The hardline patterns are anchored shell commands (for example `rm -rf /`),
  not a general sandbox — treat them as defense-in-depth, not a boundary.
- The WebUI popup surfaces one request at a time (queue count is shown when
  several are pending).

## Tests

```bash
pytest tests/security/test_approval_gate.py tests/agent/test_approval_gate_hook.py
```
