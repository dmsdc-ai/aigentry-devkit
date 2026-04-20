---
session: E-devkit-pacc-wiring
role: [SPEC FIRST] mini-spec → superseded by findings
status: NO-OP — premise invalidated by HEAD
date: 2026-04-20
spec: ~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-04-20-execution-mode-comparison-experiment-design.md (v3-max.1, LOCKED)
---

# Pacc harness wiring — findings (instead of mini-spec)

## TL;DR

The task context-ref (`b58937e4…`) asks this session to implement `--mode Pacc`
in the exec-mode harness. **HEAD already contains the full, spec-faithful
Pacc implementation.** No code change is warranted. Reporting to orchestrator
for redirection or session close.

## Evidence

### Git log on target files

| Commit | Date | Scope |
|---|---|---|
| `c6a27c1` | 2026-04-20 | T5 Stage 1 harness — D/S/Pacc dry-run + schema validation |
| `03dec46` | 2026-04-20 | T6 Pacc chain state + crash-discard (R8) |
| `d62da65` | 2026-04-20 | T7 Stage 2 probe-replay subprocess |
| `4f1dcc8` | 2026-04-20 16:59 KST | T10 live-path wiring — D/Pfresh/**Pacc**/S + Stage 2 probe |

### What the context-ref says must be done vs. what HEAD already has

| Context-ref requirement | Location in HEAD | Status |
|---|---|---|
| `--mode Pacc` dispatch in harness | `bin/exec-mode-experiment.sh:100-101, 124-145, 393-, 428` | ✅ present |
| Pacc session-id persistence / `--resume` chain | `bin/lib/exec-mode-lib.sh:310-400` (`chain_state_set/get_session_id`) | ✅ present |
| Chain-state file per session (T6) | `bin/lib/exec-mode-lib.sh:226-309` + harness:794-798 | ✅ present |
| R8 crash-discard guard | `bin/lib/exec-mode-lib.sh:241` + harness:139-143 | ✅ present |
| `position_in_chain` in `metrics.json` | `bin/exec-mode-experiment.sh:741` | ✅ present |
| State layout `…/Pacc/<fixture>/seed<NN>_pos<P>_sess<S>` | harness:124-126 | ✅ present (trial_stem) |
| Validation (session-idx + position-in-chain required for Pacc; rejected for non-Pacc; position ∈ 1..10) | harness:107-114 | ✅ present |
| Order generator emits `run_order_Pacc.csv` (30 sessions × 10 positions, per-session shuffle) | `bin/exec-mode-generate-order.py:63-77` | ✅ present |
| Tests | `tests/exec-mode/test_harness.bats:79-, 405-, 480-547`; `tests/exec-mode/test_generate_order.py:114-225` | ✅ present |

### Test status (just now, HEAD)

- `.venv-exec-mode/bin/python -m pytest tests/exec-mode/test_generate_order.py -q` → **26 passed**
- `bats --filter "Pacc" tests/exec-mode/test_harness.bats` → **13/13 passed** (dry-run Pacc, session-id persistence, --resume, R8 crash-discard, position-in-chain enforcement, non-Pacc negative guard)

### Spec §4.1 / §4.3 / §4.4 semantic fidelity check

| Spec clause | Implementation matches? |
|---|---|
| §4.1 line 73 — "30 independent sessions, each processes 10 fixtures in random order once (§4.4 balanced)" | ✅ `PACC_SESSIONS=30`, `PACC_POSITIONS=10`, per-session shuffle via `random.Random(session_idx)` |
| §4.1 line 145 — "position_in_chain (1~10) metadata recorded per trial" | ✅ enforced 1..10; emitted in metrics.json |
| §4.3 line 353 — "inputs: session_idx (P-acc only), position_in_chain (P-acc only)" | ✅ CLI rejects these on non-Pacc, requires on Pacc |
| §4.3 line 415 — "run_order_Pacc.csv (30 sessions × 10 fixtures)" | ✅ 300 rows |

### Context-ref factual errors (quick audit, in case the task gets re-queued for another gap)

- Context-ref line 72 smoke command is invalid against HEAD:
  - missing `--run-idx` (required by harness)
  - missing `--position-in-chain` (required for Pacc)
  - uses `--state-dir` but harness flag is `--state-root`
  - uses `--session-idx 0` / `--seed-idx 0` but `run_order_Pacc.csv` emits session_idx/positions starting at 1
- Context-ref line 48 trial-stem template `pacc-seed{NN}-sess{MM}` differs from HEAD's `seed{NN}_pos{P}_sess{S}` (T5 chose the latter; no spec clause contradicts)
- Context-ref line 7 "10 fixtures × 10 seeds = 400 trials" conflicts with spec §4.3 30-seed replication; pilot-scale (10 seeds) is a pilot-config decision, not a harness gap

## Decision

**Do not implement.** Do not touch `bin/exec-mode-experiment.sh`, `bin/lib/exec-mode-lib.sh`, `bin/exec-mode-generate-order.py`, or tests. Any change would either duplicate existing logic or regress the spec-faithful implementation merged in `4f1dcc8`.

## Possible redirections (for orchestrator to choose)

If the orchestrator intended a *different* Pacc-adjacent gap, candidates visible from the analyst phase-2 report:

1. **`pollution_chain_rate`** — analyst report line 91/263 notes it's Pacc-only but not yet exercised in pilot. Check if the analyzer+grader emit it correctly under the new Pacc runs.
2. **Full pilot runner** — orchestrate 400-trial execution (30×10 Pacc + 3×300 flat) and resume semantics, if that's not yet scripted.
3. **Pacc compact-risk telemetry** (spec §8) — longer sessions raise compact-event frequency; confirm the detector fires inside accumulated sessions.
4. **Regression check post-pre-reg-retag `-fix2`** — rerun Pacc bats + dry-run after retag, confirm no drift.

## Report action

Sending `PACC IMPL SPEC READY` as `PACC ALREADY DONE — premise stale` per the
context-ref's "if ambiguity found → REPORT to orchestrator, do not guess" rule
and [SPEC FIRST] Step 4.
