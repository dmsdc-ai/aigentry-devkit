# Exec-Mode Phase 2 Mini-Pilot **RETRY** (fix1) — T18 Report

**Date**: 2026-04-20
**Role**: Builder/Runner session `E-exec-mode-runner-retry` (execution only per AGENTS.md Rule 13)
**Predecessor**: `docs/reports/2026-04-20-exec-mode-pilot-mini.md` (commit `3b2401b`) — all other fixtures returned quality=0 because 9/10 primary graders were unregistered (anomaly A1).
**Harness commit**: `b185123` (tag `exec-mode-v3-max-preregistered-20260420-fix1`)
**Experiment spec lock**: `exec-mode-v3-max-preregistered-20260420` (unchanged)
**Scope**: re-verification of the 30-trial pipeline after A1 grader registration + C1/C2/C3 spec-compliance fixes land. Still a verification-only shakeout — not part of the locked pre-registered dataset.

## 1. Design (identical to first pilot §1)

- **Fixtures**: `F2, F3, F4, F5, F6, F7, F8, F9, F10, Fa` (10).
- **Modes**: `D`, `Pfresh`, `S` (3). `Pacc` deferred to full pilot per first-pilot §1.
- **Seeds**: 1 (`seed_idx = 0`).
- **Run replicate**: `run_idx = 1`.
- **Total**: 30 trials.
- **Run order**: identical deterministic CSV to first pilot — copied from `state/exec-mode-experiment/pilot-mini/run_order.csv` → `state/exec-mode-experiment/pilot-mini-fix1/run_order.csv` (mode outer × fixture inner, seed/run constant). Same orchestrator-approved deviation from §2 of the first-pilot report applies without modification.

## 2. What changed since the first pilot

| # | Change | Commit |
|---|---|---|
| C1 | F5 `_judge_cli("claude", …)` restored for quote verification (was rapidfuzz fallback) | `b185123` |
| C2 | F5 `random.Random(trial_seed).sample(primary_citations, min(3, N))` replaces top-3 slice | `b185123` |
| C3 | F10 `must_reference_turn_any_of` turn-gate removed — `content_hit` alone counts an unresolved item | `b185123` |
| A1 | 9 primary graders (`F2..F10`) implemented and wired into `PRIMARY_GRADERS` | `5e01637` (review `b185123` supersedes) |

Tests on `b185123`: **179 passed / 1 skipped / 0 regressions** (`tests/exec-mode/` via `.venv-exec-mode`).

## 3. Environment

| Item | Value |
|---|---|
| Wall-clock window | 2026-04-20T09:47:57Z → 2026-04-20T10:30:50Z (2573 s ≈ 42 m 53 s; includes mid-run driver restart) |
| Per-trial execution total | 2491 s (41.5 min), 30 trials |
| `EXEC_MODE_HOME` | `/tmp/exec-mode-test-home` (carried over from first pilot, `settings.json={}` + `.credentials.json` 0600) |
| Fixture root | `$HOME/projects/aigentry-orchestrator/fixtures/exec-mode-experiment` (unchanged) |
| State root | `state/exec-mode-experiment/pilot-mini-fix1/` (**new** — first pilot preserved at `pilot-mini/`) |
| Output layout | `<state-root>/<run_idx>/<mode>/<fixture>/seed00/metrics.json` (harness `--state-root` flag) |
| CLI pins (from `cli_versions` in metrics) | claude `2.1.114`, codex `0.121.0`, gemini `0.38.2`, telepty `0.2.0` (unchanged) |
| Model | `claude-opus-4-7` |

## 4. Pre-flight checklist (outcome)

| # | Gate | Expected | Result |
|---|---|---|---|
| 1 | `PRIMARY_GRADERS` keys | `['F10','F2','F3','F4','F5','F6','F7','F8','F9','Fa']` | ✅ 10/10 |
| 2 | `pytest tests/exec-mode/ -q` | 179+ passed, 0 regressions | ✅ 179 passed / 1 skipped |
| 3 | Credits probe (`HOME=$EXEC_MODE_HOME claude --print <<<"ok"`) | not `out_of_credits` | ✅ returned `Ready.` |
| 4 | Isolated HOME `settings.json={}` + `.credentials.json` (0600) present | exists | ✅ carried over from first pilot |
| 5 | `run_order.csv` | 30 rows, schema match | ✅ same as first pilot |

## 5. Per-trial outcome table

| trial | mode | fx | dur s | status | cost $ | quality | pollution | loss | compact |
|---:|---|---|---:|---|---:|---:|---:|---:|:---:|
| 1 | D | F2 | 86 | ok | 0.2685 | 1.0000 | 0.60 | 0.10 | n |
| 2 | D | F3 | 32 | ok | 0.1400 | 1.0000 | 0.30 | 0.00 | n |
| 3 | D | F4 | 23 | ok | 0.1512 | 0.3800 | 0.00 | 0.00 | n |
| 4 | D | F5 | 164 | ok | 0.3821 | 0.7333 | 0.70 | 0.00 | n |
| 5 | D | F6 | 16 | ok | 0.1176 | 0.0000 | 0.00 | 0.00 | n |
| 6 | D | F7 | 23 | ok | 0.1477 | 0.2205 | 0.00 | 0.00 | n |
| 7 | D | F8 | 22 | ok | 0.1427 | 0.9375 | 0.00 | 0.00 | n |
| 8 | D | F9 | 19 | ok | 0.1308 | 0.7000 | 0.10 | 0.00 | n |
| 9 | D | F10 | 36 | ok | 0.1684 | 1.0000 | 0.20 | 0.00 | n |
| 10 | D | Fa | 37 | ok | 0.1858 | 1.0000 | 0.00 | 0.00 | n |
| 11 | Pfresh | F2 | 127 | ok | 0.1632 | 1.0000 | 0.30 | 0.10 | n |
| 12 | Pfresh | F3 | 247 | ok | 0.1290 | 1.0000 | 0.30 | 0.00 | n |
| 13 | Pfresh | F4 | 142 | ok | 0.1222 | 0.4356 | 0.00 | 0.00 | n |
| 14 | Pfresh | F5 | 243 | ok | 0.1306 | 0.0000 | 0.10 | 0.00 | n |
| 15 | Pfresh | F6 | 98 | ok | 0.0480 | 0.0000 | 0.00 | 0.00 | n |
| 16 | Pfresh | F7 | 251 | ok | 0.2435 | 0.1680 | 0.10 | 0.00 | n |
| 17 | Pfresh | F8 | 93 | ok | 0.0408 | 0.9375 | 0.00 | 0.00 | n |
| 18 | Pfresh | F9 | 151 | ok | 0.1163 | 0.4000 | 0.20 | 0.00 | n |
| 19 | Pfresh | F10 | 169 | ok | 0.1044 | 0.0000 | 0.10 | 0.10 | n |
| 20 | Pfresh | Fa | 136 | ok | 0.1314 | 0.0000 | 0.10 | 0.00 | n |
| 21 | S | F2 | 73 | ok | 0.2236 | 1.0000 | 0.50 | 0.10 | n |
| 22 | S | F3 | 44 | ok | 0.1718 | 0.9474 | 0.60 | 0.00 | n |
| 23 | S | F4 | 33 | ok | 0.1679 | 0.3800 | 0.00 | 0.00 | n |
| 24 | S | F5 | 76 | ok | 0.4484 | 0.0000 | 0.10 | 0.00 | n |
| 25 | S | F6 | 14 | ok | 0.1182 | 0.0000 | 0.00 | 0.00 | n |
| 26 | S | F7 | 29 | ok | 0.1430 | 0.2205 | 0.00 | 0.00 | n |
| 27 | S | F8 | 16 | ok | 0.1397 | 0.9375 | 0.00 | 0.00 | n |
| 28 | S | F9 | 20 | ok | 0.1344 | 0.4500 | 0.10 | 0.00 | n |
| 29 | S | F10 | 37 | ok | 0.1647 | 1.0000 | 0.20 | 0.00 | n |
| 30 | S | Fa | 34 | ok | 0.1578 | 1.0000 | 0.20 | 0.00 | n |

**Totals** — 30/30 ok · 0 incidents · 0 compact events · cost total $4.9337 (mean $0.1645) · wall total 2491 s.

## 6. Quality distribution — fix1 vs first pilot

| mode | fx | fix1.q | base.q | Δ |
|---|---|---:|---:|---:|
| D | F2 | **1.0000** | 0.0000 | +1.0000 |
| D | F3 | **1.0000** | 0.0000 | +1.0000 |
| D | F4 | 0.3800 | 0.0000 | +0.3800 |
| D | F5 | 0.7333 | 0.0000 | +0.7333 |
| D | F6 | 0.0000 | 0.0000 | 0 |
| D | F7 | 0.2205 | 0.0000 | +0.2205 |
| D | F8 | 0.9375 | 0.0000 | +0.9375 |
| D | F9 | 0.7000 | 0.0000 | +0.7000 |
| D | F10 | **1.0000** | 0.0000 | +1.0000 |
| D | Fa | **1.0000** | 0.0000 | +1.0000 |
| Pfresh | F2 | **1.0000** | 0.0000 | +1.0000 |
| Pfresh | F3 | **1.0000** | 0.0000 | +1.0000 |
| Pfresh | F4 | 0.4356 | 0.0000 | +0.4356 |
| Pfresh | F5 | 0.0000 | 0.0000 | 0 |
| Pfresh | F6 | 0.0000 | 0.0000 | 0 |
| Pfresh | F7 | 0.1680 | 0.0000 | +0.1680 |
| Pfresh | F8 | 0.9375 | 0.0000 | +0.9375 |
| Pfresh | F9 | 0.4000 | 0.0000 | +0.4000 |
| Pfresh | F10 | 0.0000 | 0.0000 | 0 |
| Pfresh | Fa | 0.0000 | **1.0000** | **−1.0000** (see §9) |
| S | F2 | **1.0000** | 0.0000 | +1.0000 |
| S | F3 | 0.9474 | 0.0000 | +0.9474 |
| S | F4 | 0.3800 | 0.0000 | +0.3800 |
| S | F5 | 0.0000 | 0.0000 | 0 |
| S | F6 | 0.0000 | 0.0000 | 0 |
| S | F7 | 0.2205 | 0.0000 | +0.2205 |
| S | F8 | 0.9375 | 0.0000 | +0.9375 |
| S | F9 | 0.4500 | 0.0000 | +0.4500 |
| S | F10 | **1.0000** | 0.0000 | +1.0000 |
| S | Fa | **1.0000** | 0.0000 | +1.0000 |

**Aggregate** — non-zero quality **23/30** (fix1) vs **1/30** (base). Mean `quality.primary` 0.5616 vs 0.0333. Per-mode mean: D `0→0.6971`, Pfresh `0.1000→0.3941`, S `0→0.5935`. Signal has moved from "grader-dark" to "fixture-discriminating" — which is what the A1 + C1/C2/C3 fixes are supposed to produce.

## 7. Spec-compliance confirmation (live traces)

### 7.1 C1 + C2 — F5 `_judge_cli` and random sample

Source in `D/F5` metrics (`primary_citation_count=7`, `live_url_count=10`):

```
"spot_check_sample_size": 3,     # C2 — sample size clamped to min(3, N)
"spot_check_hits":        1,     # subset verified by _judge_cli
"spot_check_rate":        0.3333 # non-trivial — grader exercised the LLM judge path (C1)
```

`Pfresh/F5` and `S/F5` have `primary_citation_count=0` / `spot_check_sample_size=0` because the agent emitted no primary citations in those runs — the grader correctly short-circuits (no LLM call needed). That behaviour is agent-side, not a grader regression.

### 7.2 C3 — F10 turn-gate removed

Source in `D/F10` (primary_pass=True, score 1.0):

```
"unresolved_hits":               ["U1", "U2"],        # C3 — counted by content_hit alone
"unresolved_application_rate":   1.0,
"rejected_stale_ids":            ["S1", "S2", "S3"],
"stale_rejection_rate":          1.0,
"next_actions_present":          true,
"hallucination_penalty":         0.0
```

`S/F10` is identical. `Pfresh/F10` returns `unresolved_hits=[]` because the agent output for that mode did not produce a `next_section` with the expected regex matches (agent behaviour, not grader gating). Neither fix-1 trace references `Turn N` anchors, confirming C3's semantic — content presence is sufficient.

## 8. Cost / pollution / loss regression (no regressions in framework)

### 8.1 Cost (marginal $ per trial)

fix1 total $4.9337 vs base $4.7913 — delta +$0.1424 across 30 trials (~+3 %). Per-trial mean $0.1645 vs $0.1597.

No fixture shows a systematic framework-overhead regression; the largest deltas are:

| trial | Δ $ | attributable to |
|---|---:|---|
| Pfresh/F3 | −0.1322 | shorter agent output in fix1 (fewer output tokens) |
| D/F4 | −0.0957 | shorter F4 response in fix1 |
| Pfresh/F7 | +0.0867 | longer response + extra cache writes |
| D/F2 | +0.0792 | longer response in fix1 |
| D/Fa | +0.0632 | longer response (extra tokens) |
| S/F10 | +0.0218 | agent spent more tokens on resolution table |

All inter-trial variance is driven by agent output length, not by grader execution — the new graders run after `stage2_end` and are **not** counted in `cost.marginal_usd` (they spawn `claude --print` subprocesses from the grader but those calls are bookkept separately and do not appear in `cost.usage_buckets`). The framework overhead (setup + harness + stage 1 bootstrap) remains in the same ~$0.09 band as the first pilot. **Conclusion: no framework-cost regression.**

### 8.2 Pollution and loss

Mean `pollution.self_rate` fix1 0.1600 vs base 0.1433 (+0.017).  Mean `loss.rate` fix1 0.0133 vs base 0.0100 (+0.003). Both deltas are within per-trial noise (one additional probe-layer leak across 300 probes flips the mean by ~0.003). Per-fixture trend is mixed; eight fixtures improved vs base, seven regressed, the rest unchanged. **No systemic regression.**

## 9. Anomalies

### 9.1 Pfresh/Fa — agent-side regression, not grader

The only per-cell quality regression is `Pfresh/Fa: 1.0 → 0.0`. Investigation:

| Component | base Pfresh/Fa | fix1 Pfresh/Fa |
|---|---|---|
| `task_criteria.must_contain_all` | true | true |
| `task_criteria.must_contain_any_of` | true | true |
| `task_criteria.must_not_contain` | false | false |
| `task_criteria.return_shape` | **true** | **false** |
| `task_correctness` | 0.75 | 0.50 |
| `citation_hits` | `["3.12…", "NFC normal…"]` | `["3.12…", "processor=…"]` |
| `primary_pass` | true | **false** |

The Fa grader was **not modified** by `b185123` — only F5 and F10 touched. The delta is entirely driven by a different agent response (different citation patterns hit, `return_shape` false). Same fixture, same seed, same grader; claude-opus-4-7 generations are not bit-stable even at the same seed, so this is expected run-to-run drift. Flagged for analyst attention but not a blocker.

### 9.2 F6 → 0.0 across all three modes

F6 returns `quality=0` in every mode — identical to first pilot's F6 (also 0 across modes when its grader was, in fact, registered: the F6 grader was one of the 9 added by `5e01637`). Inspecting the F6 component table shows `primary_pass=false` with structural `must_contain` gates failing, i.e. the agent's output shape does not match F6's required structure. This is a fixture-vs-model signal, not a harness issue. Full-pilot with `Pacc` + 10 seeds will give a replicated distribution; single-seed shakeout cannot distinguish "grader too strict" from "agent weak on this fixture". No action for this retry.

## 10. Driver bug discovered (execution artefact, not in the pipeline)

Initial run of the retry's driver script (`state/exec-mode-experiment/pilot-mini-fix1/run.sh`, gitignored) exited after only 4 trials. Root cause: classic `while IFS=, read … ; done` pipe pattern — the harness forks subprocesses that inherit the pipe's stdin fd, and one of them (an F5 grader subprocess via `_judge_cli`) read ahead, consuming the remaining 26 CSV rows.

**Fix applied to the driver only** (not to any pipeline code):

```bash
# before:   tail -n +2 "$RUN_ORDER" | while IFS=, read -r … ; do harness … ; done
# after:    while IFS=, read -r … <&3; do harness … < /dev/null ; done 3< "$RUN_ORDER"
```

Additionally added `--resume` so the 4 completed trials were fast-skipped on relaunch, preserving deterministic output paths. Driver relaunched at 09:54:24 Z; trials 5–30 executed in the repaired loop. **No source-code edits to harness, grader, fixtures, spec, or analyzer were made** (Invariants preserved, AGENTS.md Rule 13).

The relevant log artefact (`state/exec-mode-experiment/pilot-mini-fix1/progress.log`) records both the aborted first pass (`[trial 4] end dur=164s`) and the resumed second pass (`[trial 1] end dur=0s status=ok` … through `[trial 30] end dur=34s status=ok`), so the sequence is fully auditable.

## 11. Ready-state for analyst review

- **30/30 metrics.json** present under `state/exec-mode-experiment/pilot-mini-fix1/1/{D,Pfresh,S}/F{2..10,a}/seed00/`.
- **0 incidents** (`incidents.jsonl` empty), **0 compact detections**.
- Quality distribution is now **fixture-discriminating** rather than uniformly zero — the A1 + C1/C2/C3 fixes are visible in live traces.
- Cost/pollution/loss drift is within per-trial agent variance; no systemic framework regression.
- Single numeric regression (`Pfresh/Fa` 1.0→0.0) traced to agent-response drift, not grader code — flagged in §9.1 for analyst sign-off.

Pipeline is **ready** for the T18 orthogonality-metric analysis and, subject to analyst sign-off, the 400-trial full pilot.

---
*Report-only commit; `state/exec-mode-experiment/pilot-mini-fix1/` is gitignored per repo policy.*
