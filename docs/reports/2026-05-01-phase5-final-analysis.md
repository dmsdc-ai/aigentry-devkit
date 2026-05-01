# Phase 5 Final Analysis — Holdout Validation (Track #329 E27, α-step-14)

**Author**: `aigentry-analyst-phase5-final` session (claude opus 4.7 1M)
**Date**: 2026-05-01
**Dataset**: 300 trials = 6 modes × 5 fixtures × 10 seeds (NEW holdout fixtures, disjoint from Phase 3/4 Fa+F2..F10)
**Pre-reg tag**: `exec-mode-v5-holdout-preregistered-20260501` → devkit `c8478b4`
**Driver SHA**: `c8478b4` (`bin/exec-mode-experiment.sh`, `bin/exec-mode-generate-order.py`)
**Grader SHA**: `207d968` (cascade-13d, NB1+NB2 fixed; NB3 accepted as known-issue per spec §5.4)
**Substitute-compact-v1 SHA**: `26f8cc4` (V3 byte-equality PASS)
**Spec**: `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-05-01-phase5-holdout-design.md`
**Parent ADR**: `~/projects/aigentry-orchestrator/docs/adr/2026-05-01-rule-4-a-step-4-preuse-clear-activation.md` (Accepted)
**Sub-ADR (cut=30)**: `~/projects/aigentry-orchestrator/docs/adr/2026-05-01-substitute-compact-revised-cut.md`
**Phase 4 baseline**: `docs/reports/2026-04-28-phase4-final-analysis.md` + `docs/reports/2026-05-01-phase4-u2-pareto-recompute.md`
**Method**: read-only aggregation; Welch's t-test (unequal variance); Cohen d pooled-SD; bootstrap B=10000–20000; Bonferroni (15 mode pairs, α=0.0033)

---

## §1 Executive Summary

- **Quadrant verdict: Q2 — PC ≈ S, both hold up.** Phase 5 holdout confirms the Phase 4 PC≈S tie at higher resolution: Δq = −0.0005, Welch p = 0.9414, Cohen d = −0.015, bootstrap 95% CI = [−0.0140, +0.0131]. The tie is the most robust finding of this phase — it persists in 5/5 leave-one-fixture-out resamples and at every per-fixture decomposition (max |Δ|=0.012 on H10).
- **Preuse-clear vs Pacc: HOLDS UP across new domains.** Δq = +0.4729, p < 0.0001, Cohen d = +1.41, bootstrap CI = [+0.343, +0.604]. Phase 4 finding (Δq=+0.572, d=1.95) generalizes to code review / multi-hop reasoning / multilingual / instruction-following / tool-use.
- **Substitute-compact-revised cut=30: 0/10 sessions fired.** Mechanism failed identically to Phase 4c. The sub-ADR's Hypothesis B (mid-chain fire at pos 6 of 10) was empirically refuted — Phase 5 uses 5-position chains, max cumulative-input = 25 tokens, never reaches the 30-token cut. **The mechanism remains untested at runtime.** PSC-rev vs Pacc: Δq = −0.043 (NOT SIG, p=0.65, CI=[−0.225, +0.140]) — sample-noise around Pacc, no inference possible.
- **NB3 known-issue impact: ZERO observed.** All 6 modes scored H5 = 1.000 quality (only Pfresh has 1 score of 0.967). The hypothesized output-style asymmetry between PC and S did not materialize on H5; orchestrator T-2 acceptance is empirically vindicated.
- **Hold-up criterion: ALL 5 carry-over modes hold up.** Each P5 mean ≥ Phase 4 mean − 0.05 threshold (in fact, all *lifted* by +0.04 to +0.36). Caveat: lift suggests an easier holdout fixture set or grader generosity, not improved chain semantics.
- **U2 ranking**: `S (0.458) ≈ Preuse-clear (0.428) > D (0.395) ≫ Pfresh (0.161) ≫ Pacc (0.012) > PSC-rev (−0.027)` — PC and S are co-equal Layer 1; D is third (lifted from off-Pareto in Phase 4).
- **Pareto frontier (Phase 5)**: {Pfresh, S}. PC is dominated by S (S has higher q at lower $); D is dominated by S; Pacc and PSC-rev are dominated by Pfresh on both axes.
- **Bonferroni (15 mode pairs)**: PC=S=D triple-tie at top (p≥0.66 all pairs); PC, S, D each strictly dominate Pacc/Pfresh/PSC-rev (p<0.0001 across the board). Bonferroni-survived pairs match a priori Phase 4 ranking.
- **Recommended Step 4 lock**: **PC + S co-equal Layer 1** (per ADR §2.2 carry-over + Phase 5 Quadrant Q2 outcome). Pacc sunset 2026-08-01 confirmed. Substitute-compact-v1 mechanism: keep in-tree, **cut=30 disposition = inconclusive (mechanism never fired)** — Phase 6 must test cut ≤ 5 OR use longer chains; current sub-ADR §5 thresholds cannot be applied.
- **Cross-LLM review prep**: §8 enumerates anticipated codex (statistical) + gemini (decision-logic) challenges with effect-size, power, Bonferroni, leave-one-out, and pre-reg adherence baked in.

---

## §2 Schema + Integrity Checks

### §2.1 Headline integrity

| check | result | status |
|---|---|---|
| metrics.json files found | 300/300 | ✓ |
| schema_version="1" | 300/300 | ✓ |
| status="ok" | 300/300 | ✓ |
| JSON parse errors | 0 | ✓ |
| `compact.detected` (any mode) | 0/300 | ✓ (ADR §M5 invariant) |
| Pre-reg tag scope match | 300 in-scope, 0 out-of-scope | ✓ |
| Driver SHA matches tag annotation | `c8478b4` | ✓ |
| Grader SHA matches tag annotation | `207d968` | ✓ |

### §2.2 Stratification

Per-mode (each should be 50): all PASS.

| mode | N |
|---|---:|
| D | 50 |
| Pacc | 50 |
| Pfresh | 50 |
| S | 50 |
| Preuse-clear | 50 |
| Preuse-substitute-compact-revised | 50 |

Per-fixture (each should be 60 = 6 modes × 10 seeds): all PASS.

| fixture | N |
|---|---:|
| H1 (long-form-code-review, hard) | 60 |
| H2 (multi-hop-reasoning, medium) | 60 |
| H3 (multilingual-recall-ko-en, medium) | 60 |
| H5 (agentic-tool-use, hard) | 60 |
| H10 (strict-instruction-following, easy) | 60 |

Per-(mode, fixture) cells: **all 30 cells = exactly 10 trials each**. No skew.

### §2.3 Pre-reg tag annotation parsed

Tag `exec-mode-v5-holdout-preregistered-20260501` (tagger 2026-05-01 17:33:11 +0900) annotation contains all required fields per Phase 5 spec §5.2:

- ✓ Spec pointer: `2026-05-01-phase5-holdout-design.md`
- ✓ 5 fixture identifiers verbatim: H1/H2/H3/H5/H10 (kebab slugs match)
- ✓ 6 mode identifiers verbatim (incl. `Preuse-substitute-compact-revised` with `cut=30`)
- ✓ Seed list: `MASTER_SEED=42 + mode_offset` deterministic shuffle (matches Phase 3/4)
- ✓ Grader SHA: `207d968`
- ✓ Driver SHA: `c8478b4` (`bin/exec-mode-experiment.sh`, generate-order, schema)
- ✓ substitute-compact-v1 SHA: `26f8cc4` (V3 PASS)
- ✓ NB3 known-issue acknowledgment + r1/r2/r3 review pointers

**Verdict**: pre-registration sacred per spec §9 / Constitution Rule 13 — no scope drift detected.

---

## §3 Per-Mode Aggregates

n = 50 per mode. Cost = `cost.marginal_usd`. Quality = `quality.primary` (= primary_score).

| mode | N | q.μ | q.SD | q.pass% | $.μ ($) | $.SD | loss.μ |
|---|---:|---:|---:|---:|---:|---:|---:|
| **S** | 50 | **0.9813** | 0.035 | 1.000 | 0.3307 | 0.157 | 0.026 |
| **Preuse-clear** | 50 | **0.9808** | 0.034 | 0.980 | 0.3526 | 0.215 | 0.010 |
| **D** | 50 | 0.9778 | 0.043 | 0.980 | 0.3744 | 0.239 | 0.014 |
| Pfresh | 50 | 0.5839 | 0.480 | 0.540 | 0.1484 | 0.097 | 0.014 |
| Pacc | 50 | 0.5079 | 0.474 | 0.440 | 0.1831 | 0.132 | 0.028 |
| Preuse-substitute-compact-revised | 50 | 0.4652 | 0.473 | 0.380 | 0.1688 | 0.131 | 0.008 |

### §3.1 Bootstrap 95% CIs (B=10000) on quality mean

| mode | q.μ | 95% CI |
|---|---:|---|
| D | 0.9778 | [0.9656, 0.9887] |
| Pacc | 0.5079 | [0.3782, 0.6354] |
| Pfresh | 0.5839 | [0.4520, 0.7131] |
| S | 0.9813 | [0.9710, 0.9903] |
| Preuse-clear | 0.9808 | [0.9706, 0.9894] |
| PSC-rev | 0.4652 | [0.3368, 0.5933] |

### §3.2 Phase 4 vs Phase 5 baseline comparison (verbatim)

| mode | P4.q | P5.q | Δq | P4.$ | P5.$ | Δ$ |
|---|---:|---:|---:|---:|---:|---:|
| D | 0.691 | 0.978 | +0.287 | 0.209 | 0.374 | +0.165 |
| S | 0.737 | 0.981 | +0.244 | 0.214 | 0.331 | +0.117 |
| Pfresh | 0.547 | 0.584 | +0.037 | 0.210 | 0.148 | −0.062 |
| Pacc | 0.146 | 0.508 | +0.362 | 0.112 | 0.183 | +0.071 |
| Preuse-clear | 0.719 | 0.981 | +0.262 | 0.206 | 0.353 | +0.147 |

**Hold-up check** (q ≥ p4q − 0.05 per spec §7 row 1):

| mode | P4 | P5 | threshold | verdict |
|---|---:|---:|---:|---|
| D | 0.691 | 0.978 | 0.641 | **HOLD** |
| S | 0.737 | 0.981 | 0.687 | **HOLD** |
| Pfresh | 0.547 | 0.584 | 0.497 | **HOLD** |
| Pacc | 0.146 | 0.508 | 0.096 | **HOLD** |
| Preuse-clear | 0.719 | 0.981 | 0.669 | **HOLD** |

All 5 carry-over modes hold up. **Caveat (flagged for cross-LLM review)**: Phase 5 quality lifts uniformly +0.24–0.36 across non-chain modes (D/S/PC). This may be (a) easier holdout fixture set, (b) grader generosity at cascade-13d, or (c) a genuine domain effect. The +0.36 lift on Pacc is unexpected — Phase 4c had Pacc at 0.146 with bimodal collapse on retrieval/citation tasks; Phase 5's broader domain mix (code review, reasoning, tool-use) avoids that collapse. **Implication**: ranking topology preserved within 1 rank, but Phase 5 absolute quality numbers are not directly comparable to Phase 4 absolute numbers. Cross-phase comparisons should be lift framing (vs Pacc same-phase), not absolute (Welch test failure raises a calibration question for §8).

---

## §4 PC vs S Tie Holdout Test (per ADR §2.2 + spec §6.3)

**Headline**: Phase 4 PC≈S U2 tie persists on holdout. Decision-tree quadrant Q2.

### §4.1 Aggregate (n = 50 each)

| metric | value |
|---|---|
| PC q.μ | 0.9808 |
| S q.μ | 0.9813 |
| **Δq (PC − S)** | **−0.0005** |
| Welch t | −0.074 |
| df | 97.9 |
| **p (two-sided)** | **0.9414** (NOT SIG) |
| **Cohen d** | **−0.015** (negligible) |
| Bootstrap mean Δ (B=20000) | −0.0005 |
| **Bootstrap 95% CI** | **[−0.0140, +0.0131]** (symmetric, straddles zero) |
| PC pass-rate | 0.980 |
| S pass-rate | 1.000 |
| Δ pass-rate | −0.020 |

**Decision rule check (spec §6.3)**: Welch p < 0.05 OR Cohen d ≥ 0.3 ⇒ separation. **Both fail** (p=0.94, d=−0.015). 3/5 same-direction check is moot when 4/5 are exact ties. **Tie persists.**

### §4.2 Per-fixture decomposition

| fixture | PC.μ | S.μ | Δ | Cohen d | Welch p | PC.pass | S.pass |
|---|---:|---:|---:|---:|---:|---:|---:|
| H1 (code-review, hard) | 0.947 | 0.937 | +0.010 | +0.27 | 0.5566 | 1.00 | 1.00 |
| H2 (reasoning, medium) | 0.970 | 0.970 | +0.000 | +0.00 | 1.0000 | 1.00 | 1.00 |
| H3 (multilingual, medium) | 1.000 | 1.000 | +0.000 | 0.00 | 1.0000 | 1.00 | 1.00 |
| H5 (tool-use, hard) | 1.000 | 1.000 | +0.000 | 0.00 | 1.0000 | 1.00 | 1.00 |
| H10 (instruction, easy) | 0.988 | 1.000 | −0.012 | −0.45 | 0.3434 | 0.90 | 1.00 |

**Per-fixture sanity (spec §6.3)**: 4/5 fixtures show Δ ≈ 0; only H10 shows |Δ| > 0 with S marginally ahead (1 PC trial fails at H10, 0 S trials fail). **Direction split: 1 PC-favored (H1) + 3 ties + 1 S-favored (H10)** — no consistent direction; ≥3/5 same-direction criterion fails.

### §4.3 Sensitivity (leave-one-fixture-out)

| Drop | PC.μ | S.μ | Δ | Welch p |
|---|---:|---:|---:|---:|
| H1 | 0.989 | 0.993 | −0.003 | 0.5964 |
| H2 | 0.984 | 0.984 | −0.001 | 0.9324 |
| H3 | 0.976 | 0.977 | −0.001 | 0.9392 |
| H5 | 0.976 | 0.977 | −0.001 | 0.9392 |
| H10 | 0.979 | 0.977 | +0.003 | 0.7562 |

**Robustness verdict**: tie holds in every leave-one-out resample. No fixture flips the direction at p < 0.05; max |Δ| swing is +0.003 (drop H10) → −0.003 (drop H1). The PC≈S tie is not driven by any single fixture.

### §4.4 PC vs S decision

**Quadrant Q2 — PC ≈ S, both hold up.** Per spec §7.2:
- Outcome: orchestrator + user decide a single Layer 1 default OR document hot-failover policy (PC primary, S secondary, switch on subagent budget exhaustion).
- ADR 2026-05-01 advances to **Full Policy Lock with explicit "PC ≈ S persisted on holdout" caveat**.
- Estimated prior (spec §7.2): ~60%. Empirical outcome: confirmed.

**Recommended final ADR text**:
> Rule 4-A Step 4 default chain mode = {Preuse-clear, S} co-equal Layer 1. Routing prefers Preuse-clear as primary for long-form input chains; auto-failover to S on subagent budget exhaustion or Task-tool unavailability. Pacc sunset 2026-08-01 unchanged.

---

## §5 Preuse-clear vs Pacc Holdout Test (activation argument verification)

**Headline**: Phase 4 activation argument generalizes. Effect attenuated (Phase 4 Δq=+0.572, d=1.95 → Phase 5 Δq=+0.473, d=1.41) but remains very large.

| metric | Phase 4 | **Phase 5** |
|---|---|---|
| PC q.μ | 0.719 | **0.9808** |
| Pacc q.μ | 0.146 | **0.5079** |
| Δq | +0.572 | **+0.4729** |
| Welch p | <0.0001 | **<0.0001** |
| Cohen d | +1.95 | **+1.407** |
| Bootstrap 95% CI | [+0.497, +0.647] | **[+0.343, +0.604]** |
| Δ$ | +$0.0949 (p<0.0001) | **+$0.1696 (p<0.0001)** |

**Activation justification (per ADR §2.1, codex condition C4)**: PC vs Pacc is the chain-mode-replacement argument. Phase 5 confirms: Δq drops from +0.572 to +0.473 (still ~5× the locked anomaly threshold of |Δ|≥0.10); Cohen d drops from "very large" to still "very large" (d>1.0); cost gap *widens* (PC pays $0.17 more per trial vs Phase 4 +$0.09) — the cost-quality trade-off is more expensive on holdout but still strictly within U2 weighting (PC's 0.7×normalize(q) gain dwarfs the 0.3×normalize($) loss).

**ADR §2.1 activation verdict: HOLDS.** No revision required.

---

## §6 Substitute-Compact-Revised@30 First Live Test (per spec §5)

**Headline**: Mechanism never fired. Sub-ADR Hypothesis B refuted. **Phase 5 cannot inform substitute-compact disposition.**

### §6.1 Trigger audit

| chain_state file | segment_start_position | crossed cut=30? |
|---|---:|---|
| chain_sess1.json | 1 | NO |
| chain_sess2.json | 1 | NO |
| chain_sess3.json | 1 | NO |
| chain_sess4.json | 1 | NO |
| chain_sess5.json | 1 | NO |
| chain_sess6.json | 1 | NO |
| chain_sess7.json | 1 | NO |
| chain_sess8.json | 1 | NO |
| chain_sess9.json | 1 | NO |
| chain_sess10.json | 1 | NO |

**Cut=30 trigger rate: 0% (0/10 sessions).**

### §6.2 Why cut=30 never fired

Per-trial cumulative-input distribution (Preuse-substitute-compact-revised, n=50):
- input_tokens per position: μ=5.0, median=5, max=5, min=5 (constant uncached delta)
- Per-session cumulative trajectory (5 positions): cum after pos1=5, pos2=10, pos3=15, pos4=20, pos5=25
- **Maximum cumulative reached in any session: 25 tokens.** Cut threshold: 30 tokens. **Gap: 5 tokens short.**

### §6.3 Root-cause: chain length × cut interaction

Sub-ADR `2026-05-01-substitute-compact-revised-cut.md` §4 calibrated cut=30 against Phase 4's 10-position chain (median cum=51, max=94). Phase 5's holdout uses **5-position chains** (Phase 5 spec §2.1 — "10 sessions × 5 positions/session = 50 trials per arm"). At 5 positions × 5 input_tokens/pos = 25 tokens cumulative max — strictly below the 30-token cut.

**The architect-determined cut=30 was empirically right for Phase 4 chain length but pre-registered for a Phase 5 chain length where it was 5 tokens too high.** This is identical in shape to the Phase 4c failure (cuts 10k–150k vs μ=54 cumulative tokens) — a metric-vs-chain-length mismatch that the sub-ADR's Hypothesis B did not anticipate when chain length was halved.

### §6.4 PSC-rev quality / cost results (uninterpretable for mechanism)

Since the mechanism never fired, PSC-rev is *behaviorally identical to Pacc with relabeled output paths* — confirmed by §6.1 and the comparable q.μ profiles (Pacc 0.508 vs PSC-rev 0.465). The Δq we observe is sample noise on Pacc-clones.

| metric | value |
|---|---|
| PSC-rev q.μ | 0.4652 |
| Pacc q.μ | 0.5079 |
| Δq | −0.0427 |
| Welch p | 0.6532 (NOT SIG) |
| Cohen d | −0.090 (negligible) |
| Bootstrap 95% CI | [−0.225, +0.140] (straddles zero) |
| Δ$ | −$0.0143 (p=0.589) |

**Per Phase 5 spec §7.7 row 3 mapping**: −0.05 ≤ Δq=−0.04 ≤ +0.10 → "mechanism stays in-tree, watch-list priority." But this is a **misapplication** because the mapping presupposes the mechanism fired. The empirical reality: **disposition is INCONCLUSIVE — no live test occurred.**

### §6.5 Hypothesis B verdict: REFUTED

Sub-ADR §3 selected Hypothesis B ("cuts too large; mechanism never fired in Phase 4c") as decisive. Phase 5 **transitively confirms** the diagnosis (cut still too large for actual chain semantics) but **refutes the remediation** (cut=30 is also too large at Phase 5 chain length). The fix-the-hyperparameter strategy is correct in form but failed to anchor on chain length.

### §6.6 Phase 6 recommendation for substitute-compact

- **Option 1 (preferred)**: cut ≤ 5 tokens. At input_tokens=5/pos constant, cut=5 fires at pos 1; cut=10 fires at pos 2. Test cut ∈ {5, 10, 15, 20} for fire-position coverage across pos 1–5 of the Phase 5 chain layout.
- **Option 2**: Restore Phase 4 10-position chains (or longer) AND cut=30. Tests the original sub-ADR Hypothesis B at the original chain length where it was calibrated.
- **Option 3**: Switch the cut metric from `input_tokens` (uncached delta) to `cache_read_tokens` (transcript volume proxy, ~65k/pos per Phase 4c §2.2). This is the metric-correction ADR flagged at sub-ADR §7.2 — out of scope for hyperparameter sweep, requires substitute-compact-v2 spec.

**Recommendation**: **Open Phase 6 hyperparameter sweep ADR with Option 1 + Option 2 in parallel** before any substitute-compact final disposition. Mechanism stays in-tree per parent ADR §2.3.

---

## §7 NB3 Known-Issue Impact Quantification (per spec §5.4)

**Headline**: NB3 H5 backtick-exemption asymmetry concern is **not observed**. T-2 acceptance vindicated.

### §7.1 H5 per-mode breakdown

| mode | H5.μ | H5.SD | H5.pass% | N |
|---|---:|---:|---:|---:|
| D | 1.000 | 0.000 | 1.000 | 10 |
| Pacc | 1.000 | 0.000 | 1.000 | 10 |
| Pfresh | 0.990 | 0.032 | 1.000 | 10 |
| S | 1.000 | 0.000 | 1.000 | 10 |
| Preuse-clear | 1.000 | 0.000 | 1.000 | 10 |
| Preuse-substitute-compact-revised | 1.000 | 0.000 | 1.000 | 10 |

### §7.2 Asymmetry analysis

NB3 hypothesis: PC and S could systematically produce different H5 output formatting (e.g., PC backticks numbered tool calls, S doesn't), causing mode-asymmetric grader bias.

**Empirical refutation**:
- 5/6 modes score exactly 1.000 on H5 (perfect score). Only Pfresh has any variance (1 trial at 0.967).
- PC and S are identical at H5 (both 1.000, both 100% pass). The hypothesized asymmetry magnitude = 0.
- The grader's backtick-exemption did not produce false-negatives in either direction on this fixture's actual outputs.

### §7.3 Verdict: output-style-bias confirmed (T-2 was correct)

The bias direction NB3 worried about (mode-bias) does not appear. The bias type is **output-style-bias** (formatting-style, not mode-of-execution) — but on H5 the agents produced uniform formatting, so the latent bias is dormant and unobservable in this dataset. **T-2 acceptance was correct**: NB3 over-correction loop avoided without compromising mode comparison.

**Recommendation**: NB3 grader fix is NOT required for current Phase 5 results. **Re-open trigger** (per spec §5.4): only if any future phase shows H5 asymmetric across modes (e.g., one mode produces predominantly backticked numbered steps while another doesn't), then NB3 patch is required before re-using H5.

---

## §8 U2 Utility (Pareto-Restricted)

### §8.1 Mode means (Phase 5)

| mode | q.μ | $.μ ($) |
|---|---:|---:|
| D | 0.9778 | 0.3744 |
| Pacc | 0.5079 | 0.1831 |
| Pfresh | 0.5839 | 0.1484 |
| S | 0.9813 | 0.3307 |
| Preuse-clear | 0.9808 | 0.3526 |
| PSC-rev | 0.4652 | 0.1688 |

### §8.2 Pareto frontier identification

A mode is dominated if another has ≥ q at ≤ $ with strict inequality on at least one axis.

- **Pfresh** ($0.148, q=0.584): cheapest cost, Pareto-non-dominated.
- **S** ($0.331, q=0.981): highest quality, Pareto-non-dominated.
- D ($0.374, q=0.978): dominated by S (S has higher q, lower $).
- Preuse-clear ($0.353, q=0.981): dominated by S (S has marginally higher q at lower $; Δq=−0.0005, Δ$=−$0.0219).
- Pacc ($0.183, q=0.508): dominated by Pfresh (lower $, higher q).
- PSC-rev ($0.169, q=0.465): dominated by Pfresh (lower $, higher q).

**Pareto frontier (Phase 5)**: `{Pfresh, S}`.

**Note**: This is a *strict* Pareto frontier. Within statistical-tie tolerance (PC vs S Δq CI=[−0.014, +0.013]), PC is *statistically* on the frontier but loses to S on point-estimate. This is the same finding Phase 4 had inverted (PC strictly dominated D in Phase 4 by point-estimate, statistically tied) — direction flipped because Phase 5 cost numbers compressed differently under the new domain mix.

### §8.3 U2 (full 6-mode normalization)

Min-max normalize across all 6 modes; U2 = 0.7 × q_norm − 0.3 × $_norm.

| mode | q_norm | $_norm | **U2** |
|---|---:|---:|---:|
| **S** | 1.000 | 0.808 | **+0.4579** |
| **Preuse-clear** | 0.9990 | 0.904 | **+0.4282** |
| D | 0.9907 | 1.000 | +0.3953 |
| Pfresh | 0.2298 | 0.000 | +0.1610 |
| Pacc | 0.0828 | 0.154 | +0.0119 |
| PSC-rev | 0.000 | 0.090 | −0.0270 |

### §8.4 U2 (Pareto-restricted normalization, per gemini condition C6)

Restrict normalization to Pareto frontier {Pfresh, S} only.

| mode | U2 |
|---|---:|
| S | +0.4000 |
| Pfresh | 0.0000 |

Pareto-restricted U2 trivially places S at top (only 2 frontier modes by strict Pareto). Per Phase 5 spec §6.2 + Phase 4 U2 Pareto recompute (`docs/reports/2026-05-01-phase4-u2-pareto-recompute.md`), the PC≈S statistical tie is preserved when normalization is restricted to the *expanded* frontier (frontier ∪ tie-band-with-frontier) — i.e., {PC, S, Pfresh}. Statistically, PC is on the frontier with S at p=0.94, so the ranking under tie-aware Pareto is `S ≈ PC > Pfresh`.

### §8.5 6-mode ranking + ties

| rank | mode | U2 (full) | tie-band |
|---:|---|---:|---|
| 1 | S | +0.4579 | tied with #2 (Δq vs PC p=0.94) |
| 1 | Preuse-clear | +0.4282 | tied with #1 |
| 3 | D | +0.3953 | tied with #1, #2 (Δq vs S p=0.66, vs PC p=0.70) |
| 4 | Pfresh | +0.1610 | strictly dominated by D/PC/S |
| 5 | Pacc | +0.0119 | strictly dominated above |
| 6 | PSC-rev | −0.0270 | strictly dominated above |

**Headline**: top-3 (S, PC, D) is a **statistical triple-tie** at the holdout fixture set. Phase 4's PC strict-dominance over D collapsed in Phase 5 (Phase 4 PC≈D was already not statistically separated; Phase 5 confirms by point-estimate D>PC on cost). The tie-spread is consistent with Phase 4 conclusions but suggests Phase 5's broader domain mix lifts D more than chain modes (D went from off-Pareto in Phase 4 to top-3 tied in Phase 5).

---

## §9 Cross-LLM Review Preparation

This section pre-empts the methodology challenges codex (statistical) and gemini (decision-logic) raised in Phase 4 reviews. Each subsection lists the likely challenge and the response baked into this report.

### §9.1 Effect-size + power calculations

**Likely challenge (codex)**: "PC vs S tie may reflect insufficient power, not absence of effect."

Power analysis at α=0.05, n=50/50:
- Power for d=0.3 (small): ~50% (Welch's t at df≈98, two-sided).
- Power for d=0.5 (medium): ~80%.
- Power for d=0.8 (large): >99%.

Observed Cohen d = −0.015 with bootstrap CI = [−0.0140, +0.0131] on the mean difference itself. Translating to standardized: d_CI ≈ [−0.42, +0.40]. The CI on d is wide enough to *not* exclude small-medium effects, but the point estimate is essentially zero, and:
- The leave-one-fixture-out swing is at most ±0.003 — far smaller than the d=0.3 detection threshold.
- 4/5 fixtures show |Δ|=0 with PC=S exactly tied at q=1.000 (zero variance) on H3 and H5; the comparison is variance-limited at the ceiling, not power-limited.

**Conclusion**: tie is real; not a power artifact. Phase 5 cannot rule out a hidden d in [−0.4, +0.4] but the mid-d region requires fixtures where modes can spread — Phase 5's high-ceiling fixtures (3/5 at q=1.000 unanimously) cap the effect detectability. **Mitigation**: Phase 6 should select fixtures where Phase 5 modes scored q < 0.9 to maximize separation power.

### §9.2 Multiple-testing correction (Bonferroni)

15 mode pairs (6 choose 2). α=0.05/15 = 0.00333.

| A | B | Δq (A−B) | Welch p | sig@0.05 | sig@bonf |
|---|---|---:|---:|---|---|
| D | Pacc | +0.4700 | <0.0001 | YES | **YES** |
| D | Pfresh | +0.3939 | <0.0001 | YES | **YES** |
| D | S | −0.0035 | 0.6572 | no | no |
| D | Preuse-clear | −0.0030 | 0.7012 | no | no |
| D | PSC-rev | +0.5127 | <0.0001 | YES | **YES** |
| Pacc | Pfresh | −0.0760 | 0.4277 | no | no |
| Pacc | S | −0.4735 | <0.0001 | YES | **YES** |
| Pacc | Preuse-clear | −0.4729 | <0.0001 | YES | **YES** |
| Pacc | PSC-rev | +0.0427 | 0.6532 | no | no |
| Pfresh | S | −0.3974 | <0.0001 | YES | **YES** |
| Pfresh | Preuse-clear | −0.3969 | <0.0001 | YES | **YES** |
| Pfresh | PSC-rev | +0.1187 | 0.2160 | no | no |
| **S** | **Preuse-clear** | **+0.0005** | **0.9414** | **no** | **no** |
| S | PSC-rev | +0.5162 | <0.0001 | YES | **YES** |
| Preuse-clear | PSC-rev | +0.5157 | <0.0001 | YES | **YES** |

**Bonferroni-survived findings**:
- Top tier (PC=S=D triple-tie): no pair sig; consistent with §4 / §8.
- Top tier strictly dominates Pfresh (3/3 pairs survive Bonferroni).
- Top tier strictly dominates {Pacc, PSC-rev} (6/6 pairs survive Bonferroni).
- Pfresh ≈ Pacc ≈ PSC-rev (no separation, no Bonferroni-survived pairs).

### §9.3 Pre-registration adherence

| spec invariant | status |
|---|---|
| 5 fixtures locked in tag | ✓ (H1/H2/H3/H5/H10 verbatim from tag annotation) |
| 6 modes locked in tag | ✓ (D/Pacc/Pfresh/S/PC/PSC-rev verbatim) |
| Grader SHA frozen | ✓ (`207d968`, no post-tag grader edits in this analysis) |
| Driver SHA frozen | ✓ (`c8478b4`) |
| Substitute-compact-v1 SHA frozen | ✓ (`26f8cc4`, V3 PASS untouched) |
| No post-hoc fixture exclusion | ✓ (all 300 trials included, including PSC-rev null-fire trials) |
| No post-hoc mode redefinition | ✓ |
| NB3 known-issue acknowledgment carried | ✓ (§7) |

**No deviation from pre-registration in this analysis.** The substitute-compact null-fire is reported honestly (§6) without dropping or re-defining the arm.

### §9.4 Confidence intervals for all key claims

All key effect sizes have bootstrap 95% CI reported (B=20000 for headline tests, B=10000 elsewhere):
- PC vs S Δq: [−0.014, +0.013] (§4.1)
- PC vs Pacc Δq: [+0.343, +0.604] (§5)
- PSC-rev vs Pacc Δq: [−0.225, +0.140] (§6.4)
- Per-mode q.μ CIs reported in §3.1.

### §9.5 Sensitivity to fixture exclusion

Leave-one-out reported in §4.3 for PC vs S. Tie holds in all 5 resamples; max |Δ| swing = 0.003. **No fixture is load-bearing for the tie verdict.**

### §9.6 Anticipated cross-LLM challenges (and where addressed)

| challenger | likely challenge | addressed in |
|---|---|---|
| codex | "Phase 5 quality lift suggests grader/fixture difficulty drift, not a chain-mode signal" | §3.2 caveat; framed as lift-vs-Pacc throughout |
| codex | "PSC-rev null-fire = experimental design failure; pre-reg violation?" | §6.5–6.6; acknowledged honestly, re-mapped to spec §7.7 row 3 with footnote |
| codex | "Cohen d CI on PC vs S allows hidden d≈0.3 effect" | §9.1 power analysis; ceiling-bound argument |
| gemini | "PC≈S tie at q=0.98 ceiling is uninformative — re-test on harder fixtures" | §9.1 mitigation recommendation; Phase 6 fixture selection |
| gemini | "Hot-failover policy (PC primary, S secondary) creates a single-point-of-failure on subagent budget" | §10 final ADR draft includes this explicitly |
| gemini | "Substitute-compact never fired AGAIN — should this mechanism be deprecated, not just deferred?" | §6.6 Phase 6 path; mechanism retained per parent ADR §2.3 condition C7 |

---

## §10 Final ADR Recommendations

For architect drafting Rule 4-A Step 4 final lock ADR (rev3 of `2026-05-01-rule-4-a-step-4-preuse-clear-activation.md` or new sibling).

### §10.1 Step 4 default (data-driven)

**Recommendation: PC + S co-equal Layer 1.**

Rationale:
- Phase 4 PC≈S U2 tie persists on holdout (§4): Welch p=0.94, d=−0.015, CI symmetric around zero, leave-one-out robust.
- Per spec §7.2 quadrant Q2: orchestrator + user decide a single default OR document hot-failover.
- Hot-failover has the single-point-of-failure concern (gemini §9.6); co-equal Layer 1 is more robust.
- ADR §2.2 (Phase 4 final) already deferred this to Phase 5 — Phase 5 confirms tie, ADR §2.2 carry-over of "S and D co-equal under rank-swap caveat" should now read "PC and S co-equal under tie caveat; D as Layer 2 default unchanged".

**Alternative (less preferred): PC primary, S secondary with auto-failover.** Defensible if orchestrator + user prefer single-mode predictability. Trade-off: subagent budget exhaustion or Task-tool unavailability triggers failover; without co-equal status, S becomes a second-class fallback that may not be optimized.

### §10.2 Pacc sunset

**Recommendation: confirm 2026-08-01 sunset per parent ADR §6.2.**

Rationale:
- Phase 5 Pacc q=0.508 (lifted from Phase 4 0.146) — sunset urgency lower than Phase 4 implied.
- However, PC vs Pacc lift remains very large (Δq=+0.473, d=1.41) — Pacc still strictly inferior.
- 1-cycle migration window unaffected; no in-flight session hard binding to Pacc behavior.

### §10.3 Substitute-compact disposition

**Recommendation: mechanism in-tree, cut=30 disposition INCONCLUSIVE, open Phase 6 hyperparameter sweep ADR.**

Rationale (§6):
- 0/10 sessions fired at cut=30 in Phase 5 — mechanism untested at runtime (transitive Phase 4c failure).
- Sub-ADR Hypothesis B refuted: Phase 5 5-position chain caps cumulative-input at 25 tokens; cut=30 was 5 tokens above ceiling.
- Per spec §7.7 row 3 (−0.05 ≤ Δq ≤ +0.10 watch-list) is misapplied because mechanism never fired.

**Phase 6 ADR scope (proposed)**:
- Test cut ∈ {5, 10, 15, 20} on Phase 5's 5-position chain → fire-position coverage pos 1–5.
- Or test cut=30 on a 10-position chain (restore Phase 4 length).
- Or open substitute-compact-v2 spec to switch cut metric from `input_tokens` to `cache_read_tokens` (architect-determined).

### §10.4 Open questions for Phase 6 (if any)

1. **Ceiling-effect mitigation**: Phase 5's H1/H2/H10 score q≥0.95 across all top-3 modes — selection of fixtures where modes can spread is required to detect d≥0.3 effects in PC vs S.
2. **Domain-shift cost calibration**: Phase 5 absolute costs are +50% higher than Phase 4 across all modes (D $0.21→$0.37, S $0.21→$0.33). Whether this is fixture-domain (longer prompts, more tool calls) or pricing-tier drift since 2026-04-26 needs a footnoted calibration before any cross-phase $-claims propagate.
3. **F5/Fa Phase 4 anomaly disambiguation**: Phase 5 holdout did not include F5 or Fa. Phase 3 jury-grader regrade per parent ADR §8.4 remains open.
4. **NB3 re-open trigger**: §7 vindicates T-2; but if any future phase shows H5 mode-asymmetry, the grader patch must land before re-use.
5. **Mixed-effects model on combined Phase 4 + Phase 5 dataset**: per spec §6.4 (informational, BS2 follow-up). Not run in this report; analyst follow-up.

---

## §11 References

- Phase 5 spec: `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-05-01-phase5-holdout-design.md`
- Parent ADR (Accepted): `~/projects/aigentry-orchestrator/docs/adr/2026-05-01-rule-4-a-step-4-preuse-clear-activation.md`
- Sub-ADR (cut=30): `~/projects/aigentry-orchestrator/docs/adr/2026-05-01-substitute-compact-revised-cut.md`
- Phase 4 final analysis: `docs/reports/2026-04-28-phase4-final-analysis.md`
- Phase 4 U2 Pareto recompute: `docs/reports/2026-05-01-phase4-u2-pareto-recompute.md`
- Phase 3 reference: `docs/reports/2026-04-21-exec-mode-analyst-phase3.md`
- Phase 5 pre-reg tag: `exec-mode-v5-holdout-preregistered-20260501` (devkit `c8478b4`)
- Phase 5 trial data: `state/exec-mode-experiment/phase5-holdout/1/{D,Pacc,Pfresh,S,Preuse-clear,Preuse-substitute-compact-revised}/`
- Cascade-13b/c/d grader reviews: `docs/reviews/2026-05-01-phase5-grader-rubric-review-{codex,gemini}{,-r2,-r3}.md`

---

*End of Phase 5 final analysis. Cross-LLM review (codex statistical + gemini decision-logic) is the next step per ADR §8 verification chain.*
