---
title: "Phase 6 Q2 final analysis cross-LLM review - statistical methodology"
date: 2026-05-03
session: aigentry-reviewer-phase6-q2-codex
status: DONE
review_target: docs/reports/2026-05-03-phase6-q2-final-analysis.md
pre_reg_tag: exec-mode-v6-preregistered-20260502
verdict: ACCEPT_WITH_CONDITIONS
---

# Phase 6 Q2 Codex Review - Statistical Methodology

## Executive verdict

**ACCEPT_WITH_CONDITIONS.** The analyst's arithmetic is reproducible from the
150 raw `metrics.json` files, and the pre-registered Q2 decision rule resolves
to **PROMOTE D via branch (b)**:

| Gate | Independent recompute | Verdict |
|---|---:|---|
| TOST D vs PC | Delta=+0.006894; 90% CI=[-0.004417, +0.018205]; p_max=8.09e-09 | CONFIRMED |
| TOST D vs S | Delta=+0.011476; 90% CI=[-0.003360, +0.026312]; p_max=2.70e-05 | CONFIRMED |
| Superiority D vs lower of {PC,S}=S | Welch one-sided p=0.100645; MW asymptotic p=0.313303 | NS CONFIRMED |

No blocker invalidates the spec-authorized PROMOTE outcome. The largest
methodology issue is interpretation: this is **statistical equivalence plus a
pre-registered operational tie-breaker**, not statistical superiority and not
new empirical proof of cross-CLI portability.

Issue counts: **0 BLOCKERS, 5 MAJORS, 3 MINORS**.

---

## §1 Pre-registration adherence

**Active design matches the trial data.** The binding post-§3.2.1 grid is
3 modes x 2 fixtures x 25 seeds = 150 trials:

| Cell | Mode | Fixture | n | status=ok |
|---|---|---|---:|---:|
| Q2-D-H1 | D | H1 | 25 | 25 |
| Q2-D-H10 | D | H10 | 25 | 25 |
| Q2-PC-H1 | Preuse-clear | H1 | 25 | 25 |
| Q2-PC-H10 | Preuse-clear | H10 | 25 | 25 |
| Q2-S-H1 | S | H1 | 25 | 25 |
| Q2-S-H10 | S | H10 | 25 | 25 |
| **Total** | | | **150** | **150** |

I found 150 `metrics.json` files and all 150 have `status="ok"`. There are no
missing trials, extra cells, or post-hoc trial exclusions.

**Fallback status.** H11-H14 were dropped under the explicit §3.2.1 fallback
after Q4 r5 returned 0/8 qualifying fixtures. That is a post-tag procedural
correction, but it is documented before Q2 fire and is the active binding
design. The consequence is real: the verdict is scoped to H1+H10 task profiles.

**Sensitivity labeling.** The analyst labels H1/H10 stratification as
sensitivity and keeps aggregate H1+H10 as the binding endpoint. That respects
the codex C3 lesson from Q1.

---

## §2 SD=0 statistical handling

### §2.1 Raw cause of SD=0

Both D cells are deterministic across all 25 seeds:

| Cell | q values | Underlying grader components |
|---|---|---|
| Q2-D-H1 | 25/25 at 0.9565 | matched B1-B5, missed B6; `tp_weight=11`, `fn_weight=1`, `fp_weight=0`; precision=1.0, recall=0.9167, weighted F1=0.9565 |
| Q2-D-H10 | 25/25 at 1.0000 | 8/8 strict-instruction constraints passed |

So D-H1 is **not** a simple "5/6 constraints" score. It is severity-weighted F1:
`2 * precision * recall / (precision + recall) = 0.9565` after rounding. D-H10
is the simple 8/8 constraint case.

The deterministic D output is consistent with the harness model: Q2 runner marks
D as non-chain, D trials have `position_in_chain=null`, no D `chain_sess*.json`
files exist, and `harness_stage1_live_D` sends `setup_history.md + task_prompt.md`
to a cold `claude --print` call.

### §2.2 Welch-Satterthwaite with one zero-SD arm

The analyst's edge-case formula is correct for stratified cell-level checks.
If one arm has `s^2=0` and the comparator has nonzero variance:

`SE = sqrt(0/n_D + s_comp^2/n_comp) = s_comp / sqrt(n_comp)`

and Welch-Satterthwaite df reduces to `n_comp - 1`.

Examples from the raw data:

| Test | SE | df | 90% CI |
|---|---:|---:|---|
| H1 D vs PC | 0.008788 | 24 | [-0.006247, +0.023823] |
| H1 D vs S | 0.005505 | 24 | [-0.001466, +0.017370] |
| H10 D vs PC | 0.005000 | 24 | [-0.003554, +0.013554] |
| H10 D vs S | 0.015000 | 24 | [-0.010663, +0.040663] |

The CI does **not** degenerate because the comparator side has variance. It
would degenerate only if both arms had zero variance; that case is not present.

Important nuance: the **binding aggregate D arm is not SD=0**. Pooling D-H1
and D-H10 gives `mean=0.978250`, sample `SD=0.021971` because H1 and H10 have
different deterministic cell means. The analyst's final aggregate TOST CIs use
this nonzero aggregate D SD. A paragraph in §3.2 of the analyst report blurs
cell-level and aggregate SE, but the final reported CIs are correct.

### §2.3 Three-method convergence

**Welch/TOST confirmed.** Both aggregate TOST CIs are inside +/-0.05, and the
superiority Welch test remains non-significant.

**Mann-Whitney confirmed for superiority sensitivity.**

| Comparison | U | asymptotic p | exact-with-ties p |
|---|---:|---:|---:|
| D > PC aggregate | 1300.0 | 0.348191 | 0.367019 |
| D > S aggregate | 1312.5 | 0.313303 | 0.336452 |
| H1 D > PC | 325.0 | 0.168528 | 0.408752 |
| H1 D > S | 337.5 | 0.080713 | 0.322136 |

All are non-significant, including the H1-only alternative.

**Exact-equivalence is only an inspection check.** It is reasonable to say the
constant D cell means are inside the +/-0.05 margin relative to PC/S means, but
that is not an independent formal statistical method and should not be presented
as equal in status to the pre-registered Welch TOST. It supports the intuition;
it does not replace CI-based equivalence testing.

---

## §3 §2.2.1 dual-gate verdict integrity

### §3.1 TOST D vs PC

| Quantity | Value |
|---|---:|
| mean(D) | 0.978250 |
| mean(PC) | 0.971356 |
| Delta D-PC | +0.006894 |
| SE | 0.0067896 |
| df | 73.2583 |
| 90% CI | [-0.004417, +0.018205] |
| TOST p_lower | 1.33e-12 |
| TOST p_upper | 8.09e-09 |
| TOST p_max | 8.09e-09 |

TOST D vs PC is **CONFIRMED**.

### §3.2 TOST D vs S

| Quantity | Value |
|---|---:|
| mean(D) | 0.978250 |
| mean(S) | 0.966774 |
| Delta D-S | +0.011476 |
| SE | 0.0088857 |
| df | 62.3924 |
| 90% CI | [-0.003360, +0.026312] |
| TOST p_lower | 1.45e-09 |
| TOST p_upper | 2.70e-05 |
| TOST p_max | 2.70e-05 |

TOST D vs S is **CONFIRMED**.

### §3.3 Superiority component

PC mean is 0.971356 and S mean is 0.966774, so the lower incumbent is S.

| Test | Statistic | p |
|---|---:|---:|
| Welch one-sided D > S | t=1.2915, df=62.3924 | 0.100645 |
| Mann-Whitney one-sided D > S | U=1312.5 | 0.313303 |
| Cohen d D-S | 0.2583 | |

Superiority is **not significant** at uncorrected α=0.05 or Bonferroni
α=0.00714.

### §3.4 Branch (b) authorization

Spec §2.2.1 explicitly permits promotion when both TOSTs hold and equivalence is
the strongest statistical claim, using the operational-advantage tie-breaker.
Spec §12.3 then disambiguates branch (b) as: TOST holds, superiority p >=
0.00714, promote on the operational tie-breaker.

Therefore branch (b) is procedurally authorized **without superiority**. It is
not post-hoc. The ADR must still state the basis precisely: the statistical
evidence establishes equivalence within +/-0.05; the promotion decision then
uses a pre-registered operational policy preference.

---

## §4 Bonferroni family

The binding spec does **not** treat Q2 as a standalone three-test Bonferroni
family. Spec §7.5 defines a seven-member superiority Welch family:

1. Five Q1 substitute-compact superiority comparisons.
2. Q2 D vs PC superiority.
3. Q2 D vs S superiority.

So the superiority threshold is `0.05 / 7 = 0.00714`.

TOST tests are explicitly outside that superiority family and use uncorrected
α=0.05. Even if a reviewer forced a stricter TOST correction, the aggregate Q2
TOST p-values would still pass: D-vs-PC p_max=8.09e-09 and D-vs-S
p_max=2.70e-05.

The analyst's α threshold is correct for the superiority component. One minor
omission: §7.5 lists both D-vs-PC and D-vs-S superiority comparisons in the
family, while the branch decision only needs D vs the lower incumbent. D-vs-PC
is also NS (`p=0.156635`), so the omission does not change the verdict.

---

## §5 H1-only sensitivity

H1-only sensitivity agrees with the aggregate verdict.

| H1 test | Delta | 90% CI | TOST | Welch superiority p | MW asymptotic p |
|---|---:|---|---|---:|---:|
| D vs PC | +0.008788 | [-0.006247, +0.023823] | PASS | 0.163643 | 0.168528 |
| D vs S | +0.007952 | [-0.001466, +0.017370] | PASS | 0.080746 | 0.080713 |

Under the H1-only view, both equivalence tests pass and superiority remains
non-significant. The rank-based alternative does not create a conflicting
signal.

---

## §6 H10 ceiling impact

H10 is ceiling-adjacent:

| Mode | H10 mean | H10 SD | Distribution note |
|---|---:|---:|---|
| D | 1.000 | 0.000 | 25/25 at 8/8 constraints |
| PC | 0.995 | 0.025 | 24/25 at 1.0; one C7 failure at 0.875 |
| S | 0.985 | 0.075 | 24/25 at 1.0; one C1/C5/C7 failure at 0.625 |

H10-only TOST still passes:

| H10 test | Delta | 90% CI | TOST p_max |
|---|---:|---|---:|
| D vs PC | +0.005000 | [-0.003554, +0.013554] | 1.85e-09 |
| D vs S | +0.015000 | [-0.010663, +0.040663] | 0.014169 |

The D-vs-S H10 sensitivity is the loosest equivalence check and depends on the
spec's uncorrected TOST convention. Since H10 is near ceiling across all modes,
it cannot support a broad "D is better" story. It supports only the narrower
claim that D is not practically worse on this strict-instruction fixture.

The analyst captures the H10 caveat and correctly points to H1 as the
signal-bearing fixture. The ADR should keep that caveat visible.

---

## §7 Branch (b) tie-breaker scrutiny

### §7.1 Operational claims

**D non-chain / no chain-state burden: verified.** The Q2 runner marks D as
`chain=false`, D trials have no session or position fields, the D state root has
zero `chain_sess*.json` files, and the harness cold-starts with
`setup_history.md + task_prompt.md`. This claim is supported by both code and
raw metrics.

**Cross-CLI portable: architecturally plausible but not empirically tested in
Q2.** Rule 4-A Step 5 treats D as the external/orchestrator default because S is
not available at that layer. But Q2 itself used the Claude harness path
(`claude --print`) for live Stage 1. The `metrics.json` files record CLI
versions for Claude/Codex/Gemini, but they are not Codex/Gemini execution data.

### §7.2 Empirical status of branch (b)

Branch (b) has **procedural support** because it is pre-registered in §2.2.1 and
§12.3. It has **partial empirical support** for no chain-state burden because
D's SD=0 cells demonstrate reproducibility under fixed inputs. It does **not**
have Q2 empirical support for cross-CLI parity.

So the tie-breaker basis is **ambiguous**: strong as a spec-authorized policy
tie-breaker, weak as a data-driven operational superiority claim.

### §7.3 WATCHLIST alternative

WATCHLIST would be a conservative policy override, but it is not the Q2 spec
outcome. The Q2 decision table has only PROMOTE when both TOSTs plus
superiority/tie-breaker hold, or MAINTAIN when dual TOST fails. Since branch (b)
holds, the reviewer should not reject PROMOTE. The right control is ADR wording
and follow-up conditions, not changing the pre-registered outcome after the fact.

---

## §8 §3.2.1 fallback impact assessment

The fallback is valid but narrows external validity:

- Original Q2 intended H1 + H11-H14 across five fixtures.
- Q4 r5 failed to produce qualifying H11-H14 fixtures.
- Active Q2 therefore uses H1 + H10 only, with n=25 per cell to preserve
  N=50 per mode.

This preserves nominal per-mode power for aggregate TOST, but it reduces domain
coverage from five fixture surfaces to two. The verdict applies to long-form
code review and strict instruction following. It does not license broad claims
for agentic tool use, multilingual summarization, structured extraction, or
other non-H1/H10 profiles.

The analyst respects this by treating H1/H10 decomposition as sensitivity and by
recording the external-validity caveat. Phase 7 should re-test D on a
non-ceiling, non-H1/H10 fixture set before broadening the deployment claim.

---

## §9 4-way Layer 1 architecture

Q1 is now accepted via the substitute-compact sub-ADR, and Q2 promotes D under
branch (b). The resulting state is spec §9.4 **S1**:

`{PC, S, D, substitute-compact-at-winning-cut}`.

The spec did anticipate S1 as a 4-candidate set in §9.4, but OQ-P6-1 is worded
as a "3-way" selector problem when D promotes. After the accepted Q1 sub-ADR
selected a chain-length-conditional substitute-compact policy, the real selector
problem is 4-way:

`PC / S / D / substitute-compact-conditional`.

This is a critical follow-up. A Phase 6 conclusion ADR that promotes both Q1 and
Q2 without pre-registering or locking a deterministic selector would leave Rule
4-A Step 4 under-specified.

---

## §10 Cost-benefit

Cost and utility recompute:

| Mode | mean q | mean cost | total cost | norm q | norm cost | U2 |
|---|---:|---:|---:|---:|---:|---:|
| D | 0.978250 | 0.383106 | 19.155288 | 1.000 | 1.000 | 0.4000 |
| PC | 0.971356 | 0.366754 | 18.337682 | 0.399 | 0.000 | 0.2795 |
| S | 0.966774 | 0.369706 | 18.485292 | 0.000 | 0.181 | -0.0542 |

D has the highest quality and highest cost. The cost premium is +4.5% vs PC and
+3.6% vs S. Under the spec's U2 formula, D ranks first.

D does not strictly Pareto-dominate PC because PC is cheaper. PC strictly
dominates S on quality and cost in this Q2 dataset. "D non-chain" is not a cost
advantage in the measured data; it is an operational simplicity advantage.

---

## §11 BLOCKERS / MAJORS / MINORS

### BLOCKERS

None. I found no data-count, pre-registration, threshold, or arithmetic failure
that invalidates PROMOTE under §2.2.1 branch (b).

### MAJORS

**M1 - Promotion is equivalence plus operational policy, not superiority.**
Superiority is NS by Welch and Mann-Whitney. The final ADR must not imply D
statistically outperformed PC/S.

**M2 - Cross-CLI portability is imported rationale, not Q2 evidence.** Q2 used
Claude execution. Cross-CLI parity for D should be a Phase 7 verification or an
explicit architectural assumption inherited from Rule 4-A Step 5.

**M3 - External validity is narrowed to H1+H10.** H11-H14 were dropped and H10 is
ceiling-adjacent. Any broad-domain D-promotion wording would overclaim.

**M4 - The 4-way selector is now critical.** Q1+Q2 promote produces
PC/S/D/substitute-compact-conditional. OQ-P6-1 must be resolved before the Phase
6 conclusion ADR can claim a deterministic Rule 4-A Step 4.

**M5 - SD=0 is statistically handled, but substantively important.** D's cell
replicates are point masses under fixed inputs. This supports reproducibility,
but it should not be described as 25 independent demonstrations of stochastic
robustness within each D fixture.

### MINORS

**N1 - "Exact-equivalence" should be downgraded to inspection.** It is useful
intuition, not a third formal statistical method.

**N2 - Analyst §3.2 blurs cell-level and aggregate SD.** The final numbers are
correct, but the prose should say aggregate D SD is nonzero while stratified D
SD is zero.

**N3 - Report D-vs-PC superiority for completeness.** Spec §7.5 includes both
D-vs-PC and D-vs-S in the superiority family. D-vs-PC is harmlessly NS
(`p=0.156635`), but including it improves auditability.

---

## §12 Top conditions for sub-ADR

1. **ADR MUST state the exact branch: TOST equivalence confirmed for D-vs-PC and
   D-vs-S; superiority NS; PROMOTE occurs only through §2.2.1 / §12.3 branch (b)
   operational tie-breaker.**
2. **ADR MUST label the operational tie-breaker as external policy rationale,
   not Q2 statistical evidence.** D non-chain/no-state burden is verified here;
   cross-CLI portability is not.
3. **ADR MUST scope the result to H1+H10 task profiles** and open a Phase 7
   non-ceiling, non-H1/H10 external-validity sweep before broad deployment
   claims.
4. **Phase 6 conclusion MUST resolve the 4-way deterministic selector** for
   `{PC, S, D, substitute-compact-conditional}` before updating Rule 4-A Step 4.
5. **ADR MUST preserve the SD=0 methodology caveat:** aggregate D SD is nonzero;
   stratified SD=0 CIs use comparator variance and df=n-1; exact-equivalence is
   inspection only.
6. **ADR SHOULD include the full multiple-testing statement:** seven-test
   superiority family at α=0.00714; TOST exempt at α=0.05 per spec; D-vs-PC
   superiority NS and D-vs-S superiority NS.

---

## Appendix - Reproducibility notes

All numbers above were recomputed directly from:

`state/exec-mode-experiment/phase6-q2/**/metrics.json`

Key formula choices:

- Sample SD (`statistics.stdev`) for Welch/TOST.
- Welch SE: `sqrt(s1^2/n1 + s2^2/n2)`.
- Welch-Satterthwaite df.
- TOST CI: `Delta +/- t_0.95,df * SE`.
- Mann-Whitney: SciPy `mannwhitneyu(..., alternative="greater", method="asymptotic")`;
  exact-with-ties p-values reported as sensitivity where relevant.
- U2: `0.7 * normalized_quality - 0.3 * normalized_cost`.

References used:

- `docs/reports/2026-05-03-phase6-q2-final-analysis.md`
- `docs/reports/2026-05-03-phase6-q2-fire.md`
- `/Users/duckyoungkim/projects/aigentry-orchestrator/docs/superpowers/specs/2026-05-02-phase6-design.md`
- `/Users/duckyoungkim/projects/aigentry-orchestrator/docs/adr/2026-05-01-rule-4-a-step-4-final-lock.md`
- `/Users/duckyoungkim/projects/aigentry-orchestrator/docs/adr/2026-05-03-substitute-compact-phase6-promote.md`
- `bin/exec-mode-phase6-q2-runner.py`
- `bin/exec-mode-experiment.sh`
- `bin/exec-mode-grader.py`
