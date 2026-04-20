# exec-mode P3 Pilot — mode=S full runner report

**Session**: `E-fullpilot-S` (builder/runner, execution-only per AGENTS.md Rule 13)
**Date**: 2026-04-20 (initial run) / 2026-04-21 (retry of 5 quota-tail trials)
**Spec**: `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-04-20-execution-mode-comparison-experiment-design.md` §4.3
**HEAD tag**: `exec-mode-v3-max-preregistered-20260420-fix2`
**State root**: `state/exec-mode-experiment/full-pilot-fix2/1/S/`
**Scope**: mode=S, fixtures F2–F10+Fa (10), seed_idx 0–9, run_idx=1 → 100 trials
**Status**: **DONE** — 100 / 100 metrics.json written, all retried failures recovered

## Top-line numbers

| metric | value |
| --- | --- |
| trials completed | 100 / 100 |
| harness rc=0 rate | 100 % (after retry of 5 quota-tail failures) |
| quality.primary mean | **0.6373** |
| quality.primary median | 0.7500 |
| quality.primary non-zero | **86 / 100** (86.0 %) |
| cost marginal total | $10.7785 (notional, subscription) |
| cost marginal mean | $0.1078 / trial |
| compacts detected | 0 |
| incidents logged (in metrics) | 0 |
| pollution leaks | 0 |
| length_capped | 0 |
| human_review_queued | 0 |
| wall-clock (v1 + v2 + retry) | ≈ 68 min main body + ~5 min retry batch |

## Per-fixture breakdown (100 trials)

| fixture | primary_mean | non-zero / n | cost_mean ($) |
| --- | ---: | ---: | ---: |
| F2  | **1.0000** | 10 / 10 | 0.1400 |
| F3  | 0.9737     | 10 / 10 | 0.0756 |
| F6  | 0.9500     | 10 / 10 | 0.0301 |
| F8  | 0.9375     | 10 / 10 | 0.0579 |
| Fa  | 0.7400     | 10 / 10 | 0.0684 |
| F9  | 0.6950     | 10 / 10 | 0.0630 |
| F4  | 0.4556     | 10 / 10 | 0.0766 |
| F5  | 0.2907     | 5 / 10  | 0.4102 |
| F7  | 0.2310     | 10 / 10 | 0.0705 |
| F10 | **0.1000** | 1 / 10  | 0.0854 |

Bimodal fixtures (many zeros): **F10** (9/10 zero) and **F5** (5/10 zero). F7 again all-non-zero-but-low (uniform partial credit). F2/F3/F6/F8 near-ceiling. F5 carries the highest per-trial cost at $0.410/trial — mode S has no warmup in theory, yet cost profile mimics warmup; the anomaly also appeared in mode D's F5 and warrants a grader-cost audit. F10 collapses harder in S than in D (mean 0.100 vs D's 0.500) — structural fixture weakness under stateless-setup inputs in mode S.

## Zero-primary outliers (14 trials)

```
F10 seeds=0,1,2,4,5,6,7,8,9   primary=0.0   (9 / 10 seeds)
F5  seeds=0,2,5,6,7            primary=0.0   (5 / 10 seeds)
```

All 14 zero-scores come from exactly **two fixtures** (F10 and F5). Mode-level failure unlikely; fixture sensitivity confirmed — same two fixtures surfaced as bimodal in mode D.

## Cross-check vs pilot-mini-fix1 (seed=0 overlap)

`pilot-mini-fix1/1/S/F*/seed00/metrics.json` vs `full-pilot-fix2/1/S/F*/seed00/metrics.json`:

| fixture | mini-fix1 | full-pilot-fix2 | delta | flag |
| --- | ---: | ---: | ---: | --- |
| F2  | 1.0000 | 1.0000 | 0.000  | = |
| F3  | 0.9474 | 0.9474 | 0.000  | = |
| F4  | 0.3800 | 0.4556 | +0.076 | ↑ |
| F5  | 0.0000 | 0.0000 | 0.000  | = (both genuine zeros) |
| F6  | 0.9500 | 0.9500 | 0.000  | = |
| F7  | 0.2205 | 0.2205 | 0.000  | = |
| F8  | 0.9375 | 0.9375 | 0.000  | = |
| F9  | 0.4500 | 0.7500 | +0.300 | ↑ |
| F10 | 1.0000 | 0.0000 | **−1.000** | ⚠ REGRESSION |
| Fa  | 1.0000 | 0.8500 | −0.150 | ↓ |

- **F10 seed=0 regression** (1.0 → 0.0) mirrors mode D's F10 seed=0 regression (1.0 → 0.0). Two independent runs agree the mini-fix1 F10/seed=0 perfect score was variance upside, not a stable expectation. Analyst should weight the 10-seed aggregate (q_mean=0.10) as the true estimate for F10/S, not the mini anecdote.
- **F9 seed=0** improved by +0.30 — consistent with LLM run-to-run variance; no grader/fixture change.
- **Seed-0 determinism**: 6/10 fixtures returned byte-identical scores, confirming grader determinism. Divergences are LLM sampling variance (no fixture or grader changes between mini-fix1 and full-pilot-fix2).

## Anomalies and incidents

### A1. 5 tail trials hit `out_of_extra_usage` on 2026-04-20 (resolved 2026-04-21)

**Affected trials** (all initially rc=1, stage1.jsonl contained a single `result` event with `is_error=True`):

| trial_idx | fixture | seed | first-run cause |
| ---: | --- | ---: | --- |
| 96  | F8 | 3 | `You're out of extra usage · resets 3am (Asia/Seoul)` |
| 97  | F7 | 5 | same |
| 98  | F2 | 4 | same |
| 99  | F5 | 0 | same |
| 100 | Fa | 7 | same |

**Classification**: **transient** (subscription rolling-quota exhaustion), not a harness bug, not fixture-specific, not a mode-S-specific LLM failure.

**Evidence**:
- All 5 were the last 5 rows in run_order_S.csv's seed_idx ∈ [0,9] filter — quota ran out only after ~95 mode-S calls plus sibling runners' concurrent consumption.
- stage1.jsonl for each contained a single `result` line: `{"type":"result","is_error":true,"result":"You're out of extra usage · resets 3am (Asia/Seoul)"}`. No assistant text, no tool use, no compact event.

**Resolution** (2026-04-21 ~08:35 KST, after quota reset and isolated-HOME credential refresh):

```
F8  seed=3  dur=26s   primary=0.9375
F7  seed=5  dur=23s   primary=0.1440
F2  seed=4  dur=59s   primary=1.0000
F5  seed=0  dur=170s  primary=0.0000   (genuine zero, matches mini-fix1)
Fa  seed=7  dur=36s   primary=0.2000
```

All 5 retried successfully with `--resume`. Total retry wall-clock ≈ 5 min 14 s. Zero duplicate metrics.json; the 95 pre-retry entries were untouched.

### A2. Runner v1 stdin-consumption bug (self-inflicted, fixed)

Same pattern as the D runner: v1's `while IFS=, read ... done <<< "$FILTERED"` loop ran the harness without `</dev/null`, and a harness child (likely `claude --print` via `bash -c`) drained remaining CSV rows. Loop exited at 15 / 100 with rc=0.

**Fix**: `</dev/null` added to the inner `perl -e 'alarm 600; exec' bin/exec-mode-experiment.sh ...` invocation (v2). Resume-safe replay produced zero duplicate metrics.json — all 95 successful v2 entries plus the 5 retried entries are authoritative.

### A3. No other anomalies

- 0 `compact.detected=true`
- 0 `pollution.leaks` truthy
- 0 non-empty `incidents[]` arrays in any of the 100 metrics
- 0 `length_capped` or `human_review_queued`
- All 100 `status == "ok"`

## Comparison vs mode D (same fixtures, seed 0–9, 100 trials each)

| metric | D (100/100) | S (100/100) | delta |
| --- | ---: | ---: | ---: |
| q_nonzero share | 90 % (90/100) | 86 % (86/100) | −4 pp |
| q_mean overall | 0.6835 | 0.6373 | −0.046 |
| q_median | — | 0.7500 | — |
| cost mean | $0.1016 | $0.1078 | +$0.006 |
| harness rc=0 rate (post-retry) | 100 % | 100 % | = |

On aggregate quality, mode S trails mode D by a modest ~4 pp on non-zero share and ~0.05 on mean — within the variance band of a single seed slice. Cost per trial is ~6 % higher in S (likely the F5 $0.41 outlier pulling the mean). Fixture-ordering weaknesses (F10 bimodal collapse, F5/F7 low-ceiling) are shared with D — confirming mode-independence of those shortfalls.

## Budget note (subscription plan)

- 100 trials × $0.1078 = **$10.78 notional** cost for decision-tree evidence. No dollars billed.
- 5 h quota untouched during the body of the run; daily rolling quota exhausted at trial 96 on 2026-04-20. Quota reset at 03:00 Asia/Seoul and credentials refresh at 08:35 KST restored full operation.

## Invariants respected

- ✅ No code modification in `bin/`, `lib/`, `tests/`, `fixtures`, `state/schema/`, or the spec.
- ✅ `HOME=/tmp/exec-mode-test-home` (isolated) for every `claude --print` spawn via `EXEC_MODE_HOME` env; credentials refreshed once after 2026-04-21 00:44 KST account bounce.
- ✅ `--resume` on every harness invocation; 15 smoke / v1-partial trials skipped on v2 replay, 95 successful trials skipped on retry pass — zero re-execution of already-graded trials.
- ✅ Explicit pathspec commits (report file only; `state/` gitignored).
- ✅ Same `run_order_S.csv` used throughout (301 rows header-inclusive; 100 rows match seed_idx ∈ [0,9] filter).

## Deliverables

1. **100 metrics.json** at `state/exec-mode-experiment/full-pilot-fix2/1/S/F{2..10,a}/seed{00..09}/`.
2. **This report** — `docs/reports/2026-04-20-exec-mode-fullpilot-S.md`.
3. **Commits**: `e2e8532` (PARTIAL 95/100) and this follow-up (DONE 100/100, retry closeout). State dir gitignored.
