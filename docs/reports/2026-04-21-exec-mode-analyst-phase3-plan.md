# Exec-Mode Phase 3 Analyst — Plan (SPEC FIRST)

**Author**: `E-exec-mode-analyst-phase3` session
**Date**: 2026-04-21
**Status**: AWAITING ORCHESTRATOR APPROVAL
**Final report target**: `docs/reports/2026-04-21-exec-mode-analyst-phase3.md`
**Brief**: `~/.telepty/shared/ad1c8f146052137297f1ccd8f60a1472fd657c8c7ba13d23e1514d55eac66b83.md`
**Predecessor**: `docs/reports/2026-04-20-exec-mode-analyst-phase2.md` (commit `9a5d049`) — Phase 2 v0 do-not-lock draft (N=30, 3 modes, cell CI degenerate)

---

## 1. Pre-flight receipts (Step 1 done)

### 1.1 Archive SHA-256 verification — ✅ MATCH

| Expected (brief) | Observed (shasum -a 256) |
|---|---|
| `e7390a4...` | `e7390a411399b6e77dceb31bb8af3f607c683858535e8fbcc314069049b93a19` |

Archive: `docs/data/raw/2026-04-21-full-pilot-fix2.tar.gz` — integrity confirmed.

### 1.2 Dataset completeness audit — ✅ 399/400 as expected, no new gaps

Filesystem scan of `state/exec-mode-experiment/full-pilot-fix2/1/`:

| mode | metrics.json count | expected | status |
|---|---:|---:|---|
| D      | 100 | 100 | ✅ complete |
| Pfresh | 100 | 100 | ✅ complete (F9/seed06 retry landed — confirmed `seed06/metrics.json` present) |
| Pacc   | 99  | 100 | ✅ matches — single missing cell `sess=5/pos=6/F9/seed=5` (720s perl-alarm timeout, Pacc runner report §5.4) |
| S      | 100 | 100 | ✅ complete (5 `out_of_extra_usage` tail retries all recovered, S runner report §A1) |
| **Total** | **399** | **400** | **✅ matches brief** |

No filesystem gaps beyond the two known incidents documented in runner reports.

### 1.3 Inputs read

| # | Source | Path | Role |
|---|---|---|---|
| 1 | Mission brief | `~/.telepty/shared/ad1c8f…md` | 13-section skeleton + hard constraints |
| 2 | Pre-registered analysis plan | `aigentry-orchestrator/docs/superpowers/analysis-plan/2026-04-20-exec-mode-analysis.md` | Bootstrap CI methodology (§2.1), decision-tree algorithm (§3), holdout formula (§4) |
| 3 | Locked spec v3-max.1 | `aigentry-orchestrator/docs/superpowers/specs/2026-04-20-execution-mode-comparison-experiment-design.md` | Mode/fixture/metric definitions, §4.3 seeds policy, §4.4 Pacc position semantics, §5.6 reporting template |
| 4 | Phase 2 analyst report | `docs/reports/2026-04-20-exec-mode-analyst-phase2.md` | v0 do-not-lock tree, H1-H8 triage baseline, Pfresh/Fa RCA |
| 5 | F6 RCA (integrated) | `docs/reports/2026-04-20-exec-mode-f6-rca.md` | H5 verdict = grader-side regex bug; R1/R2 fix specified |
| 6 | Per-mode runner reports | `docs/reports/2026-04-20-exec-mode-fullpilot-{D,S,Pfresh,Pacc}.md` (commits 3dec3d0, ce0882f, 19b5aec, 6254eb6) | Per-mode N, anomalies, cross-check vs mini |
| 7 | Grader review | `aigentry-orchestrator/docs/reviews/2026-04-20-claude-graders-primaries-review.md` | H1-H8, M1-M8 triage source |
| 8 | Analyzer | `bin/exec-mode-analyze.py` | `helm_table()` + `bootstrap_ci()` + heatmap pipeline. Supports 4 modes incl. Pacc `pollution_chain_rate`, position effect plot. READ-ONLY. |

**Pre-registration tags observed**: `exec-mode-v3-max-preregistered-20260420-fix2` (graders + H-patches, commit b185123+d80fb76), `exec-mode-v3-max-preregistered-20260420-fix3` (Pacc harness chainfix, commit 94729cd).

---

## 2. Constraint envelope (inherited + reaffirmed)

- **Read-only** on `bin/exec-mode-grader.py`, `bin/exec-mode-experiment.sh`, fixtures, spec, analysis plan. Escalate to orchestrator if a grader/harness bug surfaces — do not patch.
- **Bootstrap 95% CI only** (10K resamples, percentile). **No p-values, no hypothesis tests** (spec §6, plan §2, brief HARD constraint).
- **HELM-style orthogonal** — report 4 metrics separately. **No composite scalar** (spec §5.6, brief).
- **Analyzer**: invoke `bin/exec-mode-analyze.py` and reuse `bootstrap_ci()` as an imported function (sys.path, no mod). Do not modify.
- **Evidence citation mandatory** on every claim → spec §, plan §, metrics path, or runner report §.
- **Commit hygiene**: explicit pathspec only (`git add docs/reports/2026-04-21-exec-mode-analyst-phase3.md` + this plan). Never `-A` (brief lesson §: 3× contamination in prior rounds).
- **Rule 10 write domain**: `docs/reports/2026-04-21-exec-mode-analyst-phase3.md` is this session's exclusive write target; plan file + final report only.

---

## 3. Output skeleton (13 sections, brief-mandated order)

| § | Section | Source / method | Key outputs |
|---|---|---|---|
| 1 | Executive summary (1p) | Synthesis after §2-§12; **highlight Pacc decay 0.49→0.00 as THE structural finding** (brief lesson) | lockable-or-not verdict, 3-5 bullet headline findings |
| 2 | Dataset summary | Filesystem scan + per-mode N + missing-trial docs | 399/400 table, cell-N per (fixture, mode), incident recap |
| 3 | HELM orthogonal metric table (4 mode × 10 fixture × 4 metric + 95% CI) | `analyzer.helm_table()` run once → render 4 sub-tables (cost_marginal, quality, pollution_self, loss) + Pacc-only pollution_chain; **cell CI now VALID at N=10** | 4 mode × 10 fixture grids, compact_rate row per mode |
| 4 | Bootstrap CI methodology + assumptions | Quote analyzer `bootstrap_ci()` (lines 107-137), plan §2.1, spec §5.6; document the N=10 per-cell path (vs Phase 2's degenerate N=1); cross-cell seed independence via `_cell_seed(fixture, mode, 42, slot)` | Methodology statement + "what this CI can/cannot tell us" |
| 5 | Per-mode aggregate + 95% CI (N=100 per mode-metric cell) | Import `bootstrap_ci`; for each (mode, metric), aggregate 100 per-trial values (99 for Pacc) | 4-row mode table, tight CIs vs phase 2 wide |
| 6 | Pacc accumulation decay (pos × 4 metrics) | Import `bootstrap_ci`; stratify Pacc N=99 by `position_in_chain` ∈ 1..10 × 4 metrics; N=10 per position cell except pos=6 where N=9 | 10-row × 4-metric CI table; narrative on 0.49 → 0.00 monotone decay + pos=10 rebound hypothesis |
| 7 | **Decision Tree v1 — LOCKABLE** | Apply plan §3 Pareto+10%-margin algorithm over 4 modes with CI lower-bounds informing margin; **add quality-floor amendment** (see §N4 below); **fixture × mode recommendation per cluster**; Rule 4 delegation threshold criteria | v1 mermaid tree + algorithm transcript + explicit thresholds + lockability verdict |
| 8 | F10 universal zero RCA | Cross-mode: Pfresh 0/10, S 1/10, D 5/10, Pacc 1/10 non-zero. Drill `primary_components` across 5 modes; decide fixture-strict vs grader-candidate; if grader-candidate, escalate to orchestrator as H-review candidate and defer lock per brief failed-approach §4 | Verdict: {fixture-strict \| grader-gap \| agent-weak}, H-review recommendation if needed |
| 9 | F5/F10 bimodal cross-mode analysis | D and S both surface F5 & F10 bimodality (zeros + near-ceiling); quantify bimodal ratio per (mode, fixture) and test whether fixture effect dominates mode effect | per-mode zero-share table, interpretation |
| 10 | Anomaly summary | (a) Pacc pos=10 rebound (0.28 vs pos=8 0.00) — check fixture-assignment artifact per Pacc runner report §3; (b) F9 seed=6 Pfresh 3-attempt trial; (c) 2 Pfresh auth refresh pauses | Per-anomaly: category, evidence path, inclusion/exclusion call |
| 11 | **AGENTS.md Rule 4 draft text** | Derive concrete language from §7 decision tree; frame as "when to D/Pfresh/Pacc/S for delegation"; include the quality-floor guard; explicit threshold criteria | Ready-to-paste ADR language (not final ADR — that is architect's deliverable per delegation §P7) |
| 12 | Phase 4 plan (replication + holdout) | Per spec §4.3 (30-seed replication) + §4.5 (≥5 holdout fixtures + 70% accuracy lock gate); sketch calendar + session assignments + acceptance gates | Phase 4 scope, holdout protocol, Rule 4 lock-decision gate |
| 13 | H1-H8 / M1-M8 post-data triage | For each issue from grader review: classify at N=100 (confirmed-critical / confirmed-background / defused / new-risk). H5 is CLOSED-OUT (F6 now 0.95 across D/S — grader fix landed per D/S runner reports). Re-triage H4, H7, H8 against cell-level data. | Updated triage table with phase 3 evidence |

---

## 4. Methodology specifics (pre-committed)

### N1. Pacc N=99 handling

One Pacc cell missing (sess=5/pos=6/F9/seed=5 timeout). Treatment:

- **Per-mode aggregates (§5)**: use N=99 (report exact N in every table).
- **Per-(mode, fixture) cell CI (§3)**: flag `(Pacc, F9)` cell as **N=9** instead of N=10. Bootstrap CI still valid (N=9 ≥ MIN_N=5 per analyzer line 125). Footer note in §3.
- **Per-position CI (§6)**: flag `position=6` row as **N=9** (lost a F9/seed=5 trial at pos=6). All other positions N=10.
- **No re-run proposed** — spec §4.3 locks seeds; a re-run without orchestrator approval is a pre-registration breach. Document gap; do not recommend fresh trial unless orchestrator approves and spec amendment trail exists.

### N2. Cost unit clarification (inherit from phase 2 N4)

Every cost table carries the footer:

> Notional: `cost.marginal_usd` computed from token counts × Anthropic Sonnet 4.6 list pricing (spec §5.1). Subscription-plan users pay **$0 actual**. Metric is for cross-mode comparison only, not budgeting.

### N3. Pacc position-level analysis (unique to Pacc)

- Stratify 99 Pacc trials by `position_in_chain` (analyzer already extracts this field via `_flatten()` line 75).
- Compute mean + bootstrap 95% CI for each (position, metric) cell — **10 positions × 4 metrics** = 40 CIs.
- Overlay with existing `position_effect_plot()` from analyzer (line 309) for visual reference.
- Narrative: quantify pos=1 → pos=8 decay, investigate pos=10 rebound per Pacc runner report §3's hypothesis ("leftover fixture after shuffle") by checking which fixture is assigned to pos=10 per session.

### N4. Quality-floor amendment (v1 decision tree) — the key v0 → v1 change

**Phase 2 v0 artifact** (§5.3 caveat 2): Pfresh's zero-quality cells still "dominated" on cost + pollution + loss (all tiny when quality collapses). The v0 orthogonal Pareto treats this as valid; it is not.

**v1 amendment (pre-committed algorithm)**:

1. Compute per-fixture `quality_mean` for each mode.
2. Define **floor** = `max(0.5, 0.5 × max_quality_in_fixture)` — drop the floor at 0.5 absolute OR 50% of best-in-fixture, whichever higher.
3. Modes below floor are **disqualified** from that fixture's Pareto frontier (regardless of other metrics).
4. Among qualified modes, apply the standard 4-metric Pareto + 10% margin match (plan §3 steps 1-3).
5. Cluster fixtures by qualified-winner set (plan §3 step 4).
6. Justify threshold in §7 methodology: 0.5 = "more than half the task correctly completed" is the minimum bar for a production recommendation; 0.5 × max-in-fixture prevents floor from disqualifying everyone on hard fixtures (e.g., F7 where all modes cluster ~0.23).

This amendment is an **analyst-side algorithm refinement**, not a spec amendment — plan §3 step 3 ("Pareto frontier + 10% margin") does not prohibit a quality-gate pre-filter, and §5 (exploratory) explicitly allows analyst additions as long as they are labeled. Will flag the floor choice as a pre-registered v1 parameter in §7 for architect review.

### N5. Missing-trial audit (done)

Verified via filesystem scan (§1.2):
- Pacc: 1 missing (sess=5/pos=6) — expected.
- Pfresh: F9/seed06 directory has all expected files (metrics.json, stage1.jsonl, stage2_*, etc.) — 3-attempt retry landed cleanly.
- D, S: no gaps.

No additional audits needed. If §3 HELM computation surfaces unexpected NaN cells, drill-down happens in §10 anomaly reporting.

### N6. Pacc `pollution_chain_rate` gap

Per Pacc runner report §"Recommendations" item 1: harness does not populate `pollution_chain_rate` (always `null`). Analyzer `_flatten()` reads `m["pollution"]["chain_rate"]` which will be None → NaN in DataFrame → bootstrap returns `(NaN, NaN, NaN)`.

**Treatment**: Render Pacc pollution_chain column as `—` (em dash) in HELM table with footer: "chain-rate grader branch not wired — Phase 4 prerequisite per Pacc runner report recommendation 1". **Escalation**: add to orchestrator-facing next-actions as a Phase 4 blocker (but not a Phase 3 blocker; the decision tree does not require chain-rate to lock; Pareto on 3 measured metrics + chain flagged as "unmeasured").

### N7. Compact-detection check (spec §8 mandate)

Per spec §8, compacts must be reported per mode (not excluded). Four runner reports all declare 0 compacts. Confirm via `analyzer.compact_rate_table(df)` — expect 0/mode. Add to §3 as a one-row table.

### N8. Jury / Krippendorff α

Per pre-registered plan §2.7 + spec §5.2 Layer 2: deferred. `metrics.jury.json` absent across all 399 cells (consistent with phase 2 §10 next-phase note 6). This is **not a Phase 3 blocker** because primary (Layer 1) is the locked inferential surface. Report α = "deferred (jury batch not wired)" in §13 triage and move it to Phase 4 blockers. Escalation: already on builder's queue; re-flag as Phase 4 gate.

### N9. Decision-tree lockability verdict criteria

Brief requires "decision_tree_v1: locked|draft" in final report. Commit to this decision matrix upfront:

| Condition | Lock verdict |
|---|---|
| F10 RCA §8 concludes **agent-weak** (real fixture signal, not grader gap) | ✅ **LOCK v1** |
| F10 RCA §8 concludes **fixture-strict** (fixture expects something all 4 modes can't deliver) | ⚠️ **LOCK v1 with F10 marked "fixture-bound, re-evaluate post-grader-extension"** |
| F10 RCA §8 concludes **grader-gap** (H-review candidate bug) | ❌ **DRAFT only** — do not lock; defer to post-fix pilot per brief failed-approach §4 |

Locking decision is made inside §7 after §8 RCA completes. Report to orchestrator reflects this contingent outcome.

### N10. Rule 4 draft text scope

Per brief §11: produce concrete AGENTS.md language. Scope:

- Target text: a decision tree + threshold criteria for "when a delegating session SHOULD spawn a new mode=X vs keep in-session".
- Include: the quality-floor guard (N4), cost-vs-quality trade-off thresholds (CI-backed), Pacc accumulation warning (pos ≥ 5 quality drops below 0.5 floor in N=99 dataset).
- **Not**: final ADR — architect session (delegation §P7) owns the ADR synthesis. This report's §11 produces **language ready for architect adoption**, not the locked rule text.

---

## 5. Tools + execution sequence (Step 4, after approval)

### 5.1 Analyzer invocation (one-shot)

```bash
python3 ~/projects/aigentry-devkit/bin/exec-mode-analyze.py \
    --state-dir ~/projects/aigentry-devkit/state/exec-mode-experiment/full-pilot-fix2 \
    --report-dir /tmp/analyst-phase3 \
    --replication-tag full-pilot-fix2 \
    --seed 42
```

Outputs (all read-only consumables):
- `/tmp/analyst-phase3/data.csv` — HELM table CSV (fixture × mode × 4 metrics + CI + n_valid + compact_rate)
- `/tmp/analyst-phase3/heatmaps/{cost_marginal,cost_amort_30,quality,pollution_self,pollution_chain,loss}.png`
- `/tmp/analyst-phase3/position_effect_pacc_F{2..10,a}.png` — 10 Pacc position plots
- `/tmp/analyst-phase3/v3-max-results-full-pilot-fix2.md` — auto-generated markdown summary

### 5.2 Custom aggregations (import-only, read-only)

Python REPL with `sys.path.insert(0, 'bin')` then `from exec_mode_analyze import bootstrap_ci, load_metrics, _cell_seed`:
- Per-mode aggregate (§5): for each mode, 4 × `bootstrap_ci(df[df.mode==m].<metric>)`. N=100 (99 for Pacc).
- Per-position aggregate (§6): for each position ∈ 1..10 and each metric, `bootstrap_ci(pacc[pacc.position_in_chain==p].<metric>)`. N=10 per cell (N=9 at pos=6).
- Quality-floor Pareto (§7): per fixture, disqualify modes where `quality_mean < floor(fixture)`; apply §N4 algorithm.

Seed usage: inherit `_cell_seed(fixture, mode, master=42, slot=k)` for per-cell; use `hash(f"{master}:aggregate:{mode}:{metric}")` for per-mode (slot=10..13) and `hash(f"{master}:pacc-pos:{pos}:{metric}")` for per-position.

### 5.3 Anomaly drill-down (read-only JSON)

For §8 F10 RCA and §10 anomalies:
- Load specific `metrics.json` files via Python `json.load`.
- Inspect `quality.primary_components` per cell; compare against grader review H-table to classify verdict.
- No filesystem writes except to the final report file.

### 5.4 Output writes (explicit pathspec)

- Plan: `docs/reports/2026-04-21-exec-mode-analyst-phase3-plan.md` (this file).
- Final: `docs/reports/2026-04-21-exec-mode-analyst-phase3.md`.
- Commit: `git add docs/reports/2026-04-21-exec-mode-analyst-phase3-plan.md docs/reports/2026-04-21-exec-mode-analyst-phase3.md && git commit -m "docs(exec-mode): T18 analyst phase 3 — HELM + v1 decision tree + Pacc decay + F10 RCA"`.

---

## 6. Phase 2 → Phase 3 methodology delta (summary for approval)

| Dimension | Phase 2 (v0 do-not-lock) | Phase 3 (v1 target) |
|---|---|---|
| N per cell | 1 (degenerate; cell CI = NaN) | **10** (cell CI VALID) |
| Modes | 3 (D, Pfresh, S) | **4** (adds Pacc) |
| Total trials | 30 | **399** (vs 400 planned) |
| Inferential surface | mode-level aggregate (N=10 fixtures) | **cell-level CI + mode-level CI + position-level CI** |
| Decision tree | v0 do-not-lock; Pfresh Pareto artifact flagged | **v1 lockable (pending F10 RCA)** with quality-floor amendment |
| F6 status | grader bug confirmed (H5 manifesting) | **closed-out** (D/S F6 = 0.95 post-fix2 grader patches) |
| Pacc decay | not measurable (deferred) | **primary new finding**: pos=1 0.49 → pos=8 0.00 near-monotone |
| Pollution_chain | not collected | **still not collected** (harness gap — Phase 4 blocker per N6) |
| Jury / Krippendorff | not collected | **still not collected** (Phase 4 blocker per N8) |
| Rule 4 draft | absent | **concrete draft text provided** per brief §11 |

---

## 7. Risks + mitigations

| Risk | Mitigation |
|---|---|
| F10 RCA inconclusive → force LOCK despite grader-gap suspicion | N9 decision matrix: grader-gap → DRAFT only. Escalate H-review to orchestrator. |
| Quality-floor threshold bikeshed (why 0.5?) | Document in §7 methodology + invite architect review. Run sensitivity: alternate floors at 0.4 / 0.6 in §7 appendix. |
| Pacc pos=10 rebound confounds decay narrative | Drill-down in §6: fixture-assignment per-session lookup. If rebound correlates with "easy fixture leftover", down-weight in §7 cluster decision. |
| Pollution_chain absence undercuts Pacc vs others comparison | Explicit scope note: "Pacc's accumulation harm is measured via quality decay (§6) + pollution_self; chain-rate is Phase 4 addendum." |
| git add -A contamination (brief lesson — 3× prior) | Explicit-pathspec verification: run `git status` before + after commit; assert only the two report files staged. |
| Non-determinism in bootstrap (Claude opus 4.7 seed drift) | Bootstrap is deterministic (fixed seed=42 via `_cell_seed`); LLM variance is encapsulated in the data, not the analysis. |
| Cell-level CI still wide on bimodal fixtures (F5, F10) | Report CI as-is; do not collapse bimodal into spurious mean. Flag bimodality in §9 per-mode zero-share. |

---

## 8. SAWP envelope

- **State**: 399/400 metrics loaded + schema verified (analyzer reads them); 4 runner reports absorbed; phase 2 v0 draft + F6 RCA integrated; grader review H1-H8 + M1-M8 absorbed; analyzer confirmed supports 4 modes + position plot.
- **Action**: Execute §5 steps after orchestrator approval.
- **Why**: Upgrade Phase 2 v0 do-not-lock draft into a lockable v1 decision tree; quantify Pacc accumulation decay; produce Rule 4 draft language for architect.
- **Plan**: This document. Awaiting GO.

---

## 9. Sections delivered in this plan

- Pre-flight receipts (§1): SHA ✅ MATCH, dataset audit 399/400 ✅ confirmed, 8 inputs read.
- Constraint envelope (§2): 6 hard constraints reaffirmed from brief.
- Output skeleton (§3): 13 sections mapped to brief skeleton verbatim with source/method per section.
- Methodology (§4): 10 pre-committed specifics (N1-N10) covering Pacc N=99 handling, cost footer, position-level analysis, quality-floor amendment, missing-trial audit, chain-rate gap, compact check, jury deferral, lockability matrix, Rule 4 scope.
- Tools + execution (§5): one-shot analyzer invocation, import-only aggregations, anomaly drill-down protocol, explicit-pathspec commits.
- Phase 2→3 delta (§6): methodology table for orchestrator review.
- Risks + mitigations (§7): 7 risks with mitigations.
- SAWP (§8): state/action/why/plan.

**Plan ready. 13 target sections. Evidence pointers: 8 inputs + 399 metrics paths + analyzer invocation sketched. Awaiting orchestrator approval before Step 4.**
