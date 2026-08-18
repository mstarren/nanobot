"""Tests for the persisted WebUI notebook store."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nanobot.webui import notebook_store as store


@pytest.fixture(autouse=True)
def _isolate_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("nanobot.config.paths.get_webui_dir", lambda: tmp_path / "webui")


def test_default_store_is_empty() -> None:
    assert store.list_notebooks() == []


def test_create_notebook_roundtrip() -> None:
    notebook = store.create_notebook(name="Research", emoji="🔬", instructions="Be precise.")
    assert notebook["name"] == "Research"
    assert notebook["emoji"] == "🔬"
    assert notebook["instructions"] == "Be precise."
    assert notebook["session_keys"] == []
    assert notebook["created_at"] and notebook["updated_at"]

    # Persisted to disk and reloaded.
    stored = store.read_notebook_store()
    assert stored["schema_version"] == store.NOTEBOOK_STORE_SCHEMA_VERSION
    assert [n["id"] for n in stored["notebooks"]] == [notebook["id"]]


def test_create_notebook_requires_name() -> None:
    with pytest.raises(ValueError, match="name"):
        store.create_notebook(name="   ")


def test_create_notebook_truncates_long_fields() -> None:
    notebook = store.create_notebook(
        name="x" * 500,
        emoji="y" * 50,
        instructions="z" * 10_000,
    )
    assert len(notebook["name"]) == store._MAX_NAME_LENGTH
    assert len(notebook["emoji"]) == store._MAX_EMOJI_LENGTH
    assert len(notebook["instructions"]) == store._MAX_INSTRUCTIONS_LENGTH


def test_update_notebook() -> None:
    notebook = store.create_notebook(name="A", instructions="one")
    updated = store.update_notebook(
        notebook["id"], name="B", emoji="📚", instructions="two"
    )
    assert updated is not None
    assert updated["name"] == "B"
    assert updated["instructions"] == "two"
    assert store.get_notebook(notebook["id"])["name"] == "B"
    assert store.update_notebook("missing", name="X") is None


def test_delete_notebook() -> None:
    notebook = store.create_notebook(name="A")
    assert store.delete_notebook(notebook["id"]) is True
    assert store.get_notebook(notebook["id"]) is None
    assert store.delete_notebook(notebook["id"]) is False


def test_add_and_remove_session() -> None:
    notebook = store.create_notebook(name="A")
    updated, added = store.add_session(notebook["id"], "websocket:chat-1")
    assert added is True
    assert "websocket:chat-1" in updated["session_keys"]

    # Idempotent add.
    _, added_again = store.add_session(notebook["id"], "websocket:chat-1")
    assert added_again is False

    removed, was_removed = store.remove_session(notebook["id"], "websocket:chat-1")
    assert was_removed is True
    assert removed["session_keys"] == []

    # Unknown notebook.
    missing, _ = store.add_session("nope", "websocket:chat-1")
    assert missing is None


def test_add_session_rejects_invalid_keys() -> None:
    notebook = store.create_notebook(name="A")
    with pytest.raises(ValueError):
        store.add_session(notebook["id"], "../evil path")
    with pytest.raises(ValueError):
        store.add_session(notebook["id"], "x" * 200)


def test_normalize_drops_malformed_entries(tmp_path: Path) -> None:
    path = tmp_path / "webui" / "notebooks.json"
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "notebooks": [
                    {"id": "ok1", "name": "Good", "session_keys": ["websocket:c", 42, "../bad"]},
                    {"name": "no-id"},
                    {"id": "ok1", "name": "Dup"},
                ]
            }
        ),
        encoding="utf-8",
    )
    notebooks = store.list_notebooks()
    assert len(notebooks) == 1
    assert notebooks[0]["id"] == "ok1"
    assert notebooks[0]["session_keys"] == ["websocket:c"]


def test_corrupt_store_recovers_to_default(tmp_path: Path) -> None:
    path = tmp_path / "webui" / "notebooks.json"
    path.parent.mkdir(parents=True)
    path.write_text("{not json", encoding="utf-8")
    assert store.list_notebooks() == []
