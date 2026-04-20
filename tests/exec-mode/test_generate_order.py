"""TDD for bin/exec-mode-generate-order.py (T14).

Spec references:
- §4.4 Randomization (blocked): D/Pfresh/S flat shuffle, Pacc per-session shuffle.
- §7.5 Pre-registration: run_orders/*.csv committed pre-tag, RNG seed=42 fixed.
- metrics.v1.json: trial_id pattern requires session_idx + position_in_chain for Pacc.

Owned by Session C (analyzer + order generator). Determinism is the iron invariant —
"same seed → same CSV across runs" is the pre-registration guarantee.
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

EXPECTED_FIXTURES = ["F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "Fa"]
EXPECTED_TRIALS_PER_FLAT_MODE = 300  # 10 fixtures × 30 seeds
EXPECTED_PACC_SESSIONS = 30
EXPECTED_PACC_POSITIONS = 10
EXPECTED_PACC_TRIALS = EXPECTED_PACC_SESSIONS * EXPECTED_PACC_POSITIONS  # 300


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


# ---------------- D / Pfresh / S — flat shuffle ----------------


@pytest.mark.parametrize("mode", ["D", "Pfresh", "S"])
def test_flat_csv_row_count(tmp_path, generator, mode):
    out = tmp_path / f"run_order_{mode}.csv"
    generator.write_flat_order(mode, out)
    assert len(_read_csv(out)) == EXPECTED_TRIALS_PER_FLAT_MODE


@pytest.mark.parametrize("mode", ["D", "Pfresh", "S"])
def test_flat_csv_columns(tmp_path, generator, mode):
    out = tmp_path / f"run_order_{mode}.csv"
    generator.write_flat_order(mode, out)
    rows = _read_csv(out)
    assert list(rows[0].keys()) == ["trial_idx", "fixture_id", "seed_idx"]


@pytest.mark.parametrize("mode", ["D", "Pfresh", "S"])
def test_flat_csv_balanced(tmp_path, generator, mode):
    """Every fixture appears 30×; every seed_idx (0..29) appears 10×."""
    out = tmp_path / f"run_order_{mode}.csv"
    generator.write_flat_order(mode, out)
    rows = _read_csv(out)
    fixtures = Counter(r["fixture_id"] for r in rows)
    seeds = Counter(int(r["seed_idx"]) for r in rows)
    assert set(fixtures) == set(EXPECTED_FIXTURES)
    assert all(fixtures[f] == 30 for f in EXPECTED_FIXTURES)
    assert set(seeds) == set(range(30))
    assert all(seeds[s] == 10 for s in range(30))


@pytest.mark.parametrize("mode", ["D", "Pfresh", "S"])
def test_flat_csv_trial_idx_dense(tmp_path, generator, mode):
    out = tmp_path / f"run_order_{mode}.csv"
    generator.write_flat_order(mode, out)
    rows = _read_csv(out)
    assert [int(r["trial_idx"]) for r in rows] == list(range(EXPECTED_TRIALS_PER_FLAT_MODE))


@pytest.mark.parametrize("mode", ["D", "Pfresh", "S"])
def test_flat_csv_deterministic_byte_for_byte(tmp_path, generator, mode):
    """Pre-registration guarantee: regenerating yields identical bytes."""
    out_a = tmp_path / "a.csv"
    out_b = tmp_path / "b.csv"
    generator.write_flat_order(mode, out_a)
    generator.write_flat_order(mode, out_b)
    assert out_a.read_bytes() == out_b.read_bytes()


def test_flat_modes_have_distinct_orders(tmp_path, generator):
    """D, Pfresh, S derive distinct sub-seeds → distinct shuffle orders.

    If the three CSVs were identical, the three modes would share a confound:
    every trial-time-slot would always pair the same (fixture, seed). Distinct
    orders break that confound while preserving determinism.
    """
    contents = {}
    for mode in ("D", "Pfresh", "S"):
        out = tmp_path / f"{mode}.csv"
        generator.write_flat_order(mode, out)
        contents[mode] = out.read_bytes()
    assert contents["D"] != contents["Pfresh"]
    assert contents["D"] != contents["S"]
    assert contents["Pfresh"] != contents["S"]


# ---------------- Pacc — per-session shuffle ----------------


def test_pacc_csv_row_count(tmp_path, generator):
    out = tmp_path / "Pacc.csv"
    generator.write_pacc_order(out)
    assert len(_read_csv(out)) == EXPECTED_PACC_TRIALS


def test_pacc_csv_columns(tmp_path, generator):
    out = tmp_path / "Pacc.csv"
    generator.write_pacc_order(out)
    rows = _read_csv(out)
    assert list(rows[0].keys()) == [
        "trial_idx", "session_idx", "position_in_chain", "fixture_id", "seed_idx",
    ]


def test_pacc_each_session_covers_all_fixtures_at_distinct_positions(tmp_path, generator):
    """Z design (spec §4.4): each session sees all 10 fixtures, one per position 1..10."""
    out = tmp_path / "Pacc.csv"
    generator.write_pacc_order(out)
    rows = _read_csv(out)
    by_session: dict[int, list[dict[str, str]]] = {}
    for r in rows:
        by_session.setdefault(int(r["session_idx"]), []).append(r)
    assert set(by_session) == set(range(1, EXPECTED_PACC_SESSIONS + 1))
    for sid, srows in by_session.items():
        positions = sorted(int(r["position_in_chain"]) for r in srows)
        fixtures = {r["fixture_id"] for r in srows}
        assert positions == list(range(1, EXPECTED_PACC_POSITIONS + 1)), f"session {sid}"
        assert fixtures == set(EXPECTED_FIXTURES), f"session {sid}"


def test_pacc_position_average_three(tmp_path, generator):
    """30 sessions × 10 positions / 10 fixtures = average 3 per (fixture, position).

    Spec §4.4 says 평균(average) 3 — exact balance is NOT guaranteed by random
    shuffle (binomial dispersion). Test the invariant the spec actually states.
    """
    out = tmp_path / "Pacc.csv"
    generator.write_pacc_order(out)
    rows = _read_csv(out)
    pairs = Counter((r["fixture_id"], int(r["position_in_chain"])) for r in rows)
    assert sum(pairs.values()) == EXPECTED_PACC_TRIALS
    avg = sum(pairs.values()) / (len(EXPECTED_FIXTURES) * EXPECTED_PACC_POSITIONS)
    assert avg == pytest.approx(3.0)


def test_pacc_seed_idx_equals_session_idx(tmp_path, generator):
    """Pacc seed_idx tracks the session — each session is one 'seed' for that fixture-mode cell."""
    out = tmp_path / "Pacc.csv"
    generator.write_pacc_order(out)
    rows = _read_csv(out)
    for r in rows:
        assert int(r["seed_idx"]) == int(r["session_idx"])


def test_pacc_sessions_have_distinct_orderings(tmp_path, generator):
    """Spec §4.4: random.shuffle(fixtures, seed=session_idx) — different seed → different order."""
    out = tmp_path / "Pacc.csv"
    generator.write_pacc_order(out)
    rows = _read_csv(out)
    by_session: dict[int, list[str]] = {}
    for r in rows:
        by_session.setdefault(int(r["session_idx"]), []).append(r["fixture_id"])
    orders = {tuple(by_session[s]) for s in by_session}
    # 30 distinct seeds shuffling 10 items → essentially never collide
    assert len(orders) >= EXPECTED_PACC_SESSIONS - 1


def test_pacc_deterministic_byte_for_byte(tmp_path, generator):
    out_a = tmp_path / "a.csv"
    out_b = tmp_path / "b.csv"
    generator.write_pacc_order(out_a)
    generator.write_pacc_order(out_b)
    assert out_a.read_bytes() == out_b.read_bytes()


def test_pacc_trial_idx_dense(tmp_path, generator):
    out = tmp_path / "Pacc.csv"
    generator.write_pacc_order(out)
    rows = _read_csv(out)
    assert [int(r["trial_idx"]) for r in rows] == list(range(EXPECTED_PACC_TRIALS))


# ---------------- CLI entry point ----------------


def test_cli_writes_all_four_csvs(tmp_path):
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output-dir", str(tmp_path)],
        check=True, capture_output=True, text=True,
    )
    for mode in ("D", "Pfresh", "Pacc", "S"):
        path = tmp_path / f"run_order_{mode}.csv"
        assert path.is_file(), f"{path.name} missing"
        assert path.stat().st_size > 0, f"{path.name} empty"


def test_cli_idempotent_across_invocations(tmp_path):
    """Two CLI runs in two dirs produce byte-identical CSVs."""
    a = tmp_path / "a"
    b = tmp_path / "b"
    a.mkdir(); b.mkdir()
    for d in (a, b):
        subprocess.run(
            [sys.executable, str(GENERATOR), "--output-dir", str(d)],
            check=True, capture_output=True, text=True,
        )
    for mode in ("D", "Pfresh", "Pacc", "S"):
        assert (a / f"run_order_{mode}.csv").read_bytes() == (b / f"run_order_{mode}.csv").read_bytes()
