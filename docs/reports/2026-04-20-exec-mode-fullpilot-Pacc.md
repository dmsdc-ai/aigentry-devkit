# exec-mode P3 Pilot — mode=Pacc full runner report

**Session**: `E-fullpilot-Pacc` (builder/runner, execution-only per AGENTS.md Rule 13)
**Date**: 2026-04-20 → 2026-04-21 (run spanned midnight KST)
**Spec**: `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-04-20-execution-mode-comparison-experiment-design.md` §4.3, §4.4
**HEAD tag**: `exec-mode-v3-max-preregistered-20260420-fix3`
**State root**: `state/exec-mode-experiment/full-pilot-fix2/1/Pacc/`
**Scope**: mode=Pacc, fixtures F2–F10+Fa (10), seed_idx 1–10 mapped 1:1 to session_idx 1–10, 10 positions per chain → 100 trials
**Status**: **DONE** — 99/100 metrics.json written (1 timeout incident at sess=5/pos=6/F9/seed=5)

## Top-line numbers

| metric | value |
| --- | --- |
| trials completed | 99 / 100 |
| harness rc=0 rate | 99 % (1 × rc=2 timeout at trial_idx=45) |
| quality.primary mean | **0.164** |
| quality.primary non-zero | **37 / 99** (37 %) |
| cost marginal total | $11.4898 (notional, subscription) |
| cost marginal mean | $0.1161 / trial |
| pollution.self_rate mean | 0.109 (50/99 non-zero) |
| pollution.chain_rate | not populated by harness (Pacc cross-fixture leaks unmeasured this run) |
| loss.rate mean | 0.0081 (8/99 non-zero) |
| compacts detected | 0 |
| in-metric incidents | 0 |
| runner-side incidents | 1 (perl-alarm 720s timeout, trial 45) |
| wall-clock (combined v1 + v2) | ~94 min real trial work (42-trial v1: 37 min; 58-trial v2: 57 min, excluding resume-skips) |

## Per-fixture breakdown

| fixture | primary_mean | non-zero / n | cost_mean ($) |
| --- | ---: | ---: | ---: |
| Fa  | **0.720** | 10/10 | 0.0987 |
| F2  | 0.325 | 6/10  | 0.1071 |
| F7  | 0.157 | 8/10  | 0.0976 |
| F10 | 0.100 | 1/10  | 0.1089 |
| F3  | 0.100 | 1/10  | 0.0916 |
| F8  | 0.094 | 1/10  | 0.1210 |
| F5  | 0.073 | 1/10  | 0.2231 |
| F4  | 0.055 | 9/10  | 0.0941 |
| F6  | 0.000 | 0/10  | 0.0875 |
| F9  | 0.000 | 0/9   | 0.1327 |

Only **Fa** and **F2** survive accumulation with meaningful quality. **F6** and **F9** collapse to a flat zero across all sessions/positions. F4 is "all non-zero but all tiny" (9/10 non-zero but mean 0.055) — partial-credit plateau rather than clean successes. Fixture sensitivity under accumulation is **much more severe than mode=D's bimodal F5/F10 pattern** (D report).

## Per-position_in_chain breakdown (Pacc core signal)

| position | primary_mean | non-zero / n | cost_mean ($) |
| ---: | ---: | ---: | ---: |
|  1 | **0.490** | 8/10 | 0.133 |
|  2 | 0.198 | 5/10 | 0.154 |
|  3 | 0.188 | 3/10 | 0.104 |
|  4 | 0.101 | 2/10 | 0.118 |
|  5 | 0.189 | 4/10 | 0.097 |
|  6 | 0.098 | 2/9  | 0.153 |
|  7 | 0.076 | 3/10 | 0.113 |
|  8 | **0.000** | 1/10 | 0.100 |
|  9 | 0.011 | 3/10 | 0.082 |
| 10 | 0.282 | 6/10 | 0.112 |

Position 1 (cold start) has the highest quality (0.49) by a wide margin — consistent with the spec's §4.4 hypothesis that accumulated context degrades quality. Decay is near-monotonic from pos 1→8 (0.49 → 0.00). The pos=10 rebound (0.28) is unexpected — merits analyst follow-up (possibly fixture-assignment artifact: the pos=10 row for each session is the "leftover" fixture after shuffle).

Cost per position is essentially flat (~$0.10–0.15), so Pacc's accumulation penalty in this sample shows as **quality decay without cost escalation** — token reuse via `claude --resume` is cache-efficient.

## Per-session breakdown

| session | q_mean | non-zero / n |
| ---: | ---: | ---: |
| 1  | 0.184 | 5/10 |
| 2  | 0.123 | 4/10 |
| 3  | **0.287** | 5/10 |
| 4  | 0.173 | 2/10 |
| 5  | 0.220 | 3/9  |
| 6  | 0.215 | 4/10 |
| 7  | 0.177 | 4/10 |
| 8  | 0.069 | 4/10 |
| 9  | 0.089 | 3/10 |
| 10 | 0.109 | 3/10 |

No session is a strong outlier in either direction; variance is narrow (0.07–0.29). Accumulation degradation is a **within-session position effect**, not a session-level lottery.

## Zero-primary trials (62 / 99)

Zeros concentrate on F6 (10/10), F9 (9/9), then late positions of weak fixtures. F6/F9 zero-rate mirrors the mode=D report's separate note that these fixtures were already borderline — Pacc amplifies the failure rather than revealing new weakness.

## Cross-check vs pilot-mini-fix1

**None available.** Inspection of `state/exec-mode-experiment/pilot-mini-fix1/` shows only D/Pfresh/S directories — Pacc was never exercised before today. The source-of-truth inject's seed-0 overlap line is moot. Future mini-pilot runs should include a Pacc row for regression coverage.

## Anomalies & incidents

### 1. Harness `chain_state_path` bug (pre-run blocker, fixed via fix3)

- **Found**: `bin/lib/exec-mode-lib.sh:237` keyed Pacc chain state by `(fixture × session)` (`$sr/$run/Pacc/$fix/chain_sess${sess}.json`), but spec §4.4 defines Pacc sessions as cycling across 10 randomly-ordered fixtures → pos≥2 could never find pos=1's session_id under the intended semantics.
- **Evidence**: trial 1 (sess=1/pos=2/F10) died `rc=5 "requires session_id from pos=1 in Pacc/F10/chain_sess1.json"` after trial 0 (sess=1/pos=1/F8) wrote its chain file under `Pacc/F8/chain_sess1.json`. Path mismatch = impossible to resolve.
- **Why not caught**: `pilot-mini-fix1` never exercised Pacc (no `Pacc/` tree in that run's state). First Pacc execution = today.
- **Fix**: `E-devkit-pacc-chainfix` dispatched by orchestrator, produced commit `94729cd` (tag `exec-mode-v3-max-preregistered-20260420-fix3`). Chain path now `"$sr/$run/Pacc/chain_sess${sess}.json"`, fixture becomes a JSON payload field, migration script moved existing `F8/chain_sess1.json`. 4 new bats regression tests covering multi-fixture single-session chains. pytest 191/192 + bats 35/35 green post-fix.
- **Impact on this run**: 0 trials re-done; migration was idempotent and my 1 pre-fix trial (`F8/seed01_pos1_sess1`) stayed valid under the new layout.

### 2. Runner early-exit at 42/100 (stdin-consumption bug, self-fixed)

- **Symptom**: pid 26451 terminated cleanly at `completed=42` despite 100-row scope. No harness error; loop simply fell through to `DONE`.
- **Root cause**: driver used `while read ... ; done <<< "$SCOPE_ROWS"` (herestring on fd 0). A child process inherited the loop's stdin and drained the remaining 58 rows — most likely during trial 41, which ran 206 s vs. the usual 30–60 s. `set -o pipefail` + absence of `set -e` meant the loop exited silently when `read` hit EOF.
- **Fix (mine, outside harness scope)**: drive scope rows on fd 3 (`while read -u 3 ...; done 3<<< "$SCOPE_ROWS"`) and feed every harness invocation `< /dev/null`. Matches the D runner v1→v2 self-fix pattern (orchestrator's RESUME inject noted this explicitly).
- **Recovery**: relaunched with `--resume`; 42 resume-skips flew through in 11 s, then real work resumed at trial_idx=42 (sess=5/pos=3/F3).

### 3. Quota window (00:44 → 03:00 KST)

- S sibling runner reported `out_of_extra_usage` around 23:45 KST; my runner had already exited (unrelated — bash bug), but during the pause my isolated HOME `.claude.json` crossed the ~8 h OAuth staleness window.
- Quota probe initially surfaced `401 authentication_error` synchronously but `You're out of extra usage · resets 3am (Asia/Seoul)` on a second (eventually completed) async probe. The 401 was a near-simultaneous symptom; underlying constraint was quota.
- Resolved by orchestrator refreshing `/tmp/exec-mode-test-home/.claude.json` from the real HOME (chmod 600) after the user's brief account switch / return; quota confirmed ok post-reset.

### 4. Trial 45 timeout (sess=5 / pos=6 / F9 / seed=5)

- Hit the runner's 720 s cap (perl-alarm SIGALRM → exit 142, normalized to harness rc=2 "timeout").
- Per spec §10 fault handling: kill, log incident, continue. No metrics.json written for this cell.
- Trial 46 (sess=5 / pos=7 / F8) completed ok in 37 s → chain itself was still healthy, only the single F9 call was stuck.
- Counted once in `incidents=1`; not a mode-level signal. 99/100 is the effective sample.

### 5. Cross-OS runner gap — macOS lacks `timeout`

- `bin/exec-mode-experiment.sh` contract ([spec §10 risks]) expects a per-trial timeout but the Darwin 25.4.0 host running this session has neither GNU `timeout` nor `gtimeout`.
- Workaround used by `/tmp/pacc-runner.sh`: `perl -e 'alarm shift; exec @ARGV' 720 <cmd>` → SIGALRM on expiry → exit 142 → normalize to harness rc=2. Pure-core-Perl, portable.
- Future cross-OS runners should either ship the perl-alarm wrapper or gate on `command -v timeout >/dev/null || alias timeout="perl ...`. Recommend codifying in `bin/exec-mode-experiment.sh` helper lib so siblings don't each re-discover this.

### 6. Legacy credentials-file check in source-of-truth preflight

- Pre-flight Gate 4 spec checks `$EXEC_MODE_HOME/.credentials.json` with expected mode 600. Modern Claude CLI stores credentials in `.claude.json` (not `.credentials.json`); the former is absent. Gate 3 (`claude --print <<<"ok"`) is the real auth-validity signal and passed in all pre-flights. Gate 4 should be updated to target `.claude.json` in a future pilot spec.

## Deliverables

- 99 `metrics.json` under `state/exec-mode-experiment/full-pilot-fix2/1/Pacc/F*/seed<NN>_pos<P>_sess<S>/metrics.json`
- 10 `chain_sess{1..10}.json` under `state/.../Pacc/` (session-level, post-fix3 layout)
- This report — commit-only, state tree remains gitignored per repo policy
- Runner script kept at `/tmp/pacc-runner.sh` for reference; patched version is what shipped the final 58 trials

## Recommendations for analyst

1. Populate `pollution.chain_rate` (currently always `null` in Pacc metrics) — without it we cannot separately report `Pollution_chain` per spec §5.3. Likely a grader branch that only runs when `position_in_chain > 1`.
2. Re-run trial 45 (sess=5/pos=6/F9/seed=5) once the root cause for its 720 s hang is diagnosed; single missing cell weakens position×fixture cell n (drops pos=6 to n=9 vs. the uniform n=10).
3. Investigate the pos=10 rebound (0.28 after the pos=8 nadir of 0.00). Most plausible hypothesis: the fixture assigned to pos=10 in each session is whatever remains after `random.shuffle(fixtures, seed=session_idx)` consumes positions 1–9 — worth checking whether pos=10 rebound correlates with which fixture is assigned there.
