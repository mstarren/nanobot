"""Persisted WebUI notebooks: named project spaces holding sessions + instructions.

A notebook is a named container (name + emoji) that can hold multiple chat
sessions and a block of persistent instructions. Sessions assigned to a
notebook get those instructions injected into their system prompt (the
WebUI API also mirrors them into session metadata as
``notebook_instructions`` so prompt building stays dependency-free).
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any, cast

from loguru import logger

from nanobot.config import paths as _paths


NOTEBOOK_STORE_SCHEMA_VERSION = 1
_MAX_STORE_FILE_BYTES = 256 * 1024

_MAX_NAME_LENGTH = 80
_MAX_EMOJI_LENGTH = 8
_MAX_INSTRUCTIONS_LENGTH = 4000
_SESSION_KEY_RE = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:_-"

# Metadata key mirrored into assigned sessions by the WebUI API.
NOTEBOOK_INSTRUCTIONS_METADATA_KEY = "notebook_instructions"


def notebook_store_path() -> Path:
    return _paths.get_webui_dir() / "notebooks.json"


def default_notebook_store() -> dict[str, Any]:
    return {
        "schema_version": NOTEBOOK_STORE_SCHEMA_VERSION,
        "notebooks": [],
    }


def _is_valid_session_key(key: Any) -> bool:
    if not isinstance(key, str) or not key.strip():
        return False
    if len(key) > 128:
        return False
    return all(ch in _SESSION_KEY_RE for ch in key)


def normalize_notebook(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    notebook_id = raw.get("id")
    name = raw.get("name")
    if not isinstance(notebook_id, str) or not notebook_id.strip():
        return None
    if not isinstance(name, str) or not name.strip():
        return None
    emoji = raw.get("emoji")
    instructions = raw.get("instructions")
    session_keys = raw.get("session_keys")
    if not isinstance(emoji, str):
        emoji = ""
    if not isinstance(instructions, str):
        instructions = ""
    if not isinstance(session_keys, list):
        session_keys = []
    return {
        "id": notebook_id,
        "name": name[: _MAX_NAME_LENGTH],
        "emoji": emoji[: _MAX_EMOJI_LENGTH],
        "instructions": instructions[: _MAX_INSTRUCTIONS_LENGTH],
        "session_keys": [
            key for key in session_keys if _is_valid_session_key(key)
        ],
        "created_at": raw.get("created_at") if isinstance(raw.get("created_at"), str) else None,
        "updated_at": raw.get("updated_at") if isinstance(raw.get("updated_at"), str) else None,
    }


def normalize_notebook_store(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raw = {}
    raw = cast(dict[str, Any], raw)
    notebooks: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw.get("notebooks", []):
        notebook = normalize_notebook(item)
        if notebook is None or notebook["id"] in seen:
            continue
        seen.add(notebook["id"])
        notebooks.append(notebook)
    return {
        "schema_version": NOTEBOOK_STORE_SCHEMA_VERSION,
        "notebooks": notebooks,
    }


def read_notebook_store() -> dict[str, Any]:
    path = notebook_store_path()
    if not path.is_file():
        return default_notebook_store()
    try:
        if path.stat().st_size > _MAX_STORE_FILE_BYTES:
            logger.warning("notebook store too large, ignoring: {}", path)
            return default_notebook_store()
        with open(path, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("read notebook store failed {}: {}", path, e)
        return default_notebook_store()
    return normalize_notebook_store(raw)


def write_notebook_store(raw: dict[str, Any]) -> dict[str, Any]:
    store = normalize_notebook_store(raw)
    encoded = json.dumps(
        store,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    ).encode("utf-8")
    if len(encoded) > _MAX_STORE_FILE_BYTES:
        raise ValueError("notebook store is too large")

    path = notebook_store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "wb") as f:
        f.write(encoded)
        f.write(b"\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    try:
        dir_fd = os.open(path.parent, os.O_RDONLY)
    except OSError:
        return store
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
    return store


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def list_notebooks() -> list[dict[str, Any]]:
    return read_notebook_store()["notebooks"]


def get_notebook(notebook_id: str) -> dict[str, Any] | None:
    for notebook in read_notebook_store()["notebooks"]:
        if notebook["id"] == notebook_id:
            return notebook
    return None


def create_notebook(
    *,
    name: str,
    emoji: str = "",
    instructions: str = "",
) -> dict[str, Any]:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("notebook name must be a non-empty string")
    store = read_notebook_store()
    now = _now()
    notebook = {
        "id": uuid.uuid4().hex[:12],
        "name": name.strip()[:_MAX_NAME_LENGTH],
        "emoji": emoji[: _MAX_EMOJI_LENGTH],
        "instructions": instructions[: _MAX_INSTRUCTIONS_LENGTH],
        "session_keys": [],
        "created_at": now,
        "updated_at": now,
    }
    store["notebooks"].append(notebook)
    write_notebook_store(store)
    return notebook


def update_notebook(
    notebook_id: str,
    *,
    name: str | None = None,
    emoji: str | None = None,
    instructions: str | None = None,
) -> dict[str, Any] | None:
    store = read_notebook_store()
    for notebook in store["notebooks"]:
        if notebook["id"] != notebook_id:
            continue
        if name is not None:
            if not isinstance(name, str) or not name.strip():
                raise ValueError("notebook name must be a non-empty string")
            notebook["name"] = name.strip()[:_MAX_NAME_LENGTH]
        if emoji is not None:
            notebook["emoji"] = emoji[:_MAX_EMOJI_LENGTH]
        if instructions is not None:
            notebook["instructions"] = instructions[:_MAX_INSTRUCTIONS_LENGTH]
        notebook["updated_at"] = _now()
        write_notebook_store(store)
        return notebook
    return None


def delete_notebook(notebook_id: str) -> bool:
    store = read_notebook_store()
    remaining = [n for n in store["notebooks"] if n["id"] != notebook_id]
    if len(remaining) == len(store["notebooks"]):
        return False
    store["notebooks"] = remaining
    write_notebook_store(store)
    return True


def add_session(notebook_id: str, session_key: str) -> tuple[dict[str, Any] | None, bool]:
    """Add a session to a notebook. Returns (notebook, added)."""
    if not _is_valid_session_key(session_key):
        raise ValueError("invalid session key")
    store = read_notebook_store()
    for notebook in store["notebooks"]:
        if notebook["id"] != notebook_id:
            continue
        if session_key not in notebook["session_keys"]:
            notebook["session_keys"].append(session_key)
            notebook["updated_at"] = _now()
            write_notebook_store(store)
            return notebook, True
        return notebook, False
    return None, False


def remove_session(notebook_id: str, session_key: str) -> tuple[dict[str, Any] | None, bool]:
    """Remove a session from a notebook. Returns (notebook, removed)."""
    store = read_notebook_store()
    for notebook in store["notebooks"]:
        if notebook["id"] != notebook_id:
            continue
        if session_key in notebook["session_keys"]:
            notebook["session_keys"] = [
                key for key in notebook["session_keys"] if key != session_key
            ]
            notebook["updated_at"] = _now()
            write_notebook_store(store)
            return notebook, True
        return notebook, False
    return None, False
