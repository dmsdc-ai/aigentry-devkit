# Phase 4 U2 Pareto-Restricted Recompute — α-step-12a (cascade-a)

**Author**: `aigentry-devkit-analyst-u2-pareto` session
**Date**: 2026-05-01
**Track**: #329 E27 — ADR §4 condition 6 (gemini)
**Authority**: `~/projects/aigentry-orchestrator/docs/adr/2026-05-01-rule-4-a-step-4-preuse-clear-activation.md` §4 cond 6
**Source data**: 1300 trials = 800 `phase4-replication` + 500 `phase4-preuse` (read-only)
**Method**: deterministic aggregation (`LC_ALL=C`, sorted by basename), spec utility weights (0.7/0.3) **unchanged**, no trials re-run
**Script**: `/tmp/u2_pareto_recompute.py` (one-off; not committed)

---

## §1 Goal

Re-compute U2 = 0.7·norm(q) − 0.3·norm($) using a normalization domain restricted to the Pareto-efficient frontier, and check whether the Preuse-clear vs S point-estimate tie (analyst report §6: 0.401 vs 0.400) survives outlier-domain pressure.

---

## §2 Pareto-Efficient Mode Identification

Domination rule: mode m is dominated iff ∃ m′ with (q[m′] > q[m] ∧ $[m′] ≤ $[m]) ∨ (q[m′] ≥ q[m] ∧ $[m′] < $[m]).

| mode | n | quality.μ | cost.μ ($) | dominated-by | in-frontier? |
|---|---:|---:|---:|---|:---:|
| D                              | 200 | 0.690768 | 0.208642 | Preuse-clear | — |
| **S**                          | 200 | **0.736549** | 0.214076 | (none) | ✓ |
| Pfresh                         | 200 | 0.546953 | 0.209964 | D, Preuse-clear | — |
| **Pacc**                       | 200 | 0.146389 | **0.111573** | (none) | ✓ |
| **Preuse-clear**               | 100 | 0.718507 | 0.206484 | (none) | ✓ |
| Preuse-substitute-compact-C1   | 100 | 0.154813 | 0.111961 | C3 | — |
| **Preuse-substitute-compact-C2** | 100 | 0.166799 | 0.117646 | (none) | ✓ |
| **Preuse-substitute-compact-C3** | 100 | 0.154882 | 0.111811 | (none) | ✓ |
| Preuse-substitute-compact-C4   | 100 | 0.138813 | 0.128619 | Pacc, C1, C2, C3 | — |

**Pareto frontier (5 modes)**: `S, Preuse-clear, Pacc, C2, C3`.

**Surprises vs spec hypothesis**:
- D is **off the frontier** (Preuse-clear: q +0.0277, $ −0.0022 — strict dominance). Confirms analyst §6 line 146.
- Pacc **is on the frontier** (cheapest cost, no other mode beats it on $ at ≥ Pacc quality).
- C2 and C3 are **technically Pareto-efficient** — they slot between Pacc and Preuse-clear on the trade-off curve. Spec expectation that "C1–C4 are dominated" only holds for C1 (C3 strictly beats it: same q at $0.111811 vs $0.111961) and C4 (dominated by all four cheap modes).

---

## §3 Restricted Normalization Domain

Computed over the 5-mode frontier:

| domain | q.min | q.max | q.span | $.min | $.max | $.span |
|---|---:|---:|---:|---:|---:|---:|
| **all-9** (analyst §6) | 0.138813 (C4) | 0.736549 (S) | 0.597736 | 0.111573 (Pacc) | 0.214076 (S) | 0.102503 |
| **pareto-only** (this report) | 0.146389 (Pacc) | 0.736549 (S) | 0.590160 | 0.111573 (Pacc) | 0.214076 (S) | 0.102503 |

**Net change**: only `q.min` shifts (C4 → Pacc), Δq.span = −0.007576 (−1.27%). Cost domain identical because Pacc anchors $.min in both regimes and S anchors $.max. Gemini's P4 conjecture that "C1–C4 anchor the cost minimum" does **not** hold — Pacc itself is the cost floor, and removing C1–C4 leaves it untouched.

---

## §4 U2 — All-9 vs Pareto-Restricted (9-mode comparison)

| mode | q.μ | $.μ | qN_a | $N_a | **U2_all9** | qN_p | $N_p | **U2_pareto** | Δ |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Preuse-clear**               | 0.7185 | 0.2065 | 0.970 | 0.926 | **+0.4011** | 0.969 | 0.926 | **+0.4008** | −0.0003 |
| **S**                          | 0.7365 | 0.2141 | 1.000 | 1.000 | **+0.4000** | 1.000 | 1.000 | **+0.4000** | +0.0000 |
| D                              | 0.6908 | 0.2086 | 0.923 | 0.947 | +0.3623 | 0.922 | 0.947 | +0.3616 | −0.0007 |
| Pfresh                         | 0.5470 | 0.2100 | 0.683 | 0.960 | +0.1900 | 0.679 | 0.960 | +0.1872 | −0.0029 |
| Preuse-substitute-compact-C3   | 0.1549 | 0.1118 | 0.027 | 0.002 | +0.0181 | 0.014 | 0.002 | +0.0094 | −0.0087 |
| Preuse-substitute-compact-C1   | 0.1548 | 0.1120 | 0.027 | 0.004 | +0.0176 | 0.014 | 0.004 | +0.0089 | −0.0087 |
| Preuse-substitute-compact-C2   | 0.1668 | 0.1176 | 0.047 | 0.059 | +0.0150 | 0.035 | 0.059 | +0.0064 | −0.0086 |
| Pacc                           | 0.1464 | 0.1116 | 0.013 | 0.000 | +0.0089 | 0.000 | 0.000 | **+0.0000** | −0.0089 |
| Preuse-substitute-compact-C4   | 0.1388 | 0.1286 | 0.000 | 0.166 | −0.0499 | −0.013 | 0.166 | −0.0589 | −0.0090 |

**Ranking under both domains is identical** (PC > S > D > Pfresh > C3 > C1 > C2 > Pacc > C4). Pareto restriction shifts every mode's U2 by ≤0.009 absolute; the Preuse-clear − S point gap shrinks slightly (+0.0011 → +0.0008).

---

## §5 Bootstrap CI — Preuse-clear vs S U2 Difference

B = 20 000 trial-level resamples (with replacement) from each mode; fixed normalization bounds taken from the original point estimates above; seed = 42.

| domain | mean ΔU2 (PC − S) | 95% CI | P(PC > S) |
|---|---:|---|---:|
| **Pareto-only** (this report) | +0.000594 | **[−0.1262, +0.1212]** | **0.5092** |
| All-9 (codex review C6 reproduces +0.001 / [−0.114, +0.110] / 0.504) | +0.000862 | [−0.1248, +0.1205] | 0.5109 |

CIs straddle zero by ~120× the point estimate in both regimes. Pareto restriction does not separate PC from S.

---

## §6 Verdict

**Tie holds.**

- Pareto-only PC − S point gap: +0.0008 (vs +0.0011 all-9). Direction unchanged, magnitude essentially unchanged.
- 95% bootstrap CI [−0.126, +0.121] includes 0; P(PC > S) = 0.509 — a coin flip.
- Outlier-domain compression hypothesis (gemini P4) is empirically falsifiable: the only domain change was q.min (C4 → Pacc), a 1.27% span reduction; this is too small to move the U2 needle.

Neither "PC margin grew" nor "S margin grew" applies.

---

## §7 Implication for ADR §4 Condition 6

**Condition 6 confirmed: restricted U2 reproduces the Preuse-clear ≈ S statistical tie.**

The narrow +0.001 lead in the original analyst §6 ranking is a numerical artifact, not an outlier-distortion artifact. Removing C1–C4 from the normalization domain would have re-anchored q.min and could in principle have stretched the high end of the q-axis differently — empirically it does not, because C4 (q=0.139) was only 0.008 below the next-lowest mode (Pacc q=0.146). The analyst's "Preuse-clear narrowly best on U2" framing should be replaced in ADR language with **"Preuse-clear ≈ S (tied within bootstrap CI)"** — consistent with codex review condition 3.

---

## §8 Implication for Phase 5 (Condition 5 — both PC and S in holdout)

**Condition 5 remains warranted.** Two independent normalization regimes (all-9 and Pareto-only) both place PC and S inside a single bootstrap CI; restricting to viable modes does not break the symmetry. Phase 5 must adjudicate PC vs S directly under holdout fixtures rather than ratify a 0.001-point ranking decision. Selecting only Preuse-clear would commit the same point-estimate-as-truth fallacy under both domains.

**Side note for cascade-c (fixture selection)**: the per-fixture Pareto question raised by gemini P7 (whether S dominates on reasoning fixtures while PC dominates on retrieval) is **not** answered here — this recompute is at the mode-aggregate level only. Holdout fixture choice should preserve the ability to test that conjecture.

---

*End of report. Mandatory orchestrator inject follows in separate channel.*
