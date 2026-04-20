# Exec-Mode Phase 2 Analyst — Plan (SPEC FIRST)

**Author**: `E-exec-mode-analyst` (re-inject after symlink-bug interruption)
**Date**: 2026-04-20
**Status**: AWAITING ORCHESTRATOR APPROVAL
**Final report target**: `docs/reports/2026-04-20-exec-mode-analyst-phase2.md`
**Parallel session**: `E-exec-mode-f6-rca` owns §9.2 F6 universal-zero RCA — this plan defers F6 deep-dive and references their forthcoming `docs/reports/2026-04-20-exec-mode-f6-rca.md`.

---

## 1. Inputs read (Step 1 receipts)

| # | Source | Path | Role |
|---|---|---|---|
| 1 | Re-inject brief | `~/.telepty/shared/d5d650cc23a2b50af22a6231c39ab63e72d6eba389da8e1f47fa3d0f0aed49b3.md` | Mission spec |
| 2 | Pre-registered analysis plan | `aigentry-orchestrator/docs/superpowers/analysis-plan/2026-04-20-exec-mode-analysis.md` | Bootstrap CI methodology, decision-tree algorithm, holdout formula |
| 3 | Locked spec v3-max.1 | `aigentry-orchestrator/docs/superpowers/specs/2026-04-20-execution-mode-comparison-experiment-design.md` | Mode/fixture/metric definitions, §5.6 reporting template, §7 CI ground rules |
| 4 | Pilot-mini-fix1 retry report | `aigentry-devkit/docs/reports/2026-04-20-exec-mode-pilot-mini-fix1.md` | 30/30 ok, quality 23/30 non-zero, anomalies §9.1/§9.2 raised |
| 5 | Existing analyzer | `aigentry-devkit/bin/exec-mode-analyze.py` | `helm_table()` + `bootstrap_ci()` + heatmap pipeline (read-only, run-only) |
| 6 | Grader review (H1-H8) | `aigentry-orchestrator/docs/reviews/2026-04-20-claude-graders-primaries-review.md` | Issue triage source for §9 H1-H8 impact |
| 7 | All 30 metrics.json | `aigentry-devkit/state/exec-mode-experiment/pilot-mini-fix1/1/{D,Pfresh,S}/F{2..10,a}/seed00/metrics.json` | Raw data — 30/30 verified present, schema_version=1, status=ok |

**Schema field map (verified from D/F2 sample)**: `cost.{marginal_usd, amort_usd.n_{1,10,30}, subagent_cost_usd, warmup_cost_usd}`, `quality.{primary, primary_components.primary_pass, length_capped, human_review_queued}`, `pollution.{self_rate, chain_rate, self_layer_b_pending, chain_leaks_layer_a}`, `loss.{rate, probes[].{layer_a_hit, layer_b_hit, layer_b_ratio, layer_c_pending, recall}}`, `compact.{detected, cache_read_drop_ratio, next_input_spike_ratio}`, `position_in_chain` (null for D/Pfresh/S — Pacc deferred).

---

## 2. Constraint envelope (must obey)

- **Read-only**: no edits to `bin/exec-mode-grader.py`, `bin/exec-mode-experiment.sh`, fixtures, spec, analysis plan. `exec-mode-analyze.py` may be **invoked** but not modified.
- **Bootstrap 95% CI only**: no p-values, no hypothesis tests (spec §6, plan §2).
- **HELM orthogonal reporting**: 4 metrics (cost, quality, pollution, loss) reported separately — no composite scalar (spec §5.6).
- **Min-n rule**: at N=30 (1 seed × 30 cells, but **N=1 per cell**) bootstrap CI is **degenerate** — must surface this loudly. Per analyzer line 125-127, `n < MIN_N_FOR_CI=5` → returns `(mean, NaN, NaN)`. **All cell-level CIs in this dataset will be NaN.** CI semantics shift to per-mode aggregation (N=10 fixtures per mode).
- **Evidence citation mandatory**: every claim cites spec §, plan §, or `metrics.json` path.
- **Commit hygiene**: `git add docs/reports/2026-04-20-exec-mode-analyst-phase2.md` (and plan + this draft) — explicit pathspec only, never `-A`.

---

## 3. Output skeleton (locked sections, mapped to brief §Output)

| § | Section | Source/method | Notes |
|---|---|---|---|
| 1 | Executive Summary (≤1p) | Synthesis after §2-§9 done | last to write |
| 2 | HELM orthogonal metric table | Run `exec-mode-analyze.py --state-dir .../pilot-mini-fix1 --report-dir tmp/analyst-phase2` → import `data.csv` → render 3-mode × 10-fixture grid per metric (cost_marginal, quality, pollution_self, loss); chain omitted (Pacc absent) | 4 sub-tables, NaN CI flagged |
| 3 | Bootstrap CI methodology + assumptions | Quote analyzer `bootstrap_ci()` (percentile, n_resamples=10_000, seed-derived from `_cell_seed`), spec §5.6, plan §2.1; document N=1 per cell → cell CI undefined; define **fallback aggregation** = N=10 fixtures per mode for mode-level CI | Wide-CI caveat seeded here |
| 4 | Per-mode aggregate + 95% CI | Compute mean ± bootstrap 95% CI across 10 fixtures per mode for each of 4 metrics (N=10 per (mode, metric) cell, ≥ MIN_N=5, CI valid) | Use analyzer's `bootstrap_ci()` directly via short Python REPL (no source mod) |
| 5 | Decision tree v0 — explicit thresholds | Apply plan §3 Pareto+10%-margin algorithm to per-fixture argmin/argmax across 3 modes (D, Pfresh, S); fixture-feature clusters per spec §4.2 (Cluster 1/2/3 + Fa); EXPLICITLY mark "v0 draft, single-seed, N=1 per cell, wide CI — do not lock Rule 4 from this" | Acknowledge wide CI prominently |
| 6 | §9.1 RCA — Pfresh/Fa drift (1.0 → 0.0) | Confirm pilot report finding: agent-side citation/return_shape drift, not grader; cite metrics paths for Pfresh/Fa primary_components diff vs base; recommend treating as expected Claude opus 4.7 non-determinism (lessons §) until N≥10 replicates | Reference, not duplicate |
| 7 | §9.2 RCA — F6 universal 0.0 | **Defer to** `E-exec-mode-f6-rca` session findings; placeholder section with reference path; no duplicated investigation | Coordination only |
| 8 | Full-pilot GO/NO-GO recommendation | Decision criteria: (a) C1/C2/C3 spec-compliance live-trace verified (pilot §7), (b) framework no cost regression (pilot §8.1), (c) graders fixture-discriminating (pilot §6 — 23/30 non-zero), (d) only one anomaly (Pfresh/Fa) traced agent-side — **proposed: GO with 30-seed full pilot**, conditioned on F6 RCA outcome | Subject to F6 RCA |
| 9 | H1-H8 impact triage | For each H1-H8 from grader review: classify (blocker / pilot-OK / cleanup) against pilot-mini-fix1 evidence; e.g., H4 (F4 basename hallucinations) → check D/F4 metrics for `hallucinated_nodes` count; H7 (Fa binary score) → already in production, will affect bootstrap distribution shape | Each cited to metrics path + grader-review § |
| 10 | Next-phase recommendations | (a) full-pilot ramp 1 → 10 → 30 seeds with variance gate, (b) Pacc readiness checklist, (c) judge layer (Krippendorff α) deferred — flag for builder, (d) holdout protocol prep | actionable bullets |

---

## 4. Methodology details (pre-committed before execution)

### 4.1 Cell-level CI handling
- N=1 per (mode, fixture) cell → bootstrap CI degenerate. Render mean only with `low_n_warning=true` flag in HELM table.
- **Mode-level aggregation** (N=10 per mode-metric cell): primary inferential surface — bootstrap 95% CI computed via `analyzer.bootstrap_ci()` reused as imported function.

### 4.2 Decision-tree v0 derivation algorithm (faithful to plan §3)
1. Per fixture, identify dominant mode per metric: `argmin(cost_marginal_mean)`, `argmax(quality_mean)`, `argmin(pollution_self_mean)`, `argmin(loss_rate_mean)` over {D, Pfresh, S}.
2. Compute Pareto frontier across 4 metrics per fixture.
3. Margin-match: any mode within 10% of best on ALL 4 metrics joins frontier.
4. Cluster fixtures by winner-set → tree leaves.
5. Map cluster → fixture-feature label (mechanical / research / context-heavy / harmful-carry per spec §4.2 cluster taxonomy).
6. **Output v0 draft only** — mark as "single-seed, do not lock"; full lock requires Pacc + N≥10 seeds + holdout.

### 4.3 Anomaly RCA scope split
| Anomaly | Owner | This report's treatment |
|---|---|---|
| §9.1 Pfresh/Fa 1.0 → 0.0 drift | This session | RCA + agent-side classification + recommendation |
| §9.2 F6 universal 0.0 across modes | `E-exec-mode-f6-rca` parallel | Reference their findings; do not duplicate; cross-link path |

### 4.4 Tools used
- `python3 bin/exec-mode-analyze.py --state-dir state/exec-mode-experiment/pilot-mini-fix1 --report-dir /tmp/analyst-phase2` — generates `data.csv` + heatmaps (read-only invocation per spec, plan §7).
- Python REPL: import `bootstrap_ci`, `helm_table` from `bin/exec-mode-analyze.py` (sys.path tweak, no edit) for mode-level aggregation.
- `jq` / `python -c` over individual `metrics.json` for specific anomaly evidence (Pfresh/Fa primary_components drill-down).

---

## 5. Risks + mitigations specific to this analyst pass

| Risk | Mitigation |
|---|---|
| Treating cell-level CI as valid (it's NaN with N=1) | Explicit §3 caveat + per-table footer; mode-level only for inference |
| Decision tree over-claim on single seed | "v0 draft, do-not-lock" disclaimer in §5; defer Rule 4 lock to post-full-pilot+holdout |
| Duplicating F6 RCA work | Strict reference-only in §9.2; coordination via `inject` if `E-exec-mode-f6-rca` slips |
| Spec drift in citations | Every claim cites spec §, plan §, or `metrics.json` path |
| `git add -A` slip | Explicit pathspecs in commit step; pre-commit verification of staged set |

---

## 6. Execution steps (Step 4, after approval)

1. Run analyzer once: `python3 ~/projects/aigentry-devkit/bin/exec-mode-analyze.py --state-dir ~/projects/aigentry-devkit/state/exec-mode-experiment/pilot-mini-fix1 --report-dir /tmp/analyst-phase2 --replication-tag pilot-mini-fix1` → capture `data.csv` + heatmaps for embedding/reference.
2. Compute mode-level aggregates (N=10 per cell) via Python REPL importing `bootstrap_ci` from analyzer.
3. Drill anomaly evidence: load `Pfresh/Fa/seed00/metrics.json` + `D/Fa/seed00/metrics.json` + `S/Fa/seed00/metrics.json`; extract `primary_components` diff for §9.1.
4. Drill H1-H8 evidence: per issue, check whether pilot-mini-fix1 metrics expose the failure mode (e.g., H4 → `quality.primary_components.hallucinated_nodes` for F4 cells).
5. Build decision-tree v0 per §4.2.
6. Write final report → `docs/reports/2026-04-20-exec-mode-analyst-phase2.md`.
7. Commit: `git add docs/reports/2026-04-20-exec-mode-analyst-phase2-plan.md docs/reports/2026-04-20-exec-mode-analyst-phase2.md && git commit -m "docs(exec-mode): T18 analyst phase 2 — HELM + bootstrap CI + decision tree v0"`.
8. Report final per ⚠️ MANDATORY reports template in brief.

---

## 7. SAWP envelope

- **State**: 30/30 metrics loaded; schema verified; analyzer compatibility confirmed; H1-H8 review absorbed; pilot-mini-fix1 anomalies known.
- **Action**: Execute §6 steps 1-8 after orchestrator approval.
- **Plan**: This document. Awaiting GO from orchestrator (no source-of-truth changes pending).

---

**Plan ready. Sections: 7. Evidence pointers: 7 inputs + 30 metrics paths + spec/plan §-level citations. Awaiting orchestrator approval before Step 4.**
