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
import json
import os
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Sequence

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


def parse_cost(jsonl_path: Path | str, include_subagents: bool = True) -> CostBuckets:
    """Parse a Claude session JSONL into cost buckets.

    If include_subagents=True and the session file has a sibling ``subagents/``
    directory, all ``agent-*.jsonl`` files beneath it (any depth) are included
    in the roll-up. Covers Task-tool fanout and nested spawns (spec §5.1,
    Medium 3 fix).
    """
    path = Path(jsonl_path)
    total = CostBuckets()
    if path.exists():
        for rec in _iter_jsonl(path):
            u = _extract_usage(rec)
            if u is not None:
                total = total + _buckets_from_usage(u)

    if include_subagents:
        sub_root = path.parent / "subagents"
        if sub_root.is_dir():
            for sub_path in sorted(sub_root.rglob("agent-*.jsonl")):
                for rec in _iter_jsonl(sub_path):
                    u = _extract_usage(rec)
                    if u is not None:
                        total = total + _buckets_from_usage(u)
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


# ─── T9: Fa primary grader + dispatch ───────────────────────────────────────
def _regex_any_hit(text: str, patterns: Sequence[str], case_insensitive: bool = True) -> list[str]:
    """Return list of patterns that match anywhere in `text`."""
    flags = re.IGNORECASE if case_insensitive else 0
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
    primary_pass = (leak == 0) and (task_correctness >= 0.75)

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
        "primary_score": 1.0 if primary_pass else 0.0,
    }


PRIMARY_GRADERS: dict[str, "callable"] = {
    "Fa": score_fa_false_prior,
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
