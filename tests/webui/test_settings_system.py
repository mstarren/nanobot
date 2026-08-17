from __future__ import annotations

from nanobot.config.schema import Config
from nanobot.security.approval_gate import configure_approval_gate
from nanobot.webui.settings_contracts import SettingsRequest
from nanobot.webui.settings_system import SystemSettingsHandler
from nanobot.webui.settings_system import (
    coerce_channel_value,
    system_settings_payload,
    update_agent_system_settings,
)


def test_system_domain_owns_runtime_dto_and_agent_updates(tmp_path) -> None:
    config = Config()

    changed, restart_required = update_agent_system_settings(
        config,
        {
            "timezone": ["Asia/Shanghai"],
            "tool_hint_max_length": ["120"],
        },
    )
    payload = system_settings_payload(
        config,
        config_path=tmp_path / "config.json",
        version="0.3.0",
    )

    assert changed is True
    assert restart_required is True
    assert config.agents.defaults.timezone == "Asia/Shanghai"
    assert config.agents.defaults.timezone_mode == "manual"
    assert config.agents.defaults.tool_hint_max_length == 120
    assert payload["runtime"]["config_path"] == str(tmp_path / "config.json")
    assert payload["version"] == {"current": "0.3.0"}
    assert payload["docs"]["version"] == "0.3.0"
    assert set(payload) == {"runtime", "usage", "advanced", "version", "docs", "approval"}


def test_system_domain_validates_channel_field_values() -> None:
    assert coerce_channel_value("allow_from", "alice, bob", "list") == [
        "alice",
        "bob",
    ]
    assert coerce_channel_value("enabled", "yes", "bool") is True
    assert coerce_channel_value("port", "8765", "int") == 8765


def _approval_handler() -> SystemSettingsHandler:
    handler = object.__new__(SystemSettingsHandler)
    handler.logger = None
    return handler


def test_approval_yolo_route_parses_boolean_and_session_cap() -> None:
    configure_approval_gate(gate_tools=["exec"])
    handler = _approval_handler()
    result = handler._approval_yolo(
        SettingsRequest(query={"enabled": ["true"], "session": ["websocket:chat-1"]})
    )
    assert result.status == 200
    assert result.payload["yolo_sessions"] == {"websocket:chat-1": True}

    invalid = handler._approval_yolo(SettingsRequest(query={"enabled": ["maybe"]}))
    assert invalid.status == 400
    too_long = handler._approval_yolo(
        SettingsRequest(query={"enabled": ["true"], "session": ["x" * 257]})
    )
    assert too_long.status == 400


def test_approval_yolo_route_requires_gate_and_enabled() -> None:
    from nanobot.security import approval_gate

    approval_gate._gate = None
    handler = _approval_handler()
    unavailable = handler._approval_yolo(SettingsRequest(query={"enabled": ["true"]}))
    assert unavailable.status == 503

    configure_approval_gate(gate_tools=["exec"])
    missing = handler._approval_yolo(SettingsRequest(query={}))
    assert missing.status == 400
