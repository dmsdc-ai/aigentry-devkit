# Phase 6 Grader r3 Cross-LLM Re-review - Codex

Reviewer: aigentry-reviewer-phase6-graders-r3-codex
Date: 2026-05-02
Scope: Phase A r3 fixture commit `6488926`; Phase B r3 devkit commit `6ade51c`; prior Codex r2 review `docs/reports/2026-05-02-phase6-graders-r2-codex-review.md`.

Verdict: REJECT.

Summary: the grader-side r3 fixes are good. M3, M6, N1, N3, and condition 4 are fixed, and H14 is now ACCEPT. The live harness no longer exits 5 for missing `setup_history.md` / `warmup_transcript.md`: H11-H14 x D/Pfresh all exit 0 in mocked live mode. However the new fixture probe package still violates the existing exec-mode fixture contract: each H11-H14 fixture has only 3 planted facts, 3 probes, and 3 probe answers where the lint and metrics assembly expect 10. The same new warmup files also fail delimiter lint. That keeps B1 at PARTIAL and blocks accepting these as valid Phase 6 Q4 pilot inputs.

## §0 Verification Run

- `git rev-parse --short HEAD` -> `6ade51c`.
- `git log --oneline 0f01163..6ade51c` -> `6ade51c`, `6488926`, `ac50f0c`.
- `git diff --stat 0f01163..6ade51c -- bin/exec-mode-grader.py tests/exec-mode/` -> 3 files, 550 insertions, 29 deletions.
- `.venv-exec-mode/bin/python -m py_compile bin/exec-mode-grader.py bin/lint-formatting-exemption.py` -> PASS.
- `.venv-exec-mode/bin/python bin/lint-formatting-exemption.py --fixture H1 --fixture H10 --fixture H11 --fixture H12 --fixture H13 --fixture H14` -> PASS, `24 passed, 0 failed`.
- `.venv-exec-mode/bin/python -m pytest tests/exec-mode/test_grader_formatting_exempt_status.py tests/exec-mode/test_grader_phase6_adversarial.py -q` -> PASS, `72 passed`.
- `.venv-exec-mode/bin/python -m pytest tests/exec-mode/ -q` -> PASS, `385 passed, 1 skipped`.
- Literal bare-interpreter lint remains non-reproducible: `python3 bin/lint-formatting-exemption.py --fixture ...` -> FAIL, `ModuleNotFoundError: No module named 'rapidfuzz'` for H1/H10/H11/H12/H13/H14. This is prior N2 unchanged.
- Mocked live harness smoke, with real fixture validation and metrics assembly but no external LLM calls:
  - H11 D/Pfresh -> exit 0 / exit 0.
  - H12 D/Pfresh -> exit 0 / exit 0.
  - H13 D/Pfresh -> exit 0 / exit 0.
  - H14 D/Pfresh -> exit 0 / exit 0.
- Fixture lint on the r3 H11-H14 directories fails for every fixture:
  - `planted_facts.json has 3 entries, expected 10`
  - `post_probes.md has 3 questions, expected 10`
  - `probe_answers.json has 3 entries, expected 10`
  - `warmup turn numbers not sequential from 1: [1, 1, 2, 2, 3, 3, 4]`

## §1 B1 PARTIAL -> r3 Status

Prior B1 quote from my r2 review:

> Verdict: PARTIAL / still blocking. The JSONDecodeError path is fixed, but the Phase 6 D-mode pilot cannot run against these fixtures.

And the concrete prior failure was:

> `exec-mode-experiment: fixture file missing: state/fixtures/phase6-followup/H11/setup_history.md`

r3 fixed the missing-file part. `setup_history.md` and `warmup_transcript.md` now exist for H11, H12, H13, and H14. A mocked live smoke of `bin/exec-mode-experiment.sh --fixture <H11-H14> --mode D --fixtures-root state/fixtures/phase6-followup` and the same for `--mode Pfresh` exits 0 for all 8 cells. The new `post_probes.md`, `planted_facts.json`, and `probe_answers.json` are not empty stubs; they contain fixture-specific facts and answers.

But the fixture package is still not valid against the repo's existing fixture lint and metrics contract. `tests/exec-mode/test_fixture_lint.py` declares `EXPECTED_PLANTED_FACTS = 10` and checks exactly 10 planted facts, 10 probes, 10 answers, and sequential warmup delimiters. The r3 files have only 3 of each. The harness loss assembly also iterates `range(10)` unconditionally; with H14's three declared answers matched perfectly and the other seven slots absent, the produced `metrics.json` has `loss.rate = 0.7` and `loss.probes` length 10. That is a measurement artifact, not model loss.

Verdict: PARTIAL. Missing setup/warmup and live-harness exit are fixed; full B1 fixture-package validity is unresolved.

## §2 M3 + M6 Status

M3 H12: FIXED. `_H12_VARIANTS` now declares `fenced_code_block`, `bullet_list`, `numbered_list`, and `paragraph_prose`; it no longer declares stale `raw_text`. Direct canonicalizer probes return `paragraph_prose` for both empty input and free-form prose.

M3 H14: FIXED. r3 adds a raw-text positive path and raw/comma-connector unknown-tool negatives. Direct probes show `grep_logs read_metrics list_threads restart_process` returns `primary_pass=true`, `primary_score=1.0`, `output_format_source=raw_text`; both raw and comma-connector `inspect_config` cases return `unknown_tools=["inspect_config"]`, `primary_pass=false`.

M6 H14: FIXED. `_detect_h14_unknown_tools` now scans the fence-stripped body for snake_case identifiers and filters only known palette tools / non-underscore prose. This aligns the unknown-tool detector with the canonicalizer's global known-tool extraction surface.

## §3 New Issues N1 + N3 Status

N1 H14 unknown-tool detector format gap: FIXED. Raw text and comma-with-connector unknown tools are detected and penalized.

N3 H12 raw_text vs paragraph_prose schema drift: FIXED. The declared variants match canonicalizer outputs; the targeted r3 tests include `test_h12_declared_variants_match_canonicalizer_outputs`.

Prior N2 venv reproducibility: still open. The venv command passes, but the literal bare `python3` command still fails on missing `rapidfuzz`.

## §4 Condition 4 Status

Declared-variant test metadata: FIXED for the grader/test layer. `_emit_formatting_exempt_status` now accepts and emits `formatting_exempt_test_matrix`; it validates every declared variant has at least one positive and one negative test, and that matrix test names are a subset of the flat test list. The walker test covers H1/H11/H12/H13/H14, and the scoped lint reports 24/24 PASS.

This does not cover fixture-package validity; the existing fixture lint only fails when invoked directly against `state/fixtures/phase6-followup/H11-H14`.

## §5 New Issues Introduced by r3

R3-N4 - H11-H14 probe/fact cardinality violates the exec-mode fixture contract. Each fixture has 3 planted facts, 3 post probes, and 3 probe answers, while `tests/exec-mode/test_fixture_lint.py` requires 10 and the harness emits 10 loss/pollution slots. This biases loss upward by construction and causes the fixture lint to fail on every H11-H14 directory.

R3-N5 - H11-H14 warmup transcript delimiters fail the existing sequential-turn lint. The new warmup files use repeated User/Agent turn numbers (`1,1,2,2,3,3,4`), while lint expects the extracted delimiter numbers to be sequential from 1.

No Phase 5 NB3-style over-correction was found in grader logic. H12 narrowed declarations to actual canonicalizer outputs rather than expanding scoring arbitrarily, and H14 now enforces palette-only semantics on the same surface it canonicalizes.

Harness compatibility: the live harness no longer has an exit-code regression for D/Pfresh. The regression is measurement integrity: the fixture package can run, but its pollution/loss side channels are invalid under the 10-probe contract.

## §6 Final Verdict

REJECT.

Acceptable to carry forward:

1. M3 H12/H14 fixed.
2. M6 H14 fixed.
3. N1 and N3 fixed.
4. Condition 4 fixed.
5. H14 verdict r3: ACCEPT.

Blocking before status flip:

1. Expand H11-H14 `planted_facts.json`, `post_probes.md`, and `probe_answers.json` to the 10-fact/probe/answer contract, or explicitly amend the fixture/harness contract and tests. Do not leave the harness producing 10 loss slots from 3 ground-truth answers.
2. Fix H11-H14 warmup delimiter numbering or update the lint if the repeated User/Agent numbering convention is now intended.
3. Normalize the lint pre-reg command for the intended interpreter, because bare `python3` still fails on `rapidfuzz`.

## §7 Top Issue

H11-H14 now run through the harness, but the new probe package still fails fixture lint and makes loss/pollution metrics invalid because it supplies only 3 of the required 10 planted facts/probes/answers.
