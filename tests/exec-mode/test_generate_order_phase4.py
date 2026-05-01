"""Phase 4 trial-driver wiring tests for `bin/exec-mode-generate-order.py`.

Spec: `docs/superpowers/specs/2026-04-26-phase4-trial-driver-wiring.md` §6.1
Pre-reg tag: `exec-mode-v4-replication-preregistered-20260426`

Phase 5 extension (Track #329 E27, sub-ADR
`docs/adr/2026-05-01-substitute-compact-revised-cut.md`, commit f50295c)
adds a 10th mode `Preuse-substitute-compact-revised` (cut=30 tokens),
bringing the CSV set to 10 files and total trials to 1,400 (800 + 600).

Verifies the 10-CSV Phase 4+5 set:
- Counts per arm (200 replication, 100 Preuse) — INV-7 extended (1,400 total).
- Mode set is exactly the 10 expected files (1 missing/extra → fail).
- Seed coverage: each fixture appears 20× per replication arm; 10× per
  Preuse arm (1 per session).
- Pacc + Preuse arms share the per-session shuffle (sessions 1..10 of every
  per-session arm visit fixtures in the same order — spec §4.3 guarantee).
- Determinism: same seed → byte-identical CSV across runs.
"""

from __future__ import annotations

import csv
import importlib.util
import subprocess
import sys
from collections import Counter
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
GENERATOR = REPO / "bin" / "exec-mode-generate-order.py"

FIXTURES = ["F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "Fa"]

REPLICATION_MODES = ["D", "Pfresh", "S", "Pacc"]
PREUSE_MODES = [
    "Preuse-clear",
    "Preuse-substitute-compact-C1",
    "Preuse-substitute-compact-C2",
    "Preuse-substitute-compact-C3",
    "Preuse-substitute-compact-C4",
    "Preuse-substitute-compact-revised",
]
ALL_MODES = REPLICATION_MODES + PREUSE_MODES

REPLICATION_TRIALS_PER_ARM = 200  # 10 fixtures × 20 seeds (or 20 sessions × 10 pos)
PREUSE_TRIALS_PER_ARM = 100  # 10 fixtures × 10 seeds (or 10 sessions × 10 pos)

EXPECTED_TOTAL_TRIALS = (
    REPLICATION_TRIALS_PER_ARM * len(REPLICATION_MODES)
    + PREUSE_TRIALS_PER_ARM * len(PREUSE_MODES)
)  # 800 + 600 = 1400 (Phase 4: 1,300 + Phase 5 cascade-(b) revised arm: 100)


@pytest.fixture
def generator():
    """Import the generator script as a module (no side effects on import)."""
    spec = importlib.util.spec_from_file_location("exec_mode_generate_order", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as f:
        return list(csv.DictReader(f))


# ─── Group 1: counts ──────────────────────────────────────────────────────


def test_total_trial_count_matches_pre_reg_tag(tmp_path):
    """INV-7 (extended): total Phase 4+5 trial count = 1,400 across all 10 CSVs."""
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output-dir", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    total = 0
    for mode in ALL_MODES:
        rows = _read_csv(tmp_path / f"run_order_{mode}.csv")
        total += len(rows)
    assert total == EXPECTED_TOTAL_TRIALS


@pytest.mark.parametrize("mode", REPLICATION_MODES)
def test_replication_arm_row_count(tmp_path, mode):
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output-dir", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    rows = _read_csv(tmp_path / f"run_order_{mode}.csv")
    assert len(rows) == REPLICATION_TRIALS_PER_ARM


@pytest.mark.parametrize("mode", PREUSE_MODES)
def test_preuse_arm_row_count(tmp_path, mode):
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output-dir", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    rows = _read_csv(tmp_path / f"run_order_{mode}.csv")
    assert len(rows) == PREUSE_TRIALS_PER_ARM


# ─── Group 2: mode set ────────────────────────────────────────────────────


def test_mode_set_exact(tmp_path):
    """Exactly 10 CSVs with the expected names — no missing, no extras."""
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output-dir", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    files = sorted(p.name for p in tmp_path.glob("run_order_*.csv"))
    expected = sorted(f"run_order_{m}.csv" for m in ALL_MODES)
    assert files == expected


# ─── Group 3: seed/fixture coverage ───────────────────────────────────────


@pytest.mark.parametrize("mode", PREUSE_MODES)
def test_preuse_each_fixture_appears_ten_times(tmp_path, mode):
    """Each of 10 fixtures appears 10× per Preuse arm (one per session, 10 sessions)."""
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output-dir", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    rows = _read_csv(tmp_path / f"run_order_{mode}.csv")
    fixtures = Counter(r["fixture_id"] for r in rows)
    assert set(fixtures) == set(FIXTURES)
    assert all(fixtures[f] == 10 for f in FIXTURES)


@pytest.mark.parametrize("mode", PREUSE_MODES)
def test_preuse_session_coverage(tmp_path, mode):
    """Sessions 1..10, each with positions 1..10 covering all fixtures."""
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output-dir", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    rows = _read_csv(tmp_path / f"run_order_{mode}.csv")
    by_session: dict[int, list[dict[str, str]]] = {}
    for r in rows:
        by_session.setdefault(int(r["session_idx"]), []).append(r)
    assert set(by_session) == set(range(1, 11))
    for sid, srows in by_session.items():
        positions = sorted(int(r["position_in_chain"]) for r in srows)
        fixtures = {r["fixture_id"] for r in srows}
        assert positions == list(range(1, 11)), f"session {sid}"
        assert fixtures == set(FIXTURES), f"session {sid}"


# ─── Group 4: cross-arm consistency (spec §4.3 guarantee) ─────────────────


def test_preuse_arms_share_per_session_shuffle(tmp_path):
    """Sessions 1..10 of every Preuse arm visit fixtures in the same order.

    Spec §4.3: per-session shuffle is keyed by session_idx (not by mode), so
    Preuse-clear and all 4 Preuse-substitute-compact-Cn arms must produce
    byte-identical CSV bodies (modulo a hypothetical filename column — which
    the schema does not include).
    """
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output-dir", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    bodies = {
        mode: (tmp_path / f"run_order_{mode}.csv").read_bytes()
        for mode in PREUSE_MODES
    }
    # All 5 Preuse CSVs are byte-identical (same shuffle, same row count).
    distinct = set(bodies.values())
    assert len(distinct) == 1, f"Preuse arm CSVs diverge: {len(distinct)} distinct bodies"


def test_preuse_first_10_sessions_match_pacc_first_10(tmp_path):
    """Sessions 1..10 of any Preuse arm match sessions 1..10 of Pacc.

    Spec §4.3: per-session shuffle uses session_idx as RNG seed; Pacc and
    Preuse arms must produce identical fixture orderings for shared sessions.
    Pacc's first 100 rows (sessions 1..10 × positions 1..10) must equal any
    Preuse arm's full body row-for-row in the (session_idx, position_in_chain,
    fixture_id) columns.
    """
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output-dir", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    pacc_rows = _read_csv(tmp_path / "run_order_Pacc.csv")
    preuse_rows = _read_csv(tmp_path / "run_order_Preuse-clear.csv")
    pacc_first_100 = pacc_rows[:100]
    cols = ("session_idx", "position_in_chain", "fixture_id", "seed_idx")
    pacc_view = [tuple(r[c] for c in cols) for r in pacc_first_100]
    preuse_view = [tuple(r[c] for c in cols) for r in preuse_rows]
    assert pacc_view == preuse_view


# ─── Group 5: determinism ─────────────────────────────────────────────────


def test_cli_invocation_byte_deterministic(tmp_path):
    """Two CLI runs in two distinct dirs produce byte-identical CSVs for all 9 arms."""
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir(); b.mkdir()
    for d in (a, b):
        subprocess.run(
            [sys.executable, str(GENERATOR), "--output-dir", str(d)],
            check=True, capture_output=True, text=True,
        )
    for mode in ALL_MODES:
        assert (a / f"run_order_{mode}.csv").read_bytes() == \
               (b / f"run_order_{mode}.csv").read_bytes(), f"{mode} not deterministic"
