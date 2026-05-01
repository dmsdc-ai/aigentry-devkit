---
status: STEP 1b complete (6/6 PASS)
date: 2026-05-01
runner: aigentry-devkit-runner-phase5
track: "#329 Track E27 — Phase 5 holdout fire (resume from cascade-13d)"
spec: ~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-05-01-phase5-holdout-design.md §5.3 #5
state_root: state/exec-mode-experiment/phase5-smoke/
---

# Phase 5 — STEP 1b Smoke Validation Report

## §1 TL;DR

**STATUS phase5-smoke: 6/6 PASS** | every trial produced status=`ok` with valid metrics.json
schema-validating against `state/schema/metrics.v1.json` v1. Five D-mode trials covered
all five holdout fixtures (H1, H2, H3, H10, H5) at seed 0; one
`Preuse-substitute-compact-revised` trial (cut=30, sess=0, pos=1) confirmed the new
mode wires end-to-end against H1.

One pre-tag schema bug surfaced and was fixed inline (§3 below) — permitted under
Phase 5 spec §4.1 #2 amended (commit `f50295c`).

## §2 Per-trial result

| trial_id | mode | fixture | status | quality.primary | wall |
|---|---|---|---|---|---|
| `1/D/H1/seed00` | D | H1 | ok | 0.9565 | ~84s |
| `1/D/H2/seed00` | D | H2 | ok | 1.0000 | ~88s |
| `1/D/H3/seed00` | D | H3 | ok | 1.0000 | ~88s |
| `1/D/H5/seed00` | D | H5 | ok | 1.0000 | ~88s |
| `1/D/H10/seed00` | D | H10 | ok | 1.0000 | 109s |
| `1/Preuse-substitute-compact-revised/H1/seed00_pos1_sess0` | PCrev@30 | H1 | ok | 0.9565 | 87s |

All `quality.primary ≥ 0.5` — satisfies spec §4.2 line 122 grader-validation gate
(*"each fixture must pass the existing grader on at least one mode at q ≥ 0.5"*).

## §3 Schema bug found + fixed (pre-tag)

`state/schema/metrics.v1.json` `allOf[0].if.properties.mode.enum` was missing
`Preuse-substitute-compact-revised`. The new mode therefore fell into the
`else` branch which required `session_idx: null` and `position_in_chain: null`,
contradicting the chain-mode contract.

**Fix**: appended `"Preuse-substitute-compact-revised"` to the `if.enum`. The
top-level `properties.mode.enum` already included the new mode (B5 fix from
commit `2302d98`); the conditional `if.enum` was overlooked. Re-ran the PCrev
smoke trial — passes.

This is permitted as a pre-tag harness extension under Phase 5 spec §4.1 #2
amended r2 (commit `f50295c`): "Grader extensions permitted PRE-tag, frozen
POST-tag."

## §4 Generator extension (pre-tag)

`bin/exec-mode-generate-order.py` previously generated only the Phase 4+5-cuts
10-CSV set (1,400 trials, F2..Fa fixtures). Phase 5 holdout requires a separate
6-CSV set (300 trials, H1/H2/H3/H10/H5).

**Patch**: added `--phase {4,5}` flag (default 4 — backward-compat). `--phase 5`
emits the 6-mode × 5-fixture × 10-seed Phase 5 layout per spec §2.1. Phase 4
behavior unchanged; all 27 existing `test_generate_order_phase4.py` tests pass.

Generated CSVs at `state/exec-mode-experiment/phase5-holdout/run-order/`:

```
run_order_D.csv                                    50 trials
run_order_Pfresh.csv                               50 trials
run_order_S.csv                                    50 trials
run_order_Pacc.csv                                 50 trials  (10 sess × 5 pos)
run_order_Preuse-clear.csv                         50 trials  (10 sess × 5 pos)
run_order_Preuse-substitute-compact-revised.csv    50 trials  (10 sess × 5 pos)
                                                  ──────────
                                                   300 trials
```

Per-session shuffle still keyed by `session_idx`, so chain modes share
identical (session, position) → fixture mapping (verified via `diff`).

## §5 Verification commands

```bash
.venv-exec-mode/bin/python -m pytest \
  tests/exec-mode/test_generate_order_phase4.py \
  tests/exec-mode/test_grader_phase5.py \
  tests/exec-mode/test_primary_graders_dispatch.py
# 39 passed in 0.92s
```

## §6 Next step

Pre-registration tag: `exec-mode-v5-holdout-preregistered-20260501`.
