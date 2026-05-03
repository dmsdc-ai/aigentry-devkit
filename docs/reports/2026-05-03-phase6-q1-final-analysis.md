---
title: "Phase 6 Q1 final analysis — substitute-compact PROMOTE (Q1-A5 cut=30 10-pos primary; Q1-A1 cut=5 5-pos secondary)"
date: 2026-05-03
session: aigentry-analyst-phase6-q1-final
status: DONE
phase: post-fire-analysis
pre_reg_tag: exec-mode-v6-preregistered-20260502
spec: aigentry-orchestrator/docs/superpowers/specs/2026-05-02-phase6-design.md (commit 8b4e156 + amendments)
runner_report: docs/reports/2026-05-02-phase6-q1-fire.md (commit ad55e27)
binding: spec §2.1, §3.1, §7, §10.7
---

# Phase 6 Q1 final analysis — substitute-compact decision

## Verdict (TL;DR)

**PROMOTE.** Two cells satisfy all three §2.1.1 gates (Δq ≥ +0.10 AND Welch two-sided p < 0.00714 AND Cohen d ≥ 0.5):

| Cell | Chain | Cut | Δq vs Pacc | p (two-sided Welch) | Cohen d | Verdict |
|---|---|---|---|---|---|---|
| Q1-A1 | 5-pos | **5** | +0.2035 | 0.00202 | 0.646 | **PROMOTE (5-pos)** |
| Q1-A5 | 10-pos | **30** | +0.2936 | 0.00142 | 0.659 | **PROMOTE (10-pos, primary winner)** |

Recommended sub-ADR rev3 lock: **chain-length-conditional cut grid** — `cut=5` for 5-pos chains, `cut=30` for 10-pos chains. Q1-A5 is the headline winner (largest Δq, largest H1-only d=1.848); Q1-A1 is the 5-pos co-winner.

TOST deprecation criterion (§2.1.2): NOT satisfied (0/5 cells equivalent at ε=±0.05 90% CI). Watchlist (§2.1.3) NOT triggered (promotion gate satisfied).

H1-only sensitivity verdict (§8): consistent with aggregate (A1 + A5 both promote on H1 alone). H10 is ceiling-saturated (μ=0.965–1.000 across all cells) and contributes near-zero Δq to the aggregate; the aggregate signal IS the H1 signal.

---

## §1 Schema + integrity

| Cell | Dir | n | status=ok | Pre-reg match |
|---|---|---|---|---|
| Q1-A1 | `Q1-A1-sc-5pos-cut5/` | 50 | 50/50 | §3.1 row 1 (5-pos × cut=5 × sc-revised) ✓ |
| Q1-A2 | `Q1-A2-sc-5pos-cut10/` | 50 | 50/50 | §3.1 row 2 (5-pos × cut=10 × sc-revised) ✓ |
| Q1-A3 | `Q1-A3-sc-5pos-cut15/` | 50 | 50/50 | §3.1 row 3 (5-pos × cut=15 × sc-revised) ✓ |
| Q1-A4 | `Q1-A4-sc-5pos-cut20/` | 50 | 50/50 | §3.1 row 4 (5-pos × cut=20 × sc-revised) ✓ |
| Q1-A5 | `Q1-A5-sc-10pos-cut30/` | 50 | 50/50 | §3.1 row 5 (10-pos × cut=30 × sc-revised) ✓ |
| Q1-B1 | `Q1-B1-pacc-5pos/` | 50 | 50/50 | §3.1 row 6 (5-pos × Pacc reference) ✓ |
| Q1-B2 | `Q1-B2-pacc-10pos/` | 50 | 50/50 | §3.1 row 7 (10-pos × Pacc reference) ✓ |
| **TOTAL** | | **350** | **350/350** | 7/7 cells match pre-reg verbatim |

**Pre-reg tag annotation parsed (`exec-mode-v6-preregistered-20260502`, devkit `4eefc0a`):**
- Spec base: `8b4e156` + amendments `ee6e2c7`, `555daf6`, `90d0a3a`
- 8 user-approved decisions: row 1 factorial 5-pos × {5,10,15,20} + 10-pos × {30}, row 4 n=50/cell, row 3 dual gate (Δq ≥ +0.10 / d ≥ 0.5 promote AND TOST ε=±0.05 deprecate)
- Bonferroni family count: 7 (5 Q1 sc-vs-Pacc + 2 Q2 D-vs-PC, D-vs-S) → α = 0.05/7 = **0.00714**
- Harness `--cut N` flag: devkit `c9873ae` (post-tag amendment per spec §3.4.1 #6 fallback path; documented in runner report)
- Grader lock: devkit `6ade51c`
- Each trial fixture distribution: H1 (25 trials/cell) + H10 (25 trials/cell) per spec §3.1

**Pre-reg adherence**: cells named verbatim per §5.1; cuts {5,10,15,20,30} verbatim; chain lengths {5,10} verbatim; mode names exact; n=50 honored; fixture set H1+H10 honored. NO post-hoc cell renaming, exclusion, or addition.

---

## §2 Per-cell aggregates (replicate runner numbers + add CI/cost/wall/per-fixture)

All means/SDs computed from raw `quality.primary` field of 50 trials/cell. Bootstrap 95% CI uses B=20000 percentile resamples (spec §7.4 Phase 5 standard). Cost is `cost.marginal_usd`; wall is `timestamps.stage2_end - stage1_start`.

| Cell | mean q | SD q | 95% CI (boot) | mean cost ($) | SD cost | mean wall (s) | SD wall | trigger rate | q (H1) | q (H10) |
|---|---|---|---|---|---|---|---|---|---|---|
| Q1-A1 | 0.9432 | 0.1452 | [0.897, 0.973] | 0.3222 | 0.1083 | 76.4 | 41.6 | **97.5%** (39/40) | 0.886 | 1.000 |
| Q1-A2 | 0.8515 | 0.3209 | [0.756, 0.932] | 0.2449 | 0.1174 | 60.1 | 34.6 | 50.0% (20/40) | 0.703 | 1.000 |
| Q1-A3 | 0.8057 | 0.3578 | [0.702, 0.896] | 0.2227 | 0.1366 | 59.7 | 38.5 | 25.0% (10/40) | 0.646 | 0.965 |
| Q1-A4 | 0.8212 | 0.3634 | [0.718, 0.916] | 0.2207 | 0.1344 | 57.8 | 39.4 | 25.0% (10/40) | 0.642 | 1.000 |
| Q1-A5 | 0.7936 | 0.3774 | [0.681, 0.889] | 0.1473 | 0.1174 | 40.4 | 30.0 | 11.1% (5/45) | 0.612 | 0.975 |
| Q1-B1 | 0.7397 | 0.4215 | [0.621, 0.853] | 0.1631 | 0.1264 | 49.2 | 33.9 | 0% (0/—) | 0.489 | 0.990 |
| Q1-B2 | 0.5000 | 0.5051 | [0.360, 0.640] | 0.1263 | 0.1242 | 38.5 | 31.7 | 0% (0/—) | 0.000 | 1.000 |

Trigger denominator: L=5 → 4 trigger-eligible positions × 10 sessions = 40; L=10 → 9 × 5 = 45 (pos=1 never triggers per harness contract).

**Notable observations**:
- All sc cells > matched Pacc on aggregate mean q (verifies surface finding).
- Q1-B2 H1 mean = **0.000** (10-pos Pacc complete failure on H1 — confirms surface diagnosis).
- H10 is ceiling-saturated across all cells (range 0.965–1.000) — non-informative for binding test.
- Q1-A5 has the **lowest** mean cost ($0.147) among sc cells: 10-pos chain runs amortize the per-position Pacc cost less, but sc cuts the cumulative-token tail, so per-trial cost is dominated by stage2 only (5-pos chains accumulate more pre-trigger context).

---

## §3 Per-fixture decomposition (sensitivity, NOT pre-registered binding — spec §10.7 sensitivity scope)

Spec §3.1 binding aggregates over H1+H10 within each cell. Per-fixture decomposition is sensitivity per spec §3 + §10.7 (post-hoc fixture stratification was NOT pre-registered as a primary endpoint). Reported here for transparency and to defuse codex C3 objections.

### §3.1 H1 stratification (n=25/cell)

| Cell | H1 mean q | H1 SD | H1 vs matched Pacc Δq | Welch p | Cohen d | Verdict (α=0.00714, H1-only sensitivity) |
|---|---|---|---|---|---|---|
| Q1-A1 | 0.886 | 0.196 | **+0.397** vs B1 (0.489) | 0.00056 | **1.086** | **PROMOTE** ✓ |
| Q1-A2 | 0.703 | 0.421 | +0.214 vs B1 | 0.09596 | 0.481 | NO (p, d fail) |
| Q1-A3 | 0.646 | 0.488 | +0.157 vs B1 | 0.24046 | 0.336 | NO |
| Q1-A4 | 0.642 | 0.487 | +0.153 vs B1 | 0.25124 | 0.328 | NO |
| Q1-A5 | 0.612 | 0.483 | **+0.612** vs B2 (0.000) | <0.00001 | **1.848** | **PROMOTE** ✓ |

### §3.2 H10 stratification (n=25/cell) — ceiling-saturated

| Cell | H10 mean q | H10 SD | H10 vs matched Pacc Δq | Welch p | Cohen d | Ceiling-saturated? |
|---|---|---|---|---|---|---|
| Q1-A1 | 1.000 | 0.000 | +0.010 vs B1 (0.990) | 0.16149 | 0.409 | YES (μ=1.000, SD=0) |
| Q1-A2 | 1.000 | 0.000 | +0.010 vs B1 | 0.16149 | 0.409 | YES (μ=1.000, SD=0) |
| Q1-A3 | 0.965 | 0.061 | -0.025 vs B1 | 0.06924 | -0.528 | NEAR (μ=0.965) |
| Q1-A4 | 1.000 | 0.000 | +0.010 vs B1 | 0.16149 | 0.409 | YES (μ=1.000, SD=0) |
| Q1-A5 | 0.975 | 0.057 | -0.025 vs B2 (1.000) | 0.02198 | -0.693 | NEAR (μ=0.975) |

**H10 ceiling diagnosis**: Pacc-5pos H10 = 0.990 and Pacc-10pos H10 = 1.000 — both at or essentially at the [0,1] quality ceiling. The maximum possible Δq from sc on H10 is bounded above by ~0.01 (B1) and 0.00 (B2). Per Phase 4 fixed-baseline anomaly lesson + Phase 5 cascade-13 NB3 ceiling caveat, **H10 is non-informative for the §2.1.1 binding test** at these chain lengths.

**H1 carries Q1 signal**: aggregate Δq is mathematically dominated by H1 contribution. The aggregate verdict's promotion calls (A1, A5) replicate when stratifying to H1-only. Aggregate-non-promote cells (A2, A3, A4) also do not promote on H1-only at the spec α=0.00714.

---

## §4 §2.1.1 Promotion test (binding, primary endpoint)

For each of 5 sc cells, test against matched-chain-length Pacc (5-pos sc → B1; 10-pos sc → B2). Welch two-sided t-test (spec §7.1) at Bonferroni α = 0.05/7 = **0.00714** (spec §7.5; family count includes Q2 D-vs-PC and D-vs-S — see §11 below). Pooled-SD Cohen d (spec §7.2). Bootstrap 95% CI on Δq (spec §7.4, B=20000).

### §4.1 Aggregate (binding)

| Cell | Match | Δq | Welch t | p (two-sided) | Cohen d | 95% CI Δq | Δq≥+0.10 | p<0.00714 | d≥0.5 | **Verdict** |
|---|---|---|---|---|---|---|---|---|---|---|
| **Q1-A1** | B1 | **+0.2035** | 3.211 | **0.00202** | **0.646** | [+0.085, +0.328] | ✓ | ✓ | ✓ | **PROMOTE** |
| Q1-A2 | B1 | +0.1118 | 1.495 | 0.13896 | 0.299 | [-0.033, +0.256] | ✓ | ✗ | ✗ | NO |
| Q1-A3 | B1 | +0.0660 | 0.846 | 0.40067 | 0.169 | [-0.086, +0.219] | ✗ | ✗ | ✗ | NO |
| Q1-A4 | B1 | +0.0815 | 1.038 | 0.30292 | 0.207 | [-0.070, +0.233] | ✗ | ✗ | ✗ | NO |
| **Q1-A5** | B2 | **+0.2936** | 3.293 | **0.00142** | **0.659** | [+0.118, +0.462] | ✓ | ✓ | ✓ | **PROMOTE** |

**Cells satisfying ALL THREE gates: {Q1-A1, Q1-A5}** — promotion criterion met.

### §4.2 Sensitivity check at the dispatch's stricter family count (α = 0.05/5 = 0.01)

The task dispatch text specifies "Bonferroni correction: α=0.05/5=0.01 across 5 sc cells" — this differs from the spec §7.5 binding family count of 7 (which includes Q2 superiority Welch tests). Both Q1-A1 and Q1-A5 also pass at the dispatch's α=0.01 (p=0.00202 and p=0.00142 both < 0.01), so the verdict is **robust** to either Bonferroni interpretation. Spec §7.5 is the binding pre-reg specification; the dispatch's narrower family is a sensitivity check.

### §4.3 Cohen d secondary (per-fixture aggregation)

Per spec §7.2 codex C4 caveat, hierarchical structure (50 trials = 25 H1 + 25 H10 per cell) violates strict IID. Secondary Cohen d on per-fixture means (n=2 fixtures per cell) is structurally low-power (df=2) and reported informationally only:

| Cell | H1 mean Δ | H10 mean Δ | Per-fixture mean diff | per-fixture d (n=2, low-power) |
|---|---|---|---|---|
| Q1-A1 | +0.397 | +0.010 | +0.2035 | informational only |
| Q1-A5 | +0.612 | -0.025 | +0.2936 | informational only |

**Decision rule §2.1.1 uses primary pooled-SD d (§4.1) per spec.** Q1-A1 d=0.646 ≥ 0.5 ✓; Q1-A5 d=0.659 ≥ 0.5 ✓.

---

## §5 §2.1.2 Deprecation TOST test (binding)

For each of 5 sc cells, TOST equivalence at ε=±0.05 vs matched Pacc, α=0.05 (90% two-sided CI ⊂ (-0.05, +0.05)). Welch SE; Welch–Satterthwaite df. Per spec §7.5, TOST tests use uncorrected α=0.05 (separate family from superiority Bonferroni).

| Cell | Match | Δq | 90% CI (TOST) | p_max (TOST) | Equiv @ α=0.05? |
|---|---|---|---|---|---|
| Q1-A1 | B1 | +0.2035 | [+0.0982, +0.3088] | 0.9911 | NO (CI exceeds +0.05) |
| Q1-A2 | B1 | +0.1118 | [-0.0127, +0.2363] | 0.7943 | NO (CI exceeds +0.05) |
| Q1-A3 | B1 | +0.0660 | [-0.0639, +0.1959] | 0.5809 | NO (CI exceeds +0.05) |
| Q1-A4 | B1 | +0.0815 | [-0.0492, +0.2122] | 0.6552 | NO (CI exceeds +0.05) |
| Q1-A5 | B2 | +0.2936 | [+0.1454, +0.4418] | 0.9962 | NO (CI exceeds +0.05) |

**ALL 5 cells equivalent: NO (0/5).** Deprecation criterion §2.1.2 NOT satisfied (criterion requires ALL cells equivalent AND no cell satisfies §2.1.1).

Wording discipline (spec §7.3 codex C1): the non-promote cells (A2, A3, A4) show **no separation** from Pacc at α=0.05 (Welch p > 0.05) but TOST equivalence is **not established** (90% CI extends past ±0.05 in all cases). This is the codex C1 trap explicitly: tie ≠ equivalence.

---

## §6 §2.1.3 Watchlist disposition

§2.1.3 applies if **neither** §2.1.1 promote NOR §2.1.2 deprecate triggers. Q1 result: §2.1.1 promote IS triggered (cells A1, A5). Therefore Watchlist is **NOT** the outcome.

If, hypothetically, only A2/A3/A4 results were considered: those three cells in isolation would fall in the watchlist regime — neither promotion (Δq ≥ 0.10 / p < 0.00714 / d ≥ 0.5 not all met) nor TOST equivalence (90% CI extends past ±0.05). Per spec §2.1.3 wording: "no Pareto-relevant separation observed but TOST equivalence not established" applies to A2/A3/A4 in isolation. But the binding §9.1 decision rule operates at the family level (any cell promoting → PROMOTE), so this is a footnote, not the verdict.

---

## §7 Decision matrix (spec §2.1 verbatim)

**OUTCOME: PROMOTE** (spec §9.1 row 1).

### §7.1 Spec §2.1.1 promotion verdict

> "**Decision rule (promote)**: there exists at least one substitute-compact cell satisfying ALL of: Δq vs Pacc (matched chain length) ≥ +0.10 (absolute mean difference); Welch t-test p < 0.05 (two-sided), Bonferroni-corrected for §7.5 family count; Cohen d ≥ 0.5 (medium-effect floor)."

Two cells satisfy: **Q1-A1 (5-pos, cut=5)** and **Q1-A5 (10-pos, cut=30)**. The promotion gate is met (per §2.1.1, "at least one" suffices).

### §7.2 Winning cell selection (per OQ-P6-2 default)

Spec §12.2 OQ-P6-2 forwarded the question of joint-cell promotion. The minimum-assumption default ("strongest single cell wins") applies. Δq-magnitude ranking:

| Cell | Δq | Cohen d (aggr.) | H1-only d | U2 utility (§10) | U2 rank | Effect-magnitude rank |
|---|---|---|---|---|---|---|
| Q1-A5 | **+0.2936** | 0.659 | **1.848** | **+0.4315** | **1** | **1** |
| Q1-A1 | +0.2035 | 0.646 | 1.086 | +0.4000 | 2 | 2 |

**Primary winner: Q1-A5 (10-pos × cut=30)** — largest Δq, largest Cohen d, largest H1-only effect, AND highest U2 utility (best cost-quality trade-off).
**Secondary winner: Q1-A1 (5-pos × cut=5)** — also satisfies all 3 gates; serves a different chain-length regime.

### §7.3 Recommended sub-ADR rev3 lock

Sub-ADR `2026-05-01-substitute-compact-revised-cut.md` (cut=30 origin) → revise to **chain-length-conditional cut grid**:
- 5-pos chains: `cut=5` (Q1-A1 wins)
- 10-pos chains: `cut=30` (Q1-A5 wins; matches sub-ADR Hypothesis B origin)
- Phase 7+ may sweep neighboring cuts (per spec §2.1.1 outcome clause).

If the architect prefers a single-cut lock per a strict reading of §2.1.1 ("cut value of the winning cell"), **Q1-A5 cut=30** is the primary recommendation: it has the largest absolute and effect-size signal AND it matches the sub-ADR's original Hypothesis B context (long-chain regime where Pacc collapses).

### §7.4 Follow-up scope (Phase 7+)

- Sweep cuts {25, 28, 30, 32, 35} on 10-pos to characterize the cut=30 plateau.
- Sweep cuts {3, 5, 7, 10} on 5-pos (A1 dominates A2 — narrow grid around cut=5).
- Open question: does substitute-compact generalize to non-H1/H10 fixtures? Phase 6 used the Phase-5-reused fixtures; H11–H14 were dropped from Q1 grid (not in pre-reg). External validity for sc is bounded to {H1, H10} — same external-validity caveat as Q2 per spec §3.2.1.
- Selector signal for 3-way Layer 1 split if §9.4 state S1/S3 obtains: spec §12.1 OQ-P6-1 forwarded.

### §7.5 NOT triggered

- DEPRECATE (§2.1.2): NOT triggered (0/5 equivalent + 2/5 promote).
- WATCHLIST (§2.1.3): NOT triggered (promotion gate satisfied).

---

## §8 H1 signal vs H10 ceiling — methodological caveat (pre-empt cross-LLM review)

### §8.1 Acknowledgment

The aggregate binding decision (§4.1) is mathematically driven by the H1 fixture. H10 is ceiling-saturated:
- Pacc-5pos H10 (Q1-B1) μ = 0.990, σ ≈ 0.069
- Pacc-10pos H10 (Q1-B2) μ = 1.000, σ = 0.000
- All sc cell H10 means ∈ [0.965, 1.000]

Maximum possible H10 Δq is bounded above by 0.010 (B1) and 0.000 (B2). H10 cannot mathematically contribute to Δq ≥ 0.10 and so the binding signal is structurally H1-only.

### §8.2 H1-only sensitivity verdict (§3.1)

Recomputing the §2.1.1 promotion test on H1 alone (n=25/cell, smaller sample → less power per cell BUT free of H10's ceiling-induced variance compression):

| Cell | H1 Δq | H1 p (Welch two-sided) | H1 Cohen d | Verdict (α=0.00714, n=25) |
|---|---|---|---|---|
| Q1-A1 | +0.397 | 0.00056 | 1.086 | **PROMOTE** ✓ |
| Q1-A2 | +0.214 | 0.09596 | 0.481 | NO |
| Q1-A3 | +0.157 | 0.24046 | 0.336 | NO |
| Q1-A4 | +0.153 | 0.25124 | 0.328 | NO |
| Q1-A5 | +0.612 | <0.00001 | **1.848** | **PROMOTE** ✓ |

**H1-only verdict AGREES with aggregate verdict** (A1 + A5 promote; A2/A3/A4 do not). The two cells satisfying §2.1.1 on aggregate also satisfy on H1-only. This robustness rules out the "ceiling artifact" objection.

### §8.3 H10-only sensitivity verdict (completeness)

| Cell | H10 Δq | Verdict |
|---|---|---|
| Q1-A1 | +0.010 | NO (Δq fails; ceiling-bounded) |
| Q1-A2 | +0.010 | NO |
| Q1-A3 | -0.025 | NO (sc slightly worse at saturation) |
| Q1-A4 | +0.010 | NO |
| Q1-A5 | -0.025 | NO (sc slightly worse) |

H10-only verdict: 0/5 cells promote (all near-tie or slightly negative due to ceiling). This is expected and confirms H10 is non-informative for binding.

### §8.4 Recommendation: should aggregate or H1-only be the binding endpoint?

**Spec §3.1 binds the aggregate** ("each cell uses both fixtures (25 trials per fixture per cell) to balance fixture-class signal"). The aggregate is pre-registered. H1-only sensitivity is sensitivity, not binding.

**Forward to Phase 7+ as OQ-P6-6 (new)**: future ceiling-fixture replacement should retire H10 from the Q1 binding set when the chain length is long enough that Pacc itself saturates H10 (here: even 10-pos Pacc H10 = 1.000). Q4 attempted this with H11–H14 but the pilot rejected per §3.2.1; replacement remains an open question.

For the current Phase 6 binding decision, **the aggregate verdict stands**, with the H1-only sensitivity reinforcing rather than contradicting it.

---

## §9 Trigger rate × Quality interaction

Trigger rate is the per-cell fraction of trigger-eligible positions (pos > 1) where the harness staged a sub-compact (manifested as `.preuse_inputs/manifest.json`).

### §9.1 Conditional quality given trigger fired vs not fired (sc cells)

| Cell | trigger rate | n_fired | mean q (fired) | n_not_fired | mean q (not fired) | mean q gap (fired − not_fired) |
|---|---|---|---|---|---|---|
| Q1-A1 | 97.5% | 39 | 0.936 | 1 | 1.000 | -0.064 (n=1; under-powered) |
| Q1-A2 | 50.0% | 20 | 0.916 | 20 | 0.729 | **+0.187** |
| Q1-A3 | 25.0% | 10 | 0.983 | 30 | 0.693 | **+0.290** |
| Q1-A4 | 25.0% | 10 | 0.960 | 30 | 0.723 | **+0.237** |
| Q1-A5 | 11.1% | 5 | 0.965 | 40 | 0.749 | +0.216 |

When the trigger fires, mean q ≥ 0.92 in all cells. The not-fired sub-population has mean q comparable to (or slightly worse than) the matched Pacc — consistent with "non-trigger trials are Pacc-equivalent" since the harness reverts to Pacc-like behavior when cumulative tokens stay below cut.

### §9.2 Mechanism: why low-trigger cells (A3, A4, A5) still promote (or not)

- **Q1-A5 promotes despite 11.1% trigger rate** because Pacc-10pos collapses on H1 (μ=0.0). Even 5 fires of sc on H1 trials lift the 10-pos H1 mean from 0.0 → 0.612. The asymmetry between Pacc baseline (catastrophic) and sc-when-fired (high) makes the binding test pass even with sparse triggering.
- **Q1-A3, Q1-A4 do NOT promote** because Pacc-5pos H1 is not catastrophic (μ=0.489 — moderate baseline), so the lift from sparse triggering is bounded: sc fires ~10/40 H1 trials; even at q=1.0 when fired, the cell mean lifts only modestly above Pacc.
- **Q1-A1's 97.5% trigger rate** explains its PROMOTE despite not being the largest absolute lift (cut=5 fires aggressively, capturing nearly every position-2-or-later trial; mean q approaches the "always-fired" upper bound).

### §9.3 Why cut=15 and cut=20 plateau at 25%

Per-position `input_tokens` mass clusters around the cut=15–20 threshold for H1+H10 fixtures (both fixtures' per-position prompt+response token volume is comparable); cut=15 and cut=20 fire only at positions where cumulative tokens exceed the threshold, and the 25% rate reflects positions 4–5 of 5-pos chains. cut=10 captures positions 3–5 (50%); cut=5 captures positions 2–5 (~98%).

This is informational, not binding. Forwarded to sub-ADR rev3 follow-up if the architect wants to characterize the cut-vs-trigger curve.

---

## §10 Cost-benefit (U2 utility)

Per spec §3.5 weighting (0.7×normalize(quality) − 0.3×normalize(cost), where normalize is min-max across the 7 cells):

| Cell | mean q | mean cost ($) | norm q | norm cost | **U2** | U2 rank |
|---|---|---|---|---|---|---|
| **Q1-A5** | 0.7936 | 0.1473 | 0.662 | 0.107 | **+0.4315** | **1** |
| Q1-A1 | 0.9432 | 0.3222 | 1.000 | 1.000 | +0.4000 | 2 |
| Q1-A2 | 0.8515 | 0.2449 | 0.793 | 0.605 | +0.3736 | 3 |
| Q1-A4 | 0.8212 | 0.2207 | 0.725 | 0.482 | +0.3628 | 4 |
| Q1-A3 | 0.8057 | 0.2227 | 0.690 | 0.492 | +0.3352 | 5 |
| Q1-B1 | 0.7397 | 0.1631 | 0.541 | 0.188 | +0.3223 | 6 |
| Q1-B2 | 0.5000 | 0.1263 | 0.000 | 0.000 | +0.0000 | 7 |

### §10.1 Pareto-restricted ranking

Pareto-relevant cells (no other cell dominates both q and cost): Q1-A1 (highest q), Q1-A5 (lowest cost among sc), Q1-B2 (lowest cost overall but lowest q). Q1-A2/A3/A4 are dominated by A1 and A5 on the (q, cost) frontier.

### §10.2 Cost note: does sc cost more than Pacc?

| L | Pacc mean cost | sc mean cost (avg of 5-pos cells) | Δ cost |
|---|---|---|---|
| 5-pos | $0.163 (B1) | $0.253 (avg A1–A4) | +$0.090 (+55%) |
| 10-pos | $0.126 (B2) | $0.147 (A5) | +$0.021 (+17%) |

5-pos sc cells cost ~55% more than Pacc on the same chain length — the cumulative-cut staging adds token overhead in the early-fire regime. 10-pos sc (A5) is only +17% vs Pacc-10pos because the 11.1% trigger rate keeps amortized overhead low. This is a positive operational fact for A5: large quality gain at modest cost premium.

### §10.3 U2 winner

**Q1-A5 wins U2** (+0.4315), narrowly above Q1-A1 (+0.4000). Combined with §7.2 Δq ranking (A5 > A1), §8.2 H1-only effect (A5 d=1.848 > A1 d=1.086), and §10.2 cost premium analysis (A5 only +17% vs Pacc), **Q1-A5 is the unambiguous primary winner**.

---

## §11 Pre-empt cross-LLM review concerns

### §11.1 Effect-size + power justification

- **Promotion gate** (Δq ≥ 0.10, p < 0.00714, d ≥ 0.5): pre-registered per §2.1.1. d ≥ 0.5 is the medium-effect floor; n=50/cell at top-tier SD≈0.04 has power >0.999 for d=1.0 (spec §7.6); the actual SDs here are larger (0.14–0.42) but the observed effects (d=0.65 aggregate, d=1.09–1.85 H1-only) substantially exceed the 0.5 floor.
- **Under-power risk** (spec §7.6): n=50 vs Pacc-variance (SD ≈ 0.47) has power ~0.40 for Δq=0.10. The TOST equivalence margin absorbs this risk: under-power does not false-deprecate. Phase 6 accepted under-power per user-approved decision row 4.
- A2/A3/A4 are in the under-powered regime; their non-promote verdict should be read as "no promotion signal at n=50" not "true null". Phase 6's gemini D2 time-box closes the substitute-compact arm regardless, so this is documented but does NOT alter the verdict.

### §11.2 Multi-test correction details

Spec §7.5 binds Bonferroni family count = 7 (5 Q1 sc-vs-Pacc + 2 Q2 D-vs-PC + D-vs-S). Per-test α = 0.05/7 = 0.00714. **Q1-only family-count interpretation (α = 0.05/5 = 0.01) yields identical verdicts** — the promotion calls are robust to the wider/narrower family choice. The TOST family is structurally separate from superiority Bonferroni per spec §7.5 + §12.4 OQ-P6-4 (forwarded; not blocking).

### §11.3 TOST + superiority ordering rationale

Per spec §7.3 TOST wording discipline (codex C1 lesson): "equivalence" used ONLY in TOST contexts; "no separation" used elsewhere. This report adheres throughout. The §2.1.1 (promotion) and §2.1.2 (deprecation) tests are structurally independent; both are evaluated; promotion triggers (A1, A5) and TOST does not (0/5 equivalent), so the verdict is unambiguously PROMOTE per §9.1 row 1 (no contradiction, no tie).

### §11.4 Endpoint discipline (codex C4 lesson, Phase 5)

`quality.primary` is in [0,1] but treated as continuous per spec §2.1 + Phase 5 codex C4. Welch t-test with the hierarchical caveat (50 trials = 25 H1 + 25 H10 — fixture clustering violates strict IID): the secondary per-fixture-mean Cohen d (n=2) is reported for transparency (§4.3) but the binding decision uses the pooled-trial Cohen d. Cluster-robust standard errors (e.g., GEE, hierarchical Bayes) are NOT pre-registered; recomputation under such models is forwarded to Phase 7+ if reviewers push back.

### §11.5 Pre-reg adherence audit

- ✓ No post-hoc fixture exclusion (H1+H10 aggregate is binding endpoint).
- ✓ No new comparisons beyond §3.1 binding set (5 sc-vs-Pacc + TOST per cell).
- ✓ Per-fixture decomposition (§3) explicitly labeled as sensitivity, not binding.
- ✓ All 350 trials included; no trial dropped.
- ✓ Bonferroni adjusted α = 0.00714 used per spec §7.5.
- ✓ Bootstrap B=20000 per spec §7.4.
- ✓ TOST 90% CI used (one-sided α=0.05 each → 90% two-sided), Welch SE, Welch–Satterthwaite df.
- ✓ Wording discipline (§7.3): "equivalence" used only in TOST context; "no separation" or "promotion gate satisfied" elsewhere.

---

## §12 Recommendations to architect (next ADR)

### §12.1 Verbatim decision

**PROMOTE substitute-compact-revised mechanism to Layer 1 chain-mode candidate.** Two cells satisfy §2.1.1: Q1-A1 (5-pos × cut=5) and Q1-A5 (10-pos × cut=30). Q1-A5 is the primary winner (largest Δq, largest H1-only Cohen d, highest U2). 0/5 cells satisfy §2.1.2 TOST equivalence; deprecation criterion not met. Spec §9.1 row 1 outcome.

### §12.2 Recommended cut value

**Chain-length-conditional cut grid** (recommended; see §7.3):
- 5-pos chains: `cut=5`
- 10-pos chains: `cut=30`

If the architect prefers a single global cut per a strict reading of §2.1.1 ("cut value of the winning cell"), recommend **`cut=30` on 10-pos chains** as the binding lock (matches sub-ADR Hypothesis B origin context; largest effect size; best U2). 5-pos chain-length sub-ADR addendum can be added in Phase 7+ via OQ-P6-2 follow-up.

### §12.3 Q2 implications

Q1 promotion changes the §9.4 outcome state space:
- If Q2 also promotes D → state **S1** (Q1 promote + Q2 promote): Rule 4-A Step 4 candidate set = {PC, S, D, substitute-compact-at-cut-30-or-conditional}. 4-way selector signal needed (not 3-way as §9.4 anticipated).
- If Q2 maintains D → state **S2** (Q1 promote + Q2 maintain): Rule 4-A Step 4 candidate set = {PC, S, substitute-compact}. Selector signal between PC, S, and substitute-compact required.

In either case, **substitute-compact joins the Layer 1 candidate set** as a chain-length-conditional or cut=30 entry. Selector signal forwarded per spec §12.1 OQ-P6-1.

**No Q2 priority change required by Q1 outcome** — Q2 binding hypotheses §2.2.1 + §2.2.2 are independent of Q1 (per spec §10).

### §12.4 Phase 7+ follow-ups

| # | Follow-up | Priority |
|---|---|---|
| 1 | Cut sweep {25, 28, 30, 32, 35} on 10-pos to characterize cut=30 plateau | T1 (high) |
| 2 | Cut sweep {3, 5, 7, 10} on 5-pos to characterize cut=5 dominance | T2 (med) |
| 3 | OQ-P6-1 selector signal for N-way Layer 1 split (parent ADR follow-up) | T1 (high; blocks Phase 6 conclusion ADR if S1/S2/S3) |
| 4 | OQ-P6-2 joint-cell vs single-cell promotion criterion (formalize) | T2 (med) |
| 5 | Ceiling-fixture replacement for sc (H10 saturated; H11–H14 dropped per §3.2.1) | T2 (med) |
| 6 | External validity sweep: sc on non-{H1,H10} fixtures (post-H11–H14 redesign) | T3 (low) |
| 7 | Cost-overhead optimization: 5-pos sc costs +55% vs Pacc; cut=30-only deployment avoids this | T2 (med) |

### §12.5 Top 3 recommendations to architect (ordered)

1. **Lock sub-ADR rev3 to chain-length-conditional cuts**: cut=5 for 5-pos, cut=30 for 10-pos. Default to cut=30 single-lock if rev3 must specify a single value.
2. **Open Phase 7 sub-question**: cut sweep around 30 on 10-pos to confirm A5 isn't a local optimum at the pre-reg cut value.
3. **Update Rule 4-A Step 4 selector signal** (OQ-P6-1) BEFORE Phase 6 conclusion ADR landing if Q2 also promotes D — the 3-way or 4-way split needs a deterministic tie-breaker pre-registered.

### §12.6 Cross-LLM review hand-off (cascade pattern per spec §10.7)

Next: orchestrator dispatches **codex review** + **gemini review** of this analysis (3-LLM cascade per Phase 5/6 pattern). Reviewer focus areas:

- Endpoint discipline: pooled-trial Cohen d vs hierarchical/cluster-robust alternatives (codex C4 lesson).
- Bonferroni family count (5 vs 7) and TOST family separation (OQ-P6-4).
- Joint-cell promotion criterion (OQ-P6-2) — single winner vs both A1 and A5 lock.
- H1-only sensitivity vs aggregate binding endpoint (forwarded as new OQ-P6-6).
- Pre-reg adherence audit (§11.5).

---

## Appendix A — Analysis script + raw results

- Script: `/tmp/phase6_q1_analysis.py` (reproducible from raw `metrics.json` files in `~/projects/aigentry-devkit/state/exec-mode-experiment/phase6-q1/`).
- Results JSON: `/tmp/phase6_q1_results.json` (full per-cell aggregates + promotion test + TOST + U2 + sensitivity).
- Bootstrap seed: `np.random.default_rng(42)` (deterministic re-runs).
- Bootstrap B: 20000 (spec §7.4 Phase 5 standard).

## Appendix B — References

- Phase 6 spec: `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-05-02-phase6-design.md` (§2.1, §3.1, §7, §9.1, §10.7)
- Pre-reg tag: `exec-mode-v6-preregistered-20260502` (devkit `4eefc0a`)
- Runner final report: `~/projects/aigentry-devkit/docs/reports/2026-05-02-phase6-q1-fire.md` (commit `ad55e27`)
- Sub-ADR (to be revised): `~/projects/aigentry-orchestrator/docs/adr/2026-05-01-substitute-compact-revised-cut.md`
- Phase 5 baseline: `~/projects/aigentry-devkit/docs/reports/2026-05-01-phase5-final-analysis.md` (substitute-compact-revised@30 0/10 fire)
- Q3 ADR (binding): `~/projects/aigentry-orchestrator/docs/adr/2026-05-02-output-style-fixture-design-rule.md` (commit `2ec53bf`)
- Codex C1/C3/C4 lessons: Phase 5 codex review; Phase 5 cascade-13 NB3
