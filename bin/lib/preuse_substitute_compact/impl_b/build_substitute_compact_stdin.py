#!/usr/bin/env python3
"""Build substitute-compact-v1 stdin bytes."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


SETUP_EXCERPT_CAP = 16_384
PRIOR_TASK_EXCERPT_CAP = 8_192
PRIOR_ASSISTANT_EXCERPT_CAP = 8_192
COMPACT_PREAMBLE_CAP = 131_072

TOP_LEVEL_KEYS = (
    "schema_version",
    "cut_id",
    "cut_tokens",
    "run_idx",
    "session_idx",
    "segment_start_position",
    "compact_before_position",
    "current_position",
    "current_fixture_id",
    "current_task_prompt_path",
    "setup_history_path",
    "prior_turns",
)

PRIOR_TURN_KEYS = (
    "position_in_chain",
    "fixture_id",
    "seed_idx",
    "task_prompt_path",
    "stage1_output_path",
)

METADATA_KEYS = (
    "cut_id",
    "cut_tokens",
    "run_idx",
    "session_idx",
    "segment_start_position",
    "compact_before_position",
    "current_position",
)

INT_TOP_LEVEL_KEYS = (
    "schema_version",
    "cut_tokens",
    "run_idx",
    "session_idx",
    "segment_start_position",
    "compact_before_position",
    "current_position",
)

TEXT_TOP_LEVEL_KEYS = (
    "cut_id",
    "current_fixture_id",
    "current_task_prompt_path",
    "setup_history_path",
)


class _ManifestDict(dict):
    """Dict subclass used only to carry the CLI manifest directory."""


def _require_exact_keys(mapping: dict[str, Any], keys: tuple[str, ...], label: str) -> None:
    # ADR §4.6.3: the manifest schema is read by key, not by object order.
    if len(mapping) != len(keys):
        raise ValueError(f"{label} has unexpected key count")
    for key in keys:
        if key not in mapping:
            raise ValueError(f"{label} is missing required key {key!r}")


def _require_int(value: Any, key: str) -> int:
    # ADR §4.6.3: numeric manifest fields remain integers.
    if type(value) is not int:
        raise ValueError(f"{key!r} must be an integer")
    return value


def _require_text(value: Any, key: str) -> str:
    # ADR §4.6.3: manifest path and identifier fields are read by explicit key.
    if not isinstance(value, str):
        raise ValueError(f"{key!r} must be a string")
    return value


def _normalise_text(data: bytes) -> str:
    # ADR §4.6.5: UTF-8 strict, start-only BOM removal, CRLF/bare-CR to LF.
    text = data.decode("utf-8", errors="strict")
    if text.startswith("\ufeff"):
        text = text[1:]
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _utf8_prefix(text: str, cap: int) -> str:
    # ADR §4.6.7: byte caps truncate only at valid UTF-8 boundaries.
    data = text.encode("utf-8")
    if len(data) <= cap:
        return text
    return data[:cap].decode("utf-8", errors="ignore")


def _utf8_suffix(text: str, cap: int) -> str:
    # ADR §4.6.7: prior assistant excerpts keep the last capped bytes.
    data = text.encode("utf-8")
    if len(data) <= cap:
        return text
    return data[-cap:].decode("utf-8", errors="ignore")


def _manifest_base_dir(manifest: dict[str, Any]) -> Path:
    # ADR §4.6.10 item 3: paths are used only for reads, never emitted.
    base_dir = getattr(manifest, "_base_dir", None)
    if base_dir is None:
        return Path(".")
    return Path(base_dir)


def _manifest_path(base_dir: Path, relative_path: str) -> Path:
    # ADR §4.6.10 items 3 and 6: no absolute path fields, no directory scans.
    path = Path(relative_path)
    if path.is_absolute():
        raise ValueError("manifest file paths must be relative")
    return base_dir / path


def _read_manifest_text(base_dir: Path, relative_path: str, *, missing_ok: bool) -> str:
    # ADR §4.6.2 and §4.6.4: read only files named in the manifest.
    path = _manifest_path(base_dir, relative_path)
    try:
        return _normalise_text(path.read_bytes())
    except FileNotFoundError:
        if missing_ok:
            return ""
        raise


def _append_label_and_text(parts: list[str], label: str, text: str) -> None:
    # ADR §4.6.8: fixed ASCII labels; ADR §4.6.5: emit LF separators.
    parts.append(label)
    parts.append("\n")
    if text:
        parts.append(text)
        if not text.endswith("\n"):
            parts.append("\n")


def _validate_prior_turn(turn: Any) -> dict[str, Any]:
    # ADR §4.6.3: each prior turn has exactly the declared fields.
    if not isinstance(turn, dict):
        raise ValueError("prior_turns entries must be objects")
    _require_exact_keys(turn, PRIOR_TURN_KEYS, "prior_turn")
    _require_int(turn["position_in_chain"], "position_in_chain")
    _require_int(turn["seed_idx"], "seed_idx")
    _require_text(turn["fixture_id"], "fixture_id")
    _require_text(turn["task_prompt_path"], "task_prompt_path")
    _require_text(turn["stage1_output_path"], "stage1_output_path")
    return turn


def _validate_manifest(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    # ADR §4.6.3 / work-spec §10 INV-2: exact manifest schema by key.
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be an object")
    _require_exact_keys(manifest, TOP_LEVEL_KEYS, "manifest")
    for key in INT_TOP_LEVEL_KEYS:
        _require_int(manifest[key], key)
    for key in TEXT_TOP_LEVEL_KEYS:
        _require_text(manifest[key], key)
    if manifest["schema_version"] != 1:
        raise ValueError("schema_version must be 1")
    prior_turns = manifest["prior_turns"]
    if not isinstance(prior_turns, list):
        raise ValueError("prior_turns must be a list")
    return [_validate_prior_turn(turn) for turn in prior_turns]


def _render_metadata(manifest: dict[str, Any]) -> list[str]:
    # ADR §4.6.1/§4.6.12: record the v1 name in the output header.
    # ADR §4.6.6/§4.6.9: include segment boundary metadata, excluding banned fields.
    parts = ["SUBSTITUTE-COMPACT-V1\n", "METADATA\n"]
    for key in METADATA_KEYS:
        parts.append(f"{key}={manifest[key]}\n")
    return parts


def _render_prior_turn(base_dir: Path, turn: dict[str, Any]) -> str:
    # ADR §4.6.4 and §4.6.8: prior turn sections use fixed labels.
    task_text = _read_manifest_text(base_dir, turn["task_prompt_path"], missing_ok=False)
    assistant_text = _read_manifest_text(base_dir, turn["stage1_output_path"], missing_ok=True)
    task_excerpt = _utf8_prefix(task_text, PRIOR_TASK_EXCERPT_CAP)
    assistant_excerpt = _utf8_suffix(assistant_text, PRIOR_ASSISTANT_EXCERPT_CAP)

    parts: list[str] = []
    parts.append(
        "PRIOR_TURN "
        f"position={turn['position_in_chain']} "
        f"fixture={turn['fixture_id']} "
        f"seed={turn['seed_idx']}\n"
    )
    _append_label_and_text(parts, "PRIOR_USER_PROMPT_EXCERPT", task_excerpt)
    _append_label_and_text(parts, "PRIOR_ASSISTANT_OUTPUT_EXCERPT", assistant_excerpt)
    return "".join(parts)


def _assemble_preamble(
    base_parts: list[str],
    turn_blocks: list[str],
) -> str:
    # ADR §4.6.7: if over cap, drop oldest prior-turn sections whole.
    remaining_turns = list(turn_blocks)
    preamble = "".join(base_parts + remaining_turns)
    while len(preamble.encode("utf-8")) > COMPACT_PREAMBLE_CAP and remaining_turns:
        remaining_turns.pop(0)
        preamble = "".join(base_parts + remaining_turns)
    return preamble


def build_substitute_compact_stdin(manifest: dict[str, Any]) -> bytes:
    """Pure function — see ADR §4.6.2."""
    # ADR §4.6.2: no model calls, tokenizer shellouts, or non-manifest reads.
    prior_turns = _validate_manifest(manifest)
    base_dir = _manifest_base_dir(manifest)

    setup_text = _read_manifest_text(base_dir, manifest["setup_history_path"], missing_ok=False)
    setup_excerpt = _utf8_prefix(setup_text, SETUP_EXCERPT_CAP)
    current_text = _read_manifest_text(base_dir, manifest["current_task_prompt_path"], missing_ok=False)

    base_parts = _render_metadata(manifest)
    _append_label_and_text(base_parts, "SETUP_HISTORY_EXCERPT", setup_excerpt)

    # ADR §4.6.4 / §4.6.10 items 7-8: numeric sort, no hash or locale order.
    sorted_turns = sorted(prior_turns, key=lambda turn: turn["position_in_chain"])
    turn_blocks = [_render_prior_turn(base_dir, turn) for turn in sorted_turns]
    preamble = _assemble_preamble(base_parts, turn_blocks)

    output_parts = [preamble]
    _append_label_and_text(output_parts, "CURRENT_TASK_PROMPT", current_text)
    output_text = "".join(output_parts)
    if not output_text.endswith("\n"):
        output_text += "\n"
    return output_text.encode("utf-8")


def _load_manifest(path: Path) -> dict[str, Any]:
    # ADR §4.6.5: parse the JSON manifest as UTF-8 strict text.
    loaded = json.loads(_normalise_text(path.read_bytes()))
    if not isinstance(loaded, dict):
        raise ValueError("manifest JSON must be an object")
    manifest = _ManifestDict(loaded)
    manifest._base_dir = path.parent
    return manifest


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: build_substitute_compact_stdin.py <manifest.json>", file=sys.stderr)
        return 2
    manifest = _load_manifest(Path(argv[1]))
    sys.stdout.buffer.write(build_substitute_compact_stdin(manifest))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
