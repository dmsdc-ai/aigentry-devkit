"""build_substitute_compact_stdin — substitute-compact-v1 (impl A, claude).

Implements ADR §4.6 (`docs/adr/2026-04-26-q1-prereq-redesign.md` lines 235-383)
verbatim. Pure stdlib only (Constitution Rule 17 무의존).

Section map (cited inline at each load-bearing decision):
  §4.6.1   name (header label "SUBSTITUTE-COMPACT-V1").
  §4.6.2   pure-function signature; no model / tokenizer / out-of-manifest reads.
  §4.6.3   manifest schema; read by key, never by object/dict iteration order.
  §4.6.4   ordering: header, setup, prior turns by position_in_chain ASC, current.
  §4.6.5   normalization: UTF-8 strict, BOM at file start only, CRLF/CR -> LF,
           preserve all other bytes, emit exactly LF, final output ends with one LF.
  §4.6.6   preserved fields (excludes timestamps / paths / session_id / cli ver / etc.).
  §4.6.7   byte caps with UTF-8 boundary-safe truncation; preamble drop-oldest-whole.
  §4.6.8   ASCII labels (case-sensitive, no Unicode).
  §4.6.9   binds §4.1 boundary semantics (consumer-side; out of scope here).
  §4.6.10  byte-drift ban list (eight MUST-NOTs).
  §4.6.11  regression manifest enumeration; row 7: missing prior assistant -> empty block.
  §4.6.12  versioning policy (this is "v1").
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# §4.6.7 byte caps. Byte-counted, not token-counted (ban-list item 1).
SETUP_CAP = 16384
PRIOR_TASK_CAP = 8192
PRIOR_ASSISTANT_CAP = 8192
PREAMBLE_CAP = 131072

# §4.6.8 fixed ASCII labels — case-sensitive, no Unicode.
LABEL_HEADER = b"SUBSTITUTE-COMPACT-V1"
LABEL_METADATA = b"METADATA"
LABEL_SETUP = b"SETUP_HISTORY_EXCERPT"
LABEL_PRIOR_USER = b"PRIOR_USER_PROMPT_EXCERPT"
LABEL_PRIOR_ASSISTANT = b"PRIOR_ASSISTANT_OUTPUT_EXCERPT"
LABEL_CURRENT = b"CURRENT_TASK_PROMPT"

# §4.6.6 preserved metadata fields, in fixed order. Order is a byte-level
# contract — read by key from manifest, emit in this tuple order to avoid
# ban-list item 7 (Python dict / set iteration order).
METADATA_FIELDS = (
    "cut_id",
    "cut_tokens",
    "run_idx",
    "session_idx",
    "segment_start_position",
    "compact_before_position",
    "current_position",
)

# §4.6.5 UTF-8 BOM, stripped only at file start.
UTF8_BOM = b"\xef\xbb\xbf"


def _normalize(raw: bytes) -> bytes:
    """§4.6.5 UTF-8 strict + BOM-at-start + CRLF/CR -> LF.

    Strict decode: invalid UTF-8 raises UnicodeDecodeError (hard failure per spec).
    Replace order matters: CRLF first, then bare CR, so a CRLF is not split.
    """
    if raw.startswith(UTF8_BOM):
        raw = raw[len(UTF8_BOM):]
    text = raw.decode("utf-8")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.encode("utf-8")


def _truncate_prefix_utf8(data: bytes, cap: int) -> bytes:
    """§4.6.7 first-N-bytes truncation, UTF-8 boundary-safe.

    Walks back over continuation bytes (0b10xxxxxx) so a multi-byte sequence is
    never split. Byte-counted only — no tokenizer (ban-list item 1).
    """
    if len(data) <= cap:
        return data
    j = cap
    while j > 0 and (data[j] & 0xC0) == 0x80:
        j -= 1
    return data[:j]


def _truncate_suffix_utf8(data: bytes, cap: int) -> bytes:
    """§4.6.7 last-N-bytes truncation, UTF-8 boundary-safe.

    Used only for prior assistant excerpt (§4.6.7 row 3: \"**Last** 8,192 bytes\").
    Walks forward past continuation bytes to land on a UTF-8 leading byte.
    """
    if len(data) <= cap:
        return data
    j = len(data) - cap
    while j < len(data) and (data[j] & 0xC0) == 0x80:
        j += 1
    return data[j:]


def _read_file_bytes(path: str) -> bytes:
    """Read raw bytes. Caller controls path resolution; this helper opens only
    paths supplied by the manifest (§4.6.2 — no out-of-manifest reads, no
    fs enumeration per ban-list item 6).
    """
    with open(path, "rb") as f:
        return f.read()


def _read_prior_assistant_or_empty(path: str) -> bytes:
    """§4.6.11 row 7: \"No prior assistant file present ... emit empty
    `PRIOR_ASSISTANT_OUTPUT_EXCERPT` block\". A missing file maps to empty
    bytes; an existing-but-empty file is also empty bytes (same on-the-wire).
    """
    try:
        return _read_file_bytes(path)
    except FileNotFoundError:
        return b""


def _emit_section(label: bytes, content: bytes) -> bytes:
    """Emit `<label>\\n<content>` and guarantee a single trailing LF before the
    next section. §4.6.5 \"final output MUST end with one LF\" is satisfied
    cumulatively because the last section's emit also lands on LF.
    """
    out = label + b"\n" + content
    if not out.endswith(b"\n"):
        out += b"\n"
    return out


def _format_metadata(manifest: dict) -> bytes:
    """§4.6.6 preserved fields, fixed §4.6.6-listed order, one `key=value` line
    per field. Reads manifest by key (§4.6.3, ban-list item 7). Integer values
    serialized via str() (locale-independent — ban-list item 8).
    """
    lines = []
    for field in METADATA_FIELDS:
        value = manifest[field]
        lines.append(f"{field}={value}".encode("utf-8"))
    return b"\n".join(lines) + b"\n"


def _build_prior_turn_block(turn: dict) -> bytes:
    """§4.6.8 PRIOR_TURN block: label line + user prompt excerpt + assistant
    output excerpt. Reads turn fields by key (§4.6.3, ban-list item 7).
    """
    position = turn["position_in_chain"]
    fixture = turn["fixture_id"]
    seed = turn["seed_idx"]
    # §4.6.8 verbatim label format: "PRIOR_TURN position=<n> fixture=<id> seed=<n>".
    label_line = (
        f"PRIOR_TURN position={position} fixture={fixture} seed={seed}".encode("utf-8")
    )

    # §4.6.7 prior task excerpt: first 8192 bytes (UTF-8 boundary-safe).
    task_norm = _normalize(_read_file_bytes(turn["task_prompt_path"]))
    task_capped = _truncate_prefix_utf8(task_norm, PRIOR_TASK_CAP)

    # §4.6.7 prior assistant excerpt: LAST 8192 bytes; §4.6.11 row 7 missing-file rule.
    asst_raw = _read_prior_assistant_or_empty(turn["stage1_output_path"])
    asst_norm = _normalize(asst_raw) if asst_raw else b""
    asst_capped = _truncate_suffix_utf8(asst_norm, PRIOR_ASSISTANT_CAP)

    out = label_line + b"\n"
    out += _emit_section(LABEL_PRIOR_USER, task_capped)
    out += _emit_section(LABEL_PRIOR_ASSISTANT, asst_capped)
    return out


def _build_preamble(manifest: dict, sorted_turns: list) -> bytes:
    """§4.6.4 ordering: header, METADATA block, setup excerpt, then per-turn
    blocks (already pre-sorted ASC by caller).
    """
    out = LABEL_HEADER + b"\n"
    out += LABEL_METADATA + b"\n"
    out += _format_metadata(manifest)

    # §4.6.7 setup excerpt: first 16384 bytes UTF-8 boundary-safe.
    setup_norm = _normalize(_read_file_bytes(manifest["setup_history_path"]))
    setup_capped = _truncate_prefix_utf8(setup_norm, SETUP_CAP)
    out += _emit_section(LABEL_SETUP, setup_capped)

    # §4.6.4 prior turns sorted ASC by integer position_in_chain. Iteration is
    # over a pre-sorted list (ban-list items 7 & 8 — no dict order, no locale sort).
    for turn in sorted_turns:
        out += _build_prior_turn_block(turn)

    return out


def build_substitute_compact_stdin(manifest: dict) -> bytes:
    """§4.6.2 pure function. Reads no clock, no env, no fs outside manifest paths.
    Returns deterministic UTF-8 bytes per ADR §4.6.

    Ban-list (§4.6.10) compliance:
      1. tokenizer truncation       — bytes only, see _truncate_*_utf8.
      2. wall-clock                 — no time/datetime imports anywhere.
      3. absolute paths in output   — METADATA / PRIOR_TURN labels carry no paths.
      4. session IDs                — never read; not in METADATA_FIELDS.
      5. CLI versions               — never read; not in METADATA_FIELDS.
      6. fs enumeration             — no listdir/glob/readdir; manifest-only paths.
      7. hash/set order             — fixed METADATA_FIELDS tuple + sorted list.
      8. locale-sensitive sort      — int() key, ascending; no str sort, no locale.
    """
    # §4.6.3 read by key (ban-list item 7). Defensive list copy avoids any in-place
    # mutation of caller's manifest object.
    prior_turns = list(manifest.get("prior_turns", []))

    # §4.6.4 + ban-list item 8: numeric ascending sort on position_in_chain.
    # int() guards against JSON quirks (spec declares the field integer).
    sorted_turns = sorted(prior_turns, key=lambda t: int(t["position_in_chain"]))

    # §4.6.7 preamble cap = 131072. If over, drop the oldest (smallest
    # position_in_chain) prior-turn block whole and rebuild. Never partial-drop.
    while True:
        preamble = _build_preamble(manifest, sorted_turns)
        if len(preamble) <= PREAMBLE_CAP:
            break
        if not sorted_turns:
            break  # cannot reduce further; header+metadata+setup already over cap.
        sorted_turns = sorted_turns[1:]

    # §4.6.7 current task: uncapped by summarizer. §4.6.5 normalization still applies.
    current_norm = _normalize(_read_file_bytes(manifest["current_task_prompt_path"]))
    out = preamble + _emit_section(LABEL_CURRENT, current_norm)

    # §4.6.5 \"final output MUST end with one LF\" — _emit_section guarantees this
    # for the last section, so `out` already terminates with exactly one LF.
    return out


# §6.2 work-spec CLI entrypoint for harness invocation. Block kept short
# (≤15 lines per dispatch). Resolves manifest-declared paths against the
# manifest file's parent directory (manifest-relative; no abspath / no env leak).
if __name__ == "__main__":
    manifest_path = Path(sys.argv[1])
    base = manifest_path.parent
    with open(manifest_path, "rb") as f:
        m = json.loads(f.read().decode("utf-8"))
    for k in ("setup_history_path", "current_task_prompt_path"):
        m[k] = str(base / m[k])
    for t in m.get("prior_turns", []):
        for k in ("task_prompt_path", "stage1_output_path"):
            t[k] = str(base / t[k])
    sys.stdout.buffer.write(build_substitute_compact_stdin(m))
