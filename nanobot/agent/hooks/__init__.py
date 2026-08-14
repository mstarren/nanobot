"""Concrete agent hook implementations."""

from nanobot.agent.hooks.approval_gate import (
    ApprovalGateHook,
    create_approval_gate_hook,
)
from nanobot.agent.hooks.file_edit_activity import (
    FileEditActivityHook,
    create_file_edit_activity_hook,
)

__all__ = [
    "ApprovalGateHook",
    "FileEditActivityHook",
    "create_approval_gate_hook",
    "create_file_edit_activity_hook",
]
