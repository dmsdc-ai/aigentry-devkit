---
title: "Phase 6 Q1 final analysis cross-LLM review - statistical methodology"
date: 2026-05-03
session: aigentry-reviewer-phase6-q1-codex
status: DONE
review_target: docs/reports/2026-05-03-phase6-q1-final-analysis.md
pre_reg_tag: exec-mode-v6-preregistered-20260502
verdict: ACCEPT_WITH_CONDITIONS
---

# Phase 6 Q1 Codex Review - Statistical Methodology

## Executive verdict

**ACCEPT_WITH_CONDITIONS.** The analyst's binding pooled-trial PROMOTE verdict is reproducible from raw `metrics.json` files under the Phase 6 spec:

| Cell | Binding verdict | Reason |
|---|---|---|
| Q1-A1 | **CONFIRMED** | Δq=+0.2035, Welch p=0.002016, Cohen d=0.646; all three §2.1.1 gates pass at α=0.00714 |
| Q1-A5 | **CONFIRMED** | Δq=+0.2936, Welch p=0.001416, Cohen d=0.659; all three §2.1.1 gates pass at α=0.00714 |

No blocker invalidates the pre-registered verdict. The largest methodology caveat is that pooled-trial significance is **not robust to session-level clustering sensitivity**: session-mean Welch p is 0.0277 for A1 and 0.0234 for A5, above the Bonferroni threshold. Because the spec explicitly binds pooled-trial Welch/Cohen d as primary, this is a **MAJOR confidence caveat**, not a blocker.

Issue counts: **0 BLOCKERS, 4 MAJORS, 3 MINORS**.

---

## §1 Pre-registration adherence audit

**Tag annotation vs analyst report: consistent.** The immutable tag `exec-mode-v6-preregistered-20260502` records Q1 factorial design as 5-pos × cuts {5,10,15,20} plus 10-pos × cut=30, n=50/cell, Q1 superiority family count folded into a 7-comparison Bonferroni family, and H1+H10 fixtures. The analyst report matches those constraints.

**No post-hoc exclusion detected.** Raw data count is 350 `metrics.json`; all have `status="ok"`. The cell counts are exactly 50 each for Q1-A1 through Q1-A5 and Q1-B1/B2. I found no dropped trial, renamed cell, extra arm, or fixture exclusion.

**Per-fixture decomposition is labeled as sensitivity.** Analyst §3 and §8 correctly label H1/H10 stratification as sensitivity, not binding. The binding endpoint remains aggregate `quality.primary` over H1+H10 per spec §3.1.

**One wording concern.** The analyst's recommendation for chain-length-conditional cuts is downstream ADR guidance, not itself a pre-registered decision rule. See §6.

---

## §2 Statistical method validation

**Welch t on `quality.primary`: acceptable because pre-registered, caveated statistically.** `quality.primary` is bounded in [0,1] and has point masses at 0 and 1, so normal-mean asymptotics are imperfect. Still, the endpoint is continuous by spec §2.1/§7.1, n=50/cell, and Welch was binding. I do not reject the method.

**Cohen d: formula verified, interpretation caveated.** Analyst uses pooled sample SD:

`d = (mean(sc) - mean(Pacc)) / sqrt(((n1-1)s1^2 + (n2-1)s2^2)/(n1+n2-2))`

This reproduces A1 d=0.646 and A5 d=0.659. Because the outcome is bounded and trials are nested inside chain sessions/fixtures, Cohen d should be treated as a pre-registered gate statistic, not a generalizable standardized effect.

**Bonferroni family count: analyst uses the correct binding count of 7.** The final report uses α=0.05/7=0.00714. This includes exactly the 5 Q1 substitute-compact-vs-matched-Pacc comparisons plus 2 Q2 superiority comparisons (D-vs-PC, D-vs-S), matching spec §7.5. It does **not** require all sc-vs-all-Pacc cross-chain comparisons; those were not pre-registered.

**Bootstrap CI: B=20000 confirmed.** Analyst appendix states B=20000; my independent rerun used B=20000 and reproduced intervals to rounding tolerance.

**TOST ε=±0.05: appropriate as a binding deprecation margin.** On a [0,1] scale, ±0.05 is a narrow practical-equivalence band and matches spec §2.1.2/§7.3. TOST remains uncorrected at α=0.05 per spec §7.5; that exemption is explicitly pre-registered.

---

## §3 Promotion verdict integrity (Q1-A1 + Q1-A5)

Raw aggregation from the 350 `metrics.json` files:

| Cell | sc mean | Pacc mean | Δq | Welch t | df | p | Cohen d | Bootstrap 95% CI Δq | Gates |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Q1-A1 vs B1 | 0.943216 | 0.739714 | +0.203502 | 3.2279 | 60.46 | 0.002016 | 0.6456 | [+0.0849, +0.3275] | PASS |
| Q1-A5 vs B2 | 0.793580 | 0.500000 | +0.293580 | 3.2926 | 90.71 | 0.001416 | 0.6585 | [+0.1162, +0.4685] | PASS |

**A1 gate check:** Δq≥+0.10 yes; p<0.00714 yes; d≥0.5 yes.

**A5 gate check:** Δq≥+0.10 yes; p<0.00714 yes; d≥0.5 yes.

**CI boundary note.** Both bootstrap CIs are above the null boundary 0. A1's CI lower bound is slightly below the practical-effect threshold +0.10, so the point-estimate gate passes but uncertainty around the +0.10 floor should be stated. A5's CI lower bound remains above +0.10.

**Hierarchical sensitivity.** Re-aggregating by chain session means gives:

| Cell | n session means | Δq | Welch p | Cohen d |
|---|---:|---:|---:|---:|
| Q1-A1 vs B1 | 10 vs 10 | +0.2035 | 0.0277 | 1.151 |
| Q1-A5 vs B2 | 5 vs 5 | +0.2936 | 0.0234 | 2.257 |

This sensitivity does not pass α=0.00714. It does not overturn the binding verdict because §7.2 says the primary decision uses pooled trials, but it materially reduces confidence in claims stated as chain-session-general effects.

---

## §4 H1-only sensitivity rigor

Analyst H1-only computations are correct:

| Cell | H1 sc mean | H1 Pacc mean | Δq | p | d | H1-only verdict |
|---|---:|---:|---:|---:|---:|---|
| Q1-A1 | 0.886432 | 0.489428 | +0.397004 | 0.000562 | 1.086 | PASS |
| Q1-A2 | 0.703084 | 0.489428 | +0.213656 | 0.095964 | 0.481 | NO |
| Q1-A3 | 0.646444 | 0.489428 | +0.157016 | 0.240458 | 0.336 | NO |
| Q1-A4 | 0.642468 | 0.489428 | +0.153040 | 0.251240 | 0.328 | NO |
| Q1-A5 | 0.612160 | 0.000000 | +0.612160 | 0.00000094 | 1.848 | PASS |

The H1-only verdict **agrees** with the aggregate verdict: only A1 and A5 pass. A2 does not pass because p and d both fail despite Δq>+0.10.

**Binding endpoint decision.** The right binding endpoint for Phase 6 Q1 is the aggregate H1+H10 endpoint, because that is what §3.1 pre-registered. H1-only is a useful sensitivity and supports the same A1/A5 calls, but it cannot replace the binding endpoint post hoc.

---

## §5 H10 ceiling impact

H10-only sensitivity reproduces the analyst's conclusion:

| Cell | H10 sc mean | H10 Pacc mean | Δq | p | d | H10-only verdict |
|---|---:|---:|---:|---:|---:|---|
| Q1-A1 | 1.000 | 0.990 | +0.010 | 0.161492 | 0.409 | NO |
| Q1-A2 | 1.000 | 0.990 | +0.010 | 0.161492 | 0.409 | NO |
| Q1-A3 | 0.965 | 0.990 | -0.025 | 0.069241 | -0.528 | NO |
| Q1-A4 | 1.000 | 0.990 | +0.010 | 0.161492 | 0.409 | NO |
| Q1-A5 | 0.975 | 1.000 | -0.025 | 0.021983 | -0.693 | NO |

H10 says no promote for all cells, while H1 says A1+A5 promote. That makes H10 a **critical caveat** for interpretation, not a blocker. The aggregate verdict is binding and happens to agree with H1-only, but the evidence should be described as **H1-driven under an H10 ceiling**. The final ADR should not imply H10 independently supports substitute-compact.

If aggregate and H1-only had diverged, the aggregate would bind for Phase 6 because it was pre-registered. Future phases should replace ceiling-saturated fixtures or pre-register fixture-stratified primary endpoints.

---

## §6 Joint-cell promotion criterion (OQ-P6-2)

Spec §2.1.1 says the mechanism promotes if "there exists at least one" substitute-compact cell satisfying all gates. Therefore A1 and A5 are **independent dual passing cells**, not a joint multi-cell gate.

Spec §12.2 forwards OQ-P6-2 and says the default is "strongest single cell wins." On the analyst's own ranking, A5 is strongest by Δq, H1-only d, and U2. Therefore:

- Binding mechanism disposition: **PROMOTE**, because at least one cell passes.
- Binding default winning cell: **Q1-A5 cut=30 on 10-pos**, unless the architect explicitly chooses a conditional policy.
- Analyst's `5-pos=cut5, 10-pos=cut30` recommendation is reasonable operationally, but it is an ADR design choice beyond the minimum pre-registered fallback.

Implication for the sub-ADR: do not silently "lock two cuts" as if the spec required it. Rev3 must explicitly resolve single-cell vs chain-length-conditional deployment.

---

## §7 Trigger rate × quality interaction

The analyst's eligible-position conditional table is reproducible:

| Cell | eligible fired | mean q fired | eligible not fired | mean q not fired |
|---|---:|---:|---:|---:|
| Q1-A1 | 39 | 0.9364 | 1 | 1.0000 |
| Q1-A2 | 20 | 0.9155 | 20 | 0.7292 |
| Q1-A3 | 10 | 0.9826 | 30 | 0.6934 |
| Q1-A4 | 10 | 0.9596 | 30 | 0.7228 |
| Q1-A5 | 5 | 0.9652 | 40 | 0.7485 |

However, the interpretation "not-fired trials are Pacc-equivalent" is too strong.

For A5, H1 not-fired eligible positions have mean q=0.5034, while matched Pacc-10pos H1 mean is 0.0000. This is not Pacc-equivalent. The likely reason is semantic: `manifest.json` marks a trigger event at a position, but downstream positions after the segment reset may still benefit from the substitute-compact state without a new trigger event. Thus trigger rate is not the same as mechanism exposure rate.

This does not invalidate the quality endpoint; it affects mechanism explanation and cost/trigger narratives. The final ADR should distinguish:

- **trigger event**: a position where `.preuse_inputs/manifest.json` exists;
- **post-trigger exposure**: later positions in the same chain segment after reset;
- **Pacc-equivalent non-exposure**: positions before any trigger.

---

## §8 Promotion vs Pareto (cost)

Cost-side verification matches the analyst:

| Comparison | Mean Pacc cost | Mean sc cost | Δ cost |
|---|---:|---:|---:|
| 5-pos B1 vs avg A1-A4 | $0.1631 | $0.2526 | +$0.0896 (+55%) |
| 10-pos B2 vs A5 | $0.1263 | $0.1473 | +$0.0210 (+17%) |

U2 ranking is reproduced:

| Rank | Cell | q mean | cost mean | U2 |
|---:|---|---:|---:|---:|
| 1 | Q1-A5 | 0.7936 | $0.1473 | +0.4315 |
| 2 | Q1-A1 | 0.9432 | $0.3222 | +0.4000 |
| 3 | Q1-A2 | 0.8515 | $0.2449 | +0.3736 |
| 4 | Q1-A4 | 0.8212 | $0.2207 | +0.3628 |
| 5 | Q1-A3 | 0.8057 | $0.2227 | +0.3352 |
| 6 | Q1-B1 | 0.7397 | $0.1631 | +0.3223 |
| 7 | Q1-B2 | 0.5000 | $0.1263 | +0.0000 |

**Does A5 dominate A1? No.** A5 has lower cost but lower quality. It is U2-preferred and Pareto-frontier-preferred under the chosen utility, but it does not strictly Pareto-dominate A1. A1 remains the highest-quality cell.

---

## §9 BLOCKERS / MAJORS / MINORS

### BLOCKERS

None. I found no pre-reg drift, data exclusion, arithmetic error, or binding-threshold failure that invalidates PROMOTE under the Phase 6 spec.

### MAJORS

**M1 - Pooled-trial significance is not cluster-robust.** Session-level sensitivity does not pass Bonferroni α=0.00714 (A1 p=0.0277; A5 p=0.0234). Binding verdict stands only under the pre-registered pooled-trial analysis.

**M2 - H10 ceiling makes the substantive evidence H1-driven.** H10-only promotes 0/5 cells. This is not a blocker because aggregate is binding and H1-only agrees, but it must constrain claims.

**M3 - OQ-P6-2 not resolved by the data alone.** A1 and A5 are independent passing cells. Single-cell lock defaults to A5; conditional cuts require explicit architect approval.

**M4 - Trigger-rate explanation conflates trigger events with exposure.** A5 not-fired H1 positions are far above Pacc-H1, so "not fired equals Pacc" is not generally true.

### MINORS

**N1 - A1 practical-effect uncertainty.** A1 bootstrap Δq CI lower bound (+0.0849) is below the +0.10 practical floor even though the point-estimate gate passes.

**N2 - H10-only tests with zero/near-zero variance should be framed descriptively.** SciPy warns about precision loss for ceiling-saturated cells; the no-promote conclusion is driven by Δq failing anyway.

**N3 - Preserve the reproducibility script or embed enough raw values.** Analyst appendix references `/tmp/phase6_q1_analysis.py`; `/tmp` is not durable. The final ADR should include tables sufficient for reproduction from `metrics.json`.

---

## §10 Top conditions for sub-ADR

The architect must address these conditions verbatim:

1. **Final ADR MUST state that the binding PROMOTE verdict uses the pre-registered pooled-trial Welch/Cohen-d analysis; session-level sensitivity does not survive α=0.00714 (A1 p=0.0277; A5 p=0.0234) and is a confidence caveat.**
2. **Sub-ADR rev3 MUST resolve OQ-P6-2 explicitly: either lock the strongest single cell `cut=30` for 10-pos (default) or approve chain-length-conditional cuts (`5-pos=cut5`, `10-pos=cut30`) as a policy choice beyond the prereg decision rule.**
3. **Sub-ADR MUST describe Q1 evidence as H1-driven under an H10 ceiling; no claim that H10 demonstrates quality lift.**
4. **Sub-ADR MUST distinguish trigger events from mechanism exposure; non-triggered positions after a segment reset are not necessarily Pacc-equivalent, so trigger-rate × quality claims need rewritten.**
5. **Any Phase 7 or neighboring-cut follow-up MUST pre-register a cluster-aware or session-level primary analysis if claims will generalize beyond the locked Phase 6 pooled-trial endpoint.**

---

## Appendix - independent recomputation snapshot

Raw files checked:

- `state/exec-mode-experiment/phase6-q1/`: 350 `metrics.json`
- Status: 350/350 `ok`
- Cell sizes: 7/7 cells at n=50
- Binding α: 0.05/7 = 0.00714
- Bootstrap: B=20000 percentile resamples, seed 42

Final review verdict: **ACCEPT_WITH_CONDITIONS**.
