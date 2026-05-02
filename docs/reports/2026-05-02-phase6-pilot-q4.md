---
date: 2026-05-02
status: pilot-complete
track: "#329 E27 Phase 6 — Q4 fixture calibration pilot"
spec: aigentry-orchestrator/docs/superpowers/specs/2026-05-02-phase6-design.md (§3.4)
tag: exec-mode-v6-preregistered-20260502 (object a7b77d9, points to 4eefc0a)
runner: aigentry-runner-phase6-pilot
trial_count: 20 (4 fixtures × Mode D × 5 seeds)
wall_clock: 329s (~5.5min, live LLM path)
verdict: REDESIGN — 0/4 fixtures land in pre-registered acceptance band [0.5, 0.85]
---

# Phase 6 Q4 Pilot — Fixture Calibration (H11–H14, Mode D)

## TL;DR

**0/4 of the dustcraw-authored Q4 fixtures (H11, H12, H13, H14) land in the pre-registered acceptance band q ∈ [0.5, 0.85] under Mode D**. All four exhibit ceiling effect (mean q ≈ 1.0). Per Phase 6 spec §3.4 acceptance criterion, **all four require redesign before Q2 binding fire** (or a documented fallback to the original 4-fixture grid per spec §8.3 #2). Q2 D-promotion test power is **blocked** until a non-ceiling Q4 fixture set is delivered.

## §1 Pilot scope

- **Spec source**: Phase 6 design §3.4 (Q4 — Fixture pilot design; out-of-grid; H11–H14 calibration).
- **Pre-conditions verified at tag time**: spec §8.3 #1, #3–7 + lint exit-0 + pytest fixture lint 11/11 + grader baseline 385/1-skipped (see tag annotation).
- **Design**: 4 candidate fixtures × Mode D × 5 seeds = **20 trials**, deterministic seed `MASTER_SEED=42 + offsets` (Phase 5-equivalent).
- **Acceptance criterion** (spec §3.4): per-fixture mean q ∈ [0.5, 0.85] → admit to Q2 grid; outside band → flag for redesign.
- **Path**: live LLM (claude --print, claude CLI 2.1.114), `bin/exec-mode-experiment.sh`, fixtures-root `state/fixtures/phase6-followup`.

## §2 Per-fixture results

| Fixture | n | seeds q | mean q | std | band [0.5, 0.85] | verdict |
|---|---|---|---|---|---|---|
| **H11** | 5 | 1.0, 1.0, 1.0, 1.0, 1.0 | **1.000** | 0.000 | ABOVE | ceiling — REDESIGN |
| **H12** | 5 | 1.0, 0.667, 1.0, 1.0, 1.0 | **0.933** | 0.149 | ABOVE | ceiling (1 seed in band) — REDESIGN |
| **H13** | 5 | 1.0, 1.0, 1.0, 1.0, 1.0 | **1.000** | 0.000 | ABOVE | ceiling — REDESIGN |
| **H14** | 5 | 1.0, 1.0, 1.0, 1.0, 1.0 | **1.000** | 0.000 | ABOVE | ceiling — REDESIGN |

**Aggregate**: 0/4 in-band; 4/4 above ceiling; 19/20 individual trials at q=1.0; 1/20 at q=0.667; 0/20 below floor 0.5; 0 trial failures (status=ok for all 20).

## §3 Interpretation

### §3.1 Ceiling pattern is robust

H11, H13, H14 each show q=1.0 across all 5 seeds (std=0). Variation in seed/probe ordering produces no quality degradation — Mode D solves these fixtures perfectly. H12 has a single seed=2 outlier at q=0.667 (one probe missed), but the other four seeds are q=1.0 and the mean (0.933) is still well above the 0.85 ceiling.

### §3.2 Implication for Q2 D-promotion power (§3.2 + §9.2)

Q4 was admitted into Phase 6 specifically because the Phase 5 H1+H10 fixture set was suspected to ceiling under D, masking a real PC=S=D triple-tie that may collapse on harder fixtures (per analyst §10.4 #1, brainstorm §4 enabling). The pilot confirms the **opposite of what Q4 needed**: the four candidate fixtures are themselves ceiling under D. They cannot detect D-vs-PC separation because all three modes (D, PC, S) plausibly score q=1.0 on them.

Per spec §2.6 decision #6 ("Q4 inclusion: ceiling-fixture replacement INCLUDED (mandatory for Q2 power)"), the calibration outcome leaves Q2 underpowered against the same ceiling threat Phase 5 already encountered.

### §3.3 Pre-registration integrity preserved

Pilot ran **after** the pre-reg tag commit (tag SHA `a7b77d9`, repo HEAD `4eefc0a`). Per dispatch hard rule "pilot is calibration only — does NOT count toward Q1/Q2 binding hypotheses", the calibration result does not retroactively alter the spec, the §9.1/§9.2/§9.3 decision logic, or the binding fixture set bound by the tag at commit time. Any redesign of H11–H14 will land as a new commit; whether the Phase 6 binding fixture set is amended pre-fire (with re-tag) or the original set is honored with documented fallback is an orchestrator decision per spec §8.3 #2.

## §4 Recommendations

### §4.1 Primary recommendation: redesign H11–H14 (or some subset) before Q2 fire

The pilot's pre-registered failure mode triggers spec §3.4 redesign clause. Recommended redesign actions (orchestrator dispatches; not bound by this report):

1. **Increase difficulty** along the dimensions H11–H14 already exercise (recall pairs, summary fidelity, route enumeration, tool-sequence ordering): more entries, more confusable distractors, longer warmup, multi-hop dependencies.
2. **Ceiling escape verification per fixture**: each redesigned fixture must show mean q ∈ [0.5, 0.85] over a 5-seed re-pilot under Mode D before re-admission.
3. **Iteration cap**: spec §3.4 does not specify a redesign-iteration limit. Recommend ≤2 redesign iterations per fixture before falling back to §8.3 #2 alternative ("fallback to 4-fixture grid documented") to respect Constitution Article 1 경량.

### §4.2 Alternative: document fallback to original grid

Per spec §8.3 #2, fallback to a 4-fixture grid (without H11–H14 — Q2 fixtures = H1 + 3 others TBD, possibly the older H2/H3/H5 acknowledging known ceiling-bias risk per Q3 ADR §11) may be documented as the binding option. This explicitly accepts reduced Q2 power and treats Q2 as a directional read rather than a binding TOST gate.

### §4.3 Q1 substitute-compact arm is unaffected

Q1 (substitute-compact factorial) uses H1 + H10 only (spec §3.1). The Q4 pilot outcome does **not** block Q1 fire. Q1 350-trial fire could proceed independently of H11–H14 redesign cycle. Orchestrator may choose to overlap Q1 fire with H11–H14 redesign to compress wall time.

### §4.4 Pre-reg tag handling

The tag `exec-mode-v6-preregistered-20260502` is sacred (dispatch hard rule). Two paths:

- **Re-tag** (`exec-mode-v6.1-...`) after redesign+re-pilot — preferred if H11–H14 redesign substantially changes fixture content.
- **Annotation pointer** (this report referenced from existing tag's companion docs) — acceptable per spec §8.2 item 9 if H11–H14 are dropped (fallback per §4.2) without redesign.

Decision is orchestrator's per §8.3 authority.

## §5 Pilot artifacts

- **Trial metrics**: `state/exec-mode-experiment/phase6-pilot-live/1/D/{H11,H12,H13,H14}/seed0{1..5}/metrics.json` (20 files).
- **Runner log**: `state/exec-mode-experiment/phase6-pilot-live/runner.log` (20 ok lines + summary).
- **Analyzer**: `/tmp/phase6-pilot-analyze.py` (mean q + std + band check).
- **Pre-reg tag** (binding): `exec-mode-v6-preregistered-20260502` → object `a7b77d9...` → commit `4eefc0a`.

## §6 Pre-condition gate audit (spec §8.3, verified at tag time)

| # | Condition | Status |
|---|---|---|
| 1 | Spec status = accepted | PASS (frontmatter `status: accepted`, 2026-05-02) |
| 2 | Q4 pilot results published | **PUBLISHED HERE** (deferred to post-tag per dispatch order; this report fulfills) |
| 3 | NB3 patch landed in devkit | PASS (grader SHAs in tag annotation) |
| 4 | H11–H14 graders cross-LLM-reviewed + accepted | PASS (round-4: codex ACCEPT_WITH_CONDITIONS / gemini ACCEPT) |
| 5 | Q3 ADR drafted (decoupled per spec §11) | PASS (orchestrator commit `2ec53bf`) |
| 6 | Smoke test (1 trial/cell q≥0 status=ok) | COVERED (pytest grader 385/385 PASS + this pilot 20/20 status=ok) |
| 7 | Lint exit-0 (Phase 6 venv scope) | PASS (24/0, 11/11 fixture lint, 385/1-skipped grader) |

## §7 Verdict + next-action ask to orchestrator

**Verdict (binding, pre-registered)**: REDESIGN H11–H14 (or accept fallback per spec §8.3 #2).

**Asks**:
1. Pick redesign vs fallback path (§4.1 vs §4.2).
2. If redesign: dispatch dustcraw r5 (or tester r5) with explicit difficulty target and re-pilot loop budget.
3. Decide Q1 fire start: now (parallel) or hold for Q4 redesign.
4. Decide tag handling per §4.4.
