# Phase 6 Grader Cross-LLM Review - Codex

Reviewer: aigentry-reviewer-phase6-graders-codex  
Date: 2026-05-02  
Scope: C2 `c7e88c5`, H1 NB3 `10ad107`, H11-H14 `b7ac241`, C1 lint `f1a8ba1`

Verdict: REJECT for pre-pre-reg tag. H1 NB3 verdict: adjust. H11-H14 verdict: 0 ACCEPT / 3 adjust / 1 reject.

Summary: the status-field implementation and dispatcher wiring are mostly correct, and the grader functions are deterministic. Two issues block Phase 6 binding: the H11-H14 fixture package is not runnable by the current devkit harness, and H11 does not actually score Component/Root-Cause pairs as pairs.

## 1. H1 NB3 Patch Audit

The H1 canonicalizer declares four variants in `bin/exec-mode-grader.py`: `markdown_pipe_table`, `markdown_pipe_table_in_code_fence`, `json_array_of_review_rows`, and `bullet_or_numbered_list_of_review_rows`. These cover the practical variants represented in the tests, but they are not exhaustive. A semantically equivalent HTML table, CSV/TSV table, or XML/semantic table would currently score as `none`; that is acceptable only if the declared equivalence surface is treated as bounded, not comprehensive.

The normalization is structurally effective for the declared variants: rows are converted to `{id,line,severity,issue,fix}` before scoring, and the tests show JSON/bullet variants receive the same planted-bug credit as markdown tables. The over-correction risk is real: the original H1 prompt requires "single markdown table" and no prose, while the patched grader sets `structure_ok = bool(rows)` for non-table variants. That means a JSON or bullet answer can pass even though it violates the original table surface. Because the Q3 ADR explicitly requires the NB3 migration, this is not a reject by itself, but it needs an explicit fixture-contract decision: either update H1's prompt/ground_truth to make table formatting non-scoring, or keep table-required semantics and mark the non-table path lower.

Adversarial tests are useful but do not satisfy the ADR checklist literally. There are positives for each declared variant and two generic negatives, but not one positive and one negative per variant, and not three adversarial cases per variant.

## 2. H11-H14 Graders Audit

H11: reject. The intended rubric is "exactly 3 correct Component/Root-Cause pairs", but the scorer checks component presence and cause presence independently against the entire output. A swapped mapping receives full credit:

`CheckoutService -> OOM`, `OrderQueue -> malformed API key`, `NotificationWorker -> PaymentGateway timeout` scored `primary_score=1.0`, `matched_pair_ids=["P1","P2","P3"]`. The bug is at `bin/exec-mode-grader.py:2779-2784`: the cause regex runs over `canonical_text`, not the candidate row/pair for that component. This invalidates H11 as a pair-extraction grader.

H12: adjust. The three-takeaway partial credit shape is reasonable, deterministic, and empty/unrelated input scores zero. However T3 is overbroad: `Redis cluster` alone can satisfy the "Scale Redis cluster if DB load increases" takeaway because `Redis.{0,40}(?:scal|...|cluster)` includes `cluster` as sufficient. A probe with only Redis evictions, TTL 6h, and "The Redis cluster exists in production" scored 1.0. Tighten T3 to require a scaling/expansion action and preferably DB-load conditionality.

H13: adjust. JSON/YAML partial credit matches the fixture metadata at a high level, and invalid prose scores zero. Two edge gaps remain: metadata says to strip backticks, but inline single-backtick JSON scores 0.0; and a JSON payload with the two required routes plus an extra `/admin` route scores 1.0 despite the "schema-strict-output" domain. Decide whether exact route set is required; if yes, penalize extras.

H14: adjust. The ordered sequence metric is deterministic and gives useful partial credit for unordered or missing tools. It does not enforce "exactly 4 tool calls" or "only use tools from this list": duplicate extra calls and unknown interleaved tools are ignored after extraction/deduplication and can still score 1.0. Add length/excess/unknown-tool penalties.

All four new graders emit `formatting_exempt_status="implemented"` with canonicalizer, variants, tests, and ADR id. The emitted fields are present, but the adversarial tests are too shallow: H11-H14 each list 4 tests while declaring 4-6 variants, so they cannot meet positive+negative coverage per variant.

Fixture packaging blocker: `state/fixtures/phase6-followup/H11-H14/` only contain `metadata.json`, `ground_truth.md`, and `task_prompt.md`. The current harness requires `task_prompt.md`, `post_probes.md`, `planted_facts.json`, `ground_truth.json`, and `probe_answers.json` before a trial can run, and passes `ground_truth.json` to `score-fixture`. Pointing `score-fixture` at the provided `ground_truth.md` raises `JSONDecodeError`. As packaged, H11-H14 cannot produce valid Phase 6 trial metrics.

## 3. PRIMARY_GRADERS Dispatch

Dispatch wiring is correct. `PRIMARY_GRADERS` includes `H11`, `H12`, `H13`, and `H14` with the intended functions, and argparse choices are auto-derived from `sorted(PRIMARY_GRADERS)`, so the CLI help includes all four. I found no duplicate keys or typos.

## 4. Statistical Fitness

The graders are deterministic, which is the right direction for low-variance evaluation. However, reliability for `q in [0.5, 0.85]` is not established. The current scores are coarse: H11/H12 are mostly 0, 0.333, 0.667, 1.0; H13 is 0, 0.5, 1.0; H14 has more levels but can over-credit invalid/excess plans.

For Q2, pooled n is 50 trials per mode across 5 fixtures, which is adequate-ish for detecting a medium superiority effect (`d=0.5`) if IID assumptions were true. The spec correctly warns about hierarchy; at the fixture-mean layer the effective n is only 5 per mode. For TOST at epsilon=0.05, the 90% CI half-width is only likely to fit inside the margin if within-mode SD is very low. Coarse partial-credit scores and fixture effects make this underpowered unless Q4 pilot data demonstrates low variance.

Current blockers destroy statistical fitness: missing fixture files make harness trials fail or fall back to `primary_score=0`, while H11's swapped-pair over-credit can inflate q to 1.0 on wrong outputs.

## 5. Lint Compliance

Verified:

- `python3 -m py_compile bin/exec-mode-grader.py bin/lint-formatting-exemption.py` passed.
- `.venv-exec-mode/bin/python -m pytest` on the four requested grader/dispatch test files passed: 53 passed.
- `.venv-exec-mode/bin/python -m pytest tests/exec-mode/test_lint_formatting_exemption.py` passed: 18 passed.
- Combined requested + lint tests passed: 71 passed.
- With temporary smoke inputs, `bin/lint-formatting-exemption.py --fixture H1 --fixture H11 --fixture H12 --fixture H13 --fixture H14` passed all AST/companion checks: 20 passed, 0 failed.
- `node -c bin/aigentry-devkit.js`, `npm test`, `bash -n install.sh`, and `bash bin/check-platform-usage.sh` passed.

Not verified as green in-repo:

- Actual lint invocation fails because `tests/exec-mode/lint-smoke/H1.json` and `H11-H14.json` are missing. This is the C1 follow-up and must be patched before pre-tag lint can be used as a gate.

Minor lint note: Python 3.14 emits a `SyntaxWarning` for an invalid escape in a docstring at `bin/exec-mode-grader.py:1111`.

## 6. Blockers Classification

BLOCKERS: 2

1. H11-H14 fixture package is not harness-runnable. The harness requires `ground_truth.json` and other fixture files; the source fixtures provide `ground_truth.md` only. Phase 6 trials cannot produce valid q until the fixture package or harness contract is fixed.
2. H11 does not score Component/Root-Cause pairs as pairs. It grants full credit to swapped mappings because each cause is searched globally.

MAJORS: 6

1. Missing `tests/exec-mode/lint-smoke/*.json` blocks the real pre-tag lint path.
2. H1 NB3 patch over-corrects relative to the original table-only prompt/ground_truth contract unless that contract is explicitly amended.
3. H1/H11-H14 adversarial tests do not provide positive and negative cases per declared variant.
4. H12 T3 regex over-credits "Redis cluster" without scale action or DB-load condition.
5. H13 misses inline backtick JSON and over-credits extra routes under a schema-strict fixture.
6. H14 ignores duplicate extra calls and unknown tools despite "exactly 4" and palette-only constraints.

MINORS: 3

1. H1 declared variants are bounded, not exhaustive; document HTML/CSV/XML as deliberately unsupported or add them.
2. `state/fixtures/phase6-followup/README.md` says H11 normalizes YAML, but H11 metadata/code do not declare YAML.
3. Fix the Python 3.14 docstring escape warning.

## 7. Top Conditions

1. Add harness-compatible H11-H14 fixture files, especially `ground_truth.json`, and run one real smoke trial per fixture through `exec-mode-experiment.sh`.
2. Rework H11 to parse candidate pairs and match cause within the same pair/row/object; add swapped-pair negative tests across table, JSON, and bullet variants.
3. Add repo lint-smoke inputs for H1/H11-H14 and require `bin/lint-formatting-exemption.py --fixture H1 --fixture H11 --fixture H12 --fixture H13 --fixture H14` to pass without temporary files.
4. Complete the adversarial matrix: positive and negative cases for every declared formatting variant, plus malformed/empty/excess-length cases.
5. Run and publish the Q4 D-mode pilot distribution before binding Q2; require per-fixture mean q in range and report variance/CI, not just point estimates.
