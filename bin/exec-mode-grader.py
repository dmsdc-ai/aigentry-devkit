#!/usr/bin/env python3.14
"""exec-mode-grader.py — cost / compact / pollution / loss / fixture grader.

CLI-only. Stdlib + rapidfuzz, plus subprocess-launched codex/gemini CLIs for
the cross-family Layer B/C judges. NO anthropic/openai/voyage SDKs.

Build spec §3.1, §7.2. Spec §5.1–§5.4, §7.1, §8.

Layout:
  Part 1 (T3): parse_cost / detect_compact / pollution_layer_a / loss_layer_a+b
  Part 2 (T4): pollution_layer_b_dual / loss_layer_c_dual + _judge_cli retry
                30s timeout, max 3 retries, 60s rate-limit cool-off (spec §7.1).

This file is loaded both as a CLI (``./exec-mode-grader.py detect-compact ...``)
and as an importable module (tests do ``import exec_mode_grader as g``). The
hyphen in the filename prevents a direct ``import``; the test conftest loads it
via importlib and registers it under the underscore name. Keep module-level
code side-effect-free so that import stays cheap.
"""
from __future__ import annotations

import argparse
import dataclasses
import html
import json
import os
import random
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Sequence
from urllib.parse import urlparse

try:
    from rapidfuzz import fuzz
except ImportError as exc:  # pragma: no cover — hard requirement
    print(
        f"exec-mode-grader: rapidfuzz missing ({exc}). "
        "Install via .venv-exec-mode/bin/pip install -r requirements-exec-mode.txt",
        file=sys.stderr,
    )
    raise


# ─── pricing (Anthropic Sonnet 4.6, per 1M tokens) ───────────────────────────
PRICE_INPUT_PER_M          = 3.00
PRICE_CACHE_WRITE_5M_PER_M = 3.75
PRICE_CACHE_WRITE_1H_PER_M = 6.00
PRICE_CACHE_READ_PER_M     = 0.30
PRICE_OUTPUT_PER_M         = 15.00


# ─── cost ────────────────────────────────────────────────────────────────────
@dataclasses.dataclass(frozen=True)
class CostBuckets:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_5m: int = 0
    cache_write_1h: int = 0
    cache_read: int = 0

    @property
    def marginal_usd(self) -> float:
        return (
            PRICE_INPUT_PER_M          * self.input_tokens
            + PRICE_CACHE_WRITE_5M_PER_M * self.cache_write_5m
            + PRICE_CACHE_WRITE_1H_PER_M * self.cache_write_1h
            + PRICE_CACHE_READ_PER_M     * self.cache_read
            + PRICE_OUTPUT_PER_M         * self.output_tokens
        ) / 1_000_000

    def as_dict(self) -> dict:
        return {
            "input_tokens":          self.input_tokens,
            "output_tokens":         self.output_tokens,
            "cache_write_5m_tokens": self.cache_write_5m,
            "cache_write_1h_tokens": self.cache_write_1h,
            "cache_read_tokens":     self.cache_read,
            "marginal_usd":          self.marginal_usd,
        }

    def __add__(self, other: "CostBuckets") -> "CostBuckets":
        return CostBuckets(
            input_tokens   = self.input_tokens   + other.input_tokens,
            output_tokens  = self.output_tokens  + other.output_tokens,
            cache_write_5m = self.cache_write_5m + other.cache_write_5m,
            cache_write_1h = self.cache_write_1h + other.cache_write_1h,
            cache_read     = self.cache_read     + other.cache_read,
        )


def _iter_jsonl(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _extract_usage(record: dict) -> dict | None:
    """Return the usage dict from an assistant turn, else None.

    Claude CLI JSONL wraps the assistant turn under either the top-level
    record (older) or record["message"] (newer). We check both.
    """
    if record.get("type") not in (None, "assistant"):
        return None
    msg = record.get("message") or {}
    if msg.get("role") not in (None, "assistant"):
        return None
    usage = msg.get("usage") or record.get("usage")
    if not isinstance(usage, dict):
        return None
    return usage


def _buckets_from_usage(usage: dict) -> CostBuckets:
    input_t  = int(usage.get("input_tokens") or 0)
    output_t = int(usage.get("output_tokens") or 0)
    cache_read = int(usage.get("cache_read_input_tokens") or 0)

    cc = usage.get("cache_creation")
    if isinstance(cc, dict):
        cw5 = int(cc.get("ephemeral_5m_input_tokens") or 0)
        cw1h = int(cc.get("ephemeral_1h_input_tokens") or 0)
    else:
        cw5 = int(usage.get("cache_creation_input_tokens") or 0)
        cw1h = 0

    return CostBuckets(
        input_tokens   = input_t,
        output_tokens  = output_t,
        cache_write_5m = cw5,
        cache_write_1h = cw1h,
        cache_read     = cache_read,
    )


def _accumulate_jsonl(path: Path, seen_message_ids: set[str]) -> CostBuckets:
    """Sum usage across a single jsonl, deduping by ``message.id``.

    Real Claude CLI stream-json writes one jsonl row per assistant content-block
    (text + each tool_use become separate rows), each carrying a COPY of the
    same ``message.id`` and the same aggregate ``usage`` payload. Summing every
    row double/triple-counts cost (Fa smoke 2026-04-20 observed this).
    Records without an ``id`` (legacy or hand-crafted fixtures) are counted
    every time.
    """
    acc = CostBuckets()
    for rec in _iter_jsonl(path):
        u = _extract_usage(rec)
        if u is None:
            continue
        mid = (rec.get("message") or {}).get("id")
        if mid:
            if mid in seen_message_ids:
                continue
            seen_message_ids.add(mid)
        acc = acc + _buckets_from_usage(u)
    return acc


def parse_cost(jsonl_path: Path | str, include_subagents: bool = True) -> CostBuckets:
    """Parse a Claude session JSONL into cost buckets.

    If include_subagents=True and the session file has a sibling ``subagents/``
    directory, all ``agent-*.jsonl`` files beneath it (any depth) are included
    in the roll-up. Covers Task-tool fanout and nested spawns (spec §5.1,
    Medium 3 fix).
    """
    path = Path(jsonl_path)
    seen: set[str] = set()
    total = CostBuckets()
    if path.exists():
        total = total + _accumulate_jsonl(path, seen)

    if include_subagents:
        sub_root = path.parent / "subagents"
        if sub_root.is_dir():
            for sub_path in sorted(sub_root.rglob("agent-*.jsonl")):
                total = total + _accumulate_jsonl(sub_path, seen)
    return total


# ─── compact detection ──────────────────────────────────────────────────────
@dataclasses.dataclass(frozen=True)
class CompactFlag:
    detected: bool = False
    reason: str | None = None
    cache_read_drop_ratio: float | None = None
    next_input_spike_ratio: float | None = None

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


def detect_compact(
    jsonl_path: Path | str,
    drop_ratio: float = 0.5,
    spike_mult: float = 2.0,
) -> CompactFlag:
    """2-signal compact detector (spec §5.1, §8).

    Rule: at some assistant turn i (i>=1),
        (cache_read[i-1] - cache_read[i]) / cache_read[i-1] > drop_ratio
      AND
        input_tokens[i] / mean(input_tokens[:i]) > spike_mult
    First turn satisfying both flips the flag.
    """
    cache_reads: list[int] = []
    inputs: list[int] = []
    for rec in _iter_jsonl(Path(jsonl_path)):
        u = _extract_usage(rec)
        if u is None:
            continue
        cache_reads.append(int(u.get("cache_read_input_tokens") or 0))
        inputs.append(int(u.get("input_tokens") or 0))

    if len(cache_reads) < 2 or len(inputs) < 2:
        return CompactFlag(detected=False)

    for i in range(1, min(len(cache_reads), len(inputs))):
        prev = cache_reads[i - 1]
        if prev <= 0:
            continue
        drop = 1.0 - (cache_reads[i] / prev)
        if drop <= drop_ratio:
            continue
        prev_inputs = inputs[:i]
        avg = sum(prev_inputs) / len(prev_inputs) if prev_inputs else 0
        if avg <= 0:
            continue
        spike = inputs[i] / avg
        if spike > spike_mult:
            return CompactFlag(
                detected=True,
                reason=(
                    f"cache_read dropped {drop*100:.1f}% at turn {i}; "
                    f"input spike {spike:.2f}× avg({avg:.0f})"
                ),
                cache_read_drop_ratio=round(drop, 4),
                next_input_spike_ratio=round(spike, 4),
            )
    return CompactFlag(detected=False)


# ─── pollution Layer A ──────────────────────────────────────────────────────
def _fact_patterns(fact: dict) -> list[re.Pattern]:
    terms = [fact.get("keyword", "")] + list(fact.get("paraphrase_examples") or [])
    patterns: list[re.Pattern] = []
    for t in terms:
        if not t:
            continue
        patterns.append(re.compile(re.escape(t), re.IGNORECASE))
    return patterns


def pollution_layer_a(output: str, facts: Sequence[dict]) -> list[bool]:
    """Per-fact Layer A leak detection (spec §5.3).

    For each fact, True iff ``output`` contains the keyword or any listed
    paraphrase example (case-insensitive substring, regex-escaped).
    """
    if not output:
        return [False] * len(facts)
    results: list[bool] = []
    for fact in facts:
        hit = any(p.search(output) for p in _fact_patterns(fact))
        results.append(hit)
    return results


# ─── loss Layer A / B ───────────────────────────────────────────────────────
def loss_layer_a(expected: str, actual: str) -> bool:
    """Exact (case-insensitive) substring match — ``expected`` appears in ``actual``."""
    if not expected or not actual:
        return False
    return expected.lower() in actual.lower()


def loss_layer_b(expected: str, actual: str, threshold: float = 0.8) -> bool:
    """rapidfuzz partial_token_set_ratio > threshold (strict) — spec §5.4.

    Token-set over sliding substring: matches "Project Xenon" against
    "the xenon effort" (planted keyword recalled as paraphrase) while
    rejecting unrelated strings. Strict inequality so ``threshold=1.0``
    never matches (boundary test).
    """
    if not expected or not actual:
        return False
    ratio = fuzz.partial_token_set_ratio(expected.lower(), actual.lower()) / 100.0
    return ratio > threshold


# ─── Part 2 (T4): cross-family CLI judges ───────────────────────────────────
JUDGE_TIMEOUT_S      = 30   # spec §7.1: per-call timeout
JUDGE_MAX_RETRIES    = 3    # spec §7.1: 3 retries (4 total attempts)
JUDGE_RATE_LIMIT_S   = 60   # spec §7.1: 60s cool-off when rate-limited
# claude added for T16 jury (spec §5.2 J1-J3); B/C dual judges use codex+gemini
# only and pass those literals directly, so this widening is backwards-safe.
_JUDGE_FAMILIES      = ("codex", "gemini", "claude")


def _judge_command(family: str, prompt: str) -> list[str]:
    if family == "codex":
        return ["codex", "exec", prompt]
    if family == "gemini":
        return ["gemini", "-p", prompt]
    if family == "claude":
        return ["claude", "--print", prompt]
    raise ValueError(f"unknown judge family: {family!r}")


def _is_rate_limited(stderr: str) -> bool:
    if not stderr:
        return False
    s = stderr.lower()
    return "429" in s or "rate_limit" in s or "rate limit" in s


def _judge_cli(
    family: str,
    prompt: str,
    *,
    timeout: int = JUDGE_TIMEOUT_S,
    max_retries: int = JUDGE_MAX_RETRIES,
    cooloff: int = JUDGE_RATE_LIMIT_S,
) -> str | None:
    """Invoke `codex|gemini|claude` CLI with retry. Returns stdout (str) or None.

    Retry policy (spec §7.1):
      - per-call timeout = ``timeout`` seconds (default 30)
      - up to ``max_retries`` retries on non-zero exit, timeout, or missing CLI
      - rate-limit (429 / "rate_limit" in stderr) → sleep ``cooloff`` seconds
      - other failures → exponential backoff capped at cooloff
    """
    if family not in _JUDGE_FAMILIES:
        raise ValueError(f"unknown judge family: {family!r}")
    # Test stub: skip live CLI when EXEC_MODE_JURY_STUB=1 (used by deferred CLI
    # smoke test where mocked subprocess.run can't reach the child interpreter).
    if os.environ.get("EXEC_MODE_JURY_STUB") == "1":
        return json.dumps({c: 4 for c in JURY_RUBRIC})
    cmd = _judge_command(family, prompt)

    last_stderr = ""
    for attempt in range(max_retries + 1):
        rate_limited = False
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            last_stderr = "timeout"
        except FileNotFoundError as exc:
            last_stderr = f"command not found: {exc}"
        else:
            if proc.returncode == 0 and proc.stdout.strip():
                return proc.stdout
            last_stderr = proc.stderr or ""
            rate_limited = _is_rate_limited(last_stderr)

        if attempt >= max_retries:
            break
        if rate_limited:
            time.sleep(cooloff)
        else:
            time.sleep(min(2 ** attempt, cooloff))
    return None


def _parse_int_answer(raw: str | None) -> int | None:
    """Extract a leading 0/1 integer from a CLI judge stdout. Returns None on miss."""
    if raw is None:
        return None
    m = re.match(r"\s*([01])\b", raw)
    if not m:
        return None
    return int(m.group(1))


def _parse_dict_answer(raw: str | None, fact_ids: Sequence[str]) -> dict[str, int] | None:
    """Parse a JSON object {fact_id: 0|1, ...} from CLI judge stdout.

    Tolerates leading prose by extracting the first balanced ``{...}`` slice.
    Returns None if no valid mapping with the requested keys is found.
    """
    if raw is None:
        return None
    text = raw.strip()
    candidates: list[str] = []
    if text.startswith("{"):
        candidates.append(text)
    m = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if m and m.group(0) not in candidates:
        candidates.append(m.group(0))
    for cand in candidates:
        try:
            parsed = json.loads(cand)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        out: dict[str, int] = {}
        for fid in fact_ids:
            v = parsed.get(fid)
            if v in (0, 1, "0", "1"):
                out[fid] = int(v)
        if out:
            return out
    return None


def _build_pollution_b_prompt(output: str, facts: Sequence[dict]) -> str:
    lines = [
        "You are a strict semantic-leak checker.",
        "AGENT OUTPUT:",
        "<<<",
        output,
        ">>>",
        "",
        "For each fact below, answer 1 if its keyword OR any paraphrase of it is",
        "mentioned (even indirectly) in the AGENT OUTPUT, otherwise 0.",
        "Reply with a single JSON object only — no prose.",
        "",
    ]
    for fact in facts:
        fid = fact.get("id", "")
        kw = fact.get("keyword", "")
        para = fact.get("paraphrase_examples") or []
        lines.append(f'  "{fid}": keyword="{kw}", paraphrases={list(para)!r}')
    fact_keys = ", ".join(f'"{f.get("id", "")}": 0' for f in facts)
    lines += ["", f"Schema: {{{fact_keys}}}"]
    return "\n".join(lines)


def _build_loss_c_prompt(question: str, expected: str, actual: str) -> str:
    return (
        "You are a strict short-answer grader.\n"
        f"Question: {question}\n"
        f'Expected answer: "{expected}"\n'
        f'Got: "{actual}"\n\n'
        "Reply with a single character: 1 if Got matches Expected (semantically "
        "equivalent or contains the expected fact), 0 otherwise. No prose."
    )


@dataclasses.dataclass(frozen=True)
class LeakVerdict:
    fact_id: str
    codex: bool | None
    gemini: bool | None
    leaked: bool
    uncertain: bool

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


@dataclasses.dataclass(frozen=True)
class LossVerdict:
    codex_correct: bool | None
    gemini_correct: bool | None
    recall: int
    uncertain: bool

    def as_dict(self) -> dict:
        return dataclasses.asdict(self)


def _combine_dual(codex: bool | None, gemini: bool | None) -> tuple[bool, bool]:
    """Dual cross-family combine: (positive, uncertain).

    - both True   → (True, False)        confirmed
    - both False  → (False, False)       confirmed clean
    - one None    → (False, True)        cannot confirm
    - disagree    → (False, True)        analyst review queue (spec §5.3 / §5.4)
    """
    if codex is None or gemini is None:
        return False, True
    if codex and gemini:
        return True, False
    if not codex and not gemini:
        return False, False
    return False, True  # disagreement


def pollution_layer_b_dual(output: str, facts: Sequence[dict]) -> list[LeakVerdict]:
    """Dual cross-family Layer B leak detection (spec §5.3).

    Calls codex + gemini CLIs ONCE each with a batched prompt covering all facts.
    Per fact, leak confirmed iff both judges return 1; one positive → uncertain.
    Subprocess failure or unparseable response → that judge's verdict is None
    (counted as uncertain for affected facts).
    """
    fact_ids = [str(f.get("id", "")) for f in facts]
    prompt = _build_pollution_b_prompt(output, facts)

    raw_codex = _judge_cli("codex", prompt)
    raw_gemini = _judge_cli("gemini", prompt)
    codex_map = _parse_dict_answer(raw_codex, fact_ids)
    gemini_map = _parse_dict_answer(raw_gemini, fact_ids)

    verdicts: list[LeakVerdict] = []
    for fid in fact_ids:
        c = None if codex_map is None or fid not in codex_map else bool(codex_map[fid])
        g_ = None if gemini_map is None or fid not in gemini_map else bool(gemini_map[fid])
        leaked, uncertain = _combine_dual(c, g_)
        verdicts.append(LeakVerdict(
            fact_id=fid,
            codex=c,
            gemini=g_,
            leaked=leaked,
            uncertain=uncertain,
        ))
    return verdicts


def loss_layer_c_dual(question: str, expected: str, actual: str) -> LossVerdict:
    """Dual cross-family Layer C loss detection (spec §5.4).

    recall = 1 iff both judges say "correct" (1).  Single positive → uncertain.
    Subprocess failure → that judge is None → uncertain (recall=0).
    """
    prompt = _build_loss_c_prompt(question, expected, actual)
    raw_codex = _judge_cli("codex", prompt)
    raw_gemini = _judge_cli("gemini", prompt)
    c_int = _parse_int_answer(raw_codex)
    g_int = _parse_int_answer(raw_gemini)
    c = None if c_int is None else bool(c_int)
    g_ = None if g_int is None else bool(g_int)
    correct, uncertain = _combine_dual(c, g_)
    return LossVerdict(
        codex_correct=c,
        gemini_correct=g_,
        recall=1 if correct else 0,
        uncertain=uncertain,
    )


# ─── T16: 5-judge jury (deferred mode) ──────────────────────────────────────
JURY_RUBRIC = ("correctness", "completeness", "efficiency", "edge_case", "style")
JURY_LENGTH_CAP_TOKENS = 2048   # spec §5.2 verbosity-bias guard
JURY_DISAGREEMENT_THRESH = 0.5  # spec §5.2 Layer 3 — |primary - jury_mean| > 0.5

# Three families = Anthropic + OpenAI + Google (spec §5.2 v3-max.1).
# Each judge gets a distinct system anchoring; criterion order is swapped per
# call to wash out per-criterion presentation bias.
JURY_PANEL: tuple[dict, ...] = (
    {"id": "J1", "family": "claude", "anchor": "strict",  "system":
        "You are a strict, evidence-only code reviewer. Penalize unsupported claims."},
    {"id": "J2", "family": "claude", "anchor": "lenient", "system":
        "You are a forgiving senior engineer. Reward clarity even if details are off."},
    {"id": "J3", "family": "claude", "anchor": "anchored", "system":
        "You are a rubric-anchored reviewer. Score each criterion independently."},
    {"id": "J4", "family": "codex",  "anchor": "default",  "system":
        "You are a careful code reviewer."},
    {"id": "J5", "family": "gemini", "anchor": "default",  "system":
        "You are a careful code reviewer."},
)


def _approx_token_count(text: str) -> int:
    """Whitespace-token proxy for length cap. Cheap, deterministic, testable.

    True tokeniser would need tiktoken or claude --count-tokens; this is fine
    for the binary cap decision (see spec §5.2 verbosity-bias guard).
    """
    return len(text.split())


def _truncate_to_cap(text: str, cap: int) -> tuple[str, bool]:
    words = text.split()
    if len(words) <= cap:
        return text, False
    head = " ".join(words[:cap])
    return head + f"\n\n[truncated to {cap} words]", True


def _build_jury_prompt(
    transcript: str,
    agent_output: str,
    system_prompt: str,
    criteria_order: Sequence[str],
) -> str:
    rubric_lines = "\n".join(
        f"  - {c}: 0..5" for c in criteria_order
    )
    schema_pairs = ", ".join(f'"{c}": <int 0-5>' for c in criteria_order)
    return (
        f"{system_prompt}\n\n"
        "TRANSCRIPT:\n"
        f"<<<\n{transcript}\n>>>\n\n"
        "AGENT OUTPUT:\n"
        f"<<<\n{agent_output}\n>>>\n\n"
        "Score the AGENT OUTPUT on each criterion (integer 0..5):\n"
        f"{rubric_lines}\n\n"
        f'Reply with one JSON object only: {{{schema_pairs}}}'
    )


def _parse_jury_response(raw: str | None) -> dict[str, int] | None:
    if raw is None:
        return None
    candidates: list[str] = []
    text = raw.strip()
    if text.startswith("{"):
        candidates.append(text)
    m = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if m and m.group(0) not in candidates:
        candidates.append(m.group(0))
    for cand in candidates:
        try:
            parsed = json.loads(cand)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        out: dict[str, int] = {}
        for crit in JURY_RUBRIC:
            v = parsed.get(crit)
            if isinstance(v, bool):  # bool is int subclass — exclude
                continue
            if isinstance(v, int) and 0 <= v <= 5:
                out[crit] = v
            elif isinstance(v, float) and 0.0 <= v <= 5.0:
                out[crit] = int(round(v))
            elif isinstance(v, str) and v.isdigit() and 0 <= int(v) <= 5:
                out[crit] = int(v)
        if len(out) == len(JURY_RUBRIC):
            return out
    return None


def _eval_mean_normalised(scores: dict[str, int]) -> float:
    """Mean of 5 criteria, normalised from 0..5 to 0..1."""
    return statistics.fmean(scores.values()) / 5.0


def jury_score(
    transcript: str,
    agent_output: str,
    *,
    primary_score: float | None = None,
    length_cap_tokens: int = JURY_LENGTH_CAP_TOKENS,
) -> dict:
    """Run the 5-judge jury (spec §5.2) with order-swap.

    Returns a dict ready to write to ``metrics.jury.json``:
      - judges: per-judge breakdown (forward + reverse evals, mean_score, parse_ok)
      - jury_mean: mean across judges that produced ≥1 valid eval (None if all failed)
      - length_capped: True iff agent_output was truncated
      - human_review: True iff |primary_score - jury_mean| > 0.5 (spec §5.2 Layer 3)
    """
    capped_output, length_capped = _truncate_to_cap(agent_output, length_cap_tokens)
    forward = list(JURY_RUBRIC)
    reverse = list(reversed(JURY_RUBRIC))

    judges_out: list[dict] = []
    judge_means: list[float] = []

    for spec in JURY_PANEL:
        evaluations = []
        valid_means: list[float] = []
        for order_label, order in (("forward", forward), ("reverse", reverse)):
            prompt = _build_jury_prompt(transcript, capped_output, spec["system"], order)
            raw = _judge_cli(spec["family"], prompt)
            scores = _parse_jury_response(raw)
            if scores is None:
                evaluations.append({
                    "order": order_label,
                    "scores": None,
                    "total": None,
                    "parse_ok": False,
                })
            else:
                total = _eval_mean_normalised(scores)
                evaluations.append({
                    "order": order_label,
                    "scores": scores,
                    "total": round(total, 6),
                    "parse_ok": True,
                })
                valid_means.append(total)
        mean_score = round(statistics.fmean(valid_means), 6) if valid_means else None
        judges_out.append({
            "judge_id": spec["id"],
            "family": spec["family"],
            "anchor": spec["anchor"],
            "evaluations": evaluations,
            "mean_score": mean_score,
        })
        if mean_score is not None:
            judge_means.append(mean_score)

    jury_mean = round(statistics.fmean(judge_means), 6) if judge_means else None
    jury_std  = round(statistics.pstdev(judge_means), 6) if len(judge_means) >= 2 else 0.0

    human_review = (
        primary_score is not None
        and jury_mean is not None
        and abs(primary_score - jury_mean) > JURY_DISAGREEMENT_THRESH
    )

    return {
        "schema_version": "1",
        "judges": judges_out,
        "jury_mean": jury_mean,
        "jury_std": jury_std,
        "length_capped": length_capped,
        "primary_score": primary_score,
        "human_review": bool(human_review),
    }


# ─── T16: deferred batch walker ─────────────────────────────────────────────


def _atomic_write_json(path: Path, body: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(body, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _iter_trial_dirs(state_root: Path):
    """Yield each trial dir under state_root that contains a metrics.json."""
    if not state_root.exists():
        return
    for metrics_path in sorted(state_root.rglob("metrics.json")):
        yield metrics_path.parent


def run_deferred(
    state_root: Path | str,
    *,
    fixture_filter: str | None = None,
    mode_filter: str | None = None,
) -> int:
    """Walk state tree; for each ok trial without metrics.jury.json, run jury.

    Returns the count of jury files written.
    """
    root = Path(state_root)
    written = 0
    for trial_dir in _iter_trial_dirs(root):
        jury_path = trial_dir / "metrics.jury.json"
        if jury_path.exists():
            continue
        try:
            metrics = json.loads((trial_dir / "metrics.json").read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if metrics.get("status") != "ok":
            continue
        if fixture_filter and metrics.get("fixture_id") != fixture_filter:
            continue
        if mode_filter and metrics.get("mode") != mode_filter:
            continue

        paths = metrics.get("paths") or {}
        out_rel = paths.get("stage1_output")
        jsonl_rel = paths.get("stage1_jsonl")
        if not out_rel:
            continue
        out_path = trial_dir / out_rel
        if not out_path.exists():
            continue
        agent_output = out_path.read_text(encoding="utf-8")
        # Transcript: prefer Stage 2 transcript file, fall back to Stage 1 jsonl.
        transcript_path = trial_dir / (paths.get("stage2_transcript") or jsonl_rel or "")
        transcript = transcript_path.read_text(encoding="utf-8") if transcript_path.exists() else ""

        primary = (metrics.get("quality") or {}).get("primary")
        result = jury_score(transcript, agent_output, primary_score=primary)
        result["trial_id"] = metrics.get("trial_id")
        result["fixture_id"] = metrics.get("fixture_id")
        result["mode"] = metrics.get("mode")
        result["seed_idx"] = metrics.get("seed_idx")
        result["run_idx"] = metrics.get("run_idx")
        _atomic_write_json(jury_path, result)
        written += 1
    return written


# ─── T17: fixture primary graders F2-F10 ────────────────────────────────────
def _safe_div(num: float, den: float) -> float:
    return num / den if den else 0.0


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _extract_urls(text: str) -> list[str]:
    return re.findall(r"https?://[^\s)>\]]+", text or "")


# ─── Output-style formatting-exemption (Q3 ADR §2.4.2 r2 contract) ──────────
# ADR: docs/adr/2026-05-02-output-style-fixture-design-rule.md (orchestrator
# repo). Every primary grader's return dict — which the harness lands at
# `metrics.json::quality.primary_components` per
# `bin/exec-mode-experiment.sh:825` — MUST carry the five
# `formatting_exempt_*` fields below. See §2.4.2 status semantics:
#   implemented     — grader normalizes structurally-equivalent variants
#                     (canonicalizer named, variants listed, tests listed).
#   not_applicable  — formatting IS the scoring surface (e.g., strict-format
#                     JSON validation); canonicalization would defeat the test.
#   grandfathered   — pre-Phase-6 fixture per §11 exemption registry; reserved
#                     for the registry's listed entries (currently H10).
FORMATTING_EXEMPT_RULE_ADR = "2026-05-02-output-style-fixture-design-rule"
_FORMATTING_EXEMPT_STATUS_VALUES = ("implemented", "not_applicable", "grandfathered")


def _emit_formatting_exempt_status(
    status: str,
    *,
    canonicalizer: str | None = None,
    variants: Sequence[str] = (),
    tests: Sequence[str] = (),
) -> dict:
    """Build the five `formatting_exempt_*` fields per ADR §2.4.2 r2.

    The returned dict is merged into a primary grader's return value. Companion
    field semantics are enforced per the §2.4.2 status table:

      * `implemented`    — caller MUST pass `canonicalizer` (function name),
                           non-empty `variants`, non-empty `tests`.
      * `not_applicable` — caller MUST omit/None the canonicalizer + leave
                           variants/tests empty; grader docstring carries the
                           `formatting_exempt_justification` section.
      * `grandfathered`  — same as `not_applicable` (no canonicalizer); the
                           grader's fixture_id MUST appear in the §11 registry.

    Lint check 2 (§2.4.3) cross-checks companion-field consistency by AST
    walking the grader source — it expects the canonicalizer function name
    and adversarial test names to resolve. Keep `canonicalizer` aligned with
    the actual `_canonicalize_*` symbol the grader calls.
    """
    if status not in _FORMATTING_EXEMPT_STATUS_VALUES:
        raise ValueError(
            f"formatting_exempt_status must be one of "
            f"{_FORMATTING_EXEMPT_STATUS_VALUES}; got {status!r}"
        )
    if status == "implemented":
        if not canonicalizer:
            raise ValueError(
                "formatting_exempt_status='implemented' requires a non-empty "
                "canonicalizer function name (lint check 2)"
            )
        if not variants:
            raise ValueError(
                "formatting_exempt_status='implemented' requires a non-empty "
                "variants list (lint check 2)"
            )
        if not tests:
            raise ValueError(
                "formatting_exempt_status='implemented' requires a non-empty "
                "tests list (lint check 2)"
            )
    else:
        # not_applicable and grandfathered use null canonicalizer + empty lists
        # per §2.4.2 status-table companion-field rules.
        if canonicalizer is not None:
            raise ValueError(
                f"formatting_exempt_status={status!r} requires "
                "canonicalizer=None (lint check 2)"
            )
        if variants or tests:
            raise ValueError(
                f"formatting_exempt_status={status!r} requires empty "
                "variants and tests lists (lint check 2)"
            )
    return {
        "formatting_exempt_status": status,
        "formatting_exempt_canonicalizer": canonicalizer,
        "formatting_exempt_variants": list(variants),
        "formatting_exempt_tests": list(tests),
        "formatting_exempt_rule_adr": FORMATTING_EXEMPT_RULE_ADR,
    }


def _parse_markdown_table_rows(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cols = [c.strip() for c in stripped.strip("|").split("|")]
        if not cols or all(not c for c in cols):
            continue
        if re.fullmatch(r"[:\-\s]+", "".join(cols)):
            continue
        rows.append(cols)
    return rows


def _label_marker_regex(label: str) -> re.Pattern[str]:
    """H8: tolerate the label surface real agents emit.

    Accepted forms (MULTILINE-anchored at line start):
      - `(a)`                      — plain parens (pre-H8 baseline)
      - `**(a)**`, `*(a)*`         — bold/italic-wrapped parens
      - `a)` `a.` `a:`             — half-paren or trailing punctuation
      - `**a.**` `**a:**` `**a)**` — bold-wrapped letter + punctuation
      - `## (a)`, `### **(a)**`    — markdown h1-h6 header prefix + any
                                     of the above surfaces (H8 deep-fix:
                                     F10 agents empirically emit h2
                                     enumerations; see analyst phase 3
                                     §8 and stage1_output.md samples)

    The optional `#{1,6}\s+` prefix is applied as an outer non-capturing
    group so all pre-existing combinations continue to match unchanged.

    The trailing-punctuation branch requires a `)`, `.`, or `:` after the
    label (with optional bold markers) so prose lines that simply start
    with "a …" do not false-match as section labels.
    """
    esc = re.escape(label)
    return re.compile(
        rf"(?im)^\s*(?:#{{1,6}}\s+)?(?:"
        rf"\*{{0,2}}\(\s*{esc}\s*\)\*{{0,2}}"     # (a), *(a)*, **(a)**, ## (a)
        rf"|\*{{0,2}}{esc}\*{{0,2}}[\)\.\:]"      # a) a. a: **a.** **a:** ## a.
        rf")"
    )


def _extract_labeled_section(text: str, label: str, next_labels: Sequence[str]) -> str:
    body = text or ""
    start_pat = _label_marker_regex(label)
    start = start_pat.search(body)
    if not start:
        return ""
    end_pos = len(body)
    for nxt in next_labels:
        nxt_pat = _label_marker_regex(nxt)
        nxt_match = nxt_pat.search(body, start.end())
        if nxt_match:
            end_pos = min(end_pos, nxt_match.start())
    return body[start.end():end_pos].strip()


def _strip_code_fence(text: str) -> str:
    stripped = (text or "").strip()
    stripped = re.sub(r"^```[a-zA-Z0-9_-]*\n", "", stripped)
    stripped = re.sub(r"\n```$", "", stripped)
    return stripped.strip()


def _url_matches_allow_entry(url: str, allow_entry: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    host = parsed.netloc.lower()
    if not host:
        return False

    allow_raw = allow_entry if "://" in allow_entry else f"https://{allow_entry}"
    allow = urlparse(allow_raw)
    allow_host = allow.netloc.lower()
    allow_path = (allow.path or "").rstrip("/")

    if allow_path:
        return host == allow_host and parsed.path.startswith(allow_path)
    return host == allow_host or host.endswith(f".{allow_host}")


def _run_curl(url: str, *, head: bool) -> subprocess.CompletedProcess[str] | None:
    cmd = ["curl", "-sS", "-L", "--max-time", "30"]
    if head:
        cmd.insert(1, "-I")
    cmd.append(url)
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None


def _url_is_live(url: str) -> bool:
    proc = _run_curl(url, head=True)
    if proc is None or proc.returncode != 0:
        return False
    statuses = re.findall(r"HTTP/\d(?:\.\d)?\s+(\d{3})", proc.stdout or "")
    if not statuses:
        return False
    return statuses[-1].startswith(("2", "3"))


def _normalise_text(text: str) -> str:
    no_tags = re.sub(r"<[^>]+>", " ", text or "")
    return re.sub(r"\s+", " ", html.unescape(no_tags)).strip().lower()


def _quote_supported_by_url(quote: str, url: str) -> bool:
    proc = _run_curl(url, head=False)
    if proc is None or proc.returncode != 0 or not proc.stdout:
        return False
    quote_norm = _normalise_text(quote)
    body_norm = _normalise_text(proc.stdout)
    if not quote_norm or not body_norm:
        return False
    if quote_norm in body_norm:
        return True
    partial = fuzz.partial_ratio(quote_norm, body_norm) / 100.0
    token = fuzz.partial_token_set_ratio(quote_norm, body_norm) / 100.0
    return max(partial, token) >= 0.88


def score_f2_invariants(agent_output: str, ground_truth: dict) -> dict:
    """MD slim proposal — preserve hidden invariants checklist."""
    text = agent_output or ""
    inv_cfg = ground_truth.get("invariants_checklist") or {}
    invariants = list(inv_cfg.get("invariants") or [])
    case_insensitive = bool(inv_cfg.get("case_insensitive", True))

    matched: list[dict] = []
    missing: list[dict] = []
    for inv in invariants:
        hits = _regex_any_hit(text, inv.get("regex_any_of") or [], case_insensitive=case_insensitive)
        record = {"id": inv.get("id"), "label": inv.get("label"), "hits": hits}
        if hits:
            matched.append(record)
        else:
            missing.append(record)

    invariant_rate = _safe_div(len(matched), len(invariants))

    struct_cfg = ground_truth.get("output_structure_checks") or {}
    must_all = [str(s).lower() for s in struct_cfg.get("must_contain_all") or []]
    structure_all_ok = all(token in text.lower() for token in must_all)
    mapping_table_ok = bool(_regex_any_hit(text, struct_cfg.get("must_contain_any_of") or []))

    ack_cfg = ((ground_truth.get("secondary_signals") or {}).get("past_failure_acknowledgment") or {})
    ack_hits = _regex_any_hit(text, ack_cfg.get("regex_any_of") or [])
    ack_min = int(ack_cfg.get("min_hits", 1))
    audit_ack = len(ack_hits) >= ack_min

    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)
    primary_score = round(_clamp01(invariant_rate), 4)

    return {
        "fixture": ground_truth.get("fixture", "F2"),
        "matched_invariants": matched,
        "missing_invariants": missing,
        "invariant_rate": primary_score,
        "output_structure": {
            "must_contain_all": structure_all_ok,
            "mapping_table_present": mapping_table_ok,
        },
        "past_failure_acknowledgment": audit_ack,
        "ack_hits": ack_hits,
        "primary_pass": primary_score >= pass_threshold and structure_all_ok and mapping_table_ok,
        "primary_score": primary_score,
    }


def score_f3_severity_f1(agent_output: str, ground_truth: dict) -> dict:
    """Blind review — severity-weighted F1 on issue IDs with distractor penalty."""
    text = agent_output or ""
    rows = [
        {
            "id": cols[0],
            "severity": cols[1] if len(cols) > 1 else "",
            "fileline": cols[2] if len(cols) > 2 else "",
            "issue": cols[3] if len(cols) > 3 else "",
            "recommendation": "|".join(cols[4:]) if len(cols) > 4 else "",
        }
        for cols in _parse_markdown_table_rows(text)
        if cols and cols[0].lower() != "id"
    ]

    weights = ground_truth.get("severity_weights") or {}
    issues = list(ground_truth.get("ground_truth_issues") or [])
    matched_issue_ids: list[str] = []
    missed_issue_ids: list[str] = []
    tp_weight = 0.0
    fn_weight = 0.0

    for issue in issues:
        candidate_lines = issue.get("must_cite_line_any_of") or [issue.get("must_cite_line")]
        candidate_lines = [int(x) for x in candidate_lines if x is not None]
        matched = False
        for row in rows:
            row_text = f"{row['issue']} {row['recommendation']}"
            line_ok = any(
                re.search(rf"(?<!\d){line}(?!\d)", row["fileline"] or "")
                for line in candidate_lines
            )
            if line_ok and _regex_any_hit(row_text, issue.get("match_regex_any_of") or []):
                matched = True
                break
        weight = float(weights.get(issue.get("severity"), 1.0))
        if matched:
            matched_issue_ids.append(issue.get("id", ""))
            tp_weight += weight
        else:
            missed_issue_ids.append(issue.get("id", ""))
            fn_weight += weight

    medium_weight = float(weights.get("Medium", 1.0))
    flagged_distractors: list[str] = []
    fp_weight = 0.0
    for distractor in ground_truth.get("distractors_must_not_flag") or []:
        line = distractor.get("line")
        for row in rows:
            row_text = f"{row['issue']} {row['recommendation']}"
            line_ok = line is None or re.search(rf"(?<!\d){int(line)}(?!\d)", row["fileline"] or "")
            if line_ok and _regex_any_hit(row_text, distractor.get("fp_regex_any_of") or []):
                flagged_distractors.append(distractor.get("id", ""))
                fp_weight += medium_weight
                break

    precision = _safe_div(tp_weight, tp_weight + fp_weight)
    recall = _safe_div(tp_weight, tp_weight + fn_weight)
    f1 = _safe_div(2 * precision * recall, precision + recall)

    sec = ground_truth.get("secondary_signals") or {}
    table_ok = bool(_regex_any_hit(text, ((sec.get("table_format") or {}).get("regex_any_of") or [])))
    verdict_ok = bool(_regex_any_hit(text, ((sec.get("verdict_paragraph") or {}).get("regex_any_of") or [])))
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)
    primary_score = round(_clamp01(f1), 4)

    return {
        "fixture": ground_truth.get("fixture", "F3"),
        "matched_issue_ids": matched_issue_ids,
        "missed_issue_ids": missed_issue_ids,
        "flagged_distractors": flagged_distractors,
        "tp_weight": round(tp_weight, 4),
        "fp_weight": round(fp_weight, 4),
        "fn_weight": round(fn_weight, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "table_format_ok": table_ok,
        "verdict_present": verdict_ok,
        "primary_pass": primary_score >= pass_threshold and table_ok and verdict_ok,
        "primary_score": primary_score,
    }


def score_f4_oracle_graph(agent_output: str, ground_truth: dict) -> dict:
    """Structure map — entity+edge matching vs oracle, hallucinated node penalty, file anchor required."""
    text = agent_output or ""
    oracle = ground_truth.get("oracle_graph") or {}
    nodes = list(oracle.get("nodes") or [])
    alias_map = oracle.get("node_aliases") or {}
    alt_names: dict[str, list[str]] = {node: [node] for node in nodes}
    for alias, target in alias_map.items():
        if target in alt_names:
            alt_names[target].append(alias)

    matched_nodes: list[str] = []
    for node, names in alt_names.items():
        if any(name in text for name in names):
            matched_nodes.append(node)

    # H4: bare basenames (e.g., `loader.py`) may be legitimate shorthand
    # citations of oracle nodes held as full paths. Only flag as hallucinated
    # when neither the literal ref nor its basename is present in the oracle.
    file_like_refs = sorted(set(re.findall(r"[\w./-]+\.(?:rs|py|toml|udl|md)", text)))
    node_basenames = {Path(n).name for n in nodes}
    hallucinated_nodes = [
        ref for ref in file_like_refs
        if ref not in nodes and Path(ref).name not in node_basenames
    ]
    node_match_rate = _safe_div(len(matched_nodes), len(nodes))

    kind_keywords = {
        "re-exports": [r"re[-\s]?exports?", r"\bexports?\b", r"-->", r"->"],
        "calls": [r"\bcalls?\b", r"\binvokes?\b", r"-->", r"->"],
        "path_dep": [r"path[_-]?dep", r"\bdepends?\b", r"\bdependency\b", r"-->", r"->"],
        "generates": [r"\bgenerates?\b", r"\bgenerated\b", r"-->", r"->"],
        "ffi_call": [r"\bffi\b", r"\bbindings?\b", r"\bcalls?\b", r"-->", r"->"],
        "imports": [r"\bimports?\b", r"-->", r"->"],
    }
    matched_edges: list[dict] = []
    for edge in oracle.get("edges") or []:
        src_alts = alt_names.get(edge.get("src"), [edge.get("src", "")])
        dst_alts = alt_names.get(edge.get("dst"), [edge.get("dst", "")])
        keywords = kind_keywords.get(edge.get("kind"), [r"-->", r"->"])
        edge_hit = False
        for src in src_alts:
            for dst in dst_alts:
                if not src or not dst:
                    continue
                src_pat = re.escape(src)
                dst_pat = re.escape(dst)
                kind_pat = "|".join(keywords)
                if re.search(
                    rf"{src_pat}[\s\S]{{0,80}}(?:{kind_pat})[\s\S]{{0,80}}{dst_pat}",
                    text,
                    re.IGNORECASE,
                ):
                    edge_hit = True
                    break
            if edge_hit:
                break
        if edge_hit:
            matched_edges.append(edge)

    edge_match_rate = _safe_div(len(matched_edges), len(oracle.get("edges") or []))

    fmt = ground_truth.get("output_format_checks") or {}
    mermaid_blocks = re.findall(fmt.get("mermaid_regex") or r"```mermaid[\s\S]*?```", text, re.IGNORECASE)
    mermaid_count = len(mermaid_blocks)
    mermaid_min = int(fmt.get("mermaid_diagram_count_min", 0))
    inventory_hits = [pat for pat in fmt.get("file_inventory_regex") or [] if _regex_any_hit(text, [pat])]
    ffi_boundary_ok = bool(_regex_any_hit(text, fmt.get("ffi_boundary_regex") or []))

    weights = (ground_truth.get("primary_metric") or {}).get("weights") or {}
    hallucination_penalty = min(1.0, _safe_div(len(hallucinated_nodes), 5))
    score = (
        float(weights.get("node", 0.4)) * node_match_rate
        + float(weights.get("edge", 0.5)) * edge_match_rate
        - float(weights.get("hallucination_penalty", 0.1)) * hallucination_penalty
    )
    if mermaid_count < mermaid_min:
        score *= 0.5
    primary_score = round(_clamp01(score), 4)
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)

    return {
        "fixture": ground_truth.get("fixture", "F4"),
        "matched_nodes": matched_nodes,
        "node_match_rate": round(node_match_rate, 4),
        "matched_edges": matched_edges,
        "edge_match_rate": round(edge_match_rate, 4),
        "hallucinated_nodes": hallucinated_nodes,
        "hallucination_penalty": round(hallucination_penalty, 4),
        "mermaid_diagram_count": mermaid_count,
        "file_inventory_hits": inventory_hits,
        "ffi_boundary_present": ffi_boundary_ok,
        "primary_pass": primary_score >= pass_threshold and mermaid_count >= mermaid_min and ffi_boundary_ok,
        "primary_score": primary_score,
    }


def score_f5_citations(agent_output: str, ground_truth: dict) -> dict:
    """Research + citations — URL liveness check + primary-source quota + claim spot checks."""
    text = agent_output or ""
    word_count = len(re.findall(r"\S+", text))
    bounds = ground_truth.get("word_count_bounds") or {}
    within_bounds = int(bounds.get("min", 0)) <= word_count <= int(bounds.get("max", 10**9))

    section_cfg = ground_truth.get("section_requirements") or {}
    heading_groups = list(section_cfg.get("required_heading_regex_any_of") or [])
    heading_hits = [
        any(re.search(pat, text, re.IGNORECASE | re.MULTILINE) for pat in group)
        for group in heading_groups
    ]

    citation_re = re.compile(
        r'^\s*>\s*"(?P<quote>[^"\n]{10,})"\s*[—–-]\s*\[(?P<title>[^\]]+)\]\((?P<url>https?://[^)]+)\)',
        re.MULTILINE,
    )
    citations = [
        {"quote": m.group("quote"), "title": m.group("title"), "url": m.group("url")}
        for m in citation_re.finditer(text)
    ]
    all_urls = list(dict.fromkeys(_extract_urls(text)))

    allowlist = ((ground_truth.get("primary_source_allowlist") or {}).get("domains") or [])
    blocklist = ((ground_truth.get("primary_source_allowlist") or {}).get("blocklist_hint") or [])
    primary_citations = [c for c in citations if any(_url_matches_allow_entry(c["url"], entry) for entry in allowlist)]
    blocklist_hits = [
        url for url in all_urls
        if any(_url_matches_allow_entry(url, blocked) for blocked in blocklist)
    ]

    live_urls = [url for url in all_urls if _url_is_live(url)]
    liveness_rate = _safe_div(len(live_urls), len(all_urls))

    sources_cfg = ground_truth.get("sources_section_requirement") or {}
    sources_heading = sources_cfg.get("heading_regex") or r"^##\s*Sources"
    sources_match = re.search(sources_heading, text, re.IGNORECASE | re.MULTILINE)
    sources_section = text[sources_match.start():] if sources_match else ""
    sources_urls = _extract_urls(sources_section)
    sources_ok = bool(sources_match) and len(set(sources_urls)) >= int(sources_cfg.get("min_urls_in_section", 0))

    seed_raw = ground_truth.get("trial_seed", 42)
    try:
        seed = int(seed_raw)
    except (TypeError, ValueError):
        seed = 42
    spot_sample = random.Random(seed).sample(primary_citations, min(3, len(primary_citations)))
    spot_hits = 0
    for item in spot_sample:
        body = _run_curl(item["url"], head=False)
        if body is None or body.returncode != 0 or not body.stdout:
            continue
        snippet = _normalise_text(body.stdout)[:4000]
        if not snippet:
            continue
        prompt = (
            "Does this quoted sentence appear substantively in the source text?\n"
            f'QUOTE: "{item["quote"]}"\n'
            f"SOURCE EXCERPT: {snippet}\n"
            'Answer only "yes" or "no".'
        )
        verdict = _judge_cli("claude", prompt)
        if verdict and verdict.strip().lower().startswith("y"):
            spot_hits += 1
    spot_rate = _safe_div(spot_hits, len(spot_sample))

    quota_cfg = ground_truth.get("citation_quota") or {}
    quota_score = min(1.0, _safe_div(len(primary_citations), int(quota_cfg.get("min_primary_citations", 5) or 5)))

    score = 0.3 * liveness_rate + 0.3 * quota_score + 0.4 * spot_rate
    if not within_bounds:
        score *= 0.5
    for _ in blocklist_hits[:3]:
        score *= 0.7
    primary_score = round(_clamp01(score), 4)
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)

    return {
        "fixture": ground_truth.get("fixture", "F5"),
        "word_count": word_count,
        "word_count_within_bounds": within_bounds,
        "section_heading_hits": heading_hits,
        "citation_count": len(citations),
        "primary_citation_count": len(primary_citations),
        "blocklist_hits": blocklist_hits,
        "live_url_count": len(live_urls),
        "liveness_rate": round(liveness_rate, 4),
        "spot_check_sample_size": len(spot_sample),
        "spot_check_hits": spot_hits,
        "spot_check_rate": round(spot_rate, 4),
        "sources_section_ok": sources_ok,
        "primary_pass": (
            primary_score >= pass_threshold
            and sources_ok
            and len(primary_citations) >= int(quota_cfg.get("min_primary_citations", 5) or 5)
        ),
        "primary_score": primary_score,
    }


def score_f6_build_turns(agent_output: str, ground_truth: dict) -> dict:
    """Fix-loop — binary build pass proxy + turns-to-success estimate.

    G8 (F6 RCA R1): diff_format_regex uses `^` anchor; agents wrap unified
    diffs in the ```diff fence that task_prompt.md itself demonstrates, so
    the `---` header sits mid-string. Pass re.MULTILINE so `^` matches line
    start, not string start. Plain (unfenced) diffs still match.
    """
    text = agent_output or ""
    checks = ground_truth.get("stage1_fix_3_checks") or {}
    diff_format_ok = bool(_regex_any_hit(
        text, [checks.get("diff_format_regex", "")], extra_flags=re.MULTILINE
    ))
    added_lines = "\n".join(
        line[1:] for line in text.splitlines()
        if line.startswith("+") and not line.startswith("+++")
    )
    fix_hits = _regex_any_hit(added_lines, checks.get("fix_content_regex_any_of") or [])
    anti_hits = _regex_any_hit(added_lines, checks.get("must_not_contain_regex") or [])
    prediction_ok = bool(_regex_any_hit(text, [checks.get("next_step_prediction_regex", "")]))

    secondary = ground_truth.get("secondary_signals") or {}
    one_patch_violation = bool(_regex_any_hit(text, [((secondary.get("one_patch_per_turn") or {}).get("violation_regex", ""))]))

    metric = ground_truth.get("primary_metric") or {}
    optimal_turns = int(metric.get("optimal_remaining_turns", 1))
    max_turns = int(metric.get("max_turns", 10))

    build_pass_binary = 1.0 if diff_format_ok and bool(fix_hits) and not anti_hits else 0.0
    turns_to_success = max_turns
    if build_pass_binary:
        turns_to_success = optimal_turns if prediction_ok else min(max_turns, optimal_turns + 1)

    score = 0.0
    if build_pass_binary:
        score = 1.0 - 0.05 * max(0, turns_to_success - optimal_turns)
    if one_patch_violation:
        score *= 0.5
    primary_score = round(_clamp01(score), 4)
    pass_threshold = float(metric.get("pass_threshold") or 1.0)

    return {
        "fixture": ground_truth.get("fixture", "F6"),
        "diff_format_ok": diff_format_ok,
        "fix_hits": fix_hits,
        "anti_pattern_hits": anti_hits,
        "prediction_ok": prediction_ok,
        "one_patch_violation": one_patch_violation,
        "build_pass_binary": build_pass_binary,
        "turns_to_success": turns_to_success,
        "primary_pass": primary_score >= pass_threshold,
        "primary_score": primary_score,
    }


def score_f7_latest_decision(agent_output: str, ground_truth: dict) -> dict:
    """Decision propagation — latest-decision correctness + superseded rejection + citation-to-turn."""
    text = agent_output or ""
    checks = ground_truth.get("stage1_output_checks") or {}

    option_present = bool(_regex_any_hit(text, checks.get("refactored_file_must_contain_regex_any_of") or []))
    result_present = bool(_regex_any_hit(text, checks.get("error_pattern_regex_any_of") or []))
    either_type_present = bool(_regex_any_hit(text, [checks.get("banned_pattern_detect_regex", "")]))

    latest_cfg = ((ground_truth.get("primary_metric") or {}).get("latest_decision_correctness") or {})
    latest_weights = latest_cfg.get("component_weights") or {}
    latest_decision = (
        float(latest_weights.get("option_present", 0.4)) * float(option_present)
        + float(latest_weights.get("result_present", 0.4)) * float(result_present)
        + float(latest_weights.get("no_either", 0.2)) * float(not either_type_present)
    )

    option_cited = bool(re.search(r"(Turn\s*6|D3)", text, re.IGNORECASE))
    result_cited = bool(re.search(r"(Turn\s*8|D4)", text, re.IGNORECASE))
    if option_cited and result_cited:
        citation_score = 1.0
    elif option_cited or result_cited:
        citation_score = 0.5
    else:
        citation_score = 0.0

    superseded_full = bool(re.search(r"(D2|Turn\s*4).*(supersed|replaced).*(Turn\s*8|D4)", text, re.IGNORECASE | re.DOTALL))
    superseded_partial = bool(_regex_any_hit(text, checks.get("superseded_mention_regex_any_of") or []))
    if superseded_full:
        superseded_score = 1.0
    elif superseded_partial:
        superseded_score = 0.5
    else:
        superseded_score = 0.0

    metric = ground_truth.get("primary_metric") or {}
    score = 0.45 * latest_decision + 0.35 * superseded_score + 0.20 * citation_score
    if either_type_present:
        score *= 0.3
    primary_score = round(_clamp01(score), 4)

    return {
        "fixture": ground_truth.get("fixture", "F7"),
        "latest_decision_correctness": round(latest_decision, 4),
        "option_present": option_present,
        "result_present": result_present,
        "either_type_present": either_type_present,
        "superseded_rejection": superseded_score,
        "citation_to_turn": citation_score,
        "primary_pass": primary_score >= float(metric.get("pass_threshold") or 1.0),
        "primary_score": primary_score,
    }


def score_f8_hidden_tests(agent_output: str, ground_truth: dict) -> dict:
    """Multi-file refactor — hidden-test proxy + duplication reduction + test-edit penalty."""
    text = agent_output or ""
    headings = list(re.finditer(r"^###\s+(src/ingest/[^\s]+)", text, re.MULTILINE))
    sections: dict[str, str] = {}
    for idx, match in enumerate(headings):
        start = match.end()
        end = headings[idx + 1].start() if idx + 1 < len(headings) else len(text)
        sections[match.group(1)] = _strip_code_fence(text[start:end])

    public_api = ground_truth.get("public_api_required_exports") or {}
    total_exports = sum(len(names) for names in public_api.values())
    present_exports = 0
    missing_exports: list[str] = []
    for path, names in public_api.items():
        body = sections.get(path, "")
        for name in names:
            if re.search(rf"\b{name}\b", body):
                present_exports += 1
            else:
                missing_exports.append(name)
    api_score = _safe_div(present_exports, total_exports)

    validators = sections.get("src/ingest/validators.ts", "")
    wrappers = {
        path: sections.get(path, "")
        for path in (
            "src/ingest/orders.ts",
            "src/ingest/users.ts",
            "src/ingest/webhooks.ts",
        )
    }
    import_count = sum(
        1 for body in wrappers.values()
        if re.search(r"from\s+['\"`]\./validators['\"`]", body)
    )

    email_regex_ok = bool(re.search(r"\[\^\\s@]\+@\[\^\\s@]\+\\\.\[\^\\s@]\+", validators))
    email_truthy_ok = bool(re.search(r"!\s*\w+\s*\|\||!\s*\w+", validators))
    email_length_ok = bool(re.search(r"(?:>\s*254|<=\s*254|length\s*[<>]=?\s*254)", validators))
    phone_strip_ok = bool(re.search(r"\\D|match\(/\\d", validators))
    phone_range_ok = bool(re.search(r"(?:<\s*7|>=?\s*7).*(?:>\s*15|<=\s*15)|7.*15", validators))
    bad_email_ok = all(re.search(r"bad_email", body) for body in wrappers.values())
    bad_phone_ok = all(re.search(r"bad_phone", body) for body in wrappers.values())
    return_input_ok = bool(re.search(r"return\s+\w+\s*;", wrappers.get("src/ingest/webhooks.ts", "")))

    hidden_checks = {
        "i18n_email": email_regex_ok and email_length_ok,
        "empty": email_truthy_ok,
        "formatted_phone": phone_strip_ok and phone_range_ok,
        "too_short": phone_range_ok,
        "no_at": email_regex_ok,
        "happy_path": return_input_ok,
        "bad_email_error": bad_email_ok,
        "bad_phone_error": bad_phone_ok,
    }
    hidden_cases = ground_truth.get("hidden_regression_tests", {}).get("test_cases") or []
    hidden_results: list[dict] = []
    passed_hidden = 0
    for case in hidden_cases:
        kind = case.get("kind", "")
        passed = bool(hidden_checks.get(kind, False))
        hidden_results.append({"kind": kind, "passed": passed})
        passed_hidden += int(passed)
    test_pass_rate = _safe_div(passed_hidden, len(hidden_cases))

    dup_cfg = ground_truth.get("duplication_reduction_metric") or {}
    baseline = int(dup_cfg.get("baseline_duplicated_lines", 36))
    duplicated_lines_after = max(0, baseline - round(baseline * import_count / 3))
    inline_validator_hits = 0
    for body in wrappers.values():
        if re.search(r"\[\^\\s@]\+@\[\^\\s@]\+\\\.\[\^\\s@]\+|\\D", body):
            inline_validator_hits += 1
    duplicated_lines_after = min(baseline, duplicated_lines_after + (inline_validator_hits * 4))
    dup_score = _clamp01(1.0 - _safe_div(duplicated_lines_after, baseline))

    penalty_cfg = ground_truth.get("test_edit_penalty") or {}
    test_edit_hits = _regex_any_hit(text, penalty_cfg.get("detect_regex_any_of") or [])
    penalty_multiplier = float(penalty_cfg.get("penalty_multiplier", 0.3)) if test_edit_hits else 1.0

    score = (0.5 * test_pass_rate + 0.3 * dup_score + 0.2 * api_score) * penalty_multiplier
    primary_score = round(_clamp01(score), 4)
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)

    return {
        "fixture": ground_truth.get("fixture", "F8"),
        "section_paths": sorted(sections),
        "hidden_test_results": hidden_results,
        "test_pass_rate": round(test_pass_rate, 4),
        "duplicated_lines_after": duplicated_lines_after,
        "duplication_reduction_score": round(dup_score, 4),
        "api_preservation_score": round(api_score, 4),
        "missing_exports": missing_exports,
        "test_edit_hits": test_edit_hits,
        "test_edit_penalty_multiplier": penalty_multiplier,
        "primary_pass": primary_score >= pass_threshold,
        "primary_score": primary_score,
    }


def score_f9_root_cause(agent_output: str, ground_truth: dict) -> dict:
    """Prior-turn debug — exact root cause match + correct fix."""
    text = agent_output or ""
    root_section = _extract_labeled_section(text, "a", ("b", "c"))
    evidence_section = _extract_labeled_section(text, "b", ("c",))
    diff_section = _extract_labeled_section(text, "c", ())

    wrong_penalty = ground_truth.get("wrong_root_cause_penalty") or {}
    wrong_hits = _regex_any_hit(root_section, wrong_penalty.get("detect_regex_any_of") or [])
    if wrong_hits:
        return {
            "fixture": ground_truth.get("fixture", "F9"),
            "wrong_root_cause_hits": wrong_hits,
            "root_cause_score": 0.0,
            "fix_score": 0.0,
            "evidence_score": 0.0,
            "primary_pass": False,
            "primary_score": 0.0,
        }

    true_root = ground_truth.get("true_root_cause") or {}
    cause_hits = _regex_any_hit(root_section, true_root.get("match_regex_any_of") or [])
    turn_refs = [
        turn for turn in true_root.get("must_reference_turn_any_of") or []
        if re.search(rf"\bTurn\s*{int(turn)}\b", root_section, re.IGNORECASE)
    ]
    if cause_hits and turn_refs:
        root_score = 1.0
    elif cause_hits:
        root_score = 0.5
    else:
        root_score = 0.0

    canonical_fix = ground_truth.get("canonical_fix") or {}
    diff_target_ok = bool(_regex_any_hit(diff_section, [canonical_fix.get("diff_file_target_regex", "")], case_insensitive=False))
    fix_hits = _regex_any_hit(diff_section, canonical_fix.get("fix_regex_any_of_in_diff") or [])
    min_matches = int(canonical_fix.get("min_regex_matches", 2))
    if diff_target_ok and len(fix_hits) >= min_matches:
        fix_score = 1.0
    elif diff_target_ok and fix_hits:
        fix_score = 0.5
    else:
        fix_score = 0.0

    red_herrings = {
        "R1": r"off[-\s]?by[-\s]?one|loop\s*bound|attempts\s*<\s*cfg\.max",
        "R2": r"overflow|backoff|2\s*\*\*\s*attempts",
        "R3": r"promise|then\s*chain|await",
    }
    ruled_out = [rid for rid, pat in red_herrings.items() if re.search(pat, evidence_section, re.IGNORECASE)]
    if len(ruled_out) >= 2:
        evidence_score = 1.0
    elif len(ruled_out) == 1:
        evidence_score = 0.5
    else:
        evidence_score = 0.0

    score = 0.5 * root_score + 0.4 * fix_score + 0.1 * evidence_score
    primary_score = round(_clamp01(score), 4)
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)

    return {
        "fixture": ground_truth.get("fixture", "F9"),
        "root_cause_hits": cause_hits,
        "turn_references": turn_refs,
        "root_cause_score": root_score,
        "fix_hits": fix_hits,
        "fix_score": fix_score,
        "evidence_ruled_out": ruled_out,
        "evidence_score": evidence_score,
        "primary_pass": primary_score >= pass_threshold,
        "primary_score": primary_score,
    }


def score_f10_checklist(agent_output: str, ground_truth: dict) -> dict:
    """Compact+resume — unresolved checklist apply rate + stale decoy rejection."""
    text = agent_output or ""
    status_section = _extract_labeled_section(text, "a", ("b", "c"))
    next_section = _extract_labeled_section(text, "b", ("c",))
    stale_section = _extract_labeled_section(text, "c", ())

    unresolved_cfg = (ground_truth.get("hidden_unresolved_checklist") or {}).get("items") or []
    unresolved_hits: list[str] = []
    for item in unresolved_cfg:
        content_hit = bool(_regex_any_hit(next_section, item.get("match_regex_any_of") or []))
        if content_hit:
            unresolved_hits.append(item.get("id", ""))
    unresolved_rate = _safe_div(len(unresolved_hits), len(unresolved_cfg))

    stale_rows = [cols for cols in _parse_markdown_table_rows(stale_section) if cols and cols[0] != "#"]
    stale_cfg = (ground_truth.get("stale_decoy_items") or {}).get("items") or []
    rejected_stale: list[str] = []
    for item in stale_cfg:
        for cols in stale_rows:
            row_text = " | ".join(cols)
            number_ok = bool(re.search(rf"(?<!\d){int(item.get('turn7_number', -1))}(?!\d)", cols[0] if cols else ""))
            reason_ok = bool(_regex_any_hit(row_text, item.get("rejection_regex_any_of") or []))
            if number_ok and reason_ok:
                rejected_stale.append(item.get("id", ""))
                break
    stale_rate = _safe_div(len(rejected_stale), len(stale_cfg))

    signals = ground_truth.get("secondary_signals") or {}
    hallucination_cfg = signals.get("no_hallucinated_next_action") or {}
    hallucinated_hits = _regex_any_hit(next_section, hallucination_cfg.get("detect_regex_any_of") or [])
    hallucination_penalty = len(hallucinated_hits) * float(hallucination_cfg.get("penalty_per_match", 0.05))

    fmt = ground_truth.get("output_format_checks") or {}
    status_ok = bool(status_section) and bool(_regex_any_hit(text, fmt.get("status_summary_regex") or []))
    next_ok = bool(next_section) and bool(_regex_any_hit(text, fmt.get("next_actions_regex") or []))
    stale_ok = bool(stale_rows) and bool(_regex_any_hit(text, fmt.get("stale_table_regex") or []))

    score = 0.5 * unresolved_rate + 0.5 * stale_rate - hallucination_penalty
    primary_score = round(_clamp01(score), 4)
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)

    return {
        "fixture": ground_truth.get("fixture", "F10"),
        "status_summary_present": status_ok,
        "next_actions_present": next_ok,
        "stale_table_present": stale_ok,
        "unresolved_hits": unresolved_hits,
        "unresolved_application_rate": round(unresolved_rate, 4),
        "rejected_stale_ids": rejected_stale,
        "stale_rejection_rate": round(stale_rate, 4),
        "hallucinated_next_action_hits": hallucinated_hits,
        "hallucination_penalty": round(hallucination_penalty, 4),
        "primary_pass": primary_score >= pass_threshold and status_ok and next_ok and stale_ok,
        "primary_score": primary_score,
    }


# ─── T9: Fa primary grader + dispatch ───────────────────────────────────────
def _regex_any_hit(
    text: str,
    patterns: Sequence[str],
    case_insensitive: bool = True,
    extra_flags: int = 0,
) -> list[str]:
    """Return list of patterns that match anywhere in `text`.

    `extra_flags` is OR-ed with the default case-insensitive flag. Used by
    F6 diff_format_regex to opt into re.MULTILINE so `^` anchors work on
    fenced diffs (G8 / F6 RCA R1).
    """
    flags = (re.IGNORECASE if case_insensitive else 0) | extra_flags
    hits: list[str] = []
    for pat in patterns:
        try:
            if re.search(pat, text, flags):
                hits.append(pat)
        except re.error:
            continue
    return hits


def score_fa_false_prior(agent_output: str, ground_truth: dict) -> dict:
    """Fa "False Prior Override" primary grader (spec §4.2 / fixture ground_truth).

    Fields produced:
      - binary_false_prior_leak: int (0 good, 1 bad — agent applied stale prior)
      - leak_patterns_hit: list[str] (debug — which patterns triggered)
      - task_correctness: float in {0.0, 0.25, 0.5, 0.75, 1.0}
      - citation_to_reversal: float (0.0 or 1.0)
      - primary_pass: bool = (leak == 0) AND (task_correctness >= 0.75)
      - primary_score: float = 1.0 if primary_pass else 0.0

    The dict shape is the contract used by score_primary() and the harness.
    """
    text = agent_output or ""

    # ---- 1. binary_false_prior_leak -----------------------------------------
    leak_cfg = ground_truth.get("binary_false_prior_leak", {}) or {}
    leak_patterns = list(leak_cfg.get("leak_patterns") or [])
    case_insensitive = bool(leak_cfg.get("case_insensitive", True))
    leak_hits = _regex_any_hit(text, leak_patterns, case_insensitive=case_insensitive)
    leak = 1 if leak_hits else 0

    # ---- 2. task_correctness (4 binary criteria, each worth 0.25) -----------
    tc = ground_truth.get("task_correctness", {}) or {}
    must_all     = list(tc.get("must_contain_all") or [])
    must_any_of  = list(tc.get("must_contain_any_of") or [])
    must_not     = list(tc.get("must_not_contain_regex") or [])
    shape_cfg    = tc.get("return_shape_check", {}) or {}
    shape_regex  = list(shape_cfg.get("heuristic_regex") or [])
    shape_min    = int(shape_cfg.get("min_heuristic_hits", 1))

    crit_must_all     = bool(must_all) and all(s in text for s in must_all)
    crit_must_any_of  = (not must_any_of) or bool(_regex_any_hit(text, must_any_of))
    crit_must_not_ok  = not _regex_any_hit(text, must_not)
    crit_shape_ok     = (not shape_regex) or len(_regex_any_hit(text, shape_regex)) >= shape_min

    criteria_met = sum([
        crit_must_all, crit_must_any_of, crit_must_not_ok, crit_shape_ok,
    ])
    task_correctness = round(criteria_met * 0.25, 4)

    # ---- 3. citation_to_reversal (binary: ≥ min_hits) -----------------------
    cit_cfg = ground_truth.get("citation_to_reversal", {}) or {}
    cit_patterns = list(cit_cfg.get("signal_keywords_regex") or [])
    cit_min = int(cit_cfg.get("min_hits_for_citation", 2))
    cit_hits = _regex_any_hit(text, cit_patterns)
    citation_to_reversal = 1.0 if len(cit_hits) >= cit_min else 0.0

    # ---- 4. primary --------------------------------------------------------
    # H7: primary_pass stays binary (spec invariant), but primary_score is
    # now continuous: (1 - leak) * task_correctness + 0.1 * citation bonus,
    # clamped to [0, 1]. This matches F2–F10 (all continuous) and restores
    # ordinal information that the prior `1.0 if primary_pass else 0.0`
    # formulation discarded (pilot-mini-fix1 Pfresh/Fa cliff artefact).
    primary_pass = (leak == 0) and (task_correctness >= 0.75)
    primary_score = round(
        _clamp01((1 - leak) * task_correctness + 0.1 * citation_to_reversal),
        4,
    )

    return {
        "fixture": ground_truth.get("fixture", "Fa"),
        "binary_false_prior_leak": leak,
        "leak_patterns_hit": leak_hits,
        "task_correctness": task_correctness,
        "task_criteria": {
            "must_contain_all":      crit_must_all,
            "must_contain_any_of":   crit_must_any_of,
            "must_not_contain":      crit_must_not_ok,
            "return_shape":          crit_shape_ok,
        },
        "citation_to_reversal": citation_to_reversal,
        "citation_hits": cit_hits,
        "primary_pass": primary_pass,
        "primary_score": primary_score,
    }


# ─── Phase 5 holdout: H1/H2/H3/H5/H10 primary graders ──────────────────────
# Track #329 E27 α-step-13. Per Phase 5 spec §4.1 #2 (amended r2, commit
# f50295c) the pre-tag grader extensions are explicitly permitted. The 5
# graders below all conform to the F-grader contract:
#   signature: (agent_output: str, ground_truth: dict) -> dict
#   returned dict MUST include primary_score (float in [0,1]) + primary_pass (bool)
# Constitution Rule 13 (객관적): rubrics are mechanically checkable without
# LLM judges; thresholds are calibrated to fixture difficulty (see ground_truth
# primary_metric.pass_threshold) rather than to any specific agent's output.

def _h10_extract_prose(text: str) -> str:
    """Strip fenced code blocks, markdown tables, and ATX headers from text.

    Used by H10 C1 (word count) so prose-only constraint is checkable. Tables,
    code, and headers are excluded by spec.
    """
    # Drop fenced code blocks first (greedy across lines).
    no_code = re.sub(r"```.*?```", "", text or "", flags=re.DOTALL)
    out_lines: list[str] = []
    for line in no_code.splitlines():
        stripped = line.strip()
        # Drop ATX headers (#, ##, ###).
        if re.match(r"^#{1,6}\s", stripped):
            continue
        # Drop table rows (anything starting with `|`).
        if stripped.startswith("|"):
            continue
        out_lines.append(line)
    return "\n".join(out_lines)


def score_h10_strict_instruction_following(agent_output: str, ground_truth: dict) -> dict:
    """H10 — fraction of 8 independent format/structure/lexical constraints satisfied.

    Each constraint is mechanically checkable from `agent_output` alone. The
    rubric is fixed by `ground_truth.constraints[*].type`; this function is a
    type→checker dispatcher. No LLM judge.
    """
    text = agent_output or ""

    # B3 (cascade-13b gemini): empty/whitespace output gets a misleading 0.5 from
    # vacuously-passing negative constraints (regex_must_not_match). Reject before
    # rubric runs so score is monotonic in actual content.
    if len(text.strip()) < 20:
        return {
            "fixture": ground_truth.get("fixture", "H10"),
            "constraints_total": len(ground_truth.get("constraints") or []),
            "constraints_passed": 0,
            "constraint_results": [],
            "primary_pass": False,
            "primary_score": 0.0,
            "empty_output_rejection": True,
        }

    prose = _h10_extract_prose(text)
    constraint_results: list[dict] = []

    for cfg in ground_truth.get("constraints") or []:
        cid = cfg.get("id", "?")
        ctype = cfg.get("type", "")
        passed = False
        detail: dict = {}

        if ctype == "word_count_range":
            words = re.findall(r"\S+", prose)
            n = len(words)
            mn = int(cfg.get("min_words", 0))
            mx = int(cfg.get("max_words", 10**9))
            passed = mn <= n <= mx
            detail = {"word_count": n, "range": [mn, mx]}

        elif ctype == "h2_section_set":
            required = list(cfg.get("required_titles") or [])
            exact = int(cfg.get("exact_count", len(required)))
            h2_titles = [
                m.group(1).strip()
                for m in re.finditer(r"(?m)^##\s+(.+?)\s*$", text)
            ]
            missing = [t for t in required if t not in h2_titles]
            passed = (len(h2_titles) == exact) and not missing
            detail = {"h2_titles": h2_titles, "missing": missing, "expected_count": exact}

        elif ctype == "regex_must_not_match":
            pat = cfg.get("regex", "")
            hits = re.findall(pat, prose)
            passed = not hits
            detail = {"hits": hits[:5]}

        elif ctype == "regex_must_not_match_any":
            ci = re.IGNORECASE if cfg.get("case_insensitive", True) else 0
            offenders = [p for p in (cfg.get("patterns") or []) if re.search(p, prose, ci)]
            passed = not offenders
            detail = {"offenders": offenders}

        elif ctype == "no_nested_bullets":
            ipat = cfg.get("indent_pattern", r"^[ \t]+- ")
            offenders = [
                line for line in text.splitlines()
                if re.match(ipat, line)
            ]
            passed = not offenders
            detail = {"offender_count": len(offenders)}

        elif ctype == "thousands_comma":
            # Identifier-internal digits (OPS-4187, v3.7.2, /v1/orders) are NOT
            # numeric values — they are part of alphanumeric tokens. The lookbehind
            # `(?<![\w\-/])` excludes digits preceded by a letter, digit, underscore,
            # hyphen or slash so identifiers don't false-trigger.
            min_value = int(cfg.get("min_value", 1000))
            min_digits = len(str(min_value))
            # B1 (cascade-13b gemini): 4-digit years like "2026", "1985" are
            # date-context values, not metric counts. Skipping the year-shaped
            # range (1900-2099) prevents false positives in retrospective memos
            # that are explicitly 2026-dated by the prompt.
            year_pat = re.compile(r"(?:19|20)\d{2}")
            # NB1 (cascade-13d codex): blanket year-shape skip masked metric
            # counts that happen to fall in 1900-2099 (e.g., "2026 건" = 2026
            # items, "1985 명" = 1985 people). Disambiguate by inspecting the
            # token's right-context: an immediately-following counter marker
            # (Korean counter or English count noun) signals metric usage and
            # must NOT be skipped. Year-context (no counter follows) still
            # passes per B1.
            counter_after_pat = re.compile(
                r"\s+(?:"
                # Single-char Korean counters bounded by particle/punct/EOL
                # to avoid colliding with common nouns (e.g., 회 vs 회고).
                r"(?:건|명|개|번|호|회)"
                r"(?=[\s.,!?)\]은는이가을를과의에도만로]|이[가다였었랐]|$)"
                r"|"
                # English count nouns at word boundary
                r"(?:items?|units?|errors?|requests?|tickets?|people|times|counts?)"
                r"\b"
                r")"
            )
            violations: list[str] = []
            for m in re.finditer(r"(?<![\w\-/])\d+(?:[,\.]\d+)*(?![\w\-/])", prose):
                tok = m.group(0)
                # Skip values with decimal points (decimals can stay un-commaed per spec).
                if "." in tok:
                    continue
                digits_only = tok.replace(",", "")
                if len(digits_only) < min_digits:
                    continue
                # B1+NB1: skip year-shaped tokens only if right-context isn't
                # a counter marker. With counter follow, treat as metric count.
                if year_pat.fullmatch(tok):
                    if not counter_after_pat.match(prose, m.end()):
                        continue
                # If no comma at all and >= min_digits, it's a violation.
                if "," not in tok:
                    violations.append(tok)
                    continue
                # Re-check comma format: groups of 3 from the right.
                left, *rest = tok.split(",")
                if not (1 <= len(left) <= 3) or any(len(g) != 3 for g in rest):
                    violations.append(tok)
            passed = not violations
            detail = {"violations": violations[:5]}

        elif ctype == "exact_last_line":
            expected = (cfg.get("expected_line") or "").strip()
            non_empty = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
            actual = non_empty[-1].strip() if non_empty else ""
            passed = actual == expected
            detail = {"actual_last_line": actual, "expected": expected}

        elif ctype == "ticket_id_set":
            pat = cfg.get("regex", "OPS-\\d{4}")
            approved = set(cfg.get("approved_ids") or [])
            exact = int(cfg.get("exact_count", len(approved)))
            found = re.findall(pat, text)
            unique_found = sorted(set(found))
            illegal = [t for t in unique_found if t not in approved]
            passed = (len(unique_found) == exact) and not illegal
            detail = {"found": unique_found, "illegal": illegal, "expected_count": exact}

        else:  # pragma: no cover — unknown constraint type, treat as fail
            passed = False
            detail = {"error": f"unknown_constraint_type:{ctype}"}

        constraint_results.append({
            "id": cid,
            "type": ctype,
            "label": cfg.get("label", ""),
            "passed": bool(passed),
            **detail,
        })

    n = len(constraint_results) or 1
    n_pass = sum(1 for c in constraint_results if c["passed"])
    primary_score = round(_clamp01(n_pass / n), 4)
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)
    # B2 (cascade-13b codex): the H10 prompt declares "any single violation
    # auto-rejects" semantics. Continuous score stays for analysis, but pass is
    # binary on full-constraint satisfaction (n_pass == n). Threshold field is
    # retained for backward-compat reporting only.
    failed_constraint_ids = [c["id"] for c in constraint_results if not c["passed"]]

    return {
        "fixture": ground_truth.get("fixture", "H10"),
        "constraints_total": n,
        "constraints_passed": n_pass,
        "constraint_results": constraint_results,
        "failed_constraint_ids": failed_constraint_ids,
        "pass_threshold": pass_threshold,
        "primary_pass": (n_pass == n),
        "primary_score": primary_score,
    }


def score_h1_long_form_code_review(agent_output: str, ground_truth: dict) -> dict:
    """H1 — severity-weighted F1 on planted bugs vs distractor flags in code review table.

    Mirrors F3's contract but with a code-review fixture (instead of writing
    review). TP weight = sum of severity weights of matched issues. FP weight =
    (#flagged distractors) * Medium weight. FN weight = sum of severity weights
    of missed issues. Score = 2PR/(P+R).
    """
    text = agent_output or ""
    rows = [
        {
            "id": cols[0] if len(cols) > 0 else "",
            "line": cols[1] if len(cols) > 1 else "",
            "severity": cols[2] if len(cols) > 2 else "",
            "issue": cols[3] if len(cols) > 3 else "",
            "fix": "|".join(cols[4:]) if len(cols) > 4 else "",
        }
        for cols in _parse_markdown_table_rows(text)
        if cols and cols[0].strip().lower() not in {"id", "#"}
    ]

    weights = ground_truth.get("severity_weights") or {}
    medium_weight = float(weights.get("Medium", 1.0))
    issues = list(ground_truth.get("ground_truth_issues") or [])

    matched_ids: list[str] = []
    missed_ids: list[str] = []
    tp_weight = 0.0
    fn_weight = 0.0

    for issue in issues:
        candidate_lines = [int(x) for x in (issue.get("must_cite_line_any_of") or []) if x is not None]
        match = False
        for row in rows:
            row_text = f"{row['issue']} {row['fix']}"
            line_field = row["line"] or ""
            line_ok = (
                not candidate_lines
                or any(
                    re.search(rf"(?<!\d){ln}(?!\d)", line_field)
                    for ln in candidate_lines
                )
            )
            content_ok = bool(_regex_any_hit(row_text, issue.get("match_regex_any_of") or []))
            if line_ok and content_ok:
                match = True
                break
        weight = float(weights.get(issue.get("severity"), 1.0))
        if match:
            matched_ids.append(issue.get("id", ""))
            tp_weight += weight
        else:
            missed_ids.append(issue.get("id", ""))
            fn_weight += weight

    flagged_distractors: list[str] = []
    fp_weight = 0.0
    for distractor in ground_truth.get("distractors_must_not_flag") or []:
        line = distractor.get("line")
        for row in rows:
            row_text = f"{row['issue']} {row['fix']}"
            line_ok = (
                line is None
                or re.search(rf"(?<!\d){int(line)}(?!\d)", row["line"] or "")
            )
            if line_ok and _regex_any_hit(row_text, distractor.get("fp_regex_any_of") or []):
                flagged_distractors.append(distractor.get("id", ""))
                fp_weight += medium_weight
                break

    precision = _safe_div(tp_weight, tp_weight + fp_weight)
    recall = _safe_div(tp_weight, tp_weight + fn_weight)
    f1 = _safe_div(2 * precision * recall, precision + recall)
    primary_score = round(_clamp01(f1), 4)

    struct_cfg = ground_truth.get("output_structure_checks") or {}
    must_all_tokens = [str(s).lower() for s in struct_cfg.get("must_contain_all") or []]
    structure_ok = all(tok in text.lower() for tok in must_all_tokens) and bool(rows)

    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)

    # B8 (cascade-13b codex condition): the 0.55 F1 threshold lets a
    # Critical+1-High subset (2/6 issues) pass, which understates the prompt's
    # "find six bugs" signal. Apply an objective floor: an output must match at
    # least half of the planted issues — defaulting to ⌈n/2⌉ when the fixture
    # does not specify, with primary_metric.min_matches_for_pass as an override.
    primary_metric = ground_truth.get("primary_metric") or {}
    min_matches_default = max(1, (len(issues) + 1) // 2) if issues else 0
    min_matches = int(primary_metric.get("min_matches_for_pass", min_matches_default))
    matches_floor_ok = len(matched_ids) >= min_matches

    primary_pass = (
        primary_score >= pass_threshold
        and structure_ok
        and matches_floor_ok
    )

    return {
        "fixture": ground_truth.get("fixture", "H1"),
        "matched_issue_ids": matched_ids,
        "missed_issue_ids": missed_ids,
        "flagged_distractors": flagged_distractors,
        "tp_weight": round(tp_weight, 4),
        "fp_weight": round(fp_weight, 4),
        "fn_weight": round(fn_weight, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "structure_ok": structure_ok,
        "min_matches_for_pass": min_matches,
        "matches_floor_ok": matches_floor_ok,
        "primary_pass": primary_pass,
        "primary_score": primary_score,
    }


def score_h2_multi_hop_reasoning(agent_output: str, ground_truth: dict) -> dict:
    """H2 — answer correctness + intermediate-step coverage.

    Score = 0.7 * (sub_question_correct / 3) + 0.3 * (intermediate_steps / 4).
    Sub-question answers are checked via expected_answer_regex_any_of (treated
    OR-wise). Intermediate steps are checked the same way.
    """
    text = agent_output or ""

    sub_qs = list(ground_truth.get("sub_questions") or [])
    correct_q = 0
    sub_q_results: list[dict] = []
    total_q_weight = 0.0
    correct_q_weight = 0.0
    for sq in sub_qs:
        weight = float(sq.get("weight", 1.0))
        total_q_weight += weight
        hits = _regex_any_hit(text, sq.get("expected_answer_regex_any_of") or [])
        ok = bool(hits)
        if ok:
            correct_q += 1
            correct_q_weight += weight
        sub_q_results.append({"id": sq.get("id"), "label": sq.get("label"), "passed": ok, "hits": hits})
    answer_rate = _safe_div(correct_q_weight, total_q_weight) if total_q_weight else 0.0

    steps = list(ground_truth.get("intermediate_steps") or [])
    matched_steps: list[str] = []
    step_results: list[dict] = []
    for st in steps:
        hits = _regex_any_hit(text, st.get("regex_any_of") or [])
        ok = bool(hits)
        if ok:
            matched_steps.append(st.get("id", ""))
        step_results.append({"id": st.get("id"), "label": st.get("label"), "passed": ok})
    step_rate = _safe_div(len(matched_steps), len(steps)) if steps else 0.0

    primary_score = round(_clamp01(0.7 * answer_rate + 0.3 * step_rate), 4)
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)

    # B6 (cascade-13b codex): two cheats currently pass H2:
    #   (a) "answer-only" output (3/3 answers, 0/4 steps) hits 0.7 — passes the
    #       0.7 threshold even though the prompt requires reasoning steps.
    #   (b) Verbatim ground_truth.json copy passes because the regex scan finds
    #       the canonical answer text inside the JSON dump.
    # Fix (a) with a reasoning gate: step_rate >= 0.75 (3/4 steps) for pass.
    # Fix (b) with ground_truth-leak detection: any rubric key as substring
    # marks the output as a leak and forces primary_pass=False.
    min_step_rate = 0.75
    leak_markers = (
        "expected_answer_regex_any_of",
        "canonical_solution",
        "primary_grader",
        "intermediate_steps",
        "regex_any_of",
    )
    ground_truth_leak = any(marker in text for marker in leak_markers)
    primary_pass = (
        primary_score >= pass_threshold
        and step_rate >= min_step_rate
        and not ground_truth_leak
    )

    return {
        "fixture": ground_truth.get("fixture", "H2"),
        "sub_question_results": sub_q_results,
        "sub_question_correct_count": correct_q,
        "sub_question_total": len(sub_qs),
        "answer_rate": round(answer_rate, 4),
        "intermediate_step_results": step_results,
        "matched_steps": matched_steps,
        "step_rate": round(step_rate, 4),
        "min_step_rate": min_step_rate,
        "ground_truth_leak": ground_truth_leak,
        "primary_pass": primary_pass,
        "primary_score": primary_score,
    }


def score_h3_multilingual_recall_ko_en(agent_output: str, ground_truth: dict) -> dict:
    """H3 — entity preservation + key term recall + structure + no fabrication.

    score = 0.5 * entity_rate + 0.3 * term_rate + 0.2 * structure_score
            - 0.20 if any forbidden_patterns matched.
    """
    text = agent_output or ""

    entities = list(ground_truth.get("named_entities") or [])
    matched_entities: list[str] = []
    missing_entities: list[str] = []
    for ent in entities:
        candidates = list(ent.get("en_required") or [])
        if any(c in text for c in candidates):
            matched_entities.append(ent.get("id", ""))
        else:
            missing_entities.append(ent.get("id", ""))
    entity_rate = _safe_div(len(matched_entities), len(entities)) if entities else 0.0

    terms = list(ground_truth.get("key_terms") or [])
    matched_terms: list[str] = []
    missing_terms: list[str] = []
    for term in terms:
        token = term.get("token") or ""
        regexes = term.get("regex_any_of") or []
        ok = (token and token in text) or bool(_regex_any_hit(text, regexes))
        if ok:
            matched_terms.append(term.get("id", ""))
        else:
            missing_terms.append(term.get("id", ""))
    term_rate = _safe_div(len(matched_terms), len(terms)) if terms else 0.0

    struct_cfg = ground_truth.get("structure_checks") or {}
    h2_min = int(struct_cfg.get("h2_count_min", 0))
    h3_min = int(struct_cfg.get("h3_count_min", 0))
    table_required = bool(struct_cfg.get("table_required", False))
    bullet_required = bool(struct_cfg.get("bullet_list_required", False))
    eng_min = float((struct_cfg.get("english_dominant") or {}).get("min_ratio", 0.0))

    h2_count = len(re.findall(r"(?m)^##\s+\S", text))
    h3_count = len(re.findall(r"(?m)^###\s+\S", text))
    has_table = bool(re.search(r"(?m)^\|.+\|", text))
    has_bullet = bool(re.search(r"(?m)^\s*[-*]\s+\S", text))

    alpha = [c for c in text if c.isalpha()]
    if alpha:
        ascii_count = sum(1 for c in alpha if ord(c) < 128)
        ascii_ratio = ascii_count / len(alpha)
    else:
        ascii_ratio = 1.0

    structure_components = {
        "h2_ok": h2_count >= h2_min,
        "h3_ok": h3_count >= h3_min,
        "table_ok": (not table_required) or has_table,
        "bullet_ok": (not bullet_required) or has_bullet,
        "english_ratio_ok": ascii_ratio >= eng_min,
    }
    structure_score = _safe_div(
        sum(1 for v in structure_components.values() if v),
        len(structure_components),
    )

    forbidden_cfg = ground_truth.get("no_fabrication_check") or {}
    fabrication_hits = _regex_any_hit(text, forbidden_cfg.get("forbidden_patterns") or [])
    fabrication_penalty = 0.20 if fabrication_hits else 0.0

    raw_score = 0.5 * entity_rate + 0.3 * term_rate + 0.2 * structure_score - fabrication_penalty
    primary_score = round(_clamp01(raw_score), 4)
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)

    # B7 (cascade-13b codex): structure preservation is mandatory by the prompt
    # ("preserve ##, ###, bullet, table 1:1") but only weights 20% of the score.
    # An entity/term-rich paragraph without any required structural marker can
    # still cross the 0.7 threshold. Gate primary_pass on ALL structure
    # components passing in addition to the score and fabrication checks.
    structure_ok = all(structure_components.values())
    primary_pass = (
        primary_score >= pass_threshold
        and structure_ok
        and not fabrication_hits
    )

    return {
        "fixture": ground_truth.get("fixture", "H3"),
        "matched_entity_ids": matched_entities,
        "missing_entity_ids": missing_entities,
        "entity_rate": round(entity_rate, 4),
        "matched_term_ids": matched_terms,
        "missing_term_ids": missing_terms,
        "term_rate": round(term_rate, 4),
        "structure_components": structure_components,
        "structure_score": round(structure_score, 4),
        "structure_ok": structure_ok,
        "ascii_ratio": round(ascii_ratio, 4),
        "fabrication_hits": fabrication_hits,
        "fabrication_penalty": fabrication_penalty,
        "primary_pass": primary_pass,
        "primary_score": primary_score,
    }


def score_h5_agentic_tool_use(agent_output: str, ground_truth: dict) -> dict:
    """H5 — tool-set recall * sequence ordering, with phantom-tool penalty.

    score = (required_tool_recall * ordering_correctness) + 0.10 * argument_citation_rate
            - phantom_tool_penalty - step_count_violation_penalty.
    """
    text = agent_output or ""

    palette = {t.get("name") for t in (ground_truth.get("tool_palette") or []) if t.get("name")}

    required_tools = list(ground_truth.get("required_tools") or [])
    matched_required: list[str] = []
    missed_required: list[str] = []
    matched_weight = 0.0
    total_weight = 0.0
    for rt in required_tools:
        name = rt.get("name", "")
        weight = float(rt.get("weight", 1.0))
        total_weight += weight
        if re.search(rf"\b{re.escape(name)}\s*\(", text):
            matched_required.append(name)
            matched_weight += weight
        else:
            missed_required.append(name)
    required_recall = _safe_div(matched_weight, total_weight) if total_weight else 0.0

    def _first_pos(name: str) -> int:
        m = re.search(rf"\b{re.escape(name)}\s*\(", text)
        return m.start() if m else -1

    def _all_positions(name: str) -> list[int]:
        return [m.start() for m in re.finditer(rf"\b{re.escape(name)}\s*\(", text)]

    invariants = list(ground_truth.get("ordering_invariants") or [])
    invariant_results: list[dict] = []
    invariants_passed = 0
    for inv in invariants:
        earlier = inv.get("earlier_tool_regex", "")
        later = inv.get("later_tool_regex", "")
        twice_required = inv.get("must_appear_twice")
        ok = False
        if twice_required:
            positions = _all_positions(twice_required)
            if len(positions) >= 2:
                # must_appear_twice means: a `later` call AFTER an `earlier` call.
                e_pos = _first_pos(earlier)
                later_after = [p for p in positions if p > e_pos]
                ok = bool(later_after) and e_pos != -1
            else:
                ok = False
        else:
            e_pos = _first_pos(earlier)
            l_pos = _first_pos(later)
            ok = e_pos != -1 and l_pos != -1 and e_pos < l_pos
        invariant_results.append({"id": inv.get("id"), "label": inv.get("label"), "passed": ok})
        if ok:
            invariants_passed += 1
    ordering_rate = _safe_div(invariants_passed, len(invariants)) if invariants else 1.0

    citation_cfg = ground_truth.get("argument_citation_checks") or {}
    test_target_hit = bool(_regex_any_hit(text, citation_cfg.get("test_target_regex_any_of") or []))
    candidate_fn_hit = bool(_regex_any_hit(text, citation_cfg.get("candidate_function_any_of") or []))
    candidate_file_hit = bool(_regex_any_hit(text, citation_cfg.get("candidate_file_any_of") or []))
    citation_components = [test_target_hit, candidate_fn_hit, candidate_file_hit]
    citation_rate = _safe_div(sum(citation_components), len(citation_components))

    phantom_cfg = ground_truth.get("phantom_tool_check") or {}
    phantom_pat = phantom_cfg.get("candidate_pattern") or r"(?:^|\d\.\s+|`)([a-z_][a-z0-9_]*)\s*\("
    # B4 (cascade-13b gemini): the prompt explicitly requires citing candidate
    # bug-target functions (e.g., `apply_refund(...)`). Those literals share the
    # phantom regex shape but are NOT phantom tool invocations. Build a citation
    # allowlist of literal identifiers from `argument_citation_checks` so valid
    # citations are not penalized as phantom tool calls.
    citation_allowlist: set[str] = set()
    for pat in (citation_cfg.get("candidate_function_any_of") or []):
        if isinstance(pat, str) and re.fullmatch(r"[a-z_][a-z0-9_]*", pat):
            citation_allowlist.add(pat)
    # NB2 (cascade-13d codex): the identifier-wide allowlist masked actual
    # phantom invocations whenever the same name also appeared as a citation
    # (e.g., backticked `apply_refund()`). Switch to citation-CONTEXT-only
    # exemption: a name is only treated as citation when its match position
    # is preceded by a backtick. Names matched in numbered-step or line-start
    # context (true call sites) are no longer pre-exempted and must rely on
    # the palette membership check alone.
    candidate_calls: list[str] = []
    for m in re.finditer(phantom_pat, text, re.MULTILINE):
        name = m.group(1)
        prev_char = text[m.start(1) - 1] if m.start(1) > 0 else ""
        if prev_char == "`":
            # citation context — not an invocation
            continue
        candidate_calls.append(name)
    phantom_calls = sorted({c for c in candidate_calls if c not in palette})
    per = float(phantom_cfg.get("penalty_per", 0.10))
    cap = float(phantom_cfg.get("max_penalty", 0.40))
    phantom_penalty = min(cap, per * len(phantom_calls))

    step_range = ground_truth.get("step_count_range") or {}
    step_min = int(step_range.get("min", 0))
    step_max = int(step_range.get("max", 10**6))
    numbered_steps = re.findall(r"(?m)^\s*\d+\.\s+\S", text)
    step_count = len(numbered_steps)
    step_in_range = step_min <= step_count <= step_max
    step_violation_penalty = 0.0 if step_in_range else 0.10

    raw_score = (required_recall * ordering_rate) + 0.10 * citation_rate - phantom_penalty - step_violation_penalty
    primary_score = round(_clamp01(raw_score), 4)
    pass_threshold = float(((ground_truth.get("primary_metric") or {}).get("pass_threshold")) or 1.0)

    # B5 (cascade-13b codex): the citation bonus (0.10) can numerically cancel a
    # phantom or step-violation penalty (each 0.10). Without conjunctive gates,
    # an unnumbered paragraph or a phantom-call plan reaches primary_score=1.0.
    # Pass requires: score ≥ threshold AND step count in [min,max] AND no phantom.
    primary_pass = (
        primary_score >= pass_threshold
        and step_in_range
        and not phantom_calls
    )

    return {
        "fixture": ground_truth.get("fixture", "H5"),
        "matched_required_tools": matched_required,
        "missed_required_tools": missed_required,
        "required_recall": round(required_recall, 4),
        "ordering_invariant_results": invariant_results,
        "ordering_rate": round(ordering_rate, 4),
        "citation": {
            "test_target": test_target_hit,
            "candidate_function": candidate_fn_hit,
            "candidate_file": candidate_file_hit,
            "rate": round(citation_rate, 4),
        },
        "phantom_tool_calls": phantom_calls,
        "phantom_penalty": round(phantom_penalty, 4),
        "citation_allowlist": sorted(citation_allowlist),
        "step_count": step_count,
        "step_count_range": [step_min, step_max],
        "step_in_range": step_in_range,
        "step_violation_penalty": step_violation_penalty,
        "primary_pass": primary_pass,
        "primary_score": primary_score,
    }


PRIMARY_GRADERS: dict[str, "callable"] = {
    "F2": score_f2_invariants,
    "F3": score_f3_severity_f1,
    "F4": score_f4_oracle_graph,
    "F5": score_f5_citations,
    "F6": score_f6_build_turns,
    "F7": score_f7_latest_decision,
    "F8": score_f8_hidden_tests,
    "F9": score_f9_root_cause,
    "F10": score_f10_checklist,
    "Fa": score_fa_false_prior,
    "H1":  score_h1_long_form_code_review,
    "H2":  score_h2_multi_hop_reasoning,
    "H3":  score_h3_multilingual_recall_ko_en,
    "H5":  score_h5_agentic_tool_use,
    "H10": score_h10_strict_instruction_following,
}


def score_primary(fixture_id: str, agent_output: str, ground_truth: dict) -> dict:
    """Dispatch to the per-fixture primary grader (build spec §3.2)."""
    grader = PRIMARY_GRADERS.get(fixture_id)
    if grader is None:
        raise ValueError(
            f"no primary grader registered for fixture {fixture_id!r}; "
            f"known: {sorted(PRIMARY_GRADERS)}"
        )
    return grader(agent_output, ground_truth)


# ─── CLI ─────────────────────────────────────────────────────────────────────
def _cmd_detect_compact(args) -> int:
    flag = detect_compact(args.jsonl, drop_ratio=args.drop_ratio, spike_mult=args.spike_mult)
    print(json.dumps(flag.as_dict()))
    return 0


def _cmd_parse_cost(args) -> int:
    buckets = parse_cost(args.jsonl, include_subagents=not args.no_subagents)
    print(json.dumps(buckets.as_dict()))
    return 0


def _cmd_pollution_a(args) -> int:
    output = Path(args.output).read_text(encoding="utf-8")
    facts = json.loads(Path(args.facts).read_text(encoding="utf-8"))
    leaks = pollution_layer_a(output, facts)
    print(json.dumps({"leaks": leaks, "rate": sum(leaks) / max(len(leaks), 1)}))
    return 0


def _cmd_loss_a(args) -> int:
    print("1" if loss_layer_a(args.expected, args.actual) else "0")
    return 0


def _cmd_loss_b(args) -> int:
    print("1" if loss_layer_b(args.expected, args.actual, threshold=args.threshold) else "0")
    return 0


def _cmd_score_fixture(args) -> int:
    output = Path(args.output).read_text(encoding="utf-8")
    ground_truth = json.loads(Path(args.ground_truth).read_text(encoding="utf-8"))
    result = score_primary(args.fixture, output, ground_truth)
    print(json.dumps(result))
    return 0


def _cmd_deferred(args) -> int:
    n = run_deferred(
        args.state_root,
        fixture_filter=args.fixture,
        mode_filter=args.mode,
    )
    print(json.dumps({"jury_files_written": n}))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="exec-mode-grader", description="Exec-mode experiment grader (Part 1).")
    sub = p.add_subparsers(dest="cmd")

    # Top-level shortcut used by exec-mode-lib.sh T2 wrapper.
    p.add_argument("--detect-compact", metavar="JSONL", help="Shortcut for `detect-compact JSONL`.")
    p.add_argument("--drop-ratio", type=float, default=0.5)
    p.add_argument("--spike-mult", type=float, default=2.0)

    dc = sub.add_parser("detect-compact")
    dc.add_argument("jsonl")
    dc.add_argument("--drop-ratio", type=float, default=0.5)
    dc.add_argument("--spike-mult", type=float, default=2.0)
    dc.set_defaults(func=_cmd_detect_compact)

    pc = sub.add_parser("parse-cost")
    pc.add_argument("jsonl")
    pc.add_argument("--no-subagents", action="store_true")
    pc.set_defaults(func=_cmd_parse_cost)

    pa = sub.add_parser("pollution-a")
    pa.add_argument("--output", required=True)
    pa.add_argument("--facts", required=True)
    pa.set_defaults(func=_cmd_pollution_a)

    la = sub.add_parser("loss-a")
    la.add_argument("--expected", required=True)
    la.add_argument("--actual", required=True)
    la.set_defaults(func=_cmd_loss_a)

    lb = sub.add_parser("loss-b")
    lb.add_argument("--expected", required=True)
    lb.add_argument("--actual", required=True)
    lb.add_argument("--threshold", type=float, default=0.8)
    lb.set_defaults(func=_cmd_loss_b)

    sf = sub.add_parser("score-fixture")
    sf.add_argument("--fixture", required=True, choices=sorted(PRIMARY_GRADERS))
    sf.add_argument("--output", required=True, help="Path to agent output file.")
    sf.add_argument("--ground-truth", required=True, help="Path to fixture ground_truth.json.")
    sf.set_defaults(func=_cmd_score_fixture)

    df = sub.add_parser("deferred", help="Walk state tree; write metrics.jury.json per ok trial.")
    df.add_argument("--state-root", required=True, help="Path to state/exec-mode-experiment root.")
    df.add_argument("--fixture", default=None, help="Optional fixture_id filter.")
    df.add_argument("--mode", default=None, choices=("D", "Pfresh", "Pacc", "S"), help="Optional mode filter.")
    df.set_defaults(func=_cmd_deferred)

    return p


def main(argv: list[str] | None = None) -> int:
    p = build_parser()
    args = p.parse_args(argv)

    if args.detect_compact is not None:
        ns = argparse.Namespace(
            jsonl=args.detect_compact,
            drop_ratio=args.drop_ratio,
            spike_mult=args.spike_mult,
        )
        return _cmd_detect_compact(ns)

    if not getattr(args, "func", None):
        p.print_help(sys.stderr)
        return 2
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
