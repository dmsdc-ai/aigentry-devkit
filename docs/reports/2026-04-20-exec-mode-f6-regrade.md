# F6 regrade after grader-gates (G8+H4+H7+H8)

**Session**: `E-devkit-grader-gates` · **Date**: 2026-04-20 · **Scope**: pilot-mini-fix1 F6 trials (D/Pfresh/S, seed00).

**TL;DR** — G8 (MULTILINE flag for `diff_format_regex`) flips D/F6 and S/F6 from false-zero (0.0) to passing (0.95) on rescoring. Pfresh/F6 stays at 0.0, confirming the legitimate agent-weak signal predicted by the F6 RCA. No re-run needed — grader is pure-text, applied to the existing `stage1_output.md` artefacts.

---

## 1. What changed in the grader

Five commits landed between `9a5d049` (analyst phase 2) and this report:

| # | Commit  | Gate | Change |
|---|---------|------|--------|
| 1 | `e34a370` | G8 | `score_f6_build_turns` passes `re.MULTILINE` to `_regex_any_hit` for `diff_format_regex`; added `extra_flags` optional param. |
| 2 | `843a074` | H4 | `score_f4_oracle_graph` hallucination check also accepts basename matches. |
| 3 | `eca283f` | H7 | `score_fa_false_prior` primary_score = `clamp01((1−leak)·task_correctness + 0.1·citation)` (continuous, not binary). |
| 4 | `4e0bcd3` | H8 | `_extract_labeled_section` tolerates `(a)`/`**(a)**`/`a.`/`a:`/`a)`/`**a.**` label forms via new `_label_marker_regex` helper. |

Only G8 is material to F6 regrade. H4/H7/H8 do not touch F6 logic.

## 2. Rescored F6 trials

Script: `grader.score_f6_build_turns(stage1_output, F6.ground_truth)` against the live fixture at `aigentry-orchestrator/fixtures/exec-mode-experiment/F6/ground_truth.json`. Each trial's `metrics.json` was updated in place (gitignored — not committed) with a `quality.regrade` stanza preserving the pre-fix components.

| Trial | Old primary | New primary | diff_format_ok | build_pass_binary | primary_pass |
|-------|-------------|-------------|----------------|-------------------|--------------|
| `D/F6/seed00`      | **0.0** | **0.95** | False → **True**  | 0.0 → **1.0** | False → **True**  |
| `Pfresh/F6/seed00` | 0.0     | 0.0      | False (unchanged) | 0.0 (unchanged) | False (unchanged) |
| `S/F6/seed00`      | **0.0** | **0.95** | False → **True**  | 0.0 → **1.0** | False → **True**  |

### Why 0.95, not 1.0

For D/F6 and S/F6 the turns-to-success penalty of `0.05 × 1` still applies because `prediction_ok` is False under the current (unchanged) `next_step_prediction_regex`:

```
(next|다음)\s*(error|에러|green|통과)
```

Both agents produced Korean `"... green이 될 가능성이 높음"` / `"green 예상"` — valid next-step predictions that the regex does not cover (tokens not adjacent). This is the **R2** recommendation from the F6 RCA (`docs/reports/2026-04-20-exec-mode-f6-rca.md` §6). Because the regex lives in the orchestrator-owned fixture JSON (not grader defaults), R2 is deferred to a separate orchestrator-side fixture update per Rule 10.

If R2 lands, D and S trials would regrade to **1.0**; until then, 0.95 is the correct ceiling.

### Why Pfresh stays 0.0

`Pfresh/F6/seed00/stage1_output.md` is a task refusal — the agent, deprived of prior-turn context (that is Pfresh's design), wrote *"We're on Turn 3, not Turn 7 — Turn 7's error hasn't been revealed yet … Paste the actual Turn 7 pytest output and I'll produce the minimum diff."* That is a legitimate agent-weak signal, orthogonal to the grader regex defect. All F6 fix-content regexes correctly remain unmatched.

## 3. Confidence

- All 191 grader tests pass (`pytest tests/exec-mode/`), including 12 new regression tests added across G8/H4/H7/H8.
- Grader is a pure function of `(stage1_output, ground_truth)` — rescoring is deterministic and identical to what a re-run would compute.
- The G8 regression test (`test_score_f6_fenced_diff_matches_format_regex`) encodes the exact RCA §3 failure form, so any future regression is caught in CI.

## 4. Implication for full pilot

The pre-registration tag `exec-mode-v3-max-preregistered-20260420-fix1` was cut against pre-gate graders. Full pilot (spec §4.3, 400 trials) should be launched against `exec-mode-v3-max-preregistered-20260420-fix2` after this report lands. F6 will no longer emit false-zero on canonical fenced-diff output.

## 5. Evidence index

- Fixture: `aigentry-orchestrator/fixtures/exec-mode-experiment/F6/ground_truth.json:52,60`
- Grader pre-fix: `docs/reports/2026-04-20-exec-mode-f6-rca.md` §2-3
- Grader post-fix: `bin/exec-mode-grader.py` `score_f6_build_turns` (G8 inline spec comment)
- Pilot runtime traces: `state/exec-mode-experiment/pilot-mini-fix1/1/{D,Pfresh,S}/F6/seed00/` (gitignored; `metrics.json` rewritten in place with `quality.regrade` stanza)
- Grader tests: `tests/exec-mode/test_grader_f6.py` (fenced-diff regression), `tests/exec-mode/test_grader_helpers.py` (H8 label-surface matrix)
