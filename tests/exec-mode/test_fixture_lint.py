"""T17 — Fixture lint gate (build spec §6.3, R7/R11 mitigation).

Enforces per-fixture invariants across all 10 exec-mode fixtures
(Fa + F2–F10) authored by Session D in the sibling
`aigentry-orchestrator` repo.

Usage:
  # pytest mode (parametrized over every fixture):
  .venv-exec-mode/bin/pytest tests/exec-mode/test_fixture_lint.py -v

  # CLI mode (single fixture, exits nonzero on violation):
  .venv-exec-mode/bin/python tests/exec-mode/test_fixture_lint.py \
      ../aigentry-orchestrator/fixtures/exec-mode-experiment/Fa

  # CLI mode (all fixtures at once):
  .venv-exec-mode/bin/python tests/exec-mode/test_fixture_lint.py \
      ../aigentry-orchestrator/fixtures/exec-mode-experiment/

Spec §6.3 checks enforced:
  1. setup_history.md ≤ 2500 tokens (fairness with D/S briefing)
  2. warmup_transcript.md ≤ 2500 tokens (parity with setup)
  3. planted_facts.json has exactly 10 entries
  4. all 10 planted keywords unique, no pairwise substring overlap
  5. probe_answers.json aligned 1:1 with post_probes.md Q ordering
  6. post_probes.md keywords NOT present in task_prompt.md (R11)
  7. post_probes.md answer values NOT present in task_prompt.md
  8. warmup_transcript.md contains same 10 planted keywords as setup
  9. setup_history.md contains same 10 planted keywords
 10. turn delimiters well-formed & sequential
     ('--- Turn N ---' in setup, '--- User|Agent (Turn N) ---' in warmup)

Token counting uses tiktoken (cl100k_base); falls back to
`claude --count-tokens` CLI if tiktoken is unavailable, then to a
conservative char/2.5 estimate as last resort.

No hardcoded paths — fixture root resolved via EXEC_MODE_FIXTURE_ROOT env
var or sibling discovery (Rule 14).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:
    import pytest
except ImportError:  # CLI mode may run outside the pytest-enabled venv
    pytest = None  # type: ignore[assignment]

# ─── fixture root discovery (Rule 14: no hardcoded user paths) ──────────────

REQUIRED_FILES = (
    "setup_history.md",
    "task_prompt.md",
    "post_probes.md",
    "probe_answers.json",
    "planted_facts.json",
    "ground_truth.json",
    "warmup_transcript.md",
)

FIXTURE_IDS = ("Fa", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10")

MAX_TOKENS_SETUP = 2500
MAX_TOKENS_WARMUP = 2500
EXPECTED_PLANTED_FACTS = 10


def _default_fixture_root() -> Path | None:
    """Discover the fixture root without hardcoding user paths."""
    env = os.environ.get("EXEC_MODE_FIXTURE_ROOT")
    if env:
        p = Path(env).expanduser().resolve()
        return p if p.is_dir() else None
    # sibling checkout: <devkit>/../aigentry-orchestrator/fixtures/exec-mode-experiment/
    devkit_root = Path(__file__).resolve().parents[2]
    sibling = devkit_root.parent / "aigentry-orchestrator" / "fixtures" / "exec-mode-experiment"
    return sibling if sibling.is_dir() else None


def _discover_fixture_dirs(root: Path | None) -> list[Path]:
    if root is None:
        return []
    return [root / fid for fid in FIXTURE_IDS if (root / fid).is_dir()]


# ─── token counting ─────────────────────────────────────────────────────────

def _count_tokens_tiktoken(text: str) -> int | None:
    try:
        import tiktoken  # type: ignore
    except ImportError:
        return None
    enc = tiktoken.get_encoding("cl100k_base")
    return len(enc.encode(text))


def _count_tokens_claude_cli(text: str) -> int | None:
    """Fallback via `claude --count-tokens`. Best-effort; returns None on failure."""
    claude = shutil.which("claude")
    if claude is None:
        return None
    try:
        out = subprocess.run(
            [claude, "--count-tokens"],
            input=text, capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            return None
        # Expect a single integer in stdout (first line).
        first = out.stdout.strip().splitlines()[0] if out.stdout.strip() else ""
        return int(first) if first.isdigit() else None
    except (subprocess.SubprocessError, ValueError):
        return None


def count_tokens(text: str) -> int:
    """Return token count with graceful fallback chain.

    Order: tiktoken → claude CLI → char/2.5 (conservative Korean-heavy).
    """
    for counter in (_count_tokens_tiktoken, _count_tokens_claude_cli):
        n = counter(text)
        if n is not None:
            return n
    return int(len(text) / 2.5)


# ─── lint implementation ────────────────────────────────────────────────────

@dataclass
class LintReport:
    fixture: str
    errors: list[str] = field(default_factory=list)
    stats: dict[str, int | bool] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def lint_fixture(fixture_dir: Path) -> LintReport:
    """Run all §6.3 checks against a single fixture directory.

    Returns a LintReport; caller decides whether to raise/assert/exit.
    Never raises for missing content — returns errors instead.
    """
    report = LintReport(fixture=fixture_dir.name)

    # Required files
    missing = [f for f in REQUIRED_FILES if not (fixture_dir / f).is_file()]
    if missing:
        report.errors.append(f"missing files: {missing}")
        return report  # remaining checks require files

    setup = _read(fixture_dir / "setup_history.md")
    warmup = _read(fixture_dir / "warmup_transcript.md")
    task_prompt = _read(fixture_dir / "task_prompt.md")
    probes = _read(fixture_dir / "post_probes.md")

    try:
        facts = json.loads(_read(fixture_dir / "planted_facts.json"))
    except json.JSONDecodeError as exc:
        report.errors.append(f"planted_facts.json invalid JSON: {exc}")
        return report

    try:
        answers = json.loads(_read(fixture_dir / "probe_answers.json"))
    except json.JSONDecodeError as exc:
        report.errors.append(f"probe_answers.json invalid JSON: {exc}")
        return report

    try:
        json.loads(_read(fixture_dir / "ground_truth.json"))
    except json.JSONDecodeError as exc:
        report.errors.append(f"ground_truth.json invalid JSON: {exc}")
        return report

    # Check 1: setup token cap
    setup_tok = count_tokens(setup)
    report.stats["setup_tokens"] = setup_tok
    if setup_tok > MAX_TOKENS_SETUP:
        report.errors.append(
            f"setup_history.md {setup_tok} tokens exceeds cap {MAX_TOKENS_SETUP}"
        )

    # Check 2: warmup token cap
    warmup_tok = count_tokens(warmup)
    report.stats["warmup_tokens"] = warmup_tok
    if warmup_tok > MAX_TOKENS_WARMUP:
        report.errors.append(
            f"warmup_transcript.md {warmup_tok} tokens exceeds cap {MAX_TOKENS_WARMUP}"
        )

    # Check 3: exactly 10 planted facts
    if not isinstance(facts, list):
        report.errors.append("planted_facts.json must be a list")
        return report
    report.stats["n_planted_facts"] = len(facts)
    if len(facts) != EXPECTED_PLANTED_FACTS:
        report.errors.append(
            f"planted_facts.json has {len(facts)} entries, expected {EXPECTED_PLANTED_FACTS}"
        )

    # Require 'keyword' field on each fact
    missing_kw = [i for i, f in enumerate(facts) if not isinstance(f, dict) or "keyword" not in f]
    if missing_kw:
        report.errors.append(f"planted_facts indices missing 'keyword': {missing_kw}")
        return report
    keywords: list[str] = [f["keyword"] for f in facts]

    # Check 4a: unique keywords
    dupes = [k for k in keywords if keywords.count(k) > 1]
    if dupes:
        report.errors.append(f"duplicate planted keywords: {sorted(set(dupes))}")

    # Check 4b: no pairwise substring overlap (A is substring of B)
    overlaps: list[tuple[str, str]] = []
    for i, a in enumerate(keywords):
        for j, b in enumerate(keywords):
            if i != j and a and a in b:
                overlaps.append((a, b))
    if overlaps:
        report.errors.append(
            f"planted keyword substring overlap (A in B): {overlaps}"
        )

    # Check 5: probe ↔ answer alignment
    probe_q_nums = [int(n) for n in re.findall(r"^Q(\d+)\.", probes, re.MULTILINE)]
    answer_q_idxs = [a.get("q_idx") for a in answers if isinstance(a, dict)]
    report.stats["n_probes"] = len(probe_q_nums)
    report.stats["n_answers"] = len(answer_q_idxs)
    if len(probe_q_nums) != EXPECTED_PLANTED_FACTS:
        report.errors.append(
            f"post_probes.md has {len(probe_q_nums)} questions, expected {EXPECTED_PLANTED_FACTS}"
        )
    if len(answer_q_idxs) != EXPECTED_PLANTED_FACTS:
        report.errors.append(
            f"probe_answers.json has {len(answer_q_idxs)} entries, expected {EXPECTED_PLANTED_FACTS}"
        )
    if probe_q_nums != answer_q_idxs:
        report.errors.append(
            f"probe Q order {probe_q_nums} != answer q_idx order {answer_q_idxs}"
        )

    # Check 6/7: no planted-keyword or answer-value leak into task_prompt (R11)
    leaked_kw = [k for k in keywords if k and k in task_prompt]
    if leaked_kw:
        report.errors.append(f"planted keyword(s) leaked into task_prompt.md: {leaked_kw}")

    answer_values = [
        a.get("answer") for a in answers
        if isinstance(a, dict) and isinstance(a.get("answer"), str)
    ]
    leaked_ans = [v for v in answer_values if v and v in task_prompt]
    if leaked_ans:
        report.errors.append(f"answer value(s) leaked into task_prompt.md: {leaked_ans}")

    # Check 8: warmup contains all planted keywords (exact substring)
    miss_warmup = [k for k in keywords if k and k not in warmup]
    if miss_warmup:
        report.errors.append(f"warmup_transcript missing planted keywords: {miss_warmup}")

    # Check 9: setup contains all planted keywords
    miss_setup = [k for k in keywords if k and k not in setup]
    if miss_setup:
        report.errors.append(f"setup_history missing planted keywords: {miss_setup}")

    # Check 10: turn delimiters
    setup_turns = [int(t) for t in re.findall(r"^--- Turn (\d+) ---", setup, re.MULTILINE)]
    warmup_turns = [
        int(t) for t in re.findall(r"^--- (?:User|Agent) \(Turn (\d+)\) ---", warmup, re.MULTILINE)
    ]
    report.stats["setup_turns"] = len(setup_turns)
    report.stats["warmup_turns"] = len(warmup_turns)
    if not setup_turns:
        report.errors.append("setup_history has no well-formed '--- Turn N ---' delimiters")
    elif setup_turns != list(range(1, len(setup_turns) + 1)):
        report.errors.append(f"setup turn numbers not sequential from 1: {setup_turns}")
    if not warmup_turns:
        report.errors.append(
            "warmup_transcript has no well-formed '--- User|Agent (Turn N) ---' delimiters"
        )
    elif warmup_turns != list(range(1, len(warmup_turns) + 1)):
        report.errors.append(f"warmup turn numbers not sequential from 1: {warmup_turns}")

    return report


# ─── pytest parametrization ─────────────────────────────────────────────────

_fixture_root = _default_fixture_root()
_fixture_dirs = _discover_fixture_dirs(_fixture_root)


def _pytest_ids(dirs: Iterable[Path]) -> list[str]:
    return [d.name for d in dirs]


if pytest is not None:
    @pytest.mark.skipif(
        not _fixture_dirs,
        reason="orchestrator fixture checkout not found (set EXEC_MODE_FIXTURE_ROOT)",
    )
    @pytest.mark.parametrize("fixture_dir", _fixture_dirs, ids=_pytest_ids(_fixture_dirs))
    def test_fixture_lint(fixture_dir: Path) -> None:
        """Per-fixture §6.3 lint gate."""
        report = lint_fixture(fixture_dir)
        if not report.ok:
            pytest.fail(
                f"{report.fixture} failed lint:\n  - " + "\n  - ".join(report.errors)
            )

    def test_all_ten_fixtures_discoverable() -> None:
        """Sanity: all 10 fixtures present in the resolved root."""
        if _fixture_root is None:
            pytest.skip("orchestrator checkout not on disk")
        present = {d.name for d in _fixture_dirs}
        expected = set(FIXTURE_IDS)
        missing = expected - present
        assert not missing, f"missing fixtures: {sorted(missing)}"


# ─── CLI entrypoint ─────────────────────────────────────────────────────────

def _run_cli(argv: list[str]) -> int:
    if len(argv) < 2:
        sys.stderr.write(
            "usage: python test_fixture_lint.py <fixture_dir_or_root> [more_dirs...]\n"
        )
        return 2

    targets: list[Path] = []
    for arg in argv[1:]:
        p = Path(arg).expanduser().resolve()
        if not p.exists():
            sys.stderr.write(f"not found: {p}\n")
            return 2
        # If arg is the root dir (contains Fa/F2/etc.), expand.
        if (p / "Fa").is_dir() or (p / "F2").is_dir():
            targets.extend(_discover_fixture_dirs(p))
        else:
            targets.append(p)

    if not targets:
        sys.stderr.write("no fixtures to lint\n")
        return 2

    total_errors = 0
    for t in targets:
        report = lint_fixture(t)
        status = "PASS" if report.ok else "FAIL"
        print(f"[{status}] {report.fixture}  "
              f"setup={report.stats.get('setup_tokens', '?')}tok "
              f"warmup={report.stats.get('warmup_tokens', '?')}tok")
        if not report.ok:
            total_errors += len(report.errors)
            for e in report.errors:
                print(f"    - {e}")

    print()
    print(f"summary: {len(targets)} fixtures, {total_errors} errors")
    return 0 if total_errors == 0 else 1


if __name__ == "__main__":
    sys.exit(_run_cli(sys.argv))
