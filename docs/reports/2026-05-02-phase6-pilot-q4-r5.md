---
date: 2026-05-02
status: pilot-complete
track: "#329 E27 Phase 6 — Q4 r5 multi-mode pilot (iteration 2 of 2 HARD LIMIT)"
spec: aigentry-orchestrator §3.4 + §3.4.1 (orchestrator commit 9a76c12)
tag: exec-mode-v6-preregistered-20260502 (sealed; pilot is calibration-only)
runner: aigentry-runner-phase6-q4-pilot-r5
fixtures_commit: b1d42d0 (devkit; tester r5 redesign of H11–H14)
trial_count: 40 (4 fixtures × {D, Pacc} × 5 seeds; 0 failures)
wall_clock: ~510s (8m30s, live LLM path; 2× parallel D + 2× parallel Pacc chains)
verdict: 0/8 fixture×mode cells PASS — Q4 fixture set unrecoverable; recommend §8.3 #2 fallback
---

# Phase 6 Q4 r5 Pilot — Multi-Mode Ceiling-Avoidance Verification

## TL;DR

**0/8 fixture×mode cells satisfy the joint criterion (μq ∈ [0.5, 0.85] AND σ ≥ 0.05).** The r5 redesign produced *different* failure modes than r4 — H11/H14 still ceiling, H12 collapsed to a deterministic mid-band score (zero variance), H13 floored to q=0.0 on both modes (likely fixture-grader mismatch). Per spec §3.4.1 #6 (HARD LIMIT iteration 2 of 2), no further redesign iteration is permitted. **Recommend fallback per spec §8.3 #2** (drop H11–H14 from Q2 grid; bind Q2 to H1 + supplementary fixtures from the original 4-fixture grid).

## §1 Pilot scope

- **Spec source**: Phase 6 design §3.4 (Q4 fixture pilot) + §3.4.1 (ceiling-avoidance practices, multi-mode coverage requirement).
- **Multi-mode design (HARD per §3.4.1 #4)**: each fixture verified in **D** AND **Pacc** modes — single-mode r4 pilot missed Pacc-only ceilings.
- **Trial count**: 4 fixtures × {D, Pacc} × 5 seeds = 40 trials (D: 20 single-trial; Pacc: 20 chain positions across 5 chains of len=4).
- **Out-of-grid seeds**: seed_idx ∈ {101, 102, 103, 104, 105} — isolated from main pre-reg grid (Phase 5/Q1 use seed_idx 1..10) while remaining within harness `^seed[0-9]{2,3}$` regex.
  - *Implementation note*: spec §3.4 nominally calls for `MASTER_SEED + 1000 + offset`, but the harness `trial_id` schema caps seed_idx at 3 digits. We use the 100-series as functionally equivalent out-of-grid scheme; isolation property preserved.
- **Pacc chain layout**: 5 chains × len=4, one fixture per position. Chain order RNG-seeded per chain (`Random(MASTER_SEED + seed_idx)`) so each fixture appears at varied positions across chains (controls position bias).
- **Acceptance criterion (spec §3.4 + §3.4.1 #5)**: per fixture × mode, μq ∈ [0.5, 0.85] AND σ ≥ 0.05. Joint criterion — both must hold.
- **Path**: live LLM (claude --print, Opus 4.7), `bin/exec-mode-experiment.sh`, fixtures-root `state/fixtures/phase6-followup` (r5 redesign).

## §2 Per fixture × mode results

| Fixture | Mode | n | seeds q | μq | σ | min | max | band [0.5,0.85] | σ≥0.05 | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| **H11** | D    | 5 | 1.000, 1.000, 1.000, 0.667, 1.000 | 0.933 | 0.133 | 0.667 | 1.000 | ABOVE | yes | CEIL |
| **H11** | Pacc | 5 | 1.000, 1.000, 0.667, 0.667, 1.000 | 0.867 | 0.163 | 0.667 | 1.000 | ABOVE (just) | yes | CEIL |
| **H12** | D    | 5 | 0.667, 0.667, 0.667, 0.667, 0.667 | **0.667** | **0.000** | 0.667 | 0.667 | IN | **no** | CEIL (zero variance) |
| **H12** | Pacc | 5 | 0.333, 0.667, 0.333, 0.333, 0.333 | 0.400 | 0.133 | 0.333 | 0.667 | BELOW | yes | FLOOR |
| **H13** | D    | 5 | 0.000, 0.000, 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | BELOW | no | FLOOR |
| **H13** | Pacc | 5 | 0.000, 0.000, 0.000, 0.000, 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | BELOW | no | FLOOR |
| **H14** | D    | 5 | 1.000, 1.000, 1.000, 1.000, 1.000 | 1.000 | 0.000 | 1.000 | 1.000 | ABOVE | no | CEIL (hard) |
| **H14** | Pacc | 5 | 1.000, 0.700, 1.000, 1.000, 1.000 | 0.940 | 0.120 | 0.700 | 1.000 | ABOVE | yes | CEIL |

**Aggregate**: 0/8 PASS. Distribution: 4 CEIL (H11/D, H11/Pacc, H14/D, H14/Pacc) + 1 fixed-band-zero-σ (H12/D) + 3 FLOOR (H12/Pacc, H13/D, H13/Pacc). 0 trial failures (all 40 status=ok).

## §3 Comparison vs r4 baseline

| Fixture | r4 D μq | r5 D μq | r5 Pacc μq | r5 vs r4 (D) |
|---|---|---|---|---|
| H11 | 1.000 (σ=0.000) | 0.933 (σ=0.133) | 0.867 (σ=0.163) | mild softening; still ABOVE |
| H12 | 0.933 (σ=0.149) | 0.667 (σ=0.000) | 0.400 (σ=0.133) | mean dropped into band but variance vanished |
| H13 | 1.000 (σ=0.000) | 0.000 (σ=0.000) | 0.000 (σ=0.000) | over-correction → FLOOR |
| H14 | 1.000 (σ=0.000) | 1.000 (σ=0.000) | 0.940 (σ=0.120) | unchanged on D; mild softening on Pacc |

**Net effect of r5 redesign**: 1/4 ceilings turned to floors (H13), 1/4 turned into a deterministic mid-band fixed-answer pattern (H12/D), 2/4 unchanged in aggregate (H11/H14 still ceiling on both modes). **0/4 fixtures landed in the target band on either mode.** The redesign demonstrably *changed* fixture behavior — meaning the difficulty knobs work — but none landed the joint criterion target.

## §4 Failure-mode interpretation

### §4.1 H11 — partial ceiling break, still above band

H11/D mean dropped from 1.000 → 0.933, with σ rising 0.000 → 0.133 (one of five seeds at q=0.667). H11/Pacc μ=0.867 right at the band ceiling. The redesign added enough difficulty to introduce single-seed slips, but the modal behavior is still "agent solves it perfectly". Insufficient distractor density / multi-step compounding to consistently drag mean into [0.5, 0.85].

### §4.2 H12 — D mode produces deterministic 0.667; Pacc floor

H12/D returns exactly q=0.6667 on **every** seed (σ=0.000). Pattern signature: agent produces the same "2 of 3 correct" answer deterministically. This is a fixed-error pattern — the redesigned fixture has a probe configuration where the agent's solution misses one specific item every time. From a §3.4.1 #5 perspective this is a "deterministic ceiling at 0.667" — equally unusable for power as a ceiling at 1.0 (no D-vs-Pacc separation visible because variance is structural, not seed-driven).

H12/Pacc shows μ=0.400 with non-zero σ — the accumulated context appears to *degrade* H12 below the floor. Cross-fixture interference under Pacc.

### §4.3 H13 — floor, likely fixture-grader mismatch

All 10 trials (5 D + 5 Pacc) score q=0.0. Inspection of one D trial (`H13/D/seed101/stage1_output.md`) shows the agent emits well-formed JSON conforming to the task ("Ingress routing config with paths/backends/priorities/rewrite") with reasonable content (3 routes, correct sorting, correct rewrite-on-legacy, correct priority arithmetic). But the grader's `route_results` requires exactly `(/api/v1, api-svc)` + `(/assets, cdn-svc)` and the agent emits richer paths derived from the redesigned setup history. **The r5 fixture content and the r5 grader ground truth appear out of sync** — the agent is solving the redesigned task, but the grader is checking the pre-redesign expected output.

### §4.4 H14 — hard ceiling unchanged

H14/D unchanged from r4: q=1.0 across all 5 seeds. Pacc μ=0.940 — one seed at 0.700, the rest 1.000. Redesign did not perturb D at all and barely perturbed Pacc.

### §4.5 Multi-mode coverage validation

Multi-mode discipline per §3.4.1 #4 was *useful*: H12 looked partially in-band on D (mean 0.667) but Pacc revealed the FLOOR pattern, and H11's Pacc mean (0.867) showed the ceiling persists across modes. Single-mode D-only pilot would have miscoded H12/D as a marginal pass and missed the cross-mode failures. This validates the §3.4.1 #4 hard rule for future calibration cycles.

## §5 Iteration-limit decision (§3.4.1 #6 HARD)

Per spec §3.4.1 #6, this pilot was the **second and final** redesign iteration for H11–H14. r5 produced 0/8 PASS on the joint criterion. **No further redesign is permitted.**

Per the rejection-path branches:
- **Full pass (≥7/8)** → Q2 fire with full 4-fixture set. **Not satisfied.**
- **Partial pass** → drop ceilers, run Q2 with reduced set + H1. **Not satisfied** — 0/8 PASS leaves no fixture to keep.
- **0/8 PASS** → §3.4.1 #6 + §3.4 reject path → **fallback per spec §8.3 #2**.

## §6 Q2 grid recommendation

### §6.1 Primary recommendation: §8.3 #2 fallback

**Drop H11–H14 entirely from Q2 binding grid.** Bind Q2 to the original Phase 5 grid (H1 + H10) plus 1–2 supplementary fixtures selected from the existing Phase 5 holdout pool (H2/H3/H5 from Q3 ADR §11) with explicit acknowledgement of ceiling-bias risk (per Q3 ADR). Q2 D-vs-PC power suffers but the experiment can still proceed as a directional read rather than a binding TOST gate.

### §6.2 Tag handling

The pre-reg tag `exec-mode-v6-preregistered-20260502` (sealed) need not be re-tagged for the fallback path: H11–H14 simply remain referenced in the spec as "candidates whose r4+r5 calibration failed; not bound at fire time". This pilot report and the r4 baseline serve as the documentation trail. Orchestrator may issue an annotation pointer to this report from the existing tag's companion docs (per §8.2 #9).

### §6.3 Q1 fire interaction

Q1 substitute-compact factorial (`runner-phase6-q1-r2`, PID 86550) is in flight in parallel and uses H1+H10 fixtures only — **completely unaffected** by Q4 fallback. Q1 fire continues. As of pilot completion, Q1 was at ~50/350 with 0 failures (Q1 progress.log @ 12:18Z).

### §6.4 Tester r5 effectiveness assessment

r5 redesign was *not* ineffective — it demonstrably changed every fixture's behavior. But none of the changes landed in the target band:

- The difficulty knobs the tester pulled (adversarial distractors, multi-step compounding, distractor density) are real and produce real perturbation, but the fixtures need *calibrated* difficulty: the tester appears to have either under-applied (H11, H14) or over-applied (H13, H12 floor on Pacc) the knobs, and H12/D ended up in a deterministic-error attractor.
- A future Phase 7+ redesign cycle (if undertaken) should consider per-fixture difficulty-knob unit-tests (probe a known-mid-difficulty grader on a Mode D 3-seed micro-pilot before a 5-seed multi-mode pilot, to catch FLOOR over-corrections cheaply).

## §7 Pilot artifacts

- **Trial metrics** (40 files):
  - `state/exec-mode-experiment/phase6-q4-pilot-r5/D/1/D/{H11,H12,H13,H14}/seed{101..105}/metrics.json` (20)
  - `state/exec-mode-experiment/phase6-q4-pilot-r5/Pacc/1/Pacc/<fixture>/seed{101..105}_pos{1..4}_sess{101..105}/metrics.json` (20)
- **Aggregator output**: `state/exec-mode-experiment/phase6-q4-pilot-r5/FINAL.json` + `FINAL.txt`
- **Runner**: `bin/exec-mode-phase6-q4-r5-runner.py` (new)
- **Progress + run logs**: `state/exec-mode-experiment/phase6-q4-pilot-r5/progress.log` + `run.log`
- **Pre-reg tag** (binding, untouched): `exec-mode-v6-preregistered-20260502`

## §8 Verdict + asks to orchestrator

**Verdict (binding, pre-registered)**: 0/8 PASS — fallback per spec §8.3 #2; H11–H14 unrecoverable within iteration limit §3.4.1 #6.

**Asks**:
1. Approve §8.3 #2 fallback path (drop H11–H14, Q2 binds to H1+H10+supplementary).
2. Decide which supplementary fixtures (if any) to admit from the Phase 5 holdout pool — Q3 ADR §11 candidates (H2/H3/H5).
3. Confirm Q1 fire continues unchanged (independent of Q4 outcome).
4. Decide tag annotation handling (re-tag vs annotation pointer per §6.2).
5. **Optional**: H13 fixture-grader mismatch is an evidence finding that may warrant a separate post-mortem ticket — the grader's ground truth references pre-r5 paths. No action required for Q2 binding (H13 is dropped) but worth recording for future fixture-design audit.

## §9 Reproducibility

- Tag: `exec-mode-v6-preregistered-20260502` (sealed, sacred).
- Fixtures: devkit `b1d42d0` (`state/fixtures/phase6-followup/H{11,12,13,14}/`).
- Harness: `bin/exec-mode-experiment.sh` @ `c9873ae` (no `--cut` used in this pilot — Q4 pilot is D + Pacc only).
- Runner: `bin/exec-mode-phase6-q4-r5-runner.py` (new, this report).
- Reproduce: `python3 bin/exec-mode-phase6-q4-r5-runner.py` (re-runs against existing `state/exec-mode-experiment/phase6-q4-pilot-r5/`; idempotent via per-trial `--resume`).
