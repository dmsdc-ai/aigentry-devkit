# Phase 6 Grader r2 Cross-LLM Re-review - Codex

Reviewer: aigentry-reviewer-phase6-graders-r2-codex
Date: 2026-05-02
Scope: fixtures `011e94e`, spec `555daf6`, grader/tests `e005f6c` + `0f01163`

Verdict: REJECT. H1 NB3 r2: ACCEPT. H11-H14 r2: 3 ACCEPT / 1 adjust-still / 0 REJECT-still.

Summary: most grader logic fixes landed and the exec-mode pytest suite is green (`370 passed, 1 skipped`). However the H11-H14 fixture package is still not live-harness runnable for Phase 6 mode D, and H14 still grants full credit to outputs that include an unknown snake_case tool in raw/connector text. Those are binding issues before Phase 6 pre-reg.

## §0 Verification Run

- `python3 -m py_compile bin/exec-mode-grader.py bin/lint-formatting-exemption.py` -> PASS.
- `.venv-exec-mode/bin/python -m pytest tests/exec-mode/` -> PASS, `370 passed, 1 skipped`.
- `.venv-exec-mode/bin/python bin/lint-formatting-exemption.py --fixture H1 --fixture H10 --fixture H11 --fixture H12 --fixture H13 --fixture H14` -> PASS, `24 passed, 0 failed`.
- Bare spec command with system `python3 bin/lint-formatting-exemption.py --fixture ...` -> FAIL in this shell because `exec-mode-grader.py` cannot import `rapidfuzz`.
- Default-scope lint under the venv -> expected FAIL, `13 failed`, all pre-Phase-6 fixtures outside the amended scope.
- Live-path mock smoke: `bin/exec-mode-experiment.sh --fixture H11 --mode D ... --fixtures-root state/fixtures/phase6-followup` -> FAIL exit 5, missing `setup_history.md`. H14 mode D fails the same way; H11 Pfresh fails missing `warmup_transcript.md`.

## §1 BLOCKER Resolution Audit

### B1 - H11-H14 fixture package not harness-runnable

Prior finding: "H11-H14 fixture package is not harness-runnable. The harness requires `ground_truth.json` and other fixture files; the source fixtures provide `ground_truth.md` only."

r2 fix: commit `011e94e` added `ground_truth.json`, `post_probes.md`, `planted_facts.json`, and `probe_answers.json` under each of H11-H14. `score-fixture` now accepts the new `ground_truth.json` files without JSONDecodeError.

Verification: file existence is fixed, but live harness compatibility is not. `bin/exec-mode-experiment.sh` requires `setup_history.md` for D/S/Pacc and `warmup_transcript.md` for Pfresh (`bin/exec-mode-experiment.sh:237-249`). Those files are absent for H11-H14. A mocked non-dry-run D trial fails before any LLM call:

`exec-mode-experiment: fixture file missing: state/fixtures/phase6-followup/H11/setup_history.md`

Also, the newly added `post_probes.md` is only `# Probes`, and `planted_facts.json` / `probe_answers.json` are empty arrays. That would make pollution/loss metrics meaningless even after the missing setup files are supplied.

Verdict: PARTIAL / still blocking. The JSONDecodeError path is fixed, but the Phase 6 D-mode pilot cannot run against these fixtures.

### B2 - H11 did not score Component/Root-Cause pairs as pairs

Prior finding: "H11 does not score Component/Root-Cause pairs as pairs. It grants full credit to swapped mappings because each cause is searched globally."

r2 fix: `score_h11_structured_data_extraction` now splits candidate text into entries and only credits a pair when the component and its cause appear in the same entry (`bin/exec-mode-grader.py:2811-2921`). r2 also added swapped-pair negatives for table, JSON, and bullet outputs.

Verification: a swapped markdown table now returns `pairs_matched=0`, `primary_score=0.0`, `primary_pass=False`. The full pytest suite includes the three swapped-pair tests and passes.

Verdict: FIXED.

## §2 MAJOR Resolution

M1 missing lint-smoke inputs: FIXED with caveat. `tests/exec-mode/lint-smoke/H1.json` and H10-H14 inputs exist, and the scoped lint gate passes under the repo venv. The literal amended spec command uses bare `python3`; in this environment it fails on missing `rapidfuzz`. That is an operational reproducibility condition, not a missing-input regression.

M2 H1 table-only contract over-correction: FIXED. H1 prompt now says markdown table is recommended but JSON/list formats are allowed and non-scoring (`state/fixtures/phase5-holdout/H1/task_prompt.md:3`). Ground truth sets `output_structure_checks.table_required=false` (`state/fixtures/phase5-holdout/H1/ground_truth.json:165-172`). The grader uses `structure_ok = bool(rows)` for the current H1 path (`bin/exec-mode-grader.py:2306-2325`).

M3 adversarial matrix incomplete: PARTIAL. r2 added substantial adversarial coverage (`0f01163`, +459 lines, 299 extra tests in the full suite accounting). H1 is now adequately covered. H11-H13 are much improved. H14 still lacks a raw-text positive and a raw/connector-text unknown-tool negative; H12 declares `raw_text`, but the canonicalizer returns `raw_text` only for empty input and otherwise classifies prose as `paragraph_prose`. The `formatting_exempt_tests` metadata also does not enumerate the r2 negative matrix for H12.

M4 H12 T3 over-credits "Redis cluster": FIXED. T3 now requires scale/expand/grow/확장/증설, not `cluster` as a standalone noun (`bin/exec-mode-grader.py:2982-2995`). Probe with "The Redis cluster exists in production" plus T1/T2 now matches only T1/T2 (`primary_score=0.6667`), not full credit.

M5 H13 inline backticks and extra routes: FIXED. Inline single-backtick JSON is stripped (`bin/exec-mode-grader.py:3100-3121`), and extra route paths are penalized and block pass (`bin/exec-mode-grader.py:3227-3239`). Direct probes confirm inline-backticked correct JSON scores/pass at 1.0 and a correct+`/admin` payload returns `extras_count=1`, `primary_pass=False`.

M6 H14 duplicate/unknown/excess handling: PARTIAL. Duplicate palette calls are penalized, simple line-start unknown tools are detected, and duplicate excess length blocks pass. But unknown snake_case tools embedded in raw text or comma text with connector words are still invisible:

`grep_logs inspect_config read_metrics list_threads restart_process` -> `unknown_tools=[]`, `primary_pass=True`, `primary_score=1.0`.

`Call grep_logs, then inspect_config, then read_metrics, then list_threads, then restart_process.` -> `unknown_tools=[]`, `primary_pass=True`, `primary_score=1.0`.

The bug is in `_detect_h14_unknown_tools`, which only scans backticks, list-line starts, a narrow CSV token position, and JSON entries (`bin/exec-mode-grader.py:3276-3338`), while `_canonicalize_h14_tool_sequence` extracts known tools anywhere (`bin/exec-mode-grader.py:3396-3411`).

## §3 Conditions Integration

1. Add harness-compatible H11-H14 fixture files and run one real smoke trial per fixture: PARTIAL / missing. The four files named in triage were added, but live D-mode smoke still fails missing `setup_history.md`; Pfresh fails missing `warmup_transcript.md`. No real live-path smoke is demonstrated.
2. Rework H11 pair parsing and add swapped-pair negatives: INTEGRATED.
3. Add repo lint-smoke inputs and require scoped lint to pass: INTEGRATED under the repo venv; bare `python3` command needs dependency/interpreter normalization.
4. Complete adversarial matrix positive+negative per declared variant: PARTIAL. H1 is acceptable; H14 and H12 still have declared-variant/test-metadata gaps.
5. Run and publish Q4 D-mode pilot distribution: MISSING / downstream. This cannot run until condition 1 is fixed.

## §4 H1 NB3 Patch r2

Q1=(a) was implemented correctly. The prompt explicitly makes table format non-scoring, and ground truth codifies that with `table_required=false`. The grader simplification now matches the fixture contract rather than waiving a still-required table. I found no H1 regression in the current declared equivalence surface.

Declared H1 variants: `markdown_pipe_table`, `markdown_pipe_table_in_code_fence`, `json_array_of_review_rows`, `bullet_or_numbered_list_of_review_rows`.

Coverage: positives exist for all four variants in `test_grader_h1_nb3_adversarial.py`; negatives exist for table, fenced table, JSON, and bullet/list in `test_grader_phase6_adversarial.py`. HTML/CSV/XML remain intentionally unsupported and documented in code.

Verdict: ACCEPT.

## §5 H11-H14 Verdict Reassessment

H11: ACCEPT on grader logic. The swap-test now passes in table/JSON/bullet variants, and direct swapped-table probing scored 0.0. Fixture packaging remains blocked separately under B1.

H12: ACCEPT on rubric correction. The Redis noun-only over-credit is fixed. Minor metadata issue remains: `raw_text` is declared but non-empty prose is classified as `paragraph_prose`.

H13: ACCEPT. JSON/YAML equivalence still works, inline backticks are accepted, wrong backends remain partial, and extra route paths now block pass.

H14: adjust-still. The duplicate/excess portion is fixed, but unknown-tool detection is still incomplete for natural raw/comma text. Since H14's prompt surface is "exactly 4 tool calls" and palette-only, granting 1.0 with `inspect_config` included is not acceptable.

## §6 New Issues Introduced or Exposed by r2

N1 - H14 unknown-tool detector has a format gap. Unknown snake_case tokens in raw text or comma-separated text with connector words are not detected, while known tools are extracted globally. This is a MAJOR residual scoring bug.

N2 - The amended lint gate is not reproducible with the literal command in the current shell. `python3 bin/lint-formatting-exemption.py --fixture ...` fails on `ModuleNotFoundError: rapidfuzz`; `.venv-exec-mode/bin/python ...` passes. The spec should either require the repo venv or the installer should ensure the bare interpreter has the grader dependencies.

N3 - Test/metadata schema drift remains. H12 declares `raw_text` but effectively maps non-empty text to `paragraph_prose`; H14 declares `raw_text` but lacks a positive raw-text test and lacks raw/comma unknown-tool negatives. The lint companion check counts names, but does not prove positive+negative per variant.

No H1 NB3 r3-style over-correction found; the H1 contract was amended rather than silently widening a table-required prompt.

## §7 Lint Scope Amendment Audit

The spec amendment in orchestrator commit `555daf6` scopes §8.3 #7 to `H1,H10,H11,H12,H13,H14`. This is defensible for Phase 6 binding. Default-scope lint under the venv currently fails 13 pre-Phase-6 fixtures, exactly the debt the triage moved out of scope. Making those a Phase 6 pre-reg blocker would expand the work beyond the Phase 6 binding surface.

Phase 7 follow-up tickets exist in the architect triage §7 as PT-1 through PT-5. I found them documented in `aigentry-architect/docs/triage/2026-05-02-phase6-grader-triage.md`, but not as separate executable issue records in this repo.

Required caveat: the exact spec command uses `python3`, and that fails in this environment unless the venv interpreter is used.

## §8 Final Verdict

REJECT.

Blocking conditions for orchestrator:

1. Make H11-H14 fixtures live-harness runnable for the Phase 6 pilot. Add the required `setup_history.md` files for D/S/Pacc or amend the harness/spec contract explicitly; if Pfresh remains in any smoke scope, add `warmup_transcript.md`. Then run one non-dry-run mocked live smoke per H11-H14 in mode D.
2. Replace placeholder `post_probes.md`, `planted_facts.json`, and `probe_answers.json` with meaningful fixture data, or explicitly document that Phase 6 Q4 ignores pollution/loss for these fixtures and adjust the harness to avoid misleading `loss_rate=1.0`.
3. Fix H14 unknown-tool detection by scanning all snake_case tool-call-shaped tokens after wrapper stripping, not only backtick/list/limited-CSV positions. Add raw-text and connector-comma unknown-tool negative tests.
4. Complete the declared-variant adversarial matrix and align `formatting_exempt_tests` metadata with the actual r2 test names.
5. Normalize the lint pre-reg command so the literal command in §8.3 #7 exits 0 in the intended execution environment.

## §9 Top Issue

H11-H14 are still not live-harness runnable: a Phase 6 mode-D trial exits 5 missing `setup_history.md`, so the Q4 pilot cannot run.
