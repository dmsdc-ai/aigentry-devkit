#!/usr/bin/env python3
"""Phase 6 Q2 D-promotion fire — 150 trials runner.

Pre-reg tag: exec-mode-v6-preregistered-20260502 (devkit 4eefc0a).
§3.2.1 fallback amendment binding: H1 + H10 only (H11–H14 dropped after Q4 r5
returned 0/8 PASS). n=25 seeds × 2 fixtures × 3 modes = 150 trials, 50/mode.

Q2 design (spec §3.2 active table, post-amendment):

    Q2-D-H1    D            (non-chain)  H1   n=25
    Q2-D-H10   D            (non-chain)  H10  n=25
    Q2-PC-H1   Preuse-clear (chain)      H1   n=25  (5 sess × 5 pos)
    Q2-PC-H10  Preuse-clear (chain)      H10  n=25  (5 sess × 5 pos)
    Q2-S-H1    S            (non-chain)  H1   n=25
    Q2-S-H10   S            (non-chain)  H10  n=25

Mode label unchanged (no @cell suffix); cell disambiguation via distinct
--state-root per cell. Distinct --state-root also isolates PC chain_state.json
across H1/H10 (chain_state is per-(state-root, run-idx, session, mode)).

Concurrency model:
  - D, S (non-chain): trials in a flat thread pool (PARALLEL_FLAT).
  - PC (chain): sessions in parallel (PARALLEL_SESSIONS), positions strictly
    sequential within a session. Cells run sequentially for clean quota mgmt.

Resume-safe: --resume on every harness call. Restart from any failure point.
Each cell uses its own --state-root, so re-runs only repeat missing trials.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import subprocess
import sys
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HARNESS = (REPO / "bin/exec-mode-experiment.sh").resolve()
FIXTURES_ROOT = (REPO / "state/fixtures/phase5-holdout").resolve()
PHASE6_ROOT = (REPO / "state/exec-mode-experiment/phase6-q2").resolve()
PROGRESS = PHASE6_ROOT / "progress.log"
RUN_LOG = PHASE6_ROOT / "run.log"
CHUNKS_DIR = PHASE6_ROOT / "chunks"

RUN_IDX = "1"
PARALLEL_FLAT = 3        # D / S non-chain pool (lower than Phase 5: 6 cells share quota)
PARALLEL_SESSIONS = 2    # PC chain workers per cell

TRIALS_PER_CELL = 25
TARGET_TOTAL = 150

# 6 cells per spec §3.2 active table.
CELLS: tuple[dict, ...] = (
    {"name": "Q2-D-H1",   "mode": "D",            "fixture": "H1",  "chain": False, "subdir": "Q2-D-H1"},
    {"name": "Q2-D-H10",  "mode": "D",            "fixture": "H10", "chain": False, "subdir": "Q2-D-H10"},
    {"name": "Q2-PC-H1",  "mode": "Preuse-clear", "fixture": "H1",  "chain": True,  "subdir": "Q2-PC-H1"},
    {"name": "Q2-PC-H10", "mode": "Preuse-clear", "fixture": "H10", "chain": True,  "subdir": "Q2-PC-H10"},
    {"name": "Q2-S-H1",   "mode": "S",            "fixture": "H1",  "chain": False, "subdir": "Q2-S-H1"},
    {"name": "Q2-S-H10",  "mode": "S",            "fixture": "H10", "chain": False, "subdir": "Q2-S-H10"},
)

# PC chain shape (matches Phase 5 PC chain_len=5 pattern, sized to n=25).
PC_CHAIN_LEN = 5
PC_NUM_SESSIONS = 5

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


def _state_root(cell: dict) -> Path:
    return (PHASE6_ROOT / cell["subdir"]).resolve()


def _gen_rows(cell: dict) -> list[dict]:
    """Generate trial rows for one cell (25 trials)."""
    rows: list[dict] = []
    if cell["chain"]:
        for sess in range(1, PC_NUM_SESSIONS + 1):
            for pos in range(1, PC_CHAIN_LEN + 1):
                seed_idx = (sess - 1) * PC_CHAIN_LEN + pos  # 1..25
                rows.append({
                    "session_idx": sess,
                    "position_in_chain": pos,
                    "seed_idx": seed_idx,
                })
    else:
        # Non-chain: seed_idx 1..25, no session/position.
        for s in range(1, TRIALS_PER_CELL + 1):
            rows.append({"session_idx": None, "position_in_chain": None, "seed_idx": s})
    assert len(rows) == TRIALS_PER_CELL, \
        f"cell {cell['name']}: got {len(rows)} rows, expected {TRIALS_PER_CELL}"
    return rows


def _trial_dir(cell: dict, row: dict) -> Path:
    if cell["chain"]:
        stem = f"seed{int(row['seed_idx']):02d}_pos{row['position_in_chain']}_sess{row['session_idx']}"
    else:
        stem = f"seed{int(row['seed_idx']):02d}"
    return _state_root(cell) / RUN_IDX / cell["mode"] / cell["fixture"] / stem


def _harness_args(cell: dict, row: dict) -> list[str]:
    args = [
        "bash", str(HARNESS),
        "--fixture", cell["fixture"],
        "--mode", cell["mode"],
        "--seed-idx", str(row["seed_idx"]),
        "--run-idx", RUN_IDX,
        "--state-root", str(_state_root(cell)),
        "--fixtures-root", str(FIXTURES_ROOT),
        "--resume",
    ]
    if cell["chain"]:
        args += [
            "--session-idx", str(row["session_idx"]),
            "--position-in-chain", str(row["position_in_chain"]),
        ]
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


def _summary_text() -> str:
    counts = defaultdict(lambda: {"ok": 0, "fail": 0, "missing": 0, "q_sum": 0.0, "q_n": 0})
    grand_ok = grand_fail = grand_missing = 0
    for cell in CELLS:
        for row in _gen_rows(cell):
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
                    q = (m.get("quality") or {}).get("primary")
                    if isinstance(q, (int, float)):
                        counts[cell["name"]]["q_sum"] += float(q)
                        counts[cell["name"]]["q_n"] += 1
                else:
                    counts[cell["name"]]["fail"] += 1
                    grand_fail += 1
            except Exception:
                counts[cell["name"]]["fail"] += 1
                grand_fail += 1
    lines = [
        f"# Phase 6 Q2 fire @ {_ts()}",
        f"# done={_done}/{TARGET_TOTAL} ok={grand_ok} fail={grand_fail} missing={grand_missing}",
    ]
    for cell in CELLS:
        c = counts[cell["name"]]
        mean_q = (c["q_sum"] / c["q_n"]) if c["q_n"] else float("nan")
        lines.append(
            f"  {cell['name']:>10}  {cell['mode']:14s} fix={cell['fixture']:>3}  "
            f"ok={c['ok']:2d}  fail={c['fail']:2d}  missing={c['missing']:2d}  "
            f"mean_q={mean_q:.3f}"
        )
    return "\n".join(lines) + "\n"


def _seed_done_counter() -> None:
    global _done
    n = 0
    for cell in CELLS:
        for row in _gen_rows(cell):
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
    rows_sorted = sorted(rows, key=lambda r: int(r["position_in_chain"]))
    for row in rows_sorted:
        descr = (f"{cell['fixture']}/seed{int(row['seed_idx']):02d}"
                 f"_pos{row['position_in_chain']}_sess{row['session_idx']}")
        ok, rc = _run(_harness_args(cell, row), f"{cell['name']}/{descr}")
        _bump_done(cell["name"], descr, ok, rc)
        if not ok:
            _log(f"BAIL chain {cell['name']}/sess{session_idx} after {descr} rc={rc}")
            return


def run_chain_cell(cell: dict) -> None:
    rows = _gen_rows(cell)
    by_session: dict[int, list[dict]] = defaultdict(list)
    for row in rows:
        by_session[int(row["session_idx"])].append(row)
    state_root = _state_root(cell)
    state_root.mkdir(parents=True, exist_ok=True)
    _log(f"START chain cell {cell['name']} mode={cell['mode']} fixture={cell['fixture']} "
         f"sessions={len(by_session)} parallel={PARALLEL_SESSIONS} root={state_root}")
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
    _log(f"DONE chain cell {cell['name']}")


def run_flat_cell(cell: dict) -> None:
    rows = _gen_rows(cell)
    state_root = _state_root(cell)
    state_root.mkdir(parents=True, exist_ok=True)
    _log(f"START flat cell {cell['name']} mode={cell['mode']} fixture={cell['fixture']} "
         f"trials={len(rows)} parallel={PARALLEL_FLAT} root={state_root}")
    with ThreadPoolExecutor(max_workers=PARALLEL_FLAT) as ex:
        futures = {}
        for row in rows:
            descr = f"{cell['fixture']}/seed{int(row['seed_idx']):02d}"
            futures[ex.submit(_run, _harness_args(cell, row), f"{cell['name']}/{descr}")] = (descr,)
        for fut in as_completed(futures):
            descr, = futures[fut]
            ok, rc = fut.result()
            _bump_done(cell["name"], descr, ok, rc)
    _log(f"DONE flat cell {cell['name']}")


def run_cell(cell: dict) -> None:
    if cell["chain"]:
        run_chain_cell(cell)
    else:
        run_flat_cell(cell)


def main() -> int:
    _log("=== Phase 6 Q2 fire start ===")
    _log("Pre-reg tag: exec-mode-v6-preregistered-20260502 (4eefc0a)")
    _log("§3.2.1 amendment: H1+H10 only (H11–H14 dropped, Q4 r5 0/8 PASS)")
    _seed_done_counter()
    for cell in CELLS:
        run_cell(cell)
    final = PHASE6_ROOT / "FINAL.txt"
    final.write_text(_summary_text())
    _log("=== Phase 6 Q2 fire COMPLETE ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
