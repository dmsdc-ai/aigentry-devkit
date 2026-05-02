"""Phase 6 Q1 §3.1 binding — `--cut N` flag on bin/exec-mode-experiment.sh.

The pre-reg tag `exec-mode-v6-preregistered-20260502` (commit 4eefc0a) sealed
the harness with `cut_tokens=30` hardcoded for `Preuse-substitute-compact-revised`,
which made Q1-A1..A4 cells (cuts 5/10/15/20 on 5-pos chains) un-fireable.
This test pins the post-tag `--cut N` flag that unblocks Phase 6 Q1.

BLOCKER report (origin): telepty shared 1a2092f3...
SAWP task: ~/.telepty/shared/7c18369c8c...

Pinned behavior:
  - Default (no `--cut`): cut_tokens=30 — backward-compat with sub-ADR
    2026-05-01-substitute-compact-revised-cut.md and the pre-reg tag.
  - `--cut N`: overrides cut_tokens for `Preuse-substitute-compact-revised` only.
    Range [5..50000]; positive integer; non-int / out-of-range / non-revised
    mode rejected with exit 5.
  - Phase 6 cut grid {5,10,15,20,30} all parse cleanly.
  - Cut value echoed to stderr so per-cell aggregation can split by cut.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS = REPO_ROOT / "bin" / "exec-mode-experiment.sh"
PHASE6_CUT_GRID = (5, 10, 15, 20, 30)
REVISED_MODE = "Preuse-substitute-compact-revised"


def _run(*args: str, state_root: Path) -> subprocess.CompletedProcess[str]:
    """Invoke the harness in dry-run mode with a tmp state-root."""
    cmd = [
        "bash",
        str(HARNESS),
        "--fixture", "Fa",
        "--mode", REVISED_MODE,
        "--seed-idx", "0",
        "--run-idx", "1",
        "--session-idx", "1",
        "--position-in-chain", "1",
        "--dry-run",
        "--state-root", str(state_root),
        *args,
    ]
    return subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)


def _trial_metrics(state_root: Path) -> dict:
    metrics_path = state_root / "1" / REVISED_MODE / "Fa" / "seed00_pos1_sess1" / "metrics.json"
    assert metrics_path.is_file(), f"metrics.json missing at {metrics_path}"
    return json.loads(metrics_path.read_text(encoding="utf-8"))


# ─── Phase 6 §3.1 binding cut grid {5,10,15,20,30} ─────────────────────────


@pytest.mark.parametrize("cut", PHASE6_CUT_GRID)
def test_cut_grid_parses_and_echoes(cut: int, tmp_path: Path) -> None:
    """Each cut in the §3.1 binding grid must parse and echo cut_tokens=N."""
    proc = _run("--cut", str(cut), state_root=tmp_path)
    assert proc.returncode == 0, f"--cut {cut} failed: stderr={proc.stderr}"
    assert f"cut_tokens={cut}" in proc.stderr, (
        f"stderr missing cut_tokens={cut}: {proc.stderr!r}"
    )
    assert f"cut_id=revised" in proc.stderr
    assert f"mode={REVISED_MODE}" in proc.stderr
    # metrics.json mode label is unchanged — schema enum stays bytes-stable.
    metrics = _trial_metrics(tmp_path)
    assert metrics["mode"] == REVISED_MODE


# ─── default behavior (omitted flag) preserved ─────────────────────────────


def test_default_cut_30_preserved_when_flag_omitted(tmp_path: Path) -> None:
    """Omitting `--cut` reproduces sub-ADR cut=30 + pre-reg tag behavior."""
    proc = _run(state_root=tmp_path)
    assert proc.returncode == 0, f"default invocation failed: stderr={proc.stderr}"
    # Cut echoed at default 30 since revised mode always carries a cut value.
    assert "cut_tokens=30" in proc.stderr
    metrics = _trial_metrics(tmp_path)
    assert metrics["mode"] == REVISED_MODE


def test_explicit_cut_30_matches_default_behavior(tmp_path: Path) -> None:
    """`--cut 30` and omitted both pin cut_tokens=30 (Q1-A5 / pre-reg parity)."""
    proc = _run("--cut", "30", state_root=tmp_path)
    assert proc.returncode == 0
    assert "cut_tokens=30" in proc.stderr


# ─── invalid / out-of-range / wrong-mode rejection (exit 5) ────────────────


@pytest.mark.parametrize("bad", ["0", "-1", "-5", "abc", "5.5", "", "0x10"])
def test_cut_rejects_non_positive_integer(bad: str, tmp_path: Path) -> None:
    proc = _run("--cut", bad, state_root=tmp_path)
    assert proc.returncode == 5, f"--cut {bad!r} should be rejected, got rc={proc.returncode}"
    assert "--cut must be a positive integer" in proc.stderr or \
           "out of range" in proc.stderr


@pytest.mark.parametrize("bad", ["1", "2", "4", "50001", "100000"])
def test_cut_rejects_out_of_range(bad: str, tmp_path: Path) -> None:
    proc = _run("--cut", bad, state_root=tmp_path)
    assert proc.returncode == 5, f"--cut {bad} should be out-of-range"
    assert "out of range" in proc.stderr


def test_cut_rejected_for_non_revised_mode(tmp_path: Path) -> None:
    """C1..C4 cuts are mode-locked per Phase 4 spec §2.2; --cut is revised-only."""
    cmd = [
        "bash", str(HARNESS),
        "--fixture", "Fa",
        "--mode", "Preuse-substitute-compact-C1",
        "--seed-idx", "0", "--run-idx", "1",
        "--session-idx", "1", "--position-in-chain", "1",
        "--dry-run", "--state-root", str(tmp_path),
        "--cut", "5",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
    assert proc.returncode == 5
    assert "--cut only valid for --mode Preuse-substitute-compact-revised" in proc.stderr


def test_cut_rejected_for_d_mode(tmp_path: Path) -> None:
    cmd = [
        "bash", str(HARNESS),
        "--fixture", "Fa",
        "--mode", "D",
        "--seed-idx", "0", "--run-idx", "1",
        "--dry-run", "--state-root", str(tmp_path),
        "--cut", "10",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
    assert proc.returncode == 5


# ─── boundary values for the [5..50000] range ──────────────────────────────


@pytest.mark.parametrize("cut", [5, 50000])
def test_cut_boundary_values_accepted(cut: int, tmp_path: Path) -> None:
    proc = _run("--cut", str(cut), state_root=tmp_path)
    assert proc.returncode == 0, f"boundary cut {cut} failed: {proc.stderr}"
    assert f"cut_tokens={cut}" in proc.stderr


# ─── C1..C4 hardcoded cuts unaffected by `--cut` flag introduction ─────────


@pytest.mark.parametrize(
    "mode,expected_cut",
    [
        ("Preuse-substitute-compact-C1", 10000),
        ("Preuse-substitute-compact-C2", 50000),
        ("Preuse-substitute-compact-C3", 100000),
        ("Preuse-substitute-compact-C4", 150000),
    ],
)
def test_locked_cn_cuts_unchanged(mode: str, expected_cut: int, tmp_path: Path) -> None:
    """Phase 4 spec §2.2 — C1..C4 cut map stays locked when --cut is absent."""
    cmd = [
        "bash", str(HARNESS),
        "--fixture", "Fa",
        "--mode", mode,
        "--seed-idx", "0", "--run-idx", "1",
        "--session-idx", "1", "--position-in-chain", "1",
        "--dry-run", "--state-root", str(tmp_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
    assert proc.returncode == 0
    assert f"cut_tokens={expected_cut}" in proc.stderr
