"""Tests for the WebUI notebook HTTP routes and mutation wiring."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from nanobot.webui import notebook_store as store
from nanobot.webui.ws_http import GatewayHTTPHandler

NOTEBOOK_INSTRUCTIONS_METADATA_KEY = store.NOTEBOOK_INSTRUCTIONS_METADATA_KEY


@pytest.fixture(autouse=True)
def _isolate_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("nanobot.config.paths.get_webui_dir", lambda: tmp_path / "webui")


class _FakeSessionManager:
    """Minimal SessionManager stand-in that persists metadata in memory."""

    def __init__(self) -> None:
        self.metadata_by_key: dict[str, dict[str, object]] = {
            "websocket:chat-1": {"title": "Existing chat"},
        }

    def read_session_metadata(self, key: str) -> dict[str, object] | None:
        return self.metadata_by_key.get(key)

    def get_or_create(self, key: str):
        session = MagicMock()
        session.key = key
        session.metadata = dict(self.metadata_by_key.get(key, {}))
        return session

    def save(self, session: MagicMock) -> None:
        self.metadata_by_key[session.key] = dict(session.metadata)

    def list_sessions(self):
        return [{"key": key} for key in self.metadata_by_key]


def _handler(session_manager: _FakeSessionManager | None) -> GatewayHTTPHandler:
    handler = object.__new__(GatewayHTTPHandler)
    handler.session_manager = session_manager
    handler.check_api_token = lambda request: True  # type: ignore[method-assign]
    handler._log = MagicMock()
    return handler


def _payload_response(request: MagicMock, payload: dict[str, object]) -> MagicMock:
    request.raw = MagicMock()
    setattr(request, "_nanobot_webui_mutation_payload", dict(payload))
    return request


def _json(response: object) -> dict[str, object]:
    return json.loads(response.body.decode("utf-8"))  # type: ignore[attr-defined]


def test_notebook_mutation_paths() -> None:
    assert GatewayHTTPHandler._webui_mutation_path("notebook.create", {}) == "/api/notebooks"
    assert (
        GatewayHTTPHandler._webui_mutation_path(
            "notebook.update", {"notebook_id": "nb123"}
        )
        == "/api/notebooks/nb123/update"
    )
    assert (
        GatewayHTTPHandler._webui_mutation_path(
            "notebook.delete", {"notebook_id": "nb123"}
        )
        == "/api/notebooks/nb123/delete"
    )
    assert (
        GatewayHTTPHandler._webui_mutation_path(
            "notebook.session_add", {"notebook_id": "nb123"}
        )
        == "/api/notebooks/nb123/sessions/add"
    )
    assert (
        GatewayHTTPHandler._webui_mutation_path(
            "notebook.session_remove",
            {"notebook_id": "nb123", "session_key": "websocket:chat-1"},
        )
        == "/api/notebooks/nb123/sessions/websocket%3Achat-1/remove"
    )
    bad = GatewayHTTPHandler._webui_mutation_path(
        "notebook.update", {"notebook_id": "bad id!"}
    )
    assert bad.status_code == 400


def test_notebook_is_mutation_path() -> None:
    handler = object.__new__(GatewayHTTPHandler)
    handler.settings_routes = MagicMock()
    handler.settings_routes.is_mutation_path = lambda path: False
    assert handler._is_webui_mutation_path("/api/notebooks/nb123/update")
    assert handler._is_webui_mutation_path("/api/notebooks/nb123/sessions/add")
    assert not handler._is_webui_mutation_path("/api/notebooks")


def test_notebook_list_route() -> None:
    store.create_notebook(name="Research", emoji="🔬")
    handler = _handler(None)
    payload = _json(handler._handle_notebooks(MagicMock()))
    assert len(payload["notebooks"]) == 1
    assert payload["notebooks"][0]["name"] == "Research"


def test_notebook_create_route_via_mutation_payload(tmp_path: Path) -> None:
    """notebook.create must actually create (regression: it used to no-op)."""
    handler = _handler(None)
    request = _payload_response(
        MagicMock(),
        {"name": "Research", "emoji": "🔬", "instructions": "v1"},
    )
    response = handler._handle_notebooks(request)
    payload = _json(response)
    assert "notebook" in payload
    nb = payload["notebook"]
    assert nb["name"] == "Research"
    assert nb["emoji"] == "🔬"
    assert nb["instructions"] == "v1"
    assert store.get_notebook(nb["id"]) is not None

    # A plain GET (no mutation payload) still lists.
    listed = _json(handler._handle_notebooks(MagicMock()))
    assert len(listed["notebooks"]) == 1
    assert listed["notebooks"][0]["id"] == nb["id"]

    # Missing name is a 400, not a silent no-op.
    bad = handler._handle_notebooks(
        _payload_response(MagicMock(), {"emoji": "🔬"})
    )
    assert bad.status_code == 400


def test_notebook_create_and_update_route(tmp_path: Path) -> None:
    handler = _handler(None)
    nb = store.create_notebook(name="Research", instructions="v1")
    nb_id = nb["id"]

    request = _payload_response(
        MagicMock(),
        {"notebook_id": nb_id, "name": "Research v2", "instructions": "v2"},
    )
    updated = _json(
        handler._handle_notebook_mutation(request, nb_id, "update")
    )
    assert updated["notebook"]["name"] == "Research v2"
    assert updated["notebook"]["instructions"] == "v2"

    missing = handler._handle_notebook_mutation(
        _payload_response(MagicMock(), {"notebook_id": "nope", "name": "X"}),
        "nope",
        "update",
    )
    assert missing.status_code == 404


def test_notebook_delete_route_clears_session_instructions(tmp_path: Path) -> None:
    sessions = _FakeSessionManager()
    handler = _handler(sessions)
    nb = store.create_notebook(name="Research", instructions="keep it tight")
    store.add_session(nb["id"], "websocket:chat-1")
    handler._apply_notebook_instructions(nb, "websocket:chat-1")
    assert sessions.metadata_by_key["websocket:chat-1"][
        NOTEBOOK_INSTRUCTIONS_METADATA_KEY
    ] == "keep it tight"

    response = handler._handle_notebook_mutation(
        _payload_response(MagicMock(), {"notebook_id": nb["id"]}),
        nb["id"],
        "delete",
    )
    assert _json(response)["deleted"] is True
    assert store.get_notebook(nb["id"]) is None
    assert NOTEBOOK_INSTRUCTIONS_METADATA_KEY not in sessions.metadata_by_key[
        "websocket:chat-1"
    ]


def test_notebook_session_add_route_injects_instructions(tmp_path: Path) -> None:
    sessions = _FakeSessionManager()
    handler = _handler(sessions)
    nb = store.create_notebook(name="Research", instructions="answer in Japanese")

    response = handler._handle_notebook_mutation(
        _payload_response(
            MagicMock(), {"notebook_id": nb["id"], "session_key": "websocket:chat-1"}
        ),
        nb["id"],
        "sessions/add",
    )
    payload = _json(response)
    assert payload["added"] is True
    assert "websocket:chat-1" in payload["notebook"]["session_keys"]
    assert sessions.metadata_by_key["websocket:chat-1"][
        NOTEBOOK_INSTRUCTIONS_METADATA_KEY
    ] == "answer in Japanese"

    # Adding a session that does not exist skips metadata injection.
    response2 = handler._handle_notebook_mutation(
        _payload_response(
            MagicMock(), {"notebook_id": nb["id"], "session_key": "websocket:ghost"}
        ),
        nb["id"],
        "sessions/add",
    )
    assert _json(response2)["added"] is True
    assert "websocket:ghost" not in sessions.metadata_by_key


def test_notebook_session_remove_route_clears_instructions(tmp_path: Path) -> None:
    sessions = _FakeSessionManager()
    handler = _handler(sessions)
    nb = store.create_notebook(name="Research", instructions="injected")
    store.add_session(nb["id"], "websocket:chat-1")
    handler._apply_notebook_instructions(nb, "websocket:chat-1")

    response = handler._handle_notebook_session_remove(
        MagicMock(), nb["id"], "websocket%3Achat-1"
    )
    payload = _json(response)
    assert payload["removed"] is True
    assert payload["notebook"]["session_keys"] == []
    assert NOTEBOOK_INSTRUCTIONS_METADATA_KEY not in sessions.metadata_by_key[
        "websocket:chat-1"
    ]


def test_notebook_update_propagates_instructions_to_assigned_sessions(
    tmp_path: Path,
) -> None:
    sessions = _FakeSessionManager()
    handler = _handler(sessions)
    nb = store.create_notebook(name="Research", instructions="v1")
    store.add_session(nb["id"], "websocket:chat-1")
    handler._apply_notebook_instructions(nb, "websocket:chat-1")

    request = _payload_response(
        MagicMock(),
        {"notebook_id": nb["id"], "name": "Research", "instructions": "v2"},
    )
    handler._handle_notebook_mutation(request, nb["id"], "update")
    assert sessions.metadata_by_key["websocket:chat-1"][
        NOTEBOOK_INSTRUCTIONS_METADATA_KEY
    ] == "v2"
