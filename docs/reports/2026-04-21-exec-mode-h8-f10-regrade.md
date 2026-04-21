# H8 deep-fix + F10 re-grade report

**Session**: `E-devkit-h8-f10-fix`
**Date**: 2026-04-21
**Scope**: `bin/exec-mode-grader.py::_label_marker_regex` + 40-trial text-only F10 re-grade
**Inputs**: pilot `state/exec-mode-experiment/full-pilot-fix2/1/{D,Pfresh,Pacc,S}/F10/seed*/` (40 trials, read-only)
**Output artefacts**:
- `bin/exec-mode-grader.py` — regex fix (this commit)
- `tests/exec-mode/test_grader_helpers.py` — 7 new regression tests
- `tools/h8-f10-regrade.py` — re-grade driver
- `tools/h8-f10-regrade-output.csv` — 40-row re-grade evidence

---

## 1. Diagnosis

### 1.1 Prior H8 fix was narrow

Commit `4e0bcd3` (`fix(exec-mode): _extract_labeled_section tolerates
markdown variants (H8)`) expanded the label regex from the pre-H8
`\(\s*{label}\s*\)` baseline to tolerate:

- `(a)`, `*(a)*`, `**(a)**` — paren-wrapped with optional italic/bold
- `a)`, `a.`, `a:` — half-paren or trailing punctuation
- `**a.**`, `**a:**`, `**a)**` — bold + trailing punctuation

Source (`bin/exec-mode-grader.py:836-842` *before* this commit):

```python
return re.compile(
    rf"(?im)^\s*(?:"
    rf"\*{{0,2}}\(\s*{esc}\s*\)\*{{0,2}}"     # (a), *(a)*, **(a)**
    rf"|\*{{0,2}}{esc}\*{{0,2}}[\)\.\:]"      # a) a. a: **a.** **a:** **a)**
    rf")"
)
```

The prefix whitelist was `\*{0,2}` — 0-to-2 asterisks. **No markdown
header (`#`) branch.**

### 1.2 What F10 agents actually emit

Empirical sampling of 10+ `stage1_output.md` files under
`state/exec-mode-experiment/full-pilot-fix2/1/{D,Pfresh,Pacc,S}/F10/seed*/`
shows the dominant pattern is an h2 markdown header with letter-in-parens
enumeration:

```
## (a) Status summary
...
## (b) Next actions (ordered)
...
## (c) Stale items rejected
...
```

Representative evidence:

| file | opening line |
|---|---|
| `D/F10/seed00/stage1_output.md:1` | `## (a) Status summary` |
| `D/F10/seed01/stage1_output.md:1` | `## (a) Status summary` |
| `D/F10/seed02/stage1_output.md:1` | `## (a) Status summary` |
| `Pfresh/F10/seed02/stage1_output.md:1` | `## (a) Status summary` |
| `Pacc/F10/seed01_pos2_sess1/stage1_output.md:1` | `## (a) Status summary` |
| `S/F10/seed00/stage1_output.md:1` | `## (a) Status summary` |
| `S/F10/seed01/stage1_output.md:1` | `## (a) Status summary` |
| `S/F10/seed02/stage1_output.md:1` | `## (a) Status summary` |

The `##` (two hash marks + space) prefix is not in the pre-fix regex.
`^\s*\*{0,2}` matches zero-to-two asterisks and accepts only `(a)`,
`*(a)*`, `**(a)**`. A literal `#` — let alone `## ` — falls through.

This reproduces the Claude analyst phase 3 RCA (§8, commit `472cc9f`):
21/32 F10 zero-trials are grader-gap where agent content is correct but
`_extract_labeled_section` returns empty string → all three section
presence flags flip to False → primary_score = 0.0.

### 1.3 Codex independent finding

Codex analyst (commit `9c36973`) interpreted the same signature as
*fixture-strict*. Both readings are consistent: **a regex that does not
match the agent's natural output can be described either as a grader
gap (too narrow) or as a fixture that implicitly requires a stricter
label surface than the fixture schema actually specifies.** This
re-grade settles the question empirically (§3 below).

---

## 2. Fix applied

One-line regex change at `bin/exec-mode-grader.py:836-842` — prepend an
optional markdown-header prefix (`#{1,6}\s+`) as a non-capturing group
outside the existing two-branch alternation. All pre-H8 forms continue
to match unchanged.

```python
return re.compile(
    rf"(?im)^\s*(?:#{{1,6}}\s+)?(?:"
    rf"\*{{0,2}}\(\s*{esc}\s*\)\*{{0,2}}"     # (a), *(a)*, **(a)**, ## (a)
    rf"|\*{{0,2}}{esc}\*{{0,2}}[\)\.\:]"      # a) a. a: **a.** **a:** ## a.
    rf")"
)
```

### 2.1 Why this shape, not the analyst's §8.4 sketch

The analyst §8.4 sketch was broader (`(?:\*\*|#+\s*)?\(?\s*{label}\s*\)?(?:\.|\:)?(?:\*\*)?`)
and weakened the trailing-punctuation guard (`\)?` + `(?:\.|\:)?` both
optional would match bare `a` prose lines). This implementation keeps
the pre-H8 guards intact and only adds the header prefix — strictly
narrower expansion.

### 2.2 Regression coverage (7 new tests, 8 pre-existing)

`tests/exec-mode/test_grader_helpers.py` adds:

| test | shape exercised |
|---|---|
| `test_extract_labeled_section_h2_paren_label` | `## (a)` / `## (b)` / `## (c)` — dominant F10 pattern |
| `test_extract_labeled_section_h2_paren_label_b_and_c` | `## (b)` and `## (c)` extraction with correct termination |
| `test_extract_labeled_section_h3_bold_paren` | `### **(a)**` — header + bold + parens combined |
| `test_extract_labeled_section_h2_letter_period` | `## a.` — header + letter-punct combined |
| `test_extract_labeled_section_h1_paren` | `# (a)` — h1 lower bound |
| `test_extract_labeled_section_h6_paren` | `###### (a)` — h6 upper bound |
| `test_extract_labeled_section_h2_keeps_prose_label_guard` | `## a sentence...` still rejected (no false-positive regression) |

All 15 helper tests pass (8 pre-existing + 7 new). Dependent grader
tests (F10, F7, F9) — which all exercise `_extract_labeled_section`
via their scorers — also pass unchanged.

---

## 3. Re-grade results (40 F10 trials)

Driver: `tools/h8-f10-regrade.py`. Strategy: for each trial, read
`stage1_output.md` alongside `metrics.json`, pass through the (fixed)
`score_f10_checklist(raw_text, ground_truth)` and record
`(old_primary, new_primary, old_pass, new_pass, component-presence flags)`.
**`metrics.json` is NOT mutated.** Full evidence in
`tools/h8-f10-regrade-output.csv`.

### 3.1 Per-mode means

| mode | n | old mean | new mean | delta | old pass | new pass | zero→pass lifts |
|---|---:|---:|---:|---:|---:|---:|---:|
| D      | 10 | 0.500 | **1.000** | +0.500 | 5 | **10** | 5 |
| S      | 10 | 0.100 | **1.000** | +0.900 | 1 | **10** | 9 |
| Pacc   | 10 | 0.100 | 0.317     | +0.217 | 1 | 3      | 2 |
| Pfresh | 10 | 0.000 | 0.250     | +0.250 | 0 | 0      | 0 |
| **total** | **40** | **0.175** | **0.642** | **+0.467** | **7** | **23** | **16** |

### 3.2 Per-trial fate (by mode)

**D** — 5 pre-fix zero trials (seeds 00/01/02/07/08) all lift to 1.0.
All 10 trials now pass. Matches analyst §8.4 prediction of "D F10 mean ≈ 1.000".

**S** — 9 pre-fix zero trials (seeds 00/01/02/04–09) all lift to 1.0.
All 10 trials now pass. Matches analyst §8.4 prediction of "S F10 mean ≈ 1.000".

**Pacc** — 9 pre-fix zeros; post-fix: 2 lift fully (seed04_pos1, seed08_pos1 → 1.0),
1 partial (seed01_pos2 → 0.167), 6 remain 0.0. The lifts are
position-1 or position-2 trials; residual zeros concentrate at
position ≥ 5 (seed05_pos5, seed06_pos2, seed09_pos2, seed10_pos5,
seed02_pos8, seed03_pos9) — **consistent with the Phase 3 §6 Pacc
position-decay signal (not grader-gap)**.

**Pfresh** — 10 pre-fix zeros; post-fix: 5 move to 0.5 partial
(sections now extractable, but content/unresolved rate still 1/2 =
0.5 due to legitimate fresh-context refusal of Turn 2 `U2` item);
5 remain fully 0.0 (the bare-prose refusal trials that never emitted
`(a)/(b)/(c)` at all — seeds 01/04/06/07/09 open with "우선 한 가지 플래그…"
or similar). **All residual Pfresh zeros are agent-weak** (refused to
fabricate without snapshot), which is the correct fresh-context
behavior.

### 3.3 Grader-gap / agent-weak partition (post-fix)

Zero-trial census:

| mode | pre-fix zeros | post-fix zeros | resolved | residual classified as |
|---|---:|---:|---:|---|
| D      | 5  | 0  | 5  | — (none) |
| S      | 9  | 0  | 9  | — (none) |
| Pacc   | 9  | 6  | 3  | Pacc position-decay (agent-weak) |
| Pfresh | 10 | 5  | 5  | fresh-context refusal (agent-weak) |
| **total** | **33** | **11** | **22** | **0 grader-gap remaining** |

**Grader-gap proportion: 22/33 (67%) → 0/11 (0%).** All residual zeros
are agent-weak by construction — no trial emits `## (a)` with
well-formed content that the post-fix grader still misses.

---

## 4. Phase 3 implication — Decision Tree v1 LOCK

Per analyst phase 3 §11 "Lock condition":
> after H8 re-grade on existing 40 F10 traces (no pilot re-run needed),
> reverify §7.2 cluster assignments and transition v1 DRAFT → v1 LOCKED.

### 4.1 Mode topology post-fix

F10 pass-rate ranking: **D (10/10) ≈ S (10/10) ≫ Pacc (3/10) ≫ Pfresh (0/10)**.
This **preserves** the Phase 3 §7.2 cluster assignments
(D/S dominance, Pacc DQ by position-decay, Pfresh DQ by
cost + fresh-context refusal). Tree topology invariant.

### 4.2 Quality values to refresh in §3.2 / §7

Wherever the analyst report tabulates F10-column means these should be
updated from pre-regrade to post-regrade values (+0.5 for D, +0.9 for
S, +0.22 for Pacc, +0.25 for Pfresh). The *ordinal* relationships in
§3.2 mode-ranking hold:

| metric | pre-regrade | post-regrade | direction preserved? |
|---|---:|---:|---|
| D mean (F10) | 0.500 | 1.000 | ✓ still D ≥ S |
| S mean (F10) | 0.100 | 1.000 | ✓ still D ≈ S |
| Pacc mean (F10) | 0.100 | 0.317 | ✓ still ≪ D, S |
| Pfresh mean (F10) | 0.000 | 0.250 | ✓ still ≪ D, S |

### 4.3 LOCK recommendation

- **Grader-gap resolved**: all F10 zero-trials now classify cleanly as
  agent-weak. The `## (a)` false-negative that blocked LOCK (analyst
  §8.4) is gone.
- **Topology invariant**: Rule 4 DRAFT clusters (§7.2) and
  DQ-by-position tree do not change.
- **Values require refresh**: the F10 column in §3.2 should be
  re-baselined against `tools/h8-f10-regrade-output.csv` before LOCK
  is stamped — this is a mechanical update, not a design change.

**Lockability: yes** — pending orchestrator's decision on whether to
(a) patch pilot `metrics.json` in-place with new F10 scores and re-run
the analyzer, or (b) treat the CSV as an out-of-band correction layer
in the analyst report itself. Either path unblocks LOCK; this session
does not make that choice.

---

## 5. Explicit non-scope

- **No pilot re-run.** Re-grade is text-only against existing
  `stage1_output.md`.
- **No mutation of `metrics.json`.** CSV only. Orchestrator owns the
  patch decision.
- **No tagging.** `fix4` (or equivalent) is the orchestrator's to stamp
  after reviewing this report.
- **No changes to other graders.** F2/F3/F4/F5/F6/F7/F8/F9/Fa scorers
  untouched. F7 and F9 both consume `_extract_labeled_section` and
  benefit incidentally; their own test suites pass without change.

---

## 6. Commit trail (explicit pathspec)

```
git add bin/exec-mode-grader.py \
        tests/exec-mode/test_grader_helpers.py \
        tools/h8-f10-regrade.py \
        tools/h8-f10-regrade-output.csv \
        docs/reports/2026-04-21-exec-mode-h8-f10-regrade.md
```

See the commit message on this same commit for the rationale abstract
and the analyst cross-reference.
