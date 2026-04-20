# F6 quality=0 RCA — pilot-mini-fix1

**Session**: `E-exec-mode-f6-rca` · **Date**: 2026-04-20 · **Scope**: F6 fixture only, read-only.

**TL;DR** — **fixture-design** (grader regex bug). D/F6 and S/F6 produced **semantically correct** Fix-3 diffs, graded 0.0 purely because `diff_format_regex` uses a `^` anchor without `re.MULTILINE` and agents wrap diffs in the ` ```diff ` markdown fence that the **task prompt itself demonstrates**. Pfresh/F6 is a separate, legitimate agent-weak signal (no prior-turn context → task refusal). This is **H5 manifesting** — text proxy grader too brittle.

---

## 1. F6 fixture design

Multi-turn fix-loop. Setup_history provides Turns 1–7; Stage-1 task asks the agent to produce **Fix 3** (remove `default=` kwarg from `cfg.get('timeout', default=30)`) as a unified diff + 1-sentence next-error/green prediction. Primary metric: `build_pass_binary` × turns-to-success discount, pass_threshold = 0.70 (fixtures/exec-mode-experiment/F6/ground_truth.json:62–68). `expected_winner: [P-accumulated]` (same file:5).

## 2. F6 grader logic (`score_f6_build_turns`, bin/exec-mode-grader.py:1233–1277)

```python
diff_format_ok   = regex_hit(text, [checks["diff_format_regex"]])          # L1237
added_lines      = "\n".join(l[1:] for l in text.splitlines() if l.startswith("+") and not "+++")  # L1238–41
fix_hits         = regex_hit(added_lines, checks["fix_content_regex_any_of"])   # L1242
anti_hits        = regex_hit(added_lines, checks["must_not_contain_regex"])     # L1243
prediction_ok    = regex_hit(text, [checks["next_step_prediction_regex"]])      # L1244
build_pass_binary = 1.0 if diff_format_ok and fix_hits and not anti_hits else 0.0  # L1253
```

`_regex_any_hit` (L1568–76) uses `re.IGNORECASE` only — **no `re.MULTILINE`**.

`diff_format_regex` (ground_truth.json:52):
```
^---\s*a/aigentry_config/loader\.py\s*\n\+\+\+\s*b/aigentry_config/loader\.py\s*\n@@.*@@
```
The leading `^` without `re.MULTILINE` anchors to **string start**, not line start.

`next_step_prediction_regex` (ground_truth.json:60): `(next|다음)\s*(error|에러|green|통과)` — requires "next/다음" token **immediately** preceding error/green (no intervening text).

## 3. Per-trial trace

### D/F6 — metrics.json quality.primary_components

`diff_format_ok=false`, `fix_hits=[cfg\.get\(…'timeout'…30\), cfg\.get\(…]` (2 hits), `anti_pattern_hits=[]`, `prediction_ok=false`, `build_pass_binary=0.0`, `primary_score=0.0`.

stage1_output.md:1–11 (agent output, verbatim start):
```
```diff
--- a/aigentry_config/loader.py
+++ b/aigentry_config/loader.py
@@ -9,2 +9,2 @@
-def get_timeout(cfg: dict) -> int:
-    return cfg.get('timeout', default=30)
+def get_timeout(cfg: dict) -> int:
+    return cfg.get('timeout', 30)
```

예상: 세 수정으로 syntax/import/API 이슈가 모두 해소되어 `test_loader.py` green 예상.
```
Diff is **canonical**; the fix is **exactly** the expected `cfg.get('timeout', 30)` with `default=` removed. Yet `diff_format_ok=false` because the text starts with `` ```diff `` not `---`.

### S/F6 — same pattern

metrics.json: `fix_hits` = 2 regex patterns matched, `anti_pattern_hits=[]`, `diff_format_ok=false`, `prediction_ok=false`. stage1_output.md:1–10 opens with `` ```diff `` fence, produces `+    return cfg.get('timeout', 30)`, closes with `예상: dict.get의 두 번째 인자는 positional이라 … green이 될 가능성이 높음`.

### Pfresh/F6 — different failure mode

metrics.json: `fix_hits=[]`, all checks false. stage1_output.md:1–8: agent **refused**, wrote *"We're on Turn 3, not Turn 7 — Turn 7's error hasn't been revealed yet … Paste the actual Turn 7 pytest output and I'll produce the minimum diff."* This is a legitimate agent interpretation failure on a fresh context (Pfresh strips prior turns), not a grader artifact.

### Empirical regex verification

```python
pat = r'^---\s*a/aigentry_config/loader\.py\s*\n\+\+\+\s*b/aigentry_config/loader\.py\s*\n@@.*@@'
re.search(pat, D_text, re.IGNORECASE)                     # -> None
re.search(pat, D_text, re.IGNORECASE | re.MULTILINE)      # -> <match>   ← fix
re.search(pat, S_text, re.IGNORECASE | re.MULTILINE)      # -> <match>
```
Adding `re.MULTILINE` (or stripping a leading ``` ```diff ``` fence) flips D and S to `diff_format_ok=true`.

## 4. Verdict — **fixture-design**

For D and S: the grader under-measures correct agent output. Two compounding regex design defects:

1. **`^` anchor + no MULTILINE**. Every diff wrapped in the ` ```diff ` fence (the dialect the task_prompt.md:3–9 itself demonstrates) fails. Self-inconsistent spec.
2. **Rigid prediction regex**. Natural Korean "green 예상" / "green 될 가능성" lose because `(next|다음)` must sit immediately before the keyword. The fixture's own task_prompt.md:12 reads "예상되는 다음 에러 또는 green" — the "next/green" combination is adjacent there but agents reasonably drop "다음" when the other branch is chosen.

For Pfresh: legitimate **agent-weak** signal orthogonal to the grader bug — stripping Turns 1–7 removes the sequential-reveal setup, and the agent (correctly, on limited info) refused to fabricate. This is what Pfresh is *supposed* to surface; flag but do not fix via grader.

## 5. H5 connection — **yes, directly**

`docs/reviews/2026-04-20-claude-graders-primaries-review.md:165–175` (H5) flagged exactly this: F6 is a text proxy, not a real build executor, so regex brittleness causes false-zero on semantically correct fixes. The pilot-mini-fix1 F6-all-zero result is the **predicted** H5 failure mode materialising with N=3.

## 6. Recommendations

| # | Action | Owner | Effort | When |
|---|--------|-------|--------|------|
| R1 | `diff_format_regex`: add `re.MULTILINE` at grader call **or** strip ` ```diff\n…``` ` fences before matching **or** rewrite regex to `(?m)^---\s*a/…` | devkit (grader) | XS (1 flag / 1 line) | **Pre-full-pilot** |
| R2 | `next_step_prediction_regex`: broaden to `(next|다음|green|통과|pass)\b.*?(error|에러|green|통과|pass)` or split into two OR clauses | devkit (fixture) | XS | Pre-full-pilot |
| R3 | After R1+R2, re-grade the 3 existing runtime traces in-place (no re-run needed — grader is pure-text). Expected: D and S → `primary_score≈1.0`, Pfresh unchanged at 0.0 | devkit | XS | Immediate |
| R4 | Pfresh agent-weak signal: defer judgment to full pilot with seed expansion (N≥5 per mode). Single-seed Pfresh refusal is weak evidence. | orchestrator | — | Full pilot |
| R5 | Long-term (H5 permanent fix): move build-pass to harness (`_apply_unified_diff` + `subprocess.run(build_command)`), keep grader as turn-counter | devkit (harness) | M | Post-pilot |

**Do not** change fixture expectations or agent prompt. Fix is grader-side.

---

## Evidence index

- Grader: `bin/exec-mode-grader.py:1233-1277` (`score_f6_build_turns`), `:1568-1576` (`_regex_any_hit` flags).
- Fixture: `fixtures/exec-mode-experiment/F6/ground_truth.json:52,60`; `task_prompt.md:3-9` (prompted fence form).
- Runtime (all `pilot-mini-fix1/1/{mode}/F6/seed00/`):
  - `D/stage1_output.md:1-11`, `D/metrics.json` quality.primary_components.
  - `S/stage1_output.md:1-10`, `S/metrics.json` quality.primary_components.
  - `Pfresh/stage1_output.md:1-8`, `Pfresh/metrics.json` quality.primary_components.
- Prior review: `aigentry-orchestrator/docs/reviews/2026-04-20-claude-graders-primaries-review.md:165-175` (H5).
- Pilot report: `docs/reports/2026-04-20-exec-mode-pilot-mini-fix1.md` §9.2.
