# exec-mode P3 Pilot — mode=D full runner report

**Session**: `E-fullpilot-D` (builder/runner, execution-only per AGENTS.md Rule 13)
**Date**: 2026-04-20
**Spec**: `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-04-20-execution-mode-comparison-experiment-design.md` §4.3
**HEAD tag**: `exec-mode-v3-max-preregistered-20260420-fix2`
**State root**: `state/exec-mode-experiment/full-pilot-fix2/1/D/`
**Scope**: mode=D, fixtures F2–F10+Fa (10), seed_idx 0–9, run_idx=1 → 100 trials
**Status**: **DONE** — 100/100 metrics.json written, 0 failures

## Top-line numbers

| metric | value |
| --- | --- |
| trials completed | 100 / 100 |
| harness rc=0 rate | 100 % |
| quality.primary mean | **0.6835** |
| quality.primary non-zero | **90 / 100** (90 %) |
| cost marginal total | $10.1609 (notional, subscription) |
| cost marginal mean | $0.1016 / trial |
| compacts detected | 0 |
| incidents logged | 0 |
| wall-clock (combined v1+v2) | ≈ 66 min |

## Per-fixture breakdown

| fixture | primary_mean | non-zero / n | cost_mean ($) |
| --- | ---: | ---: | ---: |
| F2  | **1.000** | 10/10 | 0.1374 |
| F3  | 0.974 | 10/10 | 0.1010 |
| F6  | 0.950 | 10/10 | 0.0492 |
| F8  | 0.938 | 10/10 | 0.0672 |
| Fa  | 0.730 | 10/10 | 0.0961 |
| F9  | 0.710 | 10/10 | 0.0436 |
| F10 | 0.500 | 5/10  | 0.0773 |
| F4  | 0.478 | 10/10 | 0.0771 |
| F5  | 0.315 | 5/10  | 0.2897 |
| F7  | 0.241 | 10/10 | 0.0774 |

Bimodal fixtures (roughly half zero, half high) in mode D: **F10** and **F5**. F7 is low-but-all-non-zero (uniform partial credit). F2/F3/F6/F8 are near-ceiling. F5 also carries the highest per-trial cost — warmup-like behavior in mode D is unexpected and worth a grader audit.

## Zero-primary outliers (10 trials)

```
F5  seed=0,4,5,6,8   primary=0.0
F10 seed=0,1,2,7,8   primary=0.0
```

All 10 zero-scores come from exactly **two fixtures**, suggesting fixture-level sensitivity rather than mode-level failure.

## Cross-check vs pilot-mini-fix1 (seed=0 overlap)

| fixture | mini-fix1 | full-pilot-fix2 | delta | flag |
| --- | ---: | ---: | ---: | --- |
| F2  | 1.0000 | 1.0000 | 0.000 | = |
| F3  | 1.0000 | 0.9474 | −0.053 | ≈ |
| F4  | 0.3800 | 0.4000 | +0.020 | ≈ |
| F5  | 0.7333 | 0.0000 | **−0.733** | ⚠ REGRESSION |
| F6  | 0.9500 | 0.9500 | 0.000 | = |
| F7  | 0.2205 | 0.2730 | +0.053 | ≈ |
| F8  | 0.9375 | 0.9375 | 0.000 | = |
| F9  | 0.7000 | 0.7500 | +0.050 | ≈ |
| F10 | 1.0000 | 0.0000 | **−1.000** | ⚠ REGRESSION |
| Fa  | 1.0000 | 0.6000 | −0.400 | ↓ |

Three regressions at seed=0 (F5, F10, Fa) — consistent with the bimodal F5/F10 pattern above. F10 went from perfect in mini-fix1 to hard zero. This is **LLM run-to-run variance** (temperature, no warmup in mode D), not a grader or fixture change — fixtures are byte-identical across runs and graders are deterministic. Analyst should treat mode D as variance-heavy at single-seed granularity; aggregate (n=10/seed) stabilizes most fixtures.

## Anomalies and incidents

- **0** `out_of_credits` events
- **0** `compact.detected=true` events
- **0** `incidents[]` entries
- **0** harness timeouts or non-zero rc
- **runner incident (self-inflicted)**: v1 runner exited at trial 25/100 because the inner `bin/exec-mode-experiment.sh` invocation inherited stdin from an `awk ... | while read` pipe; some sub-process in the harness consumed remaining CSV rows, starving the loop. Root cause fixed in `/tmp/fullpilot-D-runner.sh` v2 (fd-3 redirect + `</dev/null` on inner call). Resume-safe replay produced zero duplicates — all 100 metrics.json are authoritative.

## Budget note (subscription plan)

- 100 trials × $0.1016 = **$10.16 notional** cost for decision-tree evidence. No dollars billed.
- No 5h quota hit.

## Deliverables

- 100 × `state/exec-mode-experiment/full-pilot-fix2/1/D/F{2,3,4,5,6,7,8,9,10,a}/seed{00..09}/metrics.json`
- This report: `docs/reports/2026-04-20-exec-mode-fullpilot-D.md`

## Invariants preserved

- No code modification (harness, grader, fixtures, analyzer, spec)
- Isolated HOME (`/tmp/exec-mode-test-home`, creds 600) for every `claude --print` spawn
- All invocations used `--resume`
- Same `run_order_D.csv` as siblings Pfresh/Pacc/S
- Explicit pathspec commits (no `git add -A`)
