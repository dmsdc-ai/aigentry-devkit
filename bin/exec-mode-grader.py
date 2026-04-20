#!/usr/bin/env python3.14
"""exec-mode-grader.py — Part 1 (T3): cost / compact / pollution-A / loss-A+B.

CLI-only. Stdlib + rapidfuzz. NO anthropic/openai/voyage SDKs.

Build spec §3.1, §7.2. Spec §5.1–§5.4, §8.

This file is loaded both as a CLI (``./exec-mode-grader.py detect-compact ...``)
and as an importable module (tests do ``import exec_mode_grader as g``). The
hyphen in the filename prevents a direct ``import``; the test conftest loads it
via importlib and registers it under the underscore name. Keep module-level
code side-effect-free so that import stays cheap.

Part 2 (T4) will add subprocess-backed dual-family Layer B/C functions.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import re
import sys
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
