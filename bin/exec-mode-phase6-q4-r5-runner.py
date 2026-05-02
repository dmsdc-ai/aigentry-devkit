#!/usr/bin/env python3
"""Phase 6 Q4 r5 pilot — multi-mode ceiling-avoidance verification (40 trials).

Spec: §3.4 Q4 pilot design + §3.4.1 ceiling-avoidance practices
      (orchestrator commit 9a76c12, devkit fixtures b1d42d0).
Iteration: 2 of 2 HARD LIMIT per §3.4.1 #6 — last chance.

Design (§3.4.1 #4 multi-mode):
  - 4 fixtures (H11, H12, H13, H14) × {D, Pacc} × 5 seeds = 40 trials
  - Out-of-grid seeds: MASTER_SEED=42 + 1000 + offset (seed_idx in 1001..1005)

Mode D:
  - 4 × 5 = 20 trials, no chain
Mode Pacc:
  - Per seed, one chain visiting all 4 fixtures (chain_len=4)
  - Chain order rotates per seed to balance fixture × position
  - 5 chains × 4 positions = 20 trials, sequential within chain

Acceptance per fixture × mode (§3.4):
  μq ∈ [0.5, 0.85] AND σ ≥ 0.05

Outputs: state/exec-mode-experiment/phase6-q4-pilot-r5/<root>/<run>/<mode>/<fixture>/...
"""

from __future__ import annotations

import datetime as dt
import json
import random
import subprocess
import sys
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HARNESS = (REPO / "bin/exec-mode-experiment.sh").resolve()
FIXTURES_ROOT = (REPO / "state/fixtures/phase6-followup").resolve()
PILOT_ROOT = (REPO / "state/exec-mode-experiment/phase6-q4-pilot-r5").resolve()
PROGRESS = PILOT_ROOT / "progress.log"
RUN_LOG = PILOT_ROOT / "run.log"

RUN_IDX = "1"
PARALLEL_D = 2         # 2 concurrent D trials (Q1 fire runs 2 in parallel; cap total at 4)
PARALLEL_PACC_CHAINS = 2  # 2 Pacc chains in parallel; positions sequential within

MASTER_SEED = 42
# Spec §3.4 calls for "MASTER_SEED + 1000 + offset" out-of-grid seeds, but
# harness trial_id regex caps seed_idx at 3 digits (^seed[0-9]{2,3}$). Main
# grid (Phase 5 / Q1) uses seed_idx in 1..10; Q4 r4 pilot used 1..5. We pick
# 101..105 — still out-of-grid (>10× the main range), within harness regex.
SEEDS = (101, 102, 103, 104, 105)

FIXTURES = ("H11", "H12", "H13", "H14")
TARGET_TOTAL = 40

PILOT_ROOT.mkdir(parents=True, exist_ok=True)

_lock = threading.Lock()
_done = 0


def _ts() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _log(msg: str) -> None:
    line = f"[{_ts()}] {msg}\n"
    with _lock:
        with PROGRESS.open("a") as f:
            f.write(line)


def _pacc_chain_order(seed_idx: int) -> list[str]:
    """Deterministic per-seed chain order through 4 fixtures.

    seed=1001..1004 → rotation by (seed-1001) for fixture × position balance.
    seed=1005 → random shuffle (rng-seeded by seed_idx) for diversity.
    """
    base = list(FIXTURES)
    if 1001 <= seed_idx <= 1004:
        k = seed_idx - 1001
        return base[k:] + base[:k]
    rng = random.Random(MASTER_SEED + seed_idx)
    out = base.copy()
    rng.shuffle(out)
    return out


def _state_root_d() -> Path:
    return (PILOT_ROOT / "D").resolve()


def _state_root_pacc() -> Path:
    return (PILOT_ROOT / "Pacc").resolve()


def _trial_dir_d(fixture: str, seed_idx: int) -> Path:
    return _state_root_d() / RUN_IDX / "D" / fixture / f"seed{seed_idx:02d}"


def _trial_dir_pacc(fixture: str, seed_idx: int, pos: int) -> Path:
    return (_state_root_pacc() / RUN_IDX / "Pacc" / fixture
            / f"seed{seed_idx:02d}_pos{pos}_sess{seed_idx}")


def _run(args: list[str], descr: str) -> tuple[bool, int]:
    with RUN_LOG.open("a") as f:
        f.write(f"\n=== {_ts()} {descr} ===\n")
        f.write(" ".join(args) + "\n")
    rc = subprocess.run(
        args, stdout=open(RUN_LOG, "ab"), stderr=subprocess.STDOUT,
    ).returncode
    return rc == 0, rc


def _bump_done(descr: str, ok: bool, rc: int) -> None:
    global _done
    with _lock:
        _done += 1
        suffix = "OK" if ok else f"FAIL[{rc}]"
        with PROGRESS.open("a") as f:
            f.write(f"[{_ts()}] {suffix} {_done}/{TARGET_TOTAL} {descr}\n")


def _harness_args_d(fixture: str, seed_idx: int) -> list[str]:
    return [
        "bash", str(HARNESS),
        "--fixture", fixture,
        "--mode", "D",
        "--seed-idx", str(seed_idx),
        "--run-idx", RUN_IDX,
        "--state-root", str(_state_root_d()),
        "--fixtures-root", str(FIXTURES_ROOT),
        "--resume",
    ]


def _harness_args_pacc(fixture: str, seed_idx: int, pos: int) -> list[str]:
    return [
        "bash", str(HARNESS),
        "--fixture", fixture,
        "--mode", "Pacc",
        "--seed-idx", str(seed_idx),
        "--run-idx", RUN_IDX,
        "--state-root", str(_state_root_pacc()),
        "--fixtures-root", str(FIXTURES_ROOT),
        "--session-idx", str(seed_idx),
        "--position-in-chain", str(pos),
        "--resume",
    ]


def run_d_trial(fixture: str, seed_idx: int) -> None:
    descr = f"D/{fixture}/seed{seed_idx:02d}"
    if (_trial_dir_d(fixture, seed_idx) / "metrics.json").exists():
        _bump_done(f"{descr} (resume-skip)", True, 0)
        return
    ok, rc = _run(_harness_args_d(fixture, seed_idx), descr)
    _bump_done(descr, ok, rc)


def run_pacc_chain(seed_idx: int) -> None:
    """One chain per seed: positions 1..4 strictly sequential."""
    order = _pacc_chain_order(seed_idx)
    for pos, fixture in enumerate(order, start=1):
        descr = f"Pacc/{fixture}/seed{seed_idx:02d}_pos{pos}_sess{seed_idx}"
        if (_trial_dir_pacc(fixture, seed_idx, pos) / "metrics.json").exists():
            _bump_done(f"{descr} (resume-skip)", True, 0)
            continue
        ok, rc = _run(_harness_args_pacc(fixture, seed_idx, pos), descr)
        _bump_done(descr, ok, rc)
        if not ok:
            _log(f"BAIL Pacc chain seed={seed_idx} after pos={pos} rc={rc}")
            return


def _seed_done_counter() -> None:
    global _done
    n = 0
    for fixture in FIXTURES:
        for seed_idx in SEEDS:
            if (_trial_dir_d(fixture, seed_idx) / "metrics.json").exists():
                n += 1
    for seed_idx in SEEDS:
        order = _pacc_chain_order(seed_idx)
        for pos, fixture in enumerate(order, start=1):
            if (_trial_dir_pacc(fixture, seed_idx, pos) / "metrics.json").exists():
                n += 1
    _done = n
    _log(f"RESUME counter: {_done}/{TARGET_TOTAL} already present")


def run_d_phase() -> None:
    _log(f"START D phase: {len(FIXTURES) * len(SEEDS)} trials parallel={PARALLEL_D}")
    with ThreadPoolExecutor(max_workers=PARALLEL_D) as ex:
        futures = []
        for fixture in FIXTURES:
            for seed_idx in SEEDS:
                futures.append(ex.submit(run_d_trial, fixture, seed_idx))
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                _log(f"EXC D trial: {e}")
    _log("DONE D phase")


def run_pacc_phase() -> None:
    _log(f"START Pacc phase: {len(SEEDS)} chains × 4 pos parallel={PARALLEL_PACC_CHAINS}")
    with ThreadPoolExecutor(max_workers=PARALLEL_PACC_CHAINS) as ex:
        futures = {
            ex.submit(run_pacc_chain, seed_idx): seed_idx
            for seed_idx in SEEDS
        }
        for fut in as_completed(futures):
            sd = futures[fut]
            try:
                fut.result()
            except Exception as e:
                _log(f"EXC Pacc seed={sd}: {e}")
    _log("DONE Pacc phase")


def aggregate() -> dict:
    """Compute μq, σ, min, max per fixture × mode."""
    def _extract_q(m: dict) -> float | None:
        if m.get("status") != "ok":
            return None
        q = (m.get("quality") or {}).get("primary")
        return float(q) if isinstance(q, (int, float)) else None

    results: dict = {"D": defaultdict(list), "Pacc": defaultdict(list)}
    for fixture in FIXTURES:
        for seed_idx in SEEDS:
            mp = _trial_dir_d(fixture, seed_idx) / "metrics.json"
            if mp.exists():
                q = _extract_q(json.loads(mp.read_text()))
                if q is not None:
                    results["D"][fixture].append(q)
    for seed_idx in SEEDS:
        order = _pacc_chain_order(seed_idx)
        for pos, fixture in enumerate(order, start=1):
            mp = _trial_dir_pacc(fixture, seed_idx, pos) / "metrics.json"
            if mp.exists():
                q = _extract_q(json.loads(mp.read_text()))
                if q is not None:
                    results["Pacc"][fixture].append(q)

    summary: dict = {}
    for mode in ("D", "Pacc"):
        summary[mode] = {}
        for fixture in FIXTURES:
            vs = results[mode][fixture]
            n = len(vs)
            if n == 0:
                summary[mode][fixture] = {"n": 0, "mean": None, "std": None,
                                          "min": None, "max": None,
                                          "in_band": None, "values": []}
                continue
            mean = sum(vs) / n
            var = sum((v - mean) ** 2 for v in vs) / n if n > 1 else 0.0
            std = var ** 0.5
            in_band = (0.5 <= mean <= 0.85) and (std >= 0.05)
            summary[mode][fixture] = {
                "n": n, "mean": mean, "std": std,
                "min": min(vs), "max": max(vs),
                "in_band": in_band, "values": vs,
            }
    return summary


def write_summary(summary: dict) -> Path:
    out = PILOT_ROOT / "FINAL.json"
    out.write_text(json.dumps(summary, indent=2))
    txt_lines = [
        f"# Phase 6 Q4 r5 pilot @ {_ts()}",
        f"# done={_done}/{TARGET_TOTAL}",
        "# target: μq ∈ [0.5, 0.85] AND σ ≥ 0.05",
        "",
    ]
    for mode in ("D", "Pacc"):
        txt_lines.append(f"## Mode {mode}")
        for fixture in FIXTURES:
            r = summary[mode][fixture]
            if r["n"] == 0:
                txt_lines.append(f"  {fixture}  n=0  (no metrics)")
                continue
            verdict = "PASS" if r["in_band"] else "CEIL"
            txt_lines.append(
                f"  {fixture}  n={r['n']}  μ={r['mean']:.3f}  σ={r['std']:.3f}  "
                f"min={r['min']:.3f}  max={r['max']:.3f}  → {verdict}"
            )
        txt_lines.append("")
    (PILOT_ROOT / "FINAL.txt").write_text("\n".join(txt_lines))
    return out


def main() -> int:
    _log("=== Phase 6 Q4 r5 pilot start ===")
    _log("Spec: §3.4 + §3.4.1 ceiling-avoidance (orch 9a76c12)")
    _log("Fixtures: r5 redesign (devkit b1d42d0)")
    _log(f"Out-of-grid seeds: {SEEDS}")
    _seed_done_counter()
    run_d_phase()
    run_pacc_phase()
    summary = aggregate()
    final_path = write_summary(summary)
    _log(f"=== Phase 6 Q4 r5 pilot COMPLETE → {final_path} ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
