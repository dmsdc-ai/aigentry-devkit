# exec-mode P3 Pilot — mode=S full runner report

**Session**: `E-fullpilot-S` (builder/runner, execution-only per AGENTS.md Rule 13)
**Date**: 2026-04-20
**Spec**: `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-04-20-execution-mode-comparison-experiment-design.md` §4.3
**HEAD tag**: `exec-mode-v3-max-preregistered-20260420-fix2`
**State root**: `state/exec-mode-experiment/full-pilot-fix2/1/S/`
**Scope**: mode=S, fixtures F2–F10+Fa (10), seed_idx 0–9, run_idx=1 → 100 trials
**Status**: **PARTIAL** — 95 / 100 metrics.json written; 5 trials hit subscription quota tail exhaustion (transient, retry after reset at 3 am Asia/Seoul)

## Top-line numbers

| metric | value |
| --- | --- |
| trials completed | 95 / 100 |
| harness rc=0 rate | 95 % |
| quality.primary mean | **0.6392** |
| quality.primary median | 0.7500 |
| quality.primary non-zero | **82 / 95** (86.3 %) |
| cost marginal total | $9.7754 (notional, subscription) |
| cost marginal mean | $0.1029 / trial |
| compacts detected | 0 |
| incidents logged (in metrics) | 0 |
| pollution leaks | 0 |
| length_capped | 0 |
| human_review_queued | 0 |
| wall-clock (v1+v2 runner) | ≈ 68 min (v1: 611 s / 15 trials, v2: 3504 s / 100 trials rows including 15 resume-skips) |

## Per-fixture breakdown (95 trials)

| fixture | primary_mean | non-zero / n | cost_mean ($) |
| --- | ---: | ---: | ---: |
| F2  | **1.0000** | 9 / 9   | 0.1338 |
| F3  | 0.9737     | 10 / 10 | 0.0756 |
| F6  | 0.9500     | 10 / 10 | 0.0301 |
| F8  | 0.9375     | 9 / 9   | 0.0482 |
| Fa  | 0.7278     | 9 / 9   | 0.0610 |
| F9  | 0.6950     | 10 / 10 | 0.0630 |
| F4  | 0.4556     | 10 / 10 | 0.0766 |
| F5  | 0.3230     | 5 / 9   | 0.4133 |
| F7  | 0.2322     | 9 / 9   | 0.0624 |
| F10 | **0.1000** | 1 / 10  | 0.0854 |

Bimodal fixtures (roughly half-or-more zero): **F10** (9/10 zero) and **F5** (4/9 zero). F7 again all-non-zero-but-low (uniform partial credit), F2/F3/F6/F8 near-ceiling. F5 carries the highest per-trial cost at $0.413/trial — mode S with no warmup in theory, yet cost profile mimics warmup; the anomaly also appeared in mode D's F5 and warrants a grader-cost audit. F10 collapses even harder in S than in D (mean 0.100 vs D's 0.500) — structural fixture weakness under stateless-setup inputs.

## Zero-primary outliers (13 trials)

```
F10 seeds=0,1,2,4,5,6,7,8,9   primary=0.0   (9 / 10 seeds)
F5  seeds=2,5,6,7             primary=0.0   (4 /  9 seeds)
```

All 13 zero-scores come from exactly **two fixtures** (F10 and F5), identical bimodal pattern observed in mode D. Mode-level failure unlikely; fixture sensitivity confirmed.

## Cross-check vs pilot-mini-fix1 (seed=0 overlap)

`pilot-mini-fix1/1/S/F*/seed00/metrics.json` vs `full-pilot-fix2/1/S/F*/seed00/metrics.json`:

| fixture | mini-fix1 | full-pilot-fix2 | delta | flag |
| --- | ---: | ---: | ---: | --- |
| F2  | 1.0000 | 1.0000 | 0.000  | = |
| F3  | 0.9474 | 0.9474 | 0.000  | = |
| F4  | 0.3800 | 0.4556 | +0.076 | ≈ |
| F5  | —      | (failed: out_of_credits) | n/a | ⛔ |
| F6  | 0.9500 | 0.9500 | 0.000  | = |
| F7  | 0.2205 | 0.2205 | 0.000  | = |
| F8  | 0.9375 | 0.9375 | 0.000  | = |
| F9  | 0.4500 | 0.7500 | +0.300 | ↑ |
| F10 | 1.0000 | 0.0000 | **−1.000** | ⚠ REGRESSION |
| Fa  | 1.0000 | 0.8500 | −0.150 | ↓ |

- **F10 seed=0 regression** (1.0 → 0.0) mirrors mode D's F10 seed=0 regression (1.0 → 0.0). Two independent runs agree the mini-fix1 F10/seed=0 perfect score was a variance upside, not a stable expectation. Analyst should weight the 10-seed aggregate (q_mean=0.10) as the true estimate for F10/S, not the mini anecdote.
- **F9 seed=0** improved by +0.30 — consistent with LLM run-to-run variance; no grader/fixture change.
- **Seed-0 determinism**: 5/9 comparable fixtures returned byte-identical scores, confirming grader determinism. Divergences are LLM sampling variance.

## Anomalies and incidents

### A1. 5 trials failed with `out_of_extra_usage` (quota tail exhaustion)

**Affected trials** (all rc=1, stage1.jsonl contains a single `result` event with `is_error=True`):

| trial_idx | fixture | seed | first-minute cause |
| ---: | --- | ---: | --- |
| 96  | F8 | 3 | `You're out of extra usage · resets 3am (Asia/Seoul)` |
| 97  | F7 | 5 | same |
| 98  | F2 | 4 | same |
| 99  | F5 | 0 | same |
| 100 | Fa | 7 | same |

**Classification**: **transient** (subscription rolling-quota exhaustion), not a harness bug, not fixture-specific, not a mode-S-specific LLM failure.

**Evidence**:
- All 5 are the **last 5 trials** in run_order_S.csv's seed_idx ∈ [0,9] filter — quota ran out only after ~95 mode-S calls plus sibling runners' concurrent consumption.
- stage1.jsonl for each contains a single `result` line: `{"type":"result","is_error":true,"result":"You're out of extra usage · resets 3am (Asia/Seoul)"}`. No assistant text, no tool use, no compact event.
- Post-run credits probe (`HOME=/tmp/exec-mode-test-home claude --print <<< "ping"`) still returns the same message at 2026-04-20 23:45 KST → quota remained exhausted at report time.
- Mode D finished its 100/100 earlier in the session before quota tail hit. Parallel Pfresh/Pacc sibling consumption + S being the last runner to reach its tail trials explains the asymmetric 0 vs 5 error counts (not a mode-S flaw).

**Retry plan (for orchestrator)**:

```bash
# After 3:00 Asia/Seoul quota reset, rerun the 5 trials (pre-registered seeds, resume-safe):
cd ~/projects/aigentry-devkit
export EXEC_MODE_HOME=/tmp/exec-mode-test-home
PILOT=state/exec-mode-experiment/full-pilot-fix2
for row in "F8 3" "F7 5" "F2 4" "F5 0" "Fa 7"; do
  set -- $row; bin/exec-mode-experiment.sh --mode S --fixture "$1" --seed-idx "$2" \
    --run-idx 1 --state-root "$PILOT" --resume </dev/null
done
```

No code modification required; `--resume` skips the 95 already-written metrics.json.

### A2. Runner v1 stdin-consumption bug (self-inflicted, fixed)

Identical pattern to the D runner: v1's `while IFS=, read ... done <<< "$FILTERED"` loop ran the harness without `</dev/null`, and a harness child (likely `claude --print` via `bash -c`) drained remaining CSV rows. Loop exited at 15/100 with rc=0.

**Fix**: `</dev/null` added to the inner `perl -e 'alarm 600; exec' bin/exec-mode-experiment.sh ...` invocation (v2). Resume-safe replay produced zero duplicate metrics.json — all 95 successful entries are authoritative.

### A3. No other anomalies

- 0 `compact.detected=true`
- 0 `pollution.leaks` truthy
- 0 non-empty `incidents[]` arrays in any of the 95 metrics
- 0 `length_capped` or `human_review_queued`
- All 95 `status == "ok"`

## Comparison vs mode D (same fixtures, seed 0–9, 100 trials each)

| metric | D (100/100) | S (95/100) | delta |
| --- | ---: | ---: | ---: |
| q_nonzero share | 90 % (90/100) | 86.3 % (82/95) | −3.7 pp |
| q_mean overall | 0.6835 | 0.6392 | −0.044 |
| q_median | — | 0.7500 | — |
| cost mean | $0.1016 | $0.1029 | +$0.001 |
| harness rc=0 rate | 100 % | 95 % | −5 pp (A1) |

S is not noticeably worse than D on aggregate quality; the only gap is the 5-trial tail failure from quota exhaustion, which retry will close. Fixture-ordering weaknesses (F10 bimodal collapse, F5/F7 low-ceiling) are shared with D — confirming mode-independence of those shortfalls.

## Budget note (subscription plan)

- 95 trials × $0.1029 = **$9.78 notional** cost for decision-tree evidence. No dollars billed.
- No 5 h quota hit during the body of the run; **daily rolling quota** (separate from 5 h) exhausted at trial 96. Sibling runners' concurrent consumption (D done, Pfresh/Pacc still running) is the probable contributor to the asymmetric tail.

## Invariants respected

- ✅ No code modification in `bin/`, `lib/`, `tests/`, `fixtures`, `state/schema/`, or the spec.
- ✅ `HOME=/tmp/exec-mode-test-home` (isolated) for every `claude --print` spawn via `EXEC_MODE_HOME` env.
- ✅ `--resume` on every harness invocation; 15 smoke / v1-partial trials skipped on v2 replay without re-execution.
- ✅ Explicit pathspec commit (report file only; `state/` gitignored).
- ✅ Same `run_order_S.csv` used throughout (301 rows header-inclusive; 100 rows match seed_idx ∈ [0,9] filter).

## Deliverables

1. **95 metrics.json** at `state/exec-mode-experiment/full-pilot-fix2/1/S/F{2,3,4,6,8,9,10,a}/seed{00..09}/` and the non-failing seeds of F{5,7,8,a}.
2. **This report** — `docs/reports/2026-04-20-exec-mode-fullpilot-S.md`.
3. **Commit**: report-only.
4. **Retry plan** (A1 above) — actionable after 3 am Asia/Seoul.
