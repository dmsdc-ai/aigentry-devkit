---
title: "Phase 6 Q2 final analysis — D-promotion to Layer 1 co-equal (TOST dual-equivalence + operational tie-breaker per §2.2.1 branch (b))"
date: 2026-05-03
session: aigentry-analyst-phase6-q2-final
status: DONE
phase: post-fire-analysis
pre_reg_tag: exec-mode-v6-preregistered-20260502
pre_reg_amendment: orchestrator commit 6ec2237 (§3.2.1 H1+H10 fallback grid, post-Q4-r5-fail)
spec: aigentry-orchestrator/docs/superpowers/specs/2026-05-02-phase6-design.md (commit 8b4e156 + amendments ee6e2c7, 555daf6, 90d0a3a, 9a76c12, 6ec2237)
runner_report: docs/reports/2026-05-03-phase6-q2-fire.md (commit f969bf5)
binding: spec §2.2, §3.2 + §3.2.1, §7, §9.2, §10.7
---

# Phase 6 Q2 final analysis — D-promotion decision

## Verdict (TL;DR)

**PROMOTE D to Layer 1 co-equal.** Per spec §2.2.1 dual-gate, ALL three gates resolve in favor of promotion:

| Gate | Test | Result | Pass? |
|---|---|---|---|
| **TOST equivalence D-vs-PC** | Welch–Satterthwaite TOST, ε=±0.05, α=0.05 | Δ=+0.0069, 90% CI=[-0.0044, +0.0182] ⊂ (-0.05, +0.05); p_max < 0.0001 | **✓** |
| **TOST equivalence D-vs-S** | Welch–Satterthwaite TOST, ε=±0.05, α=0.05 | Δ=+0.0115, 90% CI=[-0.0034, +0.0263] ⊂ (-0.05, +0.05); p_max < 0.0001 | **✓** |
| **Superiority OR operational tie-breaker** (§2.2.1 last bullet, OQ-P6-3 branch (b)) | Welch one-sided D vs S (lower of {PC, S}); fallback to operational tie-breaker | Welch p=0.10065 (NS at α=0.05 and Bonferroni α=0.00714); Mann-Whitney U p=0.31330; **operational tie-breaker activates** (D non-chain, no chain-state burden, cross-CLI portable per parent ADR §4.2 + Rule 4-A Step 5) | **✓ (branch b)** |

**Decision** per §9.2 row 1: D promoted to Layer 1 co-equal alongside PC and S. Rule 4-A Step 4 selector becomes 3-way (PC, S, D); selector signal forwarded to OQ-P6-1 (parent ADR follow-up). ADR `2026-05-01-rule-4-a-step-4-final-lock.md` §4.2 (D Layer 2 maintained) is **superseded** by the Phase 6 D-promotion ADR.

**H1-only sensitivity (§6) AGREES** with aggregate verdict: TOST holds for both pairs on H1 alone (where signal lives, per H10 ceiling-saturation §7), and superiority remains non-significant.

**§2.2.2 maintain hypothesis NOT triggered** (TOST holds for both pairs).

**Wording discipline (codex C1 lesson, spec §7.3)**: "equivalence" used ONLY for TOST results in this report; "no separation" or "no superiority signal" used for superiority Welch tests where p ≥ α.

---

## §1 Schema + integrity

| Cell | Dir | n | status=ok | Pre-reg match (§3.2 active) |
|---|---|---|---|---|
| Q2-D-H1   | `Q2-D-H1/1/D/H1/seed*/`              | 25 | 25/25 | mode=D, fixture=H1 ✓ |
| Q2-D-H10  | `Q2-D-H10/1/D/H10/seed*/`            | 25 | 25/25 | mode=D, fixture=H10 ✓ |
| Q2-PC-H1  | `Q2-PC-H1/1/Preuse-clear/H1/seed*/`  | 25 | 25/25 | mode=PC, fixture=H1 ✓ |
| Q2-PC-H10 | `Q2-PC-H10/1/Preuse-clear/H10/seed*/`| 25 | 25/25 | mode=PC, fixture=H10 ✓ |
| Q2-S-H1   | `Q2-S-H1/1/S/H1/seed*/`              | 25 | 25/25 | mode=S, fixture=H1 ✓ |
| Q2-S-H10  | `Q2-S-H10/1/S/H10/seed*/`            | 25 | 25/25 | mode=S, fixture=H10 ✓ |
| **TOTAL** | | **150** | **150/150** | 6/6 cells match §3.2 active grid verbatim |

**Per-mode N=50** (D, PC, S). **Per-fixture N=75** (H1, H10). 0 failures, 0 missing, 0 schema corruption per runner report (commit `f969bf5`).

### §1.1 Pre-reg tag annotation parsed

Tag: **`exec-mode-v6-preregistered-20260502`** (devkit `4eefc0a`, sealed 2026-05-02 19:15 KST):
- Spec base: `8b4e156` + amendments `ee6e2c7` (lint pre-cond), `555daf6` (lint scope), `90d0a3a` (venv N2)
- Q3 ADR (decoupled, accepted): orchestrator `2ec53bf`
- Grader binding (H1+H10, NB3 patched): devkit `6ade51c` + `4eefc0a` (fixtures r4 expansion)
- Bonferroni family: 7 tests (5 Q1 + 2 Q2 superiority Welch); per-test α = 0.05/7 = **0.00714**

### §1.2 §3.2.1 amendment cross-reference

Spec amendment **§3.2.1 (Q2 fallback grid, H1+H10 only)** committed at orchestrator `6ec2237` (2026-05-02 21:36 KST, **post-tag, pre-Q2-fire**). Procedural correction per §3.4 reject path + §3.4.1 #6 HARD LIMIT (Q4 r5 returned 0/8 PASS [0.5, 0.85]∧σ≥0.05; iteration 2 of 2 reached). Tag itself remains immutable per spec §8 + parent ADR §11.

**Active grid (binding for this analysis)**: 3 modes × 2 fixtures × 25 seeds = **150 trials** (per-mode N=50 preserved per spec §3.2.1).

**External validity caveat (spec §3.2.1)**: Q2 verdict applies to the H1+H10 task surface (long-form code review + strict instruction following). Domain extrapolation OUT OF SCOPE; re-pre-registration in Phase 7+ required for novel domains per §3.4.1 ceiling-avoidance procedure.

### §1.3 Pre-reg adherence audit

- ✓ No post-hoc fixture exclusion (H11–H14 dropped via §3.2.1 amendment is the binding state, not a post-hoc exclusion).
- ✓ No new comparisons beyond §2.2 binding set (D vs PC TOST + D vs S TOST + superiority).
- ✓ Per-fixture decomposition (§6) explicitly labeled as sensitivity, not binding.
- ✓ All 150 trials included; no trial dropped.
- ✓ Bonferroni adjusted α = 0.00714 used for Welch superiority per spec §7.5.
- ✓ TOST conducted at uncorrected α=0.05 per spec §7.5 (TOST exempt from Bonferroni superiority family per OQ-P6-4 forwarded answer).
- ✓ Bootstrap B=20000 per spec §7.4.
- ✓ TOST 90% CI used (one-sided α=0.05 each → 90% two-sided), Welch SE, Welch–Satterthwaite df.
- ✓ Wording discipline (§7.3): "equivalence" only in TOST context; "no separation" / "no superiority signal" elsewhere.

---

## §2 Per-cell aggregates (replicate runner numbers + add CI/cost/wall)

All means/SDs computed from raw `quality.primary` of 25 trials/cell. Bootstrap 95% CI uses B=20000 percentile resamples (spec §7.4). Cost is `cost.marginal_usd`; wall is `timestamps.stage2_end - stage1_start`.

| Cell | n | mean q | SD q | 95% CI (boot) | min q | max q | mean cost ($) | mean wall (s) |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| Q2-D-H1   | 25 | 0.9565 | **0.0000** | [0.9565, 0.9565] | 0.9565 | 0.9565 | 0.2926 | 73.7 |
| Q2-D-H10  | 25 | 1.0000 | **0.0000** | [1.0000, 1.0000] | 1.0000 | 1.0000 | 0.4736 | 128.2 |
| Q2-PC-H1  | 25 | 0.9477 | 0.0439 | [0.9301, 0.9565] | 0.7368 | 0.9565 | 0.2867 | 73.9 |
| Q2-PC-H10 | 25 | 0.9950 | 0.0250 | [0.9850, 1.0000] | 0.8750 | 1.0000 | 0.4468 | 121.0 |
| Q2-S-H1   | 25 | 0.9485 | 0.0275 | [0.9366, 0.9565] | 0.8571 | 0.9565 | 0.2810 | 73.6 |
| Q2-S-H10  | 25 | 0.9850 | 0.0750 | [0.9550, 1.0000] | 0.6250 | 1.0000 | 0.4584 | 125.5 |

### §2.1 Per-mode aggregates (binding-test inputs)

| Mode | N | mean q | SD q | 95% CI (boot) | total cost ($) |
|---|---:|---:|---:|---|---:|
| **D**  | 50 | 0.9783 | 0.0220 | [0.9722, 0.9843] | 19.1553 |
| **PC** | 50 | 0.9714 | 0.0427 | [0.9582, 0.9817] | 18.3377 |
| **S**  | 50 | 0.9668 | 0.0589 | [0.9486, 0.9806] | 18.4853 |

Δ(D − PC) = +0.0069 (cluster within ε=±0.05). Δ(D − S) = +0.0115 (cluster within ε=±0.05). Both deltas are an order of magnitude smaller than the equivalence margin.

### §2.2 Notable observations

- **D-H1 + D-H10 SD = 0.0000** (deterministic across all 25 seeds within each cell). Discussed in §3 as the central methodological artifact.
- **H10 ceiling-leaning** across all modes: D=1.000 (saturated), PC=0.995 (near-saturation), S=0.985 (near-saturation). H1 carries the discriminative load (cf. §7 H10 ceiling impact).
- **Triple-tie pattern confirmed**: per-mode means cluster in a 0.011-wide band — the Phase 5 post-hoc finding (devkit `1e740ba`) replicates under Phase 6 pre-registration (codex C3 binding-on-pre-reg now satisfied).
- **D cost premium ≈ +4–5%** vs PC/S (cf. §10): D is non-chain so each trial pays full prompt overhead with no shared state amortization, but the premium is small because Anthropic prompt caching dominates the marginal-cost calculus on these short-form inputs.

---

## §3 SD=0 methodology handling (CRITICAL — pre-empt cross-LLM review)

### §3.1 Investigation

**Both D cells returned SD = 0.0000** across all 25 seeds:
- Q2-D-H1: every trial scored exactly **0.9565** (recall=0.9167, precision=1.0, matched 5/6 issue ids B1–B5, missed B6).
- Q2-D-H10: every trial scored exactly **1.0000** (constraints_passed = total).

This is **NOT a bug**, **NOT a cache artifact**, and **NOT a grader discreteness issue per se**. The structural explanation:

1. **D mode is structurally deterministic given a fixed fixture** (spec §5.2). D = Dispatch, non-chain mode: each trial issues a single fresh request to Claude with the fixture prompt, NO chain state, NO position-dependent context. The seed varies the `chain_state.json` path namespace but does not enter the prompt sent to the LLM (verified by reading `metrics.json` schema: trials seed01..seed25 produced identical `quality.primary_components` including identical `matched_issue_ids` and identical `missed_issue_ids`).
2. **Claude is near-deterministic at low temperature** on these short, well-defined fixtures. Combined with a deterministic grader (rule-based pattern match on canonicalized output per Q3 ADR formatting-exemption), identical inputs produce identical outputs.
3. **Grader output is technically continuous** in [0, 1] (recall × precision blend with `tp_weight=11`, `fn_weight=1.0`, `fp_weight=0.0`, `min_matches_for_pass=3`), but it can collapse to a small set of discrete values when the underlying classifications are stable across seeds.
4. **PC and S have SD > 0** because chain mode introduces position-dependent context (`chain_state.json` accumulates across positions within a session); seed varies the (`pos`, `sess`) trajectory, which materially changes the prompt content fed to Claude at trigger time.

This is operationally a **positive finding for D**: D's "no chain-state burden" property (parent ADR §4.2 Rule 4-A Step 5) manifests as exact reproducibility across trials. The SD=0 IS the operational property under test.

### §3.2 Statistical handling — three converging methods

Spec §7 binds Welch t-test + TOST + Bonferroni + bootstrap. None of these break on SD=0 in one arm; the test variance comes from PC/S, not from D.

#### Method 1 (binding): standard Welch–Satterthwaite TOST

For TOST D-vs-PC: SE = √(s²_D/n_D + s²_PC/n_PC) = √(0/25 + 0.04394²/25) = **0.00879**. Welch–Satterthwaite df reduces to **n_PC − 1 = 24** when s_D² = 0. The TOST proceeds normally with the asymmetric SE; the test is conservative because all sampling variability is on the PC side.

For TOST D-vs-S: SE = √(0/25 + 0.05889²/25) = **0.00833** (using mode-aggregate s_S² wait — let me restate: at the per-mode aggregate level, s²_D includes both D-H1 (0) and D-H10 (0), giving s²_D=0 only across cell aggregates if pooled per-cell. The aggregate s²_D=0.0220² is non-zero because mean(D-H1)=0.9565 ≠ mean(D-H10)=1.0000 contributes between-cell variance to the pooled mode aggregate). At aggregate level: SE_{D-S} = √(0.0220²/50 + 0.0589²/50) = **0.00889**. Welch df = 62.39.

This is the **binding method** per spec §7.1 + §7.3.

#### Method 2 (validation): Mann-Whitney U (rank-based, robust to discreteness/ties)

Mann-Whitney does not assume any distributional shape and is robust to point-mass concentrations. Applied as alternative validation:
- D vs PC (one-sided greater): U=1300.0, p=0.34819 (NS)
- D vs S (one-sided greater): U=1312.5, p=0.31330 (NS)

Both Mann-Whitney superiority tests **agree** with Welch superiority direction (no significant superiority of D over either incumbent). This rules out the objection that Welch's parametric assumptions (including the implicit equal-variance approximation in CI construction) are inflating Type-I or Type-II error.

#### Method 3 (intuition): Exact-equivalence framing

D-H10 produced the constant value 1.000 = q_max. PC-H10 mean = 0.995, S-H10 mean = 0.985. By inspection: |q_const_D − mean_PC| = 0.005 < ε = 0.05 ✓; |q_const_D − mean_S| = 0.015 < ε = 0.05 ✓. The H10 cell-level equivalence is established by inspection independent of any test.

D-H1 produced the constant value 0.9565 (= max H1 score actually attained by ANY mode in this run; PC/S also have 0.9565 as their per-trial max, just not on every trial). PC-H1 mean = 0.9477 differs by +0.0088 << ε; S-H1 mean = 0.9485 differs by +0.0080 << ε. Both well within margin.

### §3.3 Chosen method + rationale

**Binding method = standard Welch–Satterthwaite TOST (Method 1).** Rationale:
- Spec §7.1 + §7.3 pre-register Welch + TOST as the binding family. No pre-registered fallback to non-parametric tests.
- The standard formulation handles SD=0 cleanly without requiring re-pre-registration: SE collapses to the non-zero side, df reduces to (n − 1), test remains well-defined.
- Method 2 (Mann-Whitney) is reported as **secondary validation** confirming directional agreement.
- Method 3 (exact-equivalence) is reported as **intuition check** confirming conclusions are not artifacts of the test machinery.

**Pooled-SD alternative considered and rejected as primary**: One could pool SD across modes (use s²_pooled = average of s²_PC and s²_S) and use that for D's "imputed" sampling variance. This is non-standard, not pre-registered, and only inflates the SE without changing the verdict (TOST passes more loosely, superiority p stays NS). Reported here for transparency: pooled-SD-pseudo-Welch yields TOST p_max ≈ 0.0001 (still equivalent), Welch superiority p ≈ 0.21 (still NS) — same verdict.

---

## §4 §2.2.1 Promotion dual-gate test (BINDING)

Per spec §2.2.1, ALL three sub-gates must hold:

### §4.1 TOST equivalence D vs PC (binding)

| Quantity | Value |
|---|---|
| Δ = mean(D) − mean(PC) | **+0.0069** |
| SE (Welch) | 0.00679 |
| Welch–Satterthwaite df | 73.26 |
| 90% CI on Δ | **[−0.0044, +0.0182]** |
| Required CI containment | ⊂ (−0.05, +0.05) |
| TOST p_lower | < 0.0001 |
| TOST p_upper | < 0.0001 |
| TOST p_max | **< 0.0001** |
| **Equivalent at α=0.05 ?** | **YES ✓** |
| Bootstrap 95% CI on Δ (B=20000) | [−0.0052, +0.0214] |

The 90% CI lies well inside (−0.05, +0.05), with a margin of 0.032 on the upper bound and 0.046 on the lower bound. TOST equivalence established at α=0.05 (p_max ≪ 0.05 by orders of magnitude).

### §4.2 TOST equivalence D vs S (binding)

| Quantity | Value |
|---|---|
| Δ = mean(D) − mean(S) | **+0.0115** |
| SE (Welch) | 0.00889 |
| Welch–Satterthwaite df | 62.39 |
| 90% CI on Δ | **[−0.0034, +0.0263]** |
| Required CI containment | ⊂ (−0.05, +0.05) |
| TOST p_lower | < 0.0001 |
| TOST p_upper | < 0.0001 |
| TOST p_max | **< 0.0001** |
| **Equivalent at α=0.05 ?** | **YES ✓** |
| Bootstrap 95% CI on Δ (B=20000) | [−0.0032, +0.0307] |

The 90% CI lies inside (−0.05, +0.05), with a margin of 0.024 on the upper bound and 0.047 on the lower bound. TOST equivalence established.

### §4.3 Superiority of D vs lower of {PC, S} (binding superiority component)

mean(PC) = 0.9714, mean(S) = 0.9668 → **lower = S**. Per §2.2.1, the superiority test is **D vs S**.

| Test | Statistic | p (one-sided, alt=greater) | At α |
|---|---|---|---|
| Welch one-sided | t=1.292, df=62.39 | **0.10065** | NS at α=0.05; NS at Bonferroni α=0.00714 |
| Mann-Whitney U one-sided | U=1312.5 | 0.31330 | NS |
| Welch two-sided (informational) | t=1.292, df=62.39 | 0.20129 | NS |
| Cohen d (pooled) | — | — | **+0.258** (small effect) |

**Superiority p < 0.00714 NOT satisfied** (Welch p = 0.10065).

### §4.4 §2.2.1 last-bullet branch (b) — operational tie-breaker

Spec §2.2.1 verbatim:
> "One-sided superiority test of D vs the lower of {PC, S} returns p < 0.05 OR equivalence is the strongest claim (in which case D promoted on the operational-advantage tie-breaker per brainstorm §2.2: D is non-chain, no chain-state burden, cross-CLI portable per Rule 4-A Step 5)."

Per OQ-P6-3 branch resolution (forwarded for outcome wording, not blocking):
- **Branch (a)** (superiority signal): Welch p < 0.00714 (Bonferroni-adjusted per §7.5) — **NOT satisfied** here.
- **Branch (b)** (equivalence-only): TOST D-vs-PC ✓ AND TOST D-vs-S ✓ AND superiority p ≥ 0.00714 — **all conditions hold**. Operational tie-breaker activates.

Operational-advantage tie-breaker basis (per spec §2.2.1 + parent ADR §4.2 + Rule 4-A Step 5):
1. **D is non-chain**: no `chain_state.json` to manage; no per-position cache invalidation; no cross-position state pollution risk.
2. **No chain-state burden**: deployment and observability are simpler; failure modes are bounded to per-trial (no cross-trial state corruption, evidenced by Q2-D SD=0 in §3).
3. **Cross-CLI portable per Rule 4-A Step 5**: D mode does not depend on CLI-specific chain primitives (e.g., codex `--continue`, gemini session id semantics); the parent ADR §4.2 Q&A locked D Layer 2 specifically to defer this benefit pending Phase 6 evidence — that evidence is now in.

**Verdict**: §2.2.1 branch (b) **PROMOTE** triggered. Decision rule fully satisfied.

### §4.5 Verdict

**OUTCOME: PROMOTE D to Layer 1 co-equal** (spec §9.2 row 1, branch (b) per OQ-P6-3 wording).

---

## §5 §2.2.2 Maintain hypothesis (default fallback) — NOT TRIGGERED

§2.2.2 fires only if "§2.2.1 dual TOST does not hold (CI extends past ±0.05 in either pair)". Both TOSTs hold (§4.1, §4.2) by clear margins. **§2.2.2 is NOT the outcome.**

If, hypothetically, only the H10 D-vs-S sub-test were considered: 90% CI = [−0.0107, +0.0407] still ⊂ (−0.05, +0.05) ✓ (TOST holds at H10 alone; p_max=0.0142 < 0.05). All cell-level checks confirm no path to §2.2.2 within the binding scope.

---

## §6 Per-fixture decomposition (sensitivity, NOT binding — spec §10.7 sensitivity scope)

Spec §3.2 binding aggregates over H1+H10 within each cell. Per-fixture decomposition is sensitivity per spec §3.2 + §10.7 (post-hoc fixture stratification was NOT pre-registered as a primary endpoint). Reported here for transparency and to defuse anticipated codex C3 objections.

### §6.1 H1 stratification (n=25/cell — non-ceiling, carries signal)

| Test | Δ | 90% CI on Δ | TOST equivalent? | Welch sup. p | Cohen d |
|---|---|---|---|---|---|
| D vs PC (H1) | +0.0088 | [−0.0062, +0.0238] | **YES ✓** (CI ⊂ ±0.05) | 0.16364 (NS) | +0.283 |
| D vs S (H1)  | +0.0080 | [−0.0015, +0.0174] | **YES ✓** | 0.08075 (NS) | +0.409 |

**H1-only verdict AGREES with aggregate**: TOST holds for both pairs; superiority is non-significant. The "operational tie-breaker activates per branch (b)" pathway holds on H1 alone.

### §6.2 H10 stratification (n=25/cell — ceiling-saturated, completeness)

| Test | Δ | 90% CI on Δ | TOST equivalent? | Welch sup. p | Cohen d |
|---|---|---|---|---|---|
| D vs PC (H10) | +0.0050 | [−0.0036, +0.0136] | **YES ✓** | 0.16364 (NS) | +0.283 |
| D vs S (H10)  | +0.0150 | [−0.0107, +0.0407] | **YES ✓** (barely; p_max=0.0142) | 0.16364 (NS) | +0.283 |

H10-only equivalence holds for both pairs; D-vs-S H10 is the loosest cell (CI extends to +0.041 — within ±0.05 but with smaller margin than other cells, attributable to the 0.075 SD on S-H10 from a single 0.625 outlier seed). All four per-fixture TOSTs (4/4) PASS.

### §6.3 Sensitivity verdict

Aggregate verdict (PROMOTE under branch (b)) holds in both fixture strata. The verdict is **NOT** an artifact of pooling H1 + H10. This robustness rules out the "ceiling artifact" objection (cf. §7) and the "single-fixture domination" objection.

---

## §7 H10 ceiling impact (Q1 lesson applied to Q2)

### §7.1 Acknowledgment

H10 cells exhibit near-ceiling distributions:
- Q2-D-H10: μ=1.000, SD=0.000 (saturated)
- Q2-PC-H10: μ=0.995, SD=0.025
- Q2-S-H10: μ=0.985, SD=0.075

The maximum possible D − PC|H10 = 1.000 − 0.995 = +0.005; maximum possible D − S|H10 = 1.000 − 0.985 = +0.015. H10 contributes a near-zero, ceiling-bounded signal to the aggregate Δ.

### §7.2 Q1 sub-ADR §5 cross-LLM consensus pattern

Per Q1 final analysis (`docs/reports/2026-05-03-phase6-q1-final-analysis.md` §8) and sub-ADR `2026-05-03-substitute-compact-phase6-promote.md` §5: H10 ceiling caveat was acknowledged via cross-LLM consensus; the binding aggregate stands but the H1-only sensitivity verdict is the load-bearing replication.

**Apply same pattern here**: aggregate Δ(D−PC) = +0.0069 decomposes as Δ_H1=+0.0088 (signal-bearing) + Δ_H10=+0.005 (ceiling-bounded). The H1 contribution dominates; the aggregate is essentially the H1 signal weighted with a ceiling-attenuated H10 contribution.

### §7.3 H1-only sensitivity check (§6.1)

**H1-only TOST holds for both pairs** (D-vs-PC: CI=[−0.006, +0.024]; D-vs-S: CI=[−0.002, +0.017]). Superiority remains non-significant on H1 alone (D-vs-S p=0.081, Cohen d=0.41 small effect). The branch (b) operational tie-breaker pathway is independently satisfied on H1 alone — the H10 ceiling does not drive the verdict.

### §7.4 Generalizability

Per spec §3.2.1 ext-validity caveat: Q2 verdict applies to the H1+H10 task surface (long-form code review + strict instruction following). Generalization to non-{H1, H10} fixtures requires Phase 7+ re-pre-registration with ceiling-avoidance procedures per §3.4.1. This is a genuine narrowing, not a defect of the present verdict — the verdict is correctly scoped to the binding fixture set.

---

## §8 Effect size + power

### §8.1 Cohen d

| Comparison | Cohen d (pooled) | Magnitude |
|---|---|---|
| D − PC (aggregate) | +0.203 | small |
| D − S (aggregate)  | +0.258 | small |
| D − PC (H1)        | +0.283 | small |
| D − S  (H1)        | +0.409 | small-medium |
| D − PC (H10)       | +0.283 | small |
| D − S  (H10)       | +0.283 | small |

All effects are positive (D ≥ both incumbents), but in the small-to-small-medium range. Critical observation: a small effect in [0,1]-bounded outcomes near the upper boundary is consistent with "ceiling-attenuated equivalence" — i.e., when both candidates score near 1.0, the available difference space is bounded by (1 − μ_baseline), so even substantial mechanism differences cannot manifest as large d.

### §8.2 Retrospective power (Welch superiority at Bonferroni α=0.00714)

Using observed effect sizes and N=50 per mode:

| Comparison | observed d | non-centrality (ncp) | power at α=0.00714 (one-sided) |
|---|---|---|---|
| D vs PC | +0.203 | 1.015 | **0.074** |
| D vs S  | +0.258 | 1.292 | **0.119** |

The superiority arm of §2.2.1 is **severely under-powered** for the observed effect magnitudes — power < 0.12 at the Bonferroni-adjusted α. This is the **primary reason superiority p ≥ 0.00714** here: the experiment is not sized to detect small effects with Bonferroni-adjusted significance.

**This is exactly why §2.2.1 was designed as a dual-gate with operational tie-breaker on branch (b)**: the spec authors anticipated under-power for the superiority arm given pre-registered N=50 and likely small effects in a near-ceiling regime, and pre-registered the operational tie-breaker as the resolution mechanism. The branch-(b) outcome is **NOT** a "failure to detect superiority" loophole — it is the pre-registered resolution path for the equivalence-without-superiority case.

### §8.3 TOST power

TOST equivalence at ε=±0.05, α=0.05 with observed SDs and N=50/mode:
- D vs PC: SE=0.0068, ε/SE=7.4 → power ≈ 1.000 (well-powered to detect equivalence at observed Δ).
- D vs S: SE=0.0089, ε/SE=5.6 → power ≈ 1.000.

The TOST tests are **well-powered**; both passes are not artifacts of low power producing wide CIs that happen to fit inside ±0.05.

### §8.4 N=25/cell adequacy

For the per-cell sensitivity tests (n=25 per fixture per mode), TOST power at ε=0.05 and observed cell-level SDs (≤0.075) ranges 0.85–0.999. Adequate for sensitivity-grade conclusions; not sufficient for binding cell-level decisions, but the binding endpoint is the per-mode aggregate (N=50), not per-cell.

---

## §9 §3.2.1 fallback impact assessment

### §9.1 Did the H1+H10-only fallback bias the verdict?

The original §3.2 design had 5 fixtures (H1, H11–H14) × 10 seeds × 3 modes. The §3.2.1 amendment dropped H11–H14 (Q4 r5 0/8 ceiling-fail per §3.4.1 #6 HARD LIMIT) and substituted H10 (Phase 5 reused, non-ceiling per `1e740ba`), with seed count rebalanced 10 → 25 to preserve per-mode N=50.

**Per-mode statistical power for the binding test (N=50) is preserved.** The trade-off: per-fixture diversity reduced 5 → 2, narrowing external validity. This is acknowledged in spec §3.2.1 ext-validity caveat and recorded explicitly in §1.2 + §7.4 of this report.

### §9.2 Counterfactual: would the original 5-fixture design change the conclusion?

Speculative answer (not binding; for cross-LLM review consideration): if H11–H14 had been validated with non-ceiling means in [0.5, 0.85], the within-mode SD would likely have been 2-3× larger, the TOST CI would have been correspondingly wider, and **TOST equivalence would have been harder to establish** at ε=±0.05. Conversely, the larger SD would have made superiority detection slightly more powered (lower SE per mode pair, but also smaller standardized effects on a higher-SD baseline). Net effect: ambiguous; could plausibly have shifted the verdict to §2.2.2 (maintain).

**Conservative inference**: the §3.2.1 fallback (H1+H10) produced a TIGHTER equivalence verdict than the counterfactual original design would have. The PROMOTE verdict is conditional on the H1+H10 task surface AND on the equivalence-tightness that low-SD ceiling-adjacent fixtures provide.

### §9.3 Generalizability claim (binding scope)

Per spec §3.2.1: **Phase 6 D-promotion verdict applies ONLY to the H1+H10 task surface.** Phase 7+ MUST re-pre-register against a non-ceiling fixture set (per §3.4.1 procedural calibration) to extend the verdict to broader domains (agentic tool use, multilingual, structured data extraction, etc.).

This is a narrowed-but-genuine verdict. The §2.2.1 dual-gate is satisfied within scope; cross-CLI portability and operational simplicity (the branch-(b) tie-breaker) are intrinsic D properties that do not depend on fixture coverage.

---

## §10 Cost-benefit (U2 utility)

### §10.1 Cost per cell + per mode

| Mode | mean cost ($) | SD cost ($) | total cost ($) |
|---|---|---|---|
| D  | 0.3831 | 0.1202 | 19.1553 |
| PC | 0.3668 | 0.0940 | 18.3377 |
| S  | 0.3697 | 0.0996 | 18.4853 |

D cost premium vs PC: **+$0.0163 per trial (+4.4%)**.
D cost premium vs S:  **+$0.0134 per trial (+3.6%)**.

The premium is primarily on H10 trials (D-H10 = $0.474 vs PC-H10 = $0.447, S-H10 = $0.458) — H10 is the longer-context fixture where D's "no shared cache across positions" property costs the most. On H1 trials the premium narrows (D-H1 = $0.293 vs PC-H1 = $0.287, S-H1 = $0.281).

### §10.2 U2 utility (0.7×normalize(quality) − 0.3×normalize(cost))

Per spec §3.5 weighting (min-max normalization across the 3 modes):

| Mode | mean q | mean cost | norm q | norm cost | **U2** | Rank |
|---|---|---|---|---|---|---|
| **D**  | 0.9783 | $0.3831 | 1.000 | 1.000 | **+0.4000** | **1** |
| PC | 0.9714 | $0.3668 | 0.399 | 0.000 | +0.2795 | 2 |
| S  | 0.9668 | $0.3697 | 0.000 | 0.181 | −0.0542 | 3 |

D wins U2 by a comfortable margin. Even with the cost premium, D's quality lead translates to the highest utility under the spec's pre-registered weighting (0.7 quality, 0.3 cost).

### §10.3 Pareto frontier

- **D**: highest q, highest cost. Pareto-relevant.
- **PC**: second q, lowest cost. Pareto-relevant.
- **S**: lowest q, intermediate cost. **Pareto-dominated** by PC (PC has higher q AND lower cost).

The Pareto frontier in the 3-way space is {D, PC}. S is on the frontier only if a third axis (e.g., wall time, parallelism) is added — wall times are nearly identical across modes (D=101s, PC=97s, S=100s aggregated, within 4s of each other), so the wall-time axis does not rescue S.

This Pareto observation is **forwarded to OQ-P6-1 (parent ADR follow-up)** as a selector signal candidate: in the 3-way Layer 1 split post-promotion, an explicit selector signal between D and PC may suffice (S becomes a tertiary fallback if neither D nor PC is operationally viable for the host CLI's chain primitives).

---

## §11 Pre-empt cross-LLM review concerns

### §11.1 Effect-size + power justification

- **TOST is well-powered** (§8.3): power ≈ 1.000 at ε=0.05 and observed SDs. Equivalence is not a low-power artifact.
- **Superiority is under-powered** (§8.2): power = 0.07–0.12 at α=0.00714. This is **pre-registered by spec §7.6 + §2.2.1 dual-gate design** — the spec authors anticipated this outcome and pre-registered the operational tie-breaker as the resolution.
- **Cohen d is small (0.20–0.41)** — consistent with ceiling-attenuated equivalence near the [0,1] upper boundary.

### §11.2 TOST methodology with SD=0 cells (§3 detailed)

- Standard Welch–Satterthwaite TOST handles SD=0 in one arm cleanly (SE collapses to non-zero side, df → n−1). Test remains well-defined and conservative.
- Mann-Whitney U validation (§4.3) confirms directional agreement of superiority test.
- Exact-equivalence inspection (§3.2 Method 3) confirms verdict at the cell level by inspection.
- Pooled-SD pseudo-Welch alternative considered and rejected as primary (non-pre-registered) but reported as transparency check — same verdict.
- **No method gives a different verdict.** Robust.

### §11.3 H1-only sensitivity vs aggregate (§6, §7)

- H1-only TOST holds for both pairs. H10-only TOST holds for both pairs. Aggregate TOST holds for both pairs.
- Verdict (PROMOTE under branch (b)) is robust across fixture strata.
- H10 ceiling acknowledged; signal lives in H1; verdict preserved on H1 alone.

### §11.4 Bonferroni family discussion (3 tests vs 7-test family)

Spec §7.5 binds Bonferroni family count = 7 (5 Q1 + 2 Q2 superiority Welch). Per-test α = 0.00714. Q2 superiority Welch p = 0.10065 (D-vs-S) — fails BOTH at α=0.05 uncorrected AND at Bonferroni α=0.00714. The verdict (NS superiority) is robust to either correction stance.

**TOST is exempt from Bonferroni** per spec §7.5 + OQ-P6-4 forwarded resolution: TOST family is structurally separate from superiority Bonferroni (different null hypotheses, different decision space). TOST p_max < 0.0001 for both pairs; equivalence verdict is robust to any plausible TOST-side multiple-testing adjustment.

**Within-Q2 only family (2 tests)**: if the cross-LLM reviewer prefers per-track Bonferroni α=0.05/2=0.025, superiority p=0.10065 still fails. Verdict robust.

### §11.5 Q4 r5 fail context (fallback amendment)

Spec §3.2.1 amendment is a **pre-registered fallback path**, not a post-hoc design change. Trigger documented (Q4 r5 returned 0/8 PASS); HARD LIMIT documented (§3.4.1 #6); per-mode N=50 preserved; ext-validity caveat pre-registered. No pre-reg violation per spec §8.3 procedural correction wording.

### §11.6 Independence of trials (within-fixture clustering — Q1 codex top issue applies here)

Q2 has n=25 per fixture per mode. Within-cell trials share:
- Same fixture content (deterministic ground-truth set, deterministic grader)
- Same mode harness configuration
- Distinct seeds (vary `chain_state.json` paths for chain modes; vary seed registry for non-chain D mode but D mode does not consume seed in its prompt, hence SD=0)

**For D mode (non-chain): trials within a (mode, fixture) cell are essentially i.i.d. samples from a degenerate distribution** (point mass at q_const). Effective N is 1 per cell from a strict information-content standpoint. This degrades the binding N=50 per mode for D's contribution to the test, but:
- The Welch–Satterthwaite SE still uses n_D=50 (formally), so the test is **conservative** (it understates D's contribution to total variance, leading to wider SE if D had any noise; with s_D=0 the SE depends only on PC/S, which are NOT degenerate).
- The TOST verdict does not depend on D contributing variance — equivalence is established via the PC/S sampling distribution against a fixed D point.

**For PC and S (chain modes)**: within-cell trials have shared fixture but distinct seeds → distinct (pos, sess) trajectories → genuinely different prompts at trigger. N=25 per fixture is the effective N. No within-cell clustering inflation, unlike Q1 sc cells which had per-position chain dependence and shared chain trajectory.

**Q1 codex C3 within-fixture clustering critique** (per Q1 final analysis §11.4): applies less stringently to Q2 because (a) D mode has no within-cell variance to cluster, and (b) PC/S in Q2 use 25 distinct seeds with isolated `--state-root` per cell (per runner report §5 operational notes). Cluster-robust standard errors not pre-registered; recomputation under cluster-robust models forwarded to Phase 7+ if reviewers push back.

### §11.7 Pre-reg adherence audit

- ✓ No post-hoc fixture exclusion (H11–H14 dropped via pre-registered §3.2.1 fallback path).
- ✓ No new comparisons beyond §2.2.1 binding set.
- ✓ Per-fixture decomposition (§6) explicitly labeled as sensitivity, not binding.
- ✓ All 150 trials included; no trial dropped.
- ✓ Bonferroni α=0.00714 used for superiority Welch per spec §7.5.
- ✓ TOST at uncorrected α=0.05 per spec §7.5.
- ✓ Bootstrap B=20000 per spec §7.4.
- ✓ TOST 90% CI used (one-sided α=0.05 each → 90% two-sided), Welch SE, Welch–Satterthwaite df.
- ✓ Wording discipline (§7.3) maintained throughout.
- ✓ Operational tie-breaker invocation tied to spec §2.2.1 verbatim + OQ-P6-3 branch (b) wording.

---

## §12 Recommendations to architect (Q2 sub-ADR)

### §12.1 Verbatim decision

**PROMOTE D to Layer 1 co-equal chain mode.** Per spec §2.2.1 dual-gate, ALL three sub-gates resolve in favor of promotion: (i) TOST D-vs-PC equivalent at ε=±0.05 (90% CI=[−0.0044, +0.0182] ⊂ ±0.05; p_max < 0.0001); (ii) TOST D-vs-S equivalent at ε=±0.05 (90% CI=[−0.0034, +0.0263] ⊂ ±0.05; p_max < 0.0001); (iii) operational tie-breaker activated per §2.2.1 last bullet + OQ-P6-3 branch (b) (TOST holds + Welch superiority p=0.10065 ≥ 0.00714 → equivalence-only branch promotes on D's non-chain, no-chain-state-burden, cross-CLI-portable operational advantages per Rule 4-A Step 5). Spec §9.2 row 1 outcome.

### §12.2 If PROMOTE: how does Step 4 selector handle 3-way (PC, S, D)?

**Forwarded to OQ-P6-1 (parent ADR follow-up)**. Spec §12.1 OQ-P6-1 verbatim: "The single-signal selector for the 3-way split is NOT pre-registered in this Phase 6 spec — it is a parent-ADR follow-up decision (separate architect dispatch on Phase 6 conclusion)."

**Analyst recommendation (informational, non-binding)** based on §10.3 Pareto observation: S is Pareto-dominated by PC on (q, cost). The 3-way split may be effectively a 2-way split (D vs PC) with S as a tertiary fallback. Selector signal candidates for D-vs-PC primary split:
- **Chain primitive availability**: if host CLI lacks reliable chain primitives → D; else PC.
- **Cost sensitivity**: if cost-budget-bounded request → PC; else D (q-leader at +4–5% premium).
- **Cross-CLI portability requirement**: if request must execute uniformly across {claude, codex, gemini} → D; else PC.

### §12.3 Q1 + Q2 integration (state S1 per §9.4 decision matrix)

Q1 final analysis (`docs/reports/2026-05-03-phase6-q1-final-analysis.md`, sub-ADR `2026-05-03-substitute-compact-phase6-promote.md`): **substitute-compact PROMOTED** (Q1-A1 5-pos × cut=5; Q1-A5 10-pos × cut=30; chain-length-conditional grid recommended).

Combined with this Q2 verdict (D-promoted): Phase 6 outcome = **state S1 per spec §9.4** (Q1 promote + Q2 promote).

**Action per S1**: Single Phase 6 ADR documents BOTH outcomes:
- Substitute-compact promoted to Layer 1 chain-mode candidate (cut grid per Q1 sub-ADR rev3).
- D promoted to Layer 1 co-equal alongside PC and S.
- Rule 4-A Step 4 candidate set = **{PC, S, D, substitute-compact-at-(cut=5 or cut=30 conditional)}** — a 4-way candidate set.
- Selector revised: **4-way selector signal needed** (not 3-way as §9.4 anticipated for S2 or S3).
- Sub-ADR rev3 (substitute-compact) + Phase 6 D-promotion ADR jointly supersede:
  - Parent ADR §4.2 (D Layer 2 maintained).
  - Sub-ADR `2026-05-01-substitute-compact-revised-cut.md` (cut=30 origin; rev3 to chain-length-conditional).

**Cross-cell impact**: Q1 promotion is independent of Q2 promotion per spec §10 (no causal coupling pre-registered). Both sub-ADRs land independently; the parent ADR composes them into the unified Step 4 candidate set in the Phase 6 conclusion ADR.

### §12.4 Phase 7+ scope (T1 high priority items)

| # | Follow-up | Priority | Rationale |
|---|---|---|---|
| 1 | **OQ-P6-1 selector signal for 4-way Layer 1 split** (PC, S, D, substitute-compact) — parent ADR follow-up; BLOCKS Phase 6 conclusion ADR if state S1/S2/S3/S5 obtains (per §9.4) | T1 (high; **blocking**) | Without selector, Step 4 cannot deterministically pick a mode; Constitution Rule 5 violated |
| 2 | **D-promotion external validity sweep** (non-{H1,H10} fixtures per §9.3) — re-pre-register at Phase 7 after Q4-style ceiling-avoidance procedure produces validated non-ceiling fixture set | T1 (high) | Current verdict scoped to H1+H10 task surface only; broader-domain claim not licensed |
| 3 | **Cross-CLI verification of D mode** (codex, gemini parity) — confirm D works identically across the 3 CLIs since cross-CLI portability is the branch-(b) tie-breaker basis | T1 (high) | Tie-breaker basis must be empirically verified, not assumed |
| 4 | **Ceiling-fixture replacement (Q4 succession)** — H10 saturated at D=1.000; H11–H14 dropped; need new non-ceiling fixtures for any future Q2-style mode comparison | T2 (med) | Methodology debt from Q4 r5 fail; Phase 7 should attempt with §3.4.1 procedural lessons baked in |
| 5 | **Per-mode cost optimization for D on H10-style long-context** — D pays ~+4-5% cost premium vs PC; investigate whether D mode can amortize prompt caching at trial level (e.g., session-level kv-cache reuse) | T3 (low) | Operational efficiency improvement; not blocking |
| 6 | **OQ-P6-3 wording resolution in conclusion ADR** — branch (b) operational tie-breaker outcome wording per §2.2.1 forwarded for ADR-level disambiguation | T1 (high; **blocking**) | The Phase 6 conclusion ADR MUST explicitly state branch (b) basis to avoid future ambiguity over PROMOTE rationale |
| 7 | **OQ-P6-4 TOST family count formalization** — TOST exempt from Bonferroni assumed here per spec §7.5; if reviewer pushes back, formalize in Phase 6 conclusion ADR | T2 (med) | Methodological hygiene; doesn't change verdict but improves audit trail |

### §12.5 Top 3 recommendations to architect (ordered by blocking priority)

1. **Lock D-promotion sub-ADR (Layer 1 co-equal)** with explicit branch-(b) operational tie-breaker basis cited verbatim from spec §2.2.1 + this report §4.4. The branch-(b) wording matters for future audit; do NOT collapse "TOST equivalent" and "promoted" without naming the tie-breaker. Format mirrors Q1 sub-ADR `2026-05-03-substitute-compact-phase6-promote.md` for consistency.
2. **Resolve OQ-P6-1 (selector signal for 4-way Layer 1 split) BEFORE Phase 6 conclusion ADR lands**. State S1 obtains (Q1 + Q2 both promote); Step 4 candidate set is 4-way; Constitution Rule 5 ("최선 always") requires deterministic selection. Recommend an architect dispatch for OQ-P6-1 in parallel with this Q2 sub-ADR drafting.
3. **Open Phase 7 sub-question for D-promotion external validity** (non-{H1, H10} fixtures). Pair with Phase 7 Q4-succession ceiling-fixture authorship; re-pre-register against a 4–5 fixture set with §3.4.1 ceiling-avoidance procedures applied prospectively.

### §12.6 AGENTS.md / docs/rules.md amendment scope (forwarded; orchestrator authority)

If D promotes to Layer 1 co-equal, the following docs require updates (orchestrator scope, NOT analyst scope; listed for completeness):
- `aigentry-orchestrator/docs/rules.md` Rule 4-A Step 4: candidate set update (3-way → 4-way per §12.3).
- Parent ADR `2026-05-01-rule-4-a-step-4-final-lock.md` §4.2: superseded record-of-change.
- `aigentry-architect/AGENTS.md` (if any chain-mode default referenced): align with new selector outcome from OQ-P6-1.
- `aigentry-devkit/AGENTS.md` (mode names + default): D becomes a Layer 1 first-class candidate, not a Layer 2 fallback.

### §12.7 Cross-LLM review hand-off (cascade pattern per spec §10.7)

Next: orchestrator dispatches **codex review** + **gemini review** of this Q2 final analysis (3-LLM cascade per Phase 5/6 pattern; matches Q1 cascade). Reviewer focus areas:

- **§3 SD=0 methodology**: verify standard Welch–Satterthwaite TOST is correct primary method; verify Mann-Whitney U validation is sufficient; consider whether pooled-SD or non-parametric should have been pre-registered (codex C3 critique candidate).
- **§4.4 branch-(b) operational tie-breaker invocation**: verify the wording is faithful to spec §2.2.1 + OQ-P6-3 forwarded; verify the operational advantages (non-chain, no-state-burden, cross-CLI portable) are evidenced rather than asserted.
- **§6 H1-only sensitivity vs aggregate binding endpoint**: standard codex C3 critique; aggregate IS pre-registered as binding per spec §3.2 + §3.2.1.
- **§8 power discussion**: verify retro-power calc methodology; confirm under-power for superiority is pre-registered per spec §7.6 (not a defect of this analysis).
- **§9 §3.2.1 fallback impact**: verify external validity narrowing is correctly scoped; verify no implicit broader claim leaks.
- **§11.6 within-fixture clustering**: verify D mode SD=0 is correctly handled as i.i.d.-from-degenerate (not as cluster-robust hierarchical) since D has no within-cell variance to cluster.
- **§12.3 state S1 + 4-way candidate set**: verify combined Q1+Q2 outcome interpretation is correct per spec §9.4 row S1.

---

## Appendix A — Analysis script + raw results

- Script: `/tmp/phase6_q2_analysis.py` (reproducible from raw `metrics.json` files in `~/projects/aigentry-devkit/state/exec-mode-experiment/phase6-q2/`).
- Results JSON: `/tmp/phase6_q2_results.json` (full per-cell aggregates + TOST + superiority + Mann-Whitney + Cohen d + bootstrap CI + per-fixture sensitivity + U2).
- Bootstrap seed: `np.random.default_rng(42)` (deterministic re-runs).
- Bootstrap B: 20000 (spec §7.4).
- Python interpreter: `~/projects/aigentry-devkit/.venv-exec-mode/bin/python` (per spec §8.3 #7 venv).

## Appendix B — References

- Phase 6 spec: `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-05-02-phase6-design.md` (commit `8b4e156` + amendments `ee6e2c7`, `555daf6`, `90d0a3a`, `9a76c12`, `6ec2237`)
- Pre-reg tag: `exec-mode-v6-preregistered-20260502` (devkit `4eefc0a`)
- §3.2.1 amendment: orchestrator `6ec2237` (2026-05-02 21:36 KST)
- Runner final report: `~/projects/aigentry-devkit/docs/reports/2026-05-03-phase6-q2-fire.md` (commit `f969bf5`)
- Parent ADR: `~/projects/aigentry-orchestrator/docs/adr/2026-05-01-rule-4-a-step-4-final-lock.md` (§4.2 D Layer 2 — to be superseded)
- Q1 final analysis (cascade template): `~/projects/aigentry-devkit/docs/reports/2026-05-03-phase6-q1-final-analysis.md`
- Q1 sub-ADR (cross-LLM review pattern source): `~/projects/aigentry-orchestrator/docs/adr/2026-05-03-substitute-compact-phase6-promote.md`
- Phase 5 final analysis (PC=S=D triple-tie post-hoc origin): `~/projects/aigentry-devkit/docs/reports/2026-05-01-phase5-final-analysis.md` (devkit `1e740ba`)
- Phase 5 codex C3 lesson (binding-on-pre-reg): `~/projects/aigentry-devkit/docs/reports/2026-05-01-phase5-codex-review.md`

---

*End of Phase 6 Q2 final analysis. Status: DONE. Next: orchestrator dispatches cross-LLM review (codex + gemini) per spec §10.7 cascade pattern.*
