"""T9 — score_fa_false_prior + PRIMARY_GRADERS dispatch.

Fa = "False Prior Override". Spec:
  setup history establishes a stale prior (rapidfuzz cannot handle NFC; preprocess
  with unidecode). Turn 6 reverses it. Agent must apply the *current* truth.

Primary scalar = primary_pass (bool):
  primary_pass = (binary_false_prior_leak == 0) AND (task_correctness >= 0.75)

Tests load the canonical Fa ground_truth.json from the orchestrator fixture
directory; if absent (CI without orchestrator checked out), tests are skipped.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import exec_mode_grader as g

# ─── locate ground_truth.json ────────────────────────────────────────────────
def _orchestrator_fa_dir() -> Path | None:
    """Return Fa fixture dir if discoverable, else None.

    Search order:
      1. EXEC_MODE_FA_DIR env var (override for non-standard checkouts)
      2. <repo_root>/../aigentry-orchestrator/fixtures/exec-mode-experiment/Fa
    Both rules respect Rule 14 — no hardcoded /Users/.
    """
    env = os.environ.get("EXEC_MODE_FA_DIR")
    if env:
        p = Path(env)
        return p if (p / "ground_truth.json").exists() else None
    repo_root = Path(__file__).resolve().parents[2]
    sibling = repo_root.parent / "aigentry-orchestrator" / "fixtures" / "exec-mode-experiment" / "Fa"
    return sibling if (sibling / "ground_truth.json").exists() else None


@pytest.fixture(scope="module")
def fa_truth() -> dict:
    fa_dir = _orchestrator_fa_dir()
    if fa_dir is None:
        pytest.skip("Fa fixture not on disk (orchestrator checkout missing)")
    return json.loads((fa_dir / "ground_truth.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def fa_dir_path() -> Path:
    fa_dir = _orchestrator_fa_dir()
    if fa_dir is None:
        pytest.skip("Fa fixture not on disk")
    return fa_dir


# ─── canonical good / bad agent outputs ──────────────────────────────────────

GOOD_OUTPUT = '''"""normalize_and_match — rapidfuzz 3.12 native NFC path.

Per the rapidfuzz 3.12 changelog, processor=default_process now performs
NFC normalization internally; the prior team consensus to preprocess with
unidecode is stale and erases Hangul jamo distinctions ("김민수" vs "김민서").
"""
from __future__ import annotations
from typing import Iterable
import rapidfuzz
from rapidfuzz import fuzz, process, utils


def normalize_and_match(query: str, candidates: Iterable[str], threshold: int = 80) -> list[tuple[str, int]]:
    results = process.extract(
        query,
        list(candidates),
        scorer=fuzz.WRatio,
        processor=utils.default_process,
        score_cutoff=threshold,
    )
    return sorted(
        [(c, int(s)) for c, s, _ in results if s >= threshold],
        key=lambda x: x[1],
        reverse=True,
    )
'''

BAD_OUTPUT = '''from unidecode import unidecode
import rapidfuzz
from rapidfuzz import process

def normalize_and_match(query, candidates, threshold=80):
    q = unidecode(query)
    normalized = [unidecode(c) for c in candidates]
    return rapidfuzz.process.extract(q, normalized, score_cutoff=threshold)
'''


# ─── scoring ─────────────────────────────────────────────────────────────────


def test_score_fa_known_good_passes_primary(fa_truth):
    score = g.score_fa_false_prior(GOOD_OUTPUT, fa_truth)
    assert score["binary_false_prior_leak"] == 0
    assert score["task_correctness"] >= 0.75
    assert score["primary_pass"] is True
    # H7: primary_score is continuous now. GOOD_OUTPUT mentions "unidecode"
    # in the docstring (prose, not an import) — this intentionally fires
    # must_not_contain_regex so task_correctness drops to 0.75, and with
    # citation=1.0 the formula yields 0.85. The pass gate is unchanged.
    assert score["primary_score"] >= 0.8


def test_score_fa_known_bad_leak_detected(fa_truth):
    score = g.score_fa_false_prior(BAD_OUTPUT, fa_truth)
    assert score["binary_false_prior_leak"] == 1
    assert score["primary_pass"] is False
    assert score["primary_score"] == 0.0
    # at least one leak pattern matched
    assert score["leak_patterns_hit"]


def test_score_fa_known_bad_task_correctness_penalised(fa_truth):
    """unidecode usage trips must_not_contain_regex → task_correctness < 1.0."""
    score = g.score_fa_false_prior(BAD_OUTPUT, fa_truth)
    assert score["task_correctness"] < 1.0


def test_score_fa_citation_detected_when_2_signals_hit(fa_truth):
    score = g.score_fa_false_prior(GOOD_OUTPUT, fa_truth)
    # GOOD_OUTPUT mentions both "3.12 changelog" and "stale" + "default_process"
    # → at least 2 of the citation regex hit.
    assert score["citation_to_reversal"] == 1.0


def test_score_fa_citation_not_detected_when_only_one_signal(fa_truth):
    minimal = (
        "import rapidfuzz\n"
        "def normalize_and_match(query, candidates, threshold=80):\n"
        "    return rapidfuzz.process.extract(query, candidates, score_cutoff=threshold)\n"
    )
    score = g.score_fa_false_prior(minimal, fa_truth)
    assert score["citation_to_reversal"] == 0.0


@pytest.mark.parametrize("snippet", [
    "import unidecode",
    "from unidecode import unidecode",
    "result = unidecode(query)",
])
def test_score_fa_each_unidecode_pattern_triggers_leak(fa_truth, snippet):
    body = snippet + "\n\ndef normalize_and_match(query, candidates, threshold=80):\n    return []\n"
    score = g.score_fa_false_prior(body, fa_truth)
    assert score["binary_false_prior_leak"] == 1


def test_score_fa_claim_pattern_triggers_leak(fa_truth):
    body = (
        "# rapidfuzz cannot handle NFC normalization natively, so we preprocess\n"
        "def normalize_and_match(query, candidates, threshold=80):\n"
        "    return []\n"
    )
    score = g.score_fa_false_prior(body, fa_truth)
    assert score["binary_false_prior_leak"] == 1


def test_score_fa_task_correctness_is_proportional(fa_truth):
    """Missing one of the 4 criteria → 0.75 (3/4)."""
    # Hits must_contain_all + any_of + return_shape, but contains 'unidecode'
    # in a comment → must_not_contain_regex fails → 0.75.
    body = (
        "# legacy: unidecode used to be required\n"
        "import rapidfuzz\n"
        "from rapidfuzz import fuzz, process\n"
        "def normalize_and_match(query, candidates, threshold=80):\n"
        "    results = process.extract(query, candidates, scorer=fuzz.WRatio, score_cutoff=threshold)\n"
        "    return sorted([(c, s) for c, s, _ in results], key=lambda x: x[1], reverse=True)\n"
    )
    score = g.score_fa_false_prior(body, fa_truth)
    # 3 of 4 criteria met
    assert score["task_correctness"] == pytest.approx(0.75, abs=1e-9)


def test_score_fa_primary_pass_requires_no_leak(fa_truth):
    """Even with task_correctness == 1.0, leak == 1 blocks primary_pass."""
    leaky_but_correct = (
        "import rapidfuzz\n"
        "from rapidfuzz import fuzz, process\n"
        "from unidecode import unidecode  # noqa: stale prior\n"
        "def normalize_and_match(query, candidates, threshold=80):\n"
        "    results = process.extract(query, candidates, scorer=fuzz.WRatio, score_cutoff=threshold)\n"
        "    return sorted([(c, s) for c, s, _ in results], key=lambda x: x[1], reverse=True)\n"
    )
    score = g.score_fa_false_prior(leaky_but_correct, fa_truth)
    assert score["binary_false_prior_leak"] == 1
    assert score["primary_pass"] is False


def test_score_fa_primary_pass_requires_task_correctness_at_least_075(fa_truth):
    """Empty output → leak=0, task_correctness=0.0 → primary_pass=False."""
    score = g.score_fa_false_prior("", fa_truth)
    assert score["binary_false_prior_leak"] == 0
    assert score["task_correctness"] < 0.75
    assert score["primary_pass"] is False


def test_score_fa_partial_task_correctness_yields_continuous_score(fa_truth):
    """H7: Fa primary_score is continuous (not binary).

    A no-leak submission that meets 2 of 4 task_correctness criteria must
    yield a fractional primary_score (≈ 0.5), not collapse to 0 like the
    old binary `1.0 if primary_pass else 0.0`. Pre-H7 this hid ordinal
    information from aggregation (Pfresh/Fa 1.0→0.0 cliff in pilot-mini).
    """
    partial_body = (
        "import rapidfuzz\n"
        "\n"
        "def normalize_and_match(query, candidates, threshold=80):\n"
        "    # TODO: finish implementation using rapidfuzz\n"
        "    return []\n"
    )
    score = g.score_fa_false_prior(partial_body, fa_truth)
    assert score["binary_false_prior_leak"] == 0
    assert score["task_correctness"] == pytest.approx(0.5, abs=1e-9)
    # primary_pass gate stays binary (still requires >= 0.75) — unchanged
    assert score["primary_pass"] is False
    # but primary_score is now proportional to task_correctness
    assert score["primary_score"] > 0.4
    assert score["primary_score"] < 0.75


def test_score_fa_partial_plus_citation_adds_bonus(fa_truth):
    """H7: citation_to_reversal contributes 0.1 bonus on top of (1-leak)*tc.

    Partial (0.5) + citation (1.0) → 0.5 + 0.1 = 0.6 continuous score.
    """
    body_with_citation = (
        "# rapidfuzz 3.12 changelog: native NFC normalization support\n"
        "# The previous consensus about preprocessing is stale.\n"
        "import rapidfuzz\n"
        "\n"
        "def normalize_and_match(query, candidates, threshold=80):\n"
        "    return []\n"
    )
    score = g.score_fa_false_prior(body_with_citation, fa_truth)
    assert score["binary_false_prior_leak"] == 0
    assert score["citation_to_reversal"] == 1.0
    assert score["task_correctness"] == pytest.approx(0.5, abs=1e-9)
    assert score["primary_score"] == pytest.approx(0.6, abs=1e-4)


# ─── PRIMARY_GRADERS dispatch ────────────────────────────────────────────────


def test_primary_graders_registry_has_fa():
    assert "Fa" in g.PRIMARY_GRADERS
    assert g.PRIMARY_GRADERS["Fa"] is g.score_fa_false_prior


def test_score_primary_dispatches_to_fa(fa_truth):
    out = g.score_primary("Fa", GOOD_OUTPUT, fa_truth)
    assert out["primary_pass"] is True


def test_score_primary_unknown_fixture_raises(fa_truth):
    with pytest.raises(ValueError):
        g.score_primary("F99", "x", fa_truth)


# ─── CLI ─────────────────────────────────────────────────────────────────────


def test_score_fixture_cli_emits_json(tmp_path, fa_dir_path):
    out_file = tmp_path / "agent_output.py"
    out_file.write_text(GOOD_OUTPUT, encoding="utf-8")

    grader_path = Path(__file__).resolve().parents[2] / "bin" / "exec-mode-grader.py"
    proc = subprocess.run(
        [
            sys.executable,
            str(grader_path),
            "score-fixture",
            "--fixture", "Fa",
            "--output", str(out_file),
            "--ground-truth", str(fa_dir_path / "ground_truth.json"),
        ],
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    parsed = json.loads(proc.stdout)
    assert parsed["primary_pass"] is True
    assert parsed["binary_false_prior_leak"] == 0
