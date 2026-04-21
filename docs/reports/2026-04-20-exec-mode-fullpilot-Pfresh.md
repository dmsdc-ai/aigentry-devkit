# P3 Pilot — Pfresh fullpilot report

- **Spec**: `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-04-20-execution-mode-comparison-experiment-design.md` §4.3
- **Tag**: `exec-mode-v3-max-preregistered-20260420-fix2`
- **Session**: `E-fullpilot-Pfresh` (runner/executor, Rule 13)
- **Scope**: mode=Pfresh, fixtures F2..F10 + Fa, seeds 0..9 → **100 trials**
- **Outcome**: **DONE 100/100** (all seed/fixture cells filled; 1 cell required 3rd retry)

## Totals

| Metric | Value |
|---|---|
| Trials completed | 100/100 |
| Quality primary, non-zero | **70/100 (70%)** |
| Quality mean | 0.478 |
| Quality median | 0.500 |
| Quality stdev | 0.394 |
| Cost marginal (total / mean) | $12.827 / $0.128 |
| Cost warmup (total / mean) | $38.663 / $0.387 |
| Cost amort n=10 (mean) | $0.167 |
| Compacts detected | 0 |
| Loss rate mean | 0.014 |
| Pollution self_rate mean | 0.174 |

Cost is notional (subscription-plan; $0 billed).

## Per-fixture

| Fixture | n | mean q | non-zero |
|---|---|---|---|
| F2 | 10 | 1.000 | 10/10 |
| F3 | 10 | 0.909 | 10/10 |
| F8 | 10 | 0.909 | 10/10 |
| Fa | 10 | 0.580 | 10/10 |
| F4 | 10 | 0.481 | 10/10 |
| F9 | 10 | 0.315 | 5/10 |
| F5 | 10 | 0.217 | 3/10 |
| F6 | 10 | 0.190 | 2/10 |
| F7 | 10 | 0.178 | 10/10 (low scores) |
| F10 | 10 | 0.000 | 0/10 |

F2/F3/F8 saturate near 1.0; F10 fails every trial; F5/F6 non-zero only on a minority of seeds.

## Per-seed (across fixtures)

| Seed | mean q | Seed | mean q |
|---|---|---|---|
| 0 | 0.557 | 5 | 0.411 |
| 1 | 0.411 | 6 | 0.444 |
| 2 | 0.502 | 7 | 0.478 |
| 3 | 0.467 | 8 | 0.486 |
| 4 | 0.496 | 9 | 0.528 |

Seed variance is small (0.41–0.56) — fixture effects dominate over seed effects.

## Comparison vs pilot-mini-fix1 Pfresh (seed 0 overlap)

| | pilot-mini-fix1 | fullpilot-fix2 |
|---|---|---|
| seed0 non-zero | 6/10 | **8/10** |
| seed0 mean q | 0.394 | **0.557** |

Notable per-fixture shifts on seed 0:

| Fixture | pilot-mini-fix1 | fullpilot-fix2 | delta |
|---|---|---|---|
| F6 | 0.000 | 0.950 | **+0.95** |
| F9 | 0.400 | 0.750 | +0.35 |
| Fa | 0.000 | 0.600 | +0.60 |
| F3 | 1.000 | 0.824 | −0.176 |

Most of the gain likely comes from grader fixes landed between the two runs (e.g. `eca283f fix Fa binary → continuous primary_score`, `4e0bcd3 _extract_labeled_section markdown tolerance`). F3 dip on seed 0 is within stdev.

## Timeline / runner lifecycle

| Phase | Start (UTC) | End (UTC) | Notes |
|---|---|---|---|
| Run 1 | 2026-04-20 12:49:05 | 2026-04-20 14:04:18 | 25 trials ok, then isolated-HOME 401 auth regression; runner burned remaining 75 trials as fast exit=1 |
| Resume 1 | 2026-04-20 23:36:55 | 2026-04-21 00:35 (paused) | Orchestrator refreshed creds. 15 additional trials completed (40 total); auth regressed again after ~59 min wall-clock |
| Resume 2 | 2026-04-21 09:24:54 | 2026-04-21 13:42:23 | Orchestrator refreshed creds; only Pfresh runner live (no parallel contention). 59 real retries completed; 1 trial (F9 seed=6) exit=1 @153s |
| Targeted retry | 2026-04-21 13:42:ish | +192s | Single-trial `--resume` on F9 s6 → ok |

Compute time ≈ 5h across real trials; wall-clock ≈ 25h due to two credential-refresh pauses.

## Anomalies

- **Auth regressions (2×)**. Isolated HOME `/tmp/exec-mode-test-home` lost auth after ~25 trials (run 1) and ~15 additional trials (resume 1). Access token appears to have ~1h TTL. Parallel-runner refresh-token contention is a likely contributor during the initial 4-way run; even with a single runner (resume 1) the token ultimately aged out. Orchestrator (not the runner) handled each refresh per Rule 13.
- **F9 seed=6 required 3 attempts**. exit=1 at dur=4s (run 1, inside auth-break window), exit=1 at dur=153s (resume 2, real-duration failure — likely harness/grader transient, not auth), exit=0 at dur=192s on targeted retry. No other trial needed re-retry.
- **F10 cohort fully zero (0/10 non-zero)**. Deterministic; not a runner issue — worth grader review.
- **0 compacts**, **0 out_of_credits**, **0 timeouts**, **0 malformed**.

## Invariants honored

- No code modification to harness / grader / fixtures / analyzer / spec (runner script is a local loop under `state/.../` and is gitignored).
- Isolated HOME on every `claude --print` spawn (`EXEC_MODE_HOME=/tmp/exec-mode-test-home`).
- Resume-safe: `--resume` used on every invocation; stdin-isolation patch (fd-3 read + `</dev/null` on subprocess) applied to runner after orchestrator-confirmed sibling pattern.
- Explicit pathspec on commit.
- Runner read only `run_order_Pfresh.csv`.

## Artifacts

- Metrics: `state/exec-mode-experiment/full-pilot-fix2/1/Pfresh/F{2..10,a}/seed{00..09}/metrics.json` (100 files; gitignored)
- Runner log: `state/exec-mode-experiment/full-pilot-fix2/.Pfresh-runner.log` (gitignored)
- Runner script: `state/exec-mode-experiment/full-pilot-fix2/.Pfresh-runner.sh` (gitignored)
- This report: `docs/reports/2026-04-20-exec-mode-fullpilot-Pfresh.md`
