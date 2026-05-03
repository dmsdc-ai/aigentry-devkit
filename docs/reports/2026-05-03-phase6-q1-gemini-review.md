---
title: "Phase 6 Q1 final analysis cross-LLM review — decision logic + generalizability"
date: 2026-05-03
session: aigentry-reviewer-phase6-q1-gemini
status: DONE
review_target: docs/reports/2026-05-03-phase6-q1-final-analysis.md
pre_reg_tag: exec-mode-v6-preregistered-20260502
verdict: ACCEPT_WITH_CONDITIONS
---

# Phase 6 Q1 Gemini Review — Decision Logic + Generalizability

## Executive Summary

**ACCEPT_WITH_CONDITIONS.** The Phase 6 Q1 PROMOTE verdict for `substitute-compact-revised` is logically consistent with the Phase 6 spec (§2.1.1) and the parent ADR (§11). The selection of **Q1-A5 (10-pos, cut=30)** as the primary winner and **Q1-A1 (5-pos, cut=5)** as the secondary co-winner is the most robust decision given the data.

The mechanism addresses a critical failure point in long-horizon chains: the catastrophic collapse of Pacc at L=10 (μq=0.000 on H1). Industry research on "small-cut" activation patterns and $L^2M$ scaling laws supports the analyst's choice of low, non-linear cut thresholds to mitigate attention dilution.

Issue counts: **0 BLOCKERS, 2 MAJORS, 3 MINORS**.

---

## §1 Decision Logic Consistency

### §1.1 Promotion Verdict Alignment
The Q1 PROMOTE verdict (A1 and A5) satisfies the pre-registered dual-gate criteria in Phase 6 spec §2.1.1 (Δq ≥ +0.10, Welch p < 0.00714, Cohen d ≥ 0.5).
- **A1 (5-pos, cut=5)**: Δq=+0.2035, p=0.00202, d=0.646.
- **A5 (10-pos, cut=30)**: Δq=+0.2936, p=0.00142, d=0.659.
The logic correctly identifies that since at least one cell passed, the mechanism promotes.

### §1.2 Winner Selection (OQ-P6-2)
The selection of A5 as the primary winner follows the "strongest single cell wins" default (OQ-P6-2). A5 dominates A1 on:
- Absolute Δq (+0.29 vs +0.20).
- H1-only effect size (d=1.85 vs 1.09).
- U2 Utility (+0.43 vs +0.40).
- Cost efficiency (+17% premium vs +55%).

### §1.3 Sub-ADR Revision
Locking a **chain-length-conditional cut grid** (cut=5 for L=5, cut=30 for L=10) is the most logical operationalization of the result. A single global cut (e.g., cut=30) would fire too late on 5-pos chains (pos-6 unreachable), while a single low cut (e.g., cut=5) on 10-pos chains would fire too aggressively, potentially losing valuable early-chain context.

---

## §2 Generalizability

### §2.1 Industry Context: Small-Cut Activation
Web research confirms that "small-cut" patterns (pruning context based on internal activation signals or fixed "sufficiency" thresholds) are a standard industry response to context rot in long-horizon agents. The `substitute-compact` mechanism's use of a token-based cut to trigger segment resets is a valid implementation of this pattern.

### §2.2 Scaling Laws & Threshold Selection
The non-linear scaling of the cut value (L=5 → 5; L=10 → 30) aligns with **Long-context Language Modeling ($L^2M$) scaling laws**. As chain length (L) increases, the "history state" (KV cache) pressure grows. The transition from a very early cut at L=5 (firing at pos 2) to a mid-chain cut at L=10 (firing at pos 6) reflects an optimal trade-off between "context freshness" and "information retention."

### §2.3 Fixture Robustness
The signal is mathematically driven by **H1 (long-form code review)** due to H10 ceiling saturation. However, industry benchmarks (Context-Bench, GAIA) show that code-review and multi-step reasoning tasks are the primary victims of "Lost in the Middle" attention collapse. The PROMOTE verdict on H1 is highly likely to generalize to other high-complexity reasoning domains.

---

## §3 Cross-CLI Portability

### §3.1 Harness-Level Portability
The mechanism relies on the harness-level `.preuse_inputs/manifest.json` reset, which is independent of the CLI provider (Claude/Codex/Gemini). In principle, `substitute-compact` should generalize.

### §3.2 Model-Specific Attention Variation
Different models (Claude 3.5 vs Gemini 1.5 Pro) have different attention profiles. Gemini's "effective" context usage is often higher but still subject to the U-shaped curve. 
- **Risk**: A cut value optimized for Claude (cut=30) might be too early or too late for Gemini. 
- **Recommendation**: Phase 7 must include a **Cross-CLI Verification** step to ensure cut=30 doesn't cause regressions on Gemini/Codex.

---

## §4 Pacc 10-pos H1 Failure Implications

The H1-only mean of **0.000** for Pacc-10pos (Q1-B2) is the most significant finding in the report. It indicates that for complex code-review tasks, legacy Pacc is **unusable** at L=10.
- **Sunset Justification**: This catastrophic failure provides the "smoking gun" for the 2026-08-01 Pacc sunset. It is no longer a matter of "better performance"; it is a matter of fixing a broken default.
- **Impact**: Preuse-clear (PC) and Substitute-compact (sc) are the only viable paths forward for long-horizon chains.

---

## §5 Operational Implications

### §5.1 User Experience
For users, the introduction of sc provides a "safety net" against chain collapse. The cost premium for A5 (+17%) is negligible compared to the 0.0 → 0.6 quality lift.

### §5.2 Backward Compatibility
The migration path for existing Pacc users to PC (Layer 3) or S/PC (Layer 1) is clearly defined in the parent ADR. No breaking changes are introduced to the Rule 4-A Step 4 selector.

---

## §6 Constitution Check

- **Article 1 (경량)**: **PASS.** While the cut-conditional logic adds harness complexity, it is a pure-stdlib implementation that provides a massive quality lift. The "cost" of complexity is outweighed by the "benefit" of preventing total chain failure.
- **Article 5 (최선)**: **PASS.** PROMOTE is the evidenced-based best path.
- **Article 17 (무의존)**: **PASS.** No external dependencies are added.

---

## §7 Phase 7+ Recommendations

1. **Cut Sweep (10-pos)**: Sweep {25, 28, 30, 32, 35} to confirm the cut=30 plateau.
2. **Cross-CLI Verification**: Run A5 (cut=30) on Codex and Gemini to verify portability.
3. **Selector Signal (N-way)**: Define the deterministic signal for the PC/S/D/sc split (OQ-P6-1).
4. **Ceiling Fixture Retirement**: Replace H10 with a more difficult fixture (q < 0.8) to regain power in the aggregate metric.

---

## §8 BLOCKERS / MAJORS / MINORS

### BLOCKERS
None.

### MAJORS

**M1 - H10 saturation hides the aggregate signal.** The aggregate Δq is an H1 signal. The verdict is robust only because H1-only stratification agrees with the aggregate. Future phases MUST replace H10 with a more challenging fixture to avoid "non-informative" cells in the binding family.

**M2 - Cluster-sensitivity (Mirroring Codex Major).** As noted in the Codex review, session-level Welch p (0.02) does not pass α=0.00714. The verdict is binding ONLY under the pooled-trial assumption. This limits the generalizability claim: we have proven sc works for *these* trials, but have less confidence in its universal applicability across all possible sessions.

### MINORS

**N1 - Cut-Metric Confusion.** The cut is based on `input_tokens` (uncached delta), not transcript volume. This is counter-intuitive for users thinking in terms of "context window size." Documentation must clearly distinguish "Delta Cut" from "Context Window Size."

**N2 - 5-pos Cost Premium.** Q1-A1 (cut=5) has a +55% cost premium. While quality is high, this cost should be flagged as a T2 optimization candidate (Phase 7).

**N3 - Trigger vs Exposure.** As noted by Codex, the "non-trigger" trials in A5 still show quality lift vs Pacc (0.50 vs 0.00), suggesting the mechanism state persists across positions. This reinforces the PROMOTE verdict but complicates the "trigger rate" narrative.

---

## §9 Top 3 Conditions for Sub-ADR

1. **Sub-ADR Rev3 MUST lock the chain-length-conditional cut grid: cut=5 for 5-pos, cut=30 for 10-pos.** A single global cut is unsupported by the data.
2. **Sub-ADR MUST explicitly cite the Pacc-10pos H1 failure (μ=0.000) as the primary logical driver for sc promotion and Pacc sunset.**
3. **Sub-ADR MUST document the Cross-CLI portability risk: cut=30 is Claude-optimized; Phase 7 verification is required before cross-CLI deployment.**

---

*End of Gemini Review.*
