#!/usr/bin/env python3
"""Phase 6 Q1 substitute-compact fire — 350 trials runner.

Pre-reg tag: exec-mode-v6-preregistered-20260502 (devkit 4eefc0a).
Harness --cut N flag: devkit c9873ae (Phase 6 Q1 §3.1 binding).

Q1 design (spec §3.1, 7 cells × 50 trials = 350 trials):

    Q1-A1  Preuse-substitute-compact-revised  5-pos  cut=5   n=50
    Q1-A2  Preuse-substitute-compact-revised  5-pos  cut=10  n=50
    Q1-A3  Preuse-substitute-compact-revised  5-pos  cut=15  n=50
    Q1-A4  Preuse-substitute-compact-revised  5-pos  cut=20  n=50
    Q1-A5  Preuse-substitute-compact-revised  10-pos cut=30  n=50
    Q1-B1  Pacc                               5-pos  (n/a)   n=50
    Q1-B2  Pacc                               10-pos (n/a)   n=50

Fixtures per cell: H1 + H10 (25 + 25 per cell).
Mode label unchanged across cuts (no @cutN suffix per coder design note);
cell disambiguation via distinct --state-root per cell.

Concurrency: chain sessions in parallel (PARALLEL_SESSIONS), positions within
a session strictly sequential (chain_state.json constraint). Cells run in
sequence (one cell at a time) for clean quota management.

Resume-safe: --resume on every harness call. Restart from any failure point.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import os
import random
import subprocess
import sys
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HARNESS = (REPO / "bin/exec-mode-experiment.sh").resolve()
FIXTURES_ROOT = (REPO / "state/fixtures/phase5-holdout").resolve()
PHASE6_ROOT = (REPO / "state/exec-mode-experiment/phase6-q1").resolve()
PROGRESS = PHASE6_ROOT / "progress.log"
RUN_LOG = PHASE6_ROOT / "run.log"
CHUNKS_DIR = PHASE6_ROOT / "chunks"

RUN_IDX = "1"
PARALLEL_SESSIONS = 2  # conservative: 2 chains in parallel per cell

MASTER_SEED = 42
TARGET_TOTAL = 350

# 7 cells per spec §3.1.
CELLS: tuple[dict, ...] = (
    {"name": "Q1-A1", "mode": "Preuse-substitute-compact-revised", "chain_len": 5,  "cut": 5,  "subdir": "Q1-A1-sc-5pos-cut5"},
    {"name": "Q1-A2", "mode": "Preuse-substitute-compact-revised", "chain_len": 5,  "cut": 10, "subdir": "Q1-A2-sc-5pos-cut10"},
    {"name": "Q1-A3", "mode": "Preuse-substitute-compact-revised", "chain_len": 5,  "cut": 15, "subdir": "Q1-A3-sc-5pos-cut15"},
    {"name": "Q1-A4", "mode": "Preuse-substitute-compact-revised", "chain_len": 5,  "cut": 20, "subdir": "Q1-A4-sc-5pos-cut20"},
    {"name": "Q1-A5", "mode": "Preuse-substitute-compact-revised", "chain_len": 10, "cut": 30, "subdir": "Q1-A5-sc-10pos-cut30"},
    {"name": "Q1-B1", "mode": "Pacc",                              "chain_len": 5,  "cut": None, "subdir": "Q1-B1-pacc-5pos"},
    {"name": "Q1-B2", "mode": "Pacc",                              "chain_len": 10, "cut": None, "subdir": "Q1-B2-pacc-10pos"},
)

FIXTURES_Q1 = ("H1", "H10")
TRIALS_PER_FIXTURE = 25  # spec §3.1: each cell uses both fixtures, 25/25

PHASE6_ROOT.mkdir(parents=True, exist_ok=True)
CHUNKS_DIR.mkdir(parents=True, exist_ok=True)

_lock = threading.Lock()
_done = 0
_chunk_emitted = 0


def _ts() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _log(msg: str) -> None:
    line = f"[{_ts()}] {msg}\n"
    with _lock:
        with PROGRESS.open("a") as f:
            f.write(line)


def _gen_run_order(cell: dict) -> list[dict]:
    """Generate run-order rows for one cell.

    Returns list of dicts with keys: session_idx, position_in_chain,
    fixture_id, seed_idx. Per-cell: 50 positions = 25 H1 + 25 H10.

    Layout:
      chain_len=5: 10 sessions × 5 positions. Sessions alternate (H1×3,H10×2)
                   and (H1×2,H10×3) → 25/25 H1/H10 total.
      chain_len=10: 5 sessions × 10 positions, each session (H1×5, H10×5).

    Per-session fixture order is shuffled by random.Random(session_idx) so
    fixture-position assignment is deterministic + cell-distinct (cell name
    seeds the offset).
    """
    L = cell["chain_len"]
    cell_offset = sum(ord(c) for c in cell["name"])  # cell-distinct rng offset
    rows: list[dict] = []
    if L == 5:
        num_sessions = 10
        # 5 sessions of (3 H1, 2 H10), 5 sessions of (2 H1, 3 H10)
        per_session_counts = [(3, 2)] * 5 + [(2, 3)] * 5
    elif L == 10:
        num_sessions = 5
        per_session_counts = [(5, 5)] * 5
    else:
        raise ValueError(f"unsupported chain_len: {L}")

    for s_idx, (n_h1, n_h10) in enumerate(per_session_counts, start=1):
        slots = (["H1"] * n_h1) + (["H10"] * n_h10)
        random.Random(MASTER_SEED + cell_offset + s_idx).shuffle(slots)
        for pos, fixture in enumerate(slots, start=1):
            rows.append({
                "session_idx": s_idx,
                "position_in_chain": pos,
                "fixture_id": fixture,
                "seed_idx": s_idx,
            })
    assert len(rows) == 50, f"cell {cell['name']}: got {len(rows)} rows, expected 50"
    h1_count = sum(1 for r in rows if r["fixture_id"] == "H1")
    h10_count = sum(1 for r in rows if r["fixture_id"] == "H10")
    assert h1_count == 25 and h10_count == 25, \
        f"cell {cell['name']}: fixture imbalance H1={h1_count} H10={h10_count}"
    return rows


def _state_root(cell: dict) -> Path:
    return (PHASE6_ROOT / cell["subdir"]).resolve()


def _trial_dir(cell: dict, row: dict) -> Path:
    stem = f"seed{int(row['seed_idx']):02d}_pos{row['position_in_chain']}_sess{row['session_idx']}"
    return _state_root(cell) / RUN_IDX / cell["mode"] / row["fixture_id"] / stem


def _harness_args(cell: dict, row: dict) -> list[str]:
    args = [
        "bash", str(HARNESS),
        "--fixture", row["fixture_id"],
        "--mode", cell["mode"],
        "--seed-idx", str(row["seed_idx"]),
        "--run-idx", RUN_IDX,
        "--state-root", str(_state_root(cell)),
        "--fixtures-root", str(FIXTURES_ROOT),
        "--session-idx", str(row["session_idx"]),
        "--position-in-chain", str(row["position_in_chain"]),
        "--resume",
    ]
    if cell["cut"] is not None:
        args += ["--cut", str(cell["cut"])]
    return args


def _run(args: list[str], descr: str) -> tuple[bool, int]:
    with RUN_LOG.open("a") as f:
        f.write(f"\n=== {_ts()} {descr} ===\n")
    rc = subprocess.run(
        args, stdout=open(RUN_LOG, "ab"), stderr=subprocess.STDOUT,
    ).returncode
    return rc == 0, rc


def _bump_done(cell_name: str, descr: str, ok: bool, rc: int) -> None:
    global _done, _chunk_emitted
    with _lock:
        _done += 1
        suffix = "OK" if ok else f"FAIL[{rc}]"
        with PROGRESS.open("a") as f:
            f.write(f"[{_ts()}] {suffix} {_done}/{TARGET_TOTAL} {cell_name}/{descr}\n")
        if _done % 50 == 0 or _done == TARGET_TOTAL:
            _chunk_emitted += 1
            chunk = CHUNKS_DIR / f"chunk-{_chunk_emitted:02d}-at-{_done:03d}.txt"
            chunk.write_text(_summary_text())


def _trial_metrics_path(cell: dict, row: dict) -> Path:
    return _trial_dir(cell, row) / "metrics.json"


def _trial_fired(cell: dict, row: dict) -> bool:
    """Sub-compact fired at this position iff .preuse_inputs/manifest.json exists.

    The harness only stages and writes manifest.json when the cumulative
    cut crosses (line 580–589 of exec-mode-experiment.sh).
    """
    return (_trial_dir(cell, row) / ".preuse_inputs" / "manifest.json").exists()


def _summary_text() -> str:
    counts = defaultdict(lambda: {"ok": 0, "fail": 0, "missing": 0, "fired": 0})
    grand_ok = grand_fail = grand_missing = 0
    for cell in CELLS:
        rows = _gen_run_order(cell)
        for row in rows:
            mp = _trial_metrics_path(cell, row)
            if not mp.exists():
                counts[cell["name"]]["missing"] += 1
                grand_missing += 1
                continue
            try:
                m = json.loads(mp.read_text())
                if m.get("status") == "ok":
                    counts[cell["name"]]["ok"] += 1
                    grand_ok += 1
                    if cell["mode"] == "Preuse-substitute-compact-revised" \
                       and int(row["position_in_chain"]) > 1 \
                       and _trial_fired(cell, row):
                        counts[cell["name"]]["fired"] += 1
                else:
                    counts[cell["name"]]["fail"] += 1
                    grand_fail += 1
            except Exception:
                counts[cell["name"]]["fail"] += 1
                grand_fail += 1
    lines = [
        f"# Phase 6 Q1 fire @ {_ts()}",
        f"# done={_done}/{TARGET_TOTAL} ok={grand_ok} fail={grand_fail} missing={grand_missing}",
    ]
    for cell in CELLS:
        c = counts[cell["name"]]
        cut_label = f"cut={cell['cut']:>3}" if cell["cut"] is not None else "cut=  -"
        lines.append(
            f"  {cell['name']:>6}  {cell['mode']:38s} chain={cell['chain_len']:>2}  "
            f"{cut_label}  ok={c['ok']:2d}  fail={c['fail']:2d}  missing={c['missing']:2d}  "
            f"sc_fired={c['fired']:2d}"
        )
    return "\n".join(lines) + "\n"


def _seed_done_counter() -> None:
    global _done
    n = 0
    for cell in CELLS:
        rows = _gen_run_order(cell)
        for row in rows:
            mp = _trial_metrics_path(cell, row)
            if mp.exists():
                try:
                    if json.loads(mp.read_text()).get("status") == "ok":
                        n += 1
                except Exception:
                    pass
    _done = n
    _log(f"RESUME counter: {_done}/{TARGET_TOTAL} already ok")


def run_chain_session(cell: dict, session_idx: int, rows: list[dict]) -> None:
    """Within one session: positions 1..N strictly sequential."""
    rows_sorted = sorted(rows, key=lambda r: int(r["position_in_chain"]))
    for row in rows_sorted:
        descr = (f"{row['fixture_id']}/seed{int(row['seed_idx']):02d}"
                 f"_pos{row['position_in_chain']}_sess{row['session_idx']}")
        ok, rc = _run(_harness_args(cell, row), f"{cell['name']}/{descr}")
        _bump_done(cell["name"], descr, ok, rc)
        if not ok:
            _log(f"BAIL chain {cell['name']}/sess{session_idx} after {descr} rc={rc}")
            return


def run_cell(cell: dict) -> None:
    rows = _gen_run_order(cell)
    by_session: dict[int, list[dict]] = defaultdict(list)
    for row in rows:
        by_session[int(row["session_idx"])].append(row)
    state_root = _state_root(cell)
    state_root.mkdir(parents=True, exist_ok=True)
    _log(f"START cell {cell['name']} mode={cell['mode']} chain={cell['chain_len']} "
         f"cut={cell['cut']} sessions={len(by_session)} "
         f"parallel={PARALLEL_SESSIONS} root={state_root}")
    with ThreadPoolExecutor(max_workers=PARALLEL_SESSIONS) as ex:
        futures = {
            ex.submit(run_chain_session, cell, sess, sess_rows): sess
            for sess, sess_rows in by_session.items()
        }
        for fut in as_completed(futures):
            sess = futures[fut]
            try:
                fut.result()
            except Exception as e:
                _log(f"EXC cell {cell['name']}/sess{sess}: {e}")
    _log(f"DONE cell {cell['name']}")


def main() -> int:
    _log("=== Phase 6 Q1 fire start ===")
    _log(f"Pre-reg tag: exec-mode-v6-preregistered-20260502 (4eefc0a)")
    _log(f"Harness: bin/exec-mode-experiment.sh @ c9873ae (--cut flag)")
    _seed_done_counter()
    for cell in CELLS:
        run_cell(cell)
    final = PHASE6_ROOT / "FINAL.txt"
    final.write_text(_summary_text())
    _log("=== Phase 6 Q1 fire COMPLETE ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
