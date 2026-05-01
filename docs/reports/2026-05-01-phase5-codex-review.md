# Phase 5 Final Analysis Review — Codex Statistical Methodology

**Reviewer**: `aigentry-reviewer-phase5-codex`
**Date**: 2026-05-01
**Scope**: statistical-methodology review of `docs/reports/2026-05-01-phase5-final-analysis.md` at devkit commit `1e740baf9061e77e2445d6eeb65aa2cd048c9670`
**Inputs audited**: Phase 5 report, Phase 4 final report, Phase 4 U2 Pareto recompute, Phase 5 pre-registration tag, Phase 5 spec, parent ADR, substitute-compact sub-ADR, and 300 raw `metrics.json` files.

## §0 Verdict

**Verdict: ACCEPT_WITH_CONDITIONS.**

The report's headline arithmetic is reproducible from the raw metrics:

| claim | recompute |
|---|---:|
| PC vs S `quality.primary` Δ | -0.000512 |
| PC vs S Welch p / Cohen d | 0.9414 / -0.0147 |
| PC vs S bootstrap CI | [-0.0141, +0.0132] |
| PC vs Pacc Δ | +0.47295 |
| PC vs Pacc Welch p / Cohen d | 5.59e-9 / +1.407 |
| PSC-rev vs Pacc Δ | -0.04270 |
| PSC-rev trigger rate | 0/10 sessions; cumulative input max 25 < cut 30 |

The concerns are not arithmetic errors. They are inference and governance issues: "tie" is being used more strongly than the pre-registered decision rule warrants; the all-pair Bonferroni family was not pre-registered; the spec-required mixed-effects/per-fixture Pareto/outlier follow-ups were not run; and the primary endpoint must be kept distinct from `primary_pass`.

Classification summary:

| class | count |
|---|---:|
| BLOCKER | 0 |
| MAJOR | 7 |
| MINOR | 5 |

## §1 Pre-Registration Adherence Audit

### Scope match

The trial scope matches the pre-registration tag:

- 300/300 `metrics.json` files found.
- 6 modes x 5 fixtures x 10 seeds/sessions.
- 50 trials per mode; 60 per fixture; 10 per `(mode, fixture)` cell.
- All `status="ok"`, all `schema_version="1"`, all `compact.detected=false`.
- Fixture set matches H1/H2/H3/H5/H10.
- Mode set matches D/Pacc/Pfresh/S/Preuse-clear/Preuse-substitute-compact-revised.
- PSC cut value matches `cut=30`.

No post-hoc fixture exclusion, mode removal, or raw-metric redefinition was found.

### Deviations and gaps

**MAJOR M1: Spec §6.4 and §6.5 were not executed.** The Phase 5 spec says the analyst runs a mixed-effects model with fixture random intercept and publishes a per-fixture-class Pareto breakdown. The report explicitly leaves mixed-effects modeling as future work and publishes only aggregate Pareto plus PC-S per-fixture decomposition. The spec marks these as informational, not hard gates, so this is not a blocker, but final ADR text must not imply the full Phase 5 spec analysis package was completed.

**MAJOR M2: Bonferroni 15-pair family is post-hoc.** The pre-registration tag and Phase 5 spec predeclare PC-vs-S adjudication, PC/S hold-up, hard grader gate, and orthogonal PSC-vs-Pacc thresholds. They do not predeclare "all 15 mode pairs" as an a-priori family. The 15-pair Bonferroni table is acceptable exploratory support, but it cannot be used as a binding pre-registered claim or as the basis for D reclassification.

**MINOR m1: Carry-over hold threshold is pre-registered, but the report extends its scope.** The `q >= Phase4 q - 0.05` threshold appears in the Phase 5 decision tree for PC/S hold-up vs degrade. Applying it descriptively to all five carry-over modes is reasonable, but it is broader than the binding quadrant rule.

**MINOR m2: The pre-reg tag says cut=30 should fire around positions 3-4 in the 5-position layout; this was mechanically false under observed `input_tokens=5` per position.** This is an experimental design miss, not a post-hoc report deviation.

## §2 Statistical Method Validation

### Welch's t-test

Welch's t-test is acceptable as a simple test on `quality.primary` only if the endpoint is treated as a bounded continuous/ordinal score and fixtures are treated as fixed. It is not ideal:

- Scores are bounded [0, 1], heavily ceilinged for D/S/PC, and bimodal for Pacc/Pfresh/PSC.
- Trials are nested in fixtures and sessions, so trial-level Welch treats correlated/stratified observations as IID.
- Several per-fixture comparisons have zero variance; reported p=1.000 for identical constants is descriptive, not a real Welch test.

**MAJOR M3: The report should state that trial-level Welch is the pre-specified operational test, not the full inferential model.** A hierarchy-aware sensitivity is needed before broad "generalizes across domains" language. Fixture-level sensitivity is materially weaker for PC-Pacc: the five fixture-level deltas are +0.755, +0.038, +0.970, +0.602, +0.000; a one-sample t-test over fixture means gives p=0.0719, though a simple fixture-cluster bootstrap CI remains positive at approximately [+0.135, +0.811].

### Binary `primary_pass`

The report mostly analyzes `quality.primary`, not binary `primary_pass`. If ADR language switches to "pass rate" or "grader accuracy", binary methods should be used.

Binary recompute:

| comparison | pass counts | risk diff | Cohen h | odds ratio, Haldane CI | Fisher p |
|---|---:|---:|---:|---:|---:|
| PC vs S | 49/50 vs 50/50 | -0.020 | -0.284 | 0.33 [0.013, 8.22] | 1.000 |
| PC vs Pacc | 49/50 vs 22/50 | +0.540 | +1.407 | 41.8 [7.52, 232.47] | 7.26e-10 |
| PSC vs Pacc | 19/50 vs 22/50 | -0.060 | -0.122 | 0.78 [0.36, 1.73] | 0.685 |

**MAJOR M4: Keep the endpoint consistent.** Cohen d is defensible for `quality.primary`; Cohen h / risk difference / odds ratio are more appropriate for `primary_pass`.

### Bootstrap B-count

B=10,000 to 20,000 is sufficient for ordinary percentile CIs at this scale. The limitation is not B-count. It is the resampling unit: trial-level bootstrap ignores fixture/session structure. A fixture-cluster bootstrap is more aligned with the holdout-generalization question.

### Multiple testing

Bonferroni at alpha=0.0033 is conservative and reasonable for a post-hoc all-pairs table. Holm would be uniformly more powerful for family-wise error; BH/FDR is less appropriate for ADR gating. For final ADR purposes, the correct family is narrower: PC-vs-S, PC-vs-Pacc, and PSC-vs-Pacc were the predeclared decision comparisons.

### Power

The report's "tie is real; not a power artifact" sentence is too strong.

Approximate n=50/50 two-sided alpha=0.05 power for a `quality.primary` delta of 0.05 depends entirely on variance:

| assumed SD | d for Δ=0.05 | power |
|---:|---:|---:|
| 0.034-0.043 (top-tier observed SD) | 1.16-1.47 | >0.999 |
| 0.326 (Phase 4 PC-like SD) | 0.153 | 0.118 |
| 0.474-0.500 (Pacc/Pfresh/PSC observed SD) | 0.10-0.11 | 0.079-0.082 |

For binary pass-rate deltas, n=50/50 is underpowered for Δ=0.05:

| rates | approximate power |
|---|---:|
| 0.98 vs 0.93 | 0.24 |
| 1.00 vs 0.95 | 0.62 |
| 0.50 vs 0.55 | 0.08 |

**MAJOR M5: N=50/mode is adequate to detect a 0.05 difference only under the observed low-variance ceilinged top-tier score distribution. It is not generally adequate for pass-rate or high-variance mode comparisons.**

## §3 Effect-Size and CI Integrity

The key arithmetic claims have effect sizes and CIs for `quality.primary`: PC-S, PC-Pacc, PSC-Pacc, and per-mode means. Gaps remain:

- The triple-tie claim lacks equivalence margins and pairwise CIs for D-PC and D-S in the main narrative.
- U2 rankings are point-estimate only in Phase 5.
- Carry-over "all modes hold" lacks uncertainty around cross-phase deltas.
- NB3 output-style claim relies mostly on score equality, not an explicit output-style table.

### Tie vs equivalence

**MAJOR M6: "Not separated" is not the same as statistically equivalent.** The pre-registered rule says no Phase 5 winner unless Welch p<0.05 or d>=0.3 and 3/5 fixtures agree in direction. Failing that rule maps to Q2. That is an operational non-separation rule, not an equivalence test.

For PC-S `quality.primary`, a post-hoc TOST would pass for margins of +/-0.02 and +/-0.05, but not +/-0.01:

| equivalence margin | TOST max p |
|---:|---:|
| +/-0.01 | 0.0875 |
| +/-0.02 | 0.0030 |
| +/-0.05 | 8.9e-11 |

Because no equivalence margin was pre-registered, final ADR language should say "PC and S did not separate under the pre-registered Phase 5 rule" rather than "PC and S are equivalent" or "tie is proven."

### Q2 quadrant assignment

Q2 is consistent with the predeclared decision tree if phrased as "PC≈S by non-separation and both hold up." It should not be framed as a proof that PC and S are interchangeable across future domains.

## §4 Substitute-Compact@30 Inference

Raw data confirm:

- 10/10 PSC chain state files have `segment_start_position=1`.
- 50/50 PSC trials have `input_tokens=5`.
- Each 5-position PSC session has cumulative input trajectory `[5, 10, 15, 20, 25]`.
- Cut=30 was never reachable; trigger count is 0/10.

The report is right that PSC quality comparisons are uninterpretable as a mechanism test. The arm was behaviorally Pacc-with-new-label for this dataset.

**MAJOR M7: "Hypothesis B refuted" is imprecise.** The sub-ADR's underlying Hypothesis B was "cuts are too large for the metric; mechanism never fired." Phase 5 confirms that diagnosis again. What Phase 5 refutes is the `cut=30` remedy and the sub-ADR's expected mid-chain fire in this 5-position layout.

Sample-size note: for an ordinary stochastic trigger process, 0/10 would still have a 95% Clopper-Pearson upper bound of 30.8%. Here the deterministic cumulative-token audit is stronger than the binomial sample: max cumulative input was 25, below the threshold.

The recommendation to test cuts `{5, 10, 15, 20}` is mechanically grounded in observed 5-token increments, but it is still a design recommendation. Phase 6 should pre-register trigger endpoint, chain length, cut grid, and whether cut is tied to `input_tokens` or a transcript-volume proxy.

## §5 Triple-Tie PC=S=D Analysis

Recomputed trial-level Welch results:

| pair | Δq | p | d |
|---|---:|---:|---:|
| D - S | -0.003488 | 0.6572 | -0.089 |
| D - PC | -0.002976 | 0.7012 | -0.077 |
| PC - S | -0.000512 | 0.9414 | -0.015 |

As a descriptive statement, the three top modes are very close on this holdout. As an inferential statement, "triple-tie" inherits the same equivalence problem as PC-S and adds a post-hoc family problem because D reclassification was not the primary Phase 5 decision.

The data do **not** support promoting D to Layer 1 chain co-equal. D is not a chain mode, and the Phase 5 spec's Q2 action is an orchestrator/user decision about Layer 1 chain default or hot-failover. D should remain Layer 2 unless a separate routing ADR chooses otherwise.

## §6 Carry-Over Hold Criterion

The 0.05 threshold exists in the Phase 5 decision tree, but primarily for PC/S hold-up vs degrade. Recomputed deltas match the analyst table:

| mode | Phase 4 q | Phase 5 q | Δ |
|---|---:|---:|---:|
| D | 0.691 | 0.9778 | +0.287 |
| S | 0.737 | 0.9813 | +0.244 |
| Pfresh | 0.547 | 0.5839 | +0.037 |
| Pacc | 0.146 | 0.5079 | +0.362 |
| Preuse-clear | 0.719 | 0.9808 | +0.262 |

All five pass the descriptive `P5 >= P4 - 0.05` check. The large positive shifts, especially Pacc +0.362, support the analyst's caveat that the Phase 5 fixture set is easier or differently calibrated. Cross-phase absolute q comparisons should be treated as calibration-sensitive.

## §7 Sensitivity Analyses

### Leave-one-fixture-out

The report did run PC-S leave-one-fixture-out and I reproduced it. PC-S remains non-separated in all five drops; max absolute Δ is about 0.0031.

### Per-fixture decomposition

PC-S is not driven by one fixture:

| fixture | PC | S | Δ |
|---|---:|---:|---:|
| H1 | 0.9466 | 0.9366 | +0.0099 |
| H10 | 0.9875 | 1.0000 | -0.0125 |
| H2 | 0.9700 | 0.9700 | 0.0000 |
| H3 | 1.0000 | 1.0000 | 0.0000 |
| H5 | 1.0000 | 1.0000 | 0.0000 |

PC-Pacc is fixture-dependent but not driven by a single positive fixture: H1/H2/H3 are large wins, H10 is small, H5 is an exact ceiling tie.

### Outliers and ceiling effects

The report discusses ceiling effects but does not execute the spec §6.6 outlier flag. D-mode q is >0.95 on H2/H3/H5/H10, so those fixtures meet the spec's "difficulty outlier" note threshold. This does not disqualify them, but it should be explicit because ceilinging is central to PC-S non-separation.

### NB3 H5 output style

Score equality supports "no observed H5 score bias." A regex spot-check of H5 stage1 outputs found PC and S both used backticked tool-call formatting in 10/10 H5 outputs, so the core PC-vs-S mode-asymmetry concern is not observed. Across all modes formatting was not perfectly uniform (Pacc 8/10, Pfresh 7/10 backticked tool-call outputs), so the broader "all modes uniform" implication should be softened.

## §8 Blockers Classification

### BLOCKER

None. The arithmetic supports Q2 under the pre-registered operational rule and supports PC over Pacc within the fixed Phase 5 dataset.

### MAJOR

1. **M1**: Spec-required mixed-effects model and per-fixture Pareto analysis were not run.
2. **M2**: 15-pair Bonferroni family was not pre-registered; triple-tie is exploratory.
3. **M3**: Trial-level Welch ignores fixture/session hierarchy; broad generalization language is too strong.
4. **M4**: Endpoint ambiguity: `quality.primary` vs `primary_pass`; binary pass claims need binary methods.
5. **M5**: N=50/mode is not generally powered for Δ=0.05, especially for pass rates or high-variance modes.
6. **M6**: "Tie" is non-separation, not equivalence, unless a margin/TOST is declared.
7. **M7**: Substitute-compact "Hypothesis B refuted" should be rewritten as "cut=30 remedy refuted; no live mechanism test."

### MINOR

1. **m1**: Carry-over threshold applied to all five modes is broader than the binding PC/S quadrant rule.
2. **m2**: Pre-reg expected PSC cut=30 to fire in 5-position chains; raw cumulative tokens show it could not.
3. **m3**: Zero-variance per-fixture Welch p-values should be marked "undefined/identical" rather than p=1.000.
4. **m4**: B=10k bootstrap is adequate, but fixture/session-cluster bootstrap should be preferred for sensitivity.
5. **m5**: H5 NB3 conclusion should say PC/S output-style asymmetry was not observed, not that all modes had identical output style.

## §9 Conditions for Final ADR

C1: Final ADR MUST phrase PC≈S and PC=S=D as "no separation under the pre-registered Phase 5 rule"; it MUST NOT claim statistical equivalence unless it declares an equivalence margin and reports TOST or an equivalent CI criterion.

C2: Final ADR MUST either include the Phase 5 spec §6.4 mixed-effects model, §6.5 per-fixture Pareto breakdown, and §6.6 difficulty-outlier flags, or explicitly waive them as non-gating informational analyses with rationale.

C3: Final ADR MUST treat the 15-pair Bonferroni table and PC=S=D triple-tie as exploratory post-hoc support; binding decisions should rely only on the pre-registered PC-vs-S, PC-vs-Pacc, and PSC-vs-Pacc decision comparisons.

C4: Final ADR MUST name the primary endpoint consistently. If using `quality.primary`, Cohen d/Welch may be reported with hierarchy caveats; if using `primary_pass` or "grader accuracy", report risk difference plus Cohen h or odds ratio/Fisher exact results.

C5: Final ADR MUST state that substitute-compact@30 did not receive a live mechanism test because cut=30 was unreachable in the 5-position Phase 5 chains; Phase 6 must pre-register chain length, cut grid, trigger endpoint, and cut metric before drawing mechanism-efficacy conclusions.

## §10 Final Recommendation

Proceed to final ADR only with the five conditions above. The statistically defensible reading is:

- PC and S did not separate on `quality.primary` under the pre-registered Phase 5 rule.
- PC remains strongly better than Pacc on the fixed Phase 5 holdout trials, with large effect size, but hierarchy-aware uncertainty should temper broad domain-generalization wording.
- PSC-rev@30 was a failed design test, not a failed mechanism-efficacy test.
- D is descriptively close to PC/S on this holdout but should not be promoted from Layer 2 based on a post-hoc triple-tie.
