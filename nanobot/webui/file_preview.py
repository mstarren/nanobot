"""Workspace-scoped source preview payloads for the WebUI."""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from nanobot.config.paths import get_media_dir
from nanobot.security.workspace_access import WorkspaceScope
from nanobot.security.workspace_policy import WorkspaceBoundaryError, resolve_allowed_path

MAX_FILE_PREVIEW_BYTES = 384 * 1024

# Media kinds are served through the signed media route instead of the JSON
# payload. ``text``-like kinds carry their content inline.
MEDIA_PREVIEW_KINDS: frozenset[str] = frozenset({"image", "pdf", "video"})

_VIDEO_PREVIEW_EXTS: frozenset[str] = frozenset({
    ".m4v",
    ".mov",
    ".mp4",
    ".webm",
})

_MARKDOWN_EXTS: frozenset[str] = frozenset({".md", ".mdx"})
_HTML_EXTS: frozenset[str] = frozenset({".htm", ".html", ".xhtml"})


class WebUIFilePreviewError(ValueError):
    """Raised when a file cannot be previewed through the WebUI."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def file_preview_payload(
    raw_path: str | None,
    *,
    scope: WorkspaceScope,
    max_bytes: int = MAX_FILE_PREVIEW_BYTES,
    media_signer: Callable[[Path], Mapping[str, Any] | None] | None = None,
    markdown_image_rewriter: Callable[[str], str] | None = None,
) -> dict[str, Any]:
    """Return a preview payload for a file allowed by the session workspace scope.

    ``kind`` classifies the preview: ``text``/``markdown``/``html``/``csv``
    payloads carry ``content`` inline, while ``image``/``pdf``/``video``
    payloads carry a signed ``media_url`` (served by the WebUI media route)
    instead. ``media_signer`` must map a resolved path to ``{"url": ...}``;
    when it is omitted, media files are rejected like other binaries.
    ``markdown_image_rewriter`` is applied to markdown content so local
    images (``![](x.png)``) become signed media URLs.
    """

    resolved = _resolve_preview_path(raw_path, scope=scope)

    with open(resolved, "rb") as f:
        prefix = f.read(4096)

    kind = _kind_for_path_and_prefix(resolved, prefix)
    if kind in MEDIA_PREVIEW_KINDS:
        if media_signer is None:
            raise WebUIFilePreviewError(415, "binary files cannot be previewed")
        signed = media_signer(resolved)
        if not signed or "url" not in signed:
            raise WebUIFilePreviewError(415, "binary files cannot be previewed")
        return {
            "path": str(resolved),
            "display_path": _display_path(resolved, scope.project_path),
            "project_path": str(scope.project_path),
            "kind": kind,
            "language": _language_for_path(resolved),
            "content": "",
            "media_url": signed["url"],
            "size": resolved.stat().st_size,
            "truncated": False,
        }

    if b"\0" in prefix:
        raise WebUIFilePreviewError(415, "binary files cannot be previewed")

    with open(resolved, "rb") as f:
        raw = f.read(max_bytes + 1)

    truncated = len(raw) > max_bytes
    preview_bytes = raw[:max_bytes]
    try:
        content = preview_bytes.decode("utf-8")
    except UnicodeDecodeError:
        content = preview_bytes.decode("utf-8", errors="replace")

    if kind == "markdown" and markdown_image_rewriter is not None:
        content = markdown_image_rewriter(content)

    display_path = _display_path(resolved, scope.project_path)
    return {
        "path": str(resolved),
        "display_path": display_path,
        "project_path": str(scope.project_path),
        "kind": kind,
        "language": _language_for_path(resolved),
        "content": content,
        "media_url": None,
        "size": resolved.stat().st_size,
        "truncated": truncated,
    }


def file_preview_availability_payload(
    raw_path: str | None,
    *,
    scope: WorkspaceScope,
) -> dict[str, bool]:
    """Confirm that a path is a readable preview candidate without loading it fully."""

    resolved = _resolve_preview_path(raw_path, scope=scope)
    try:
        with open(resolved, "rb") as f:
            prefix = f.read(4096)
    except OSError as e:
        raise WebUIFilePreviewError(500, "failed to read file") from e
    kind = _kind_for_path_and_prefix(resolved, prefix)
    if kind in MEDIA_PREVIEW_KINDS:
        return {"available": True}
    if b"\0" in prefix:
        raise WebUIFilePreviewError(415, "binary files cannot be previewed")
    return {"available": True}


def _resolve_preview_path(raw_path: str | None, *, scope: WorkspaceScope) -> Path:
    path = _clean_preview_path(raw_path)
    if not path:
        raise WebUIFilePreviewError(400, "missing path")
    if len(path) > 4096:
        raise WebUIFilePreviewError(400, "path is too long")

    try:
        extra_roots = [get_media_dir()] if scope.restrict_to_workspace else None
        resolved = resolve_allowed_path(
            path,
            workspace=scope.project_path,
            allowed_root=scope.project_path if scope.restrict_to_workspace else None,
            extra_allowed_roots=extra_roots,
            strict=True,
        )
    except FileNotFoundError as e:
        raise WebUIFilePreviewError(404, "file not found") from e
    except WorkspaceBoundaryError as e:
        raise WebUIFilePreviewError(403, "file is outside the current workspace") from e
    except OSError as e:
        raise WebUIFilePreviewError(400, "invalid path") from e

    if not resolved.is_file():
        raise WebUIFilePreviewError(404, "file not found")
    return resolved


def _clean_preview_path(raw_path: str | None) -> str:
    if raw_path is None:
        return ""
    value = raw_path.strip()
    if not value:
        return ""
    if value.startswith("file://"):
        parsed = urlparse(value)
        value = unquote(parsed.path)
        if re.match(r"^/[A-Za-z]:[\\/]", value):
            value = value[1:]
    else:
        value = unquote(value)
    value = value.split("?", 1)[0].split("#", 1)[0].strip()
    if not re.match(r"^[A-Za-z]:[\\/]", value):
        value = re.sub(r":\d+(?::\d+)?$", "", value)
    return value


def _display_path(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def _language_for_path(path: Path) -> str:
    name = path.name.lower()
    ext = path.suffix.lower().lstrip(".")
    if name == "dockerfile":
        return "dockerfile"
    return {
        "cjs": "javascript",
        "css": "css",
        "cts": "typescript",
        "html": "html",
        "js": "javascript",
        "json": "json",
        "jsonl": "json",
        "jsx": "jsx",
        "md": "markdown",
        "mdx": "markdown",
        "mjs": "javascript",
        "mts": "typescript",
        "py": "python",
        "pyi": "python",
        "scss": "scss",
        "sh": "bash",
        "toml": "toml",
        "ts": "typescript",
        "tsx": "tsx",
        "yaml": "yaml",
        "yml": "yaml",
    }.get(ext, ext or "text")


def _sniff_image_prefix(prefix: bytes) -> bool:
    """True when the prefix looks like a raster image (PNG/JPEG/GIF/WebP)."""
    if prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    if prefix.startswith(b"\xff\xd8\xff"):
        return True
    if prefix.startswith(b"GIF87a") or prefix.startswith(b"GIF89a"):
        return True
    if prefix.startswith(b"RIFF") and prefix[8:12] == b"WEBP":
        return True
    return False


def _sniff_svg_prefix(prefix: bytes) -> bool:
    """True when the prefix reads like an SVG *document* (not incidental markup)."""
    head = prefix[:1024].lstrip()
    if head.startswith(b"<svg") or head.startswith(b"<!DOCTYPE svg"):
        return True
    return head.startswith(b"<?xml") and b"<svg" in head[:512]


def _kind_for_path_and_prefix(path: Path, prefix: bytes) -> str:
    """Classify a resolved preview path into a preview kind.

    Binary formats are detected from magic bytes first; text formats from the
    file extension. Anything else is ``text`` (the caller still rejects
    undecodable/binary files with a NUL-byte check).
    """
    if _sniff_image_prefix(prefix) or _sniff_svg_prefix(prefix):
        return "image"
    if prefix.startswith(b"%PDF-"):
        return "pdf"
    ext = path.suffix.lower()
    if ext in _VIDEO_PREVIEW_EXTS:
        return "video"
    if ext in _MARKDOWN_EXTS:
        return "markdown"
    if ext in _HTML_EXTS:
        return "html"
    if ext == ".csv":
        return "csv"
    return "text"
