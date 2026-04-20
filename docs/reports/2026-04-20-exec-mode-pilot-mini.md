# Exec-Mode Phase 2 Mini-Pilot — T18 Report

**Date**: 2026-04-20
**Role**: Builder/Runner session `E-exec-mode-runner` (execution only per AGENTS.md Rule 13)
**Build spec ref**: `aigentry-orchestrator/docs/superpowers/plans/2026-04-20-exec-mode-harness-buildplan.md` §9 T18
**Experiment spec lock**: tag `exec-mode-v3-max-preregistered-20260420` (commit `25bd0a9`)
**Harness commit**: `4f1dcc8` (live-path T10 wiring)
**Scope**: verification-only pipeline shakeout before 400-trial full pilot. **Not** part of the locked pre-registered dataset.

## 1. Design

Per build spec §9 T18:

- **Fixtures**: 10 — `F2, F3, F4, F5, F6, F7, F8, F9, F10, Fa`
- **Modes**: 3 first modes — `D` (Direct), `Pfresh` (Pre-loaded fresh), `S` (Stream)
- **Seeds**: 1 (seed_idx = 0) — verification coverage only
- **Run replicate**: run_idx = 1
- **Total**: 30 trials
- **Excluded**: P-accumulated (deferred to full pilot due to Z-design complexity)

## 2. Run-order deviation (pre-registered + orchestrator-approved)

```
Intended (pre-run checklist step 5):
  python3.14 bin/exec-mode-generate-order.py --mode-subset D,Pfresh,S --seeds 1 --output state/.../run_order.csv

Actual CLI supports:
  python3.14 bin/exec-mode-generate-order.py --output-dir DIR   (generates full 300-row pre-registered orders)

Gap: --mode-subset / --seeds flags do not exist; generator only produces the four locked full-pilot
     CSVs (run_order_D/Pfresh/Pacc/S.csv, 300 rows each, seed=42).

Decision (orchestrator GO 2026-04-20):
  Construct 30-row mini-pilot CSV deterministically in-driver (runtime artifact, not a source edit).

Schema:
  trial_idx,mode,fixture,seed_idx,run_idx
  Order: mode outer × fixture inner; fixtures sorted [F2..F10, Fa]; seed_idx=0, run_idx=1 constant.
  RNG: N/A (deterministic enumeration — this is pipeline shakeout, not randomized sampling).

Invariants preserved:
  - No source edits (harness, grader, generator, fixtures, analyzer).
  - Pre-registered spec & fixtures unchanged at tag exec-mode-v3-max-preregistered-20260420.
  - Full-pilot run_orders continue to use bin/exec-mode-generate-order.py canonical output.

Artifact: state/exec-mode-experiment/pilot-mini/run_order.csv
```

## 3. Environment

| Item | Value |
|---|---|
| Wall-clock window | 2026-04-20T08:14:22Z → 2026-04-20T08:57:27Z (2765 s ≈ 46 m 5 s) |
| `EXEC_MODE_HOME` | `/tmp/exec-mode-test-home` (isolated HOME, `settings.json={}` + `.credentials.json` 0600) |
| Fixture root | `$HOME/projects/aigentry-orchestrator/fixtures/exec-mode-experiment` |
| State root | `state/exec-mode-experiment/pilot-mini/` |
| Output layout | `<state-root>/<run_idx>/<mode>/<fixture>/seed00/metrics.json` |
| CLI pins (per `cli_versions` in metrics) | claude `2.1.114`, codex `0.121.0`, gemini `0.38.2`, telepty `0.2.0` |
| Model | `claude-opus-4-7` |
| Fixture lint | `pytest tests/exec-mode/test_fixture_lint.py` → **11/11 passed** (pre-flight) |

## 4. Pre-flight checklist (outcome)

| # | Gate | Result |
|---|---|---|
| 1 | Fixture lint 11/11 | ✅ |
| 2 | Harness commit = `4f1dcc8` | ✅ |
| 3 | Isolated HOME `settings.json={}` + credentials present | ✅ |
| 4 | Quota probe (`HOME=$EXEC_MODE_HOME claude --print <<<"ok"`) | ✅ returned `Acknowledged. Ready for your next instruction.` |
| 5 | Run order generator CLI match | ⚠️ gap — see §2 deviation (orchestrator-approved) |

## 5. Per-trial outcome table

| trial | mode | fixture | dur s | status | cost $ | tok_in | tok_out | cache_r | cache_w | quality | pollution | loss | compact |
|---:|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | D | F2 | 65 | ok | 0.1893 | 5 | 0 | 16 194 | 15 571 | 0.000 | 0.80 | 0.10 | n |
| 2 | D | F3 | 31 | ok | 0.1341 | 5 | 1 | 16 194 | 15 540 | 0.000 | 0.40 | 0.00 | n |
| 3 | D | F4 | 57 | ok | 0.2469 | 7 | 78 | 82 344 | 18 422 | 0.000 | 0.00 | 0.00 | n |
| 4 | D | F5 | 84 | ok | 0.4500 | 13 | 120 | 102 632 | 36 835 | 0.000 | 0.00 | 0.00 | n |
| 5 | D | F6 | 18 | ok | 0.1107 | 5 | 1 | 16 194 | 15 649 | 0.000 | 0.00 | 0.00 | n |
| 6 | D | F7 | 26 | ok | 0.1315 | 5 | 8 | 16 194 | 16 354 | 0.000 | 0.00 | 0.00 | n |
| 7 | D | F8 | 21 | ok | 0.1316 | 5 | 1 | 16 194 | 16 586 | 0.000 | 0.00 | 0.00 | n |
| 8 | D | F9 | 20 | ok | 0.1247 | 5 | 1 | 16 194 | 16 027 | 0.000 | 0.20 | 0.00 | n |
| 9 | D | F10 | 31 | ok | 0.1427 | 5 | 8 | 16 194 | 15 552 | 0.000 | 0.10 | 0.00 | n |
| 10 | D | Fa | 20 | ok | 0.1227 | 5 | 8 | 16 194 | 15 824 | 0.000 | 0.00 | 0.00 | n |
| 11 | Pfresh | F2 | 190 | ok | 0.1812 | 5 | 8 | 37 004 | 572 | 0.000 | 0.20 | 0.10 | n |
| 12 | Pfresh | F3 | 290 | ok | 0.2612 | 5 | 8 | 16 194 | 30 584 | 0.000 | 0.20 | 0.00 | n |
| 13 | Pfresh | F4 | 128 | ok | 0.0955 | 5 | 8 | 36 208 | 849 | 0.000 | 0.00 | 0.00 | n |
| 14 | Pfresh | F5 | 289 | ok | 0.1143 | 5 | 8 | 42 245 | 3 536 | 0.000 | 0.10 | 0.00 | n |
| 15 | Pfresh | F6 | 102 | ok | 0.0538 | 5 | 8 | 34 622 | 744 | 0.000 | 0.00 | 0.00 | n |
| 16 | Pfresh | F7 | 240 | ok | 0.1568 | 5 | 8 | 42 907 | 1 170 | 0.000 | 0.20 | 0.00 | n |
| 17 | Pfresh | F8 | 199 | ok | 0.0536 | 5 | 8 | 45 310 | 711 | 0.000 | 0.00 | 0.00 | n |
| 18 | Pfresh | F9 | 214 | ok | 0.1077 | 5 | 8 | 41 567 | 2 270 | 0.000 | 0.10 | 0.00 | n |
| 19 | Pfresh | F10 | 227 | ok | 0.1203 | 6 | 9 | 135 628 | 2 504 | 0.000 | 0.00 | 0.00 | n |
| 20 | Pfresh | Fa | 122 | ok | 0.0843 | 5 | 8 | 36 928 | 675 | **1.000** | 0.00 | 0.00 | n |
| 21 | S | F2 | 66 | ok | 0.2115 | 5 | 8 | 16 194 | 16 531 | 0.000 | 0.80 | 0.10 | n |
| 22 | S | F3 | 41 | ok | 0.1565 | 5 | 8 | 16 194 | 16 500 | 0.000 | 0.30 | 0.00 | n |
| 23 | S | F4 | 38 | ok | 0.1661 | 5 | 8 | 16 194 | 16 826 | 0.000 | 0.00 | 0.00 | n |
| 24 | S | F5 | 92 | ok | 0.4288 | 12 | 74 | 68 606 | 38 197 | 0.000 | 0.00 | 0.00 | n |
| 25 | S | F6 | 15 | ok | 0.1166 | 5 | 1 | 16 194 | 16 524 | 0.000 | 0.00 | 0.00 | n |
| 26 | S | F7 | 46 | ok | 0.1598 | 5 | 8 | 16 194 | 17 229 | 0.000 | 0.00 | 0.00 | n |
| 27 | S | F8 | 19 | ok | 0.1371 | 5 | 1 | 16 194 | 17 461 | 0.000 | 0.00 | 0.00 | n |
| 28 | S | F9 | 22 | ok | 0.1306 | 5 | 1 | 16 194 | 16 902 | 0.000 | 0.10 | 0.00 | n |
| 29 | S | F10 | 30 | ok | 0.1428 | 5 | 8 | 16 194 | 16 427 | 0.000 | 0.80 | 0.00 | n |
| 30 | S | Fa | 21 | ok | 0.1286 | 5 | 8 | 16 194 | 16 699 | 0.000 | 0.00 | 0.00 | n |

## 6. Aggregate per-mode (HELM-style orthogonal — no collapsed scalar)

| mode | n | cost $ sum | tok_in | tok_out | cache_r | cache_w | quality mean | quality range | pollution mean | loss mean | compact rate | wall s |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| D | 10 | 1.7841 | 60 | 226 | 314 528 | 182 360 | 0.000 | 0.000–0.000 | 0.150 | 0.010 | 0.00 | 373 |
| Pfresh | 10 | 1.2288 | 51 | 81 | 468 613 | 43 615 | 0.100 | 0.000–1.000 | 0.080 | 0.010 | 0.00 | 2 001 |
| S | 10 | 1.7785 | 57 | 125 | 214 352 | 189 296 | 0.000 | 0.000–0.000 | 0.200 | 0.010 | 0.00 | 390 |

### 6.1 Grand totals

| Metric | Value |
|---|---|
| Total trials | 30 |
| Complete trials (status=ok) | 30 |
| Missing metrics | 0 |
| Failed trials (non-retry) | 0 |
| Incidents logged | 0 (`incidents.jsonl` empty) |
| Compact events detected | 0 |
| Cost $ sum (notional) | **$4.7913** |
| Cost $ per-mode share | D 37.2% / Pfresh 25.6% / S 37.1% |
| Wall-clock total | 2 765 s (46 m 5 s) |

## 7. Anomalies observed

Per build spec §5 R-list — **reporting only; no remediation** (builder role).

### A1 — Quality = 0.000 across 29/30 trials (primary anomaly)

29 of 30 trials returned `quality.primary = 0.000`. The single exception is trial 20 (`Pfresh/Fa`, primary=1.000).

**Evidence** (from metrics.json `quality.primary_components`):
- **Fa grader (`score_fa_false_prior`)** is fully wired: returns full component dict (`binary_false_prior_leak`, `citation_hits`, `citation_to_reversal`, `leak_patterns_hit`, `primary_pass`, `task_correctness`, `task_criteria{must_contain_all, must_contain_any_of, must_not_contain, return_shape}`). Scored 1.0 for Pfresh/Fa; 0.0 for D/Fa and S/Fa (both failed on `return_shape: False`).
- **F2–F10 graders** return only `{"primary_score": 0}` — no component breakdown, no task_criteria. Consistent across all 27 F2–F10 trials (3 modes × 9 fixtures).

**Possible interpretation (analyst to determine, not builder):**
Per-fixture graders `score_f2..score_f10` either (a) not yet registered in `bin/exec-mode-grader.py` `PRIMARY_GRADERS` dispatch, (b) return placeholder `{primary_score: 0}` for stage1 outputs that don't match expected shape, or (c) depend on jury/Layer-B/C artifacts computed post-run. Cross-reference: pre-run checklist §3 (lines 66–78) lists all 10 fixture grader functions as required pre-tag.

### A2 — D and S wall-clock identical (~380 s), Pfresh ~5× slower (~2000 s)

D and S per-mode wall-clock ≈ 38 s/trial; Pfresh ≈ 200 s/trial.

**Interpretation** (structural, not anomalous): Pfresh replays warmup transcript via `claude --print --resume <session-id>` before stage1 probes, which does full stage-replay in a single subprocess. Expected per spec §4 / build spec §7 T6. No remediation needed.

### A3 — Pollution rate heterogeneity

Pollution self_rate distribution:
- D: values `[0.8, 0.4, 0.0, 0.0, 0.0, 0.0, 0.0, 0.2, 0.1, 0.0]` → mean 0.15, high variance
- Pfresh: mostly 0.0–0.2 → mean 0.08
- S: values `[0.8, 0.3, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.8, 0.0]` → mean 0.20, bimodal (two trials at 0.8)

**Interpretation (analyst):** F2 in both D and S returned pollution 0.80 — same fixture cross-mode consistency suggests deterministic grader behavior on F2 stage1 output. F10 in S alone showed 0.80 (not in D or Pfresh/F10). Not flagged as harness bug — may reflect real mode differences.

### A4 — Cost outlier: D/F5 ($0.45) and S/F5 ($0.43)

F5 is ~3× the per-trial cost floor (~$0.11–0.15). F5 has Stage 1 with high output_tokens (120 D, 74 S) vs other trials' ~8. **Interpretation (structural):** F5 is Cluster 2 (severity-weighted F1 task) per pre-run checklist §1 table; longer expected response. Not a harness fault.

### A5 — Pfresh/F10 cache_read spike (135 628 tokens vs ~40 K for other Pfresh trials)

Trial 19 (Pfresh/F10) shows cache_read_tokens = 135 628 — ~3× other Pfresh trials. **Interpretation (analyst):** consistent with Pfresh warmup replay — larger setup_history + warmup for F10 causes heavier cache read on probe replay. Not flagged as systemic issue.

### A6 — D/F2 output_tokens = 0

Trial 1 (D/F2) has output_tokens = 0 (vs 1–120 on other D trials). Stage 1 either returned empty or was content-free. **Interpretation:** flagged for analyst review — cannot determine from metrics alone whether this is a legitimate empty-stage1 (model chose not to answer) or a capture gap. The response still scored via grader (`primary_score: 0`, consistent with other F2 trials).

## 8. Deliverables summary (per task spec)

| # | Deliverable | Status |
|---|---|---|
| 1 | 30 metrics.json files under `state/exec-mode-experiment/pilot-mini/` | ✅ `find ... -name metrics.json \| wc -l` → 30 |
| 2 | Pilot summary report (this file) | ✅ `docs/reports/2026-04-20-exec-mode-pilot-mini.md` |
| 3 | Commit (explicit pathspec) | (see §9) |

## 9. Commit plan

```bash
git commit -- \
  state/exec-mode-experiment/pilot-mini/ \
  docs/reports/2026-04-20-exec-mode-pilot-mini.md
```

No `git add -A`. No harness/spec/grader/fixture/analyzer edits (invariants preserved).

## 10. Handoff

Ready for **analyst session** review. Key decisions for analyst (not for builder):

1. Are F2–F10 grader placeholders (`{primary_score: 0}`) expected pre-jury, or is dispatch registry incomplete relative to pre-run checklist §3?
2. Is D/F2 output_tokens=0 a data-capture gap, or genuine model non-response?
3. Does pollution variance pattern (F2 cross-mode=0.80; F10 S-only=0.80) warrant fixture-level inspection before full pilot?

If any of the above require source fixes → route to implementation session; builder does not modify pre-registered artifacts.

---

*Report generated 2026-04-20. Builder role invariants preserved: no edits to spec, harness, grader, fixtures, or analyzer.*
