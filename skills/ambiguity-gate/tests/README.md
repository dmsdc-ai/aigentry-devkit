# M2 fixture set — inter-reader agreement on the ambiguity test

Metric **M2** of ADR `2026-07-26-ambiguity-plan-mode.md` §8: the firing tests in `../SKILL.md`
are only enforceable if two independent readers reach the same verdict on the same request.

| | |
|---|---|
| **Cases** | 10 — 5 must-fire (`*-fire-*.md`), 5 must-not-fire (`*-nofire-*.md`) |
| **Readers** | two independent, e.g. a fresh Claude session + a codex session |
| **Success threshold** | ≥ 8/10 agreement on the verdict |
| **Rollback trigger** | < 7/10 ⇒ the test is not decidable; rewrite the firing tests **before** Rule 37 ships as HARD |

## How to run

For each case file, give the reader `../SKILL.md` plus **only** the `## Request` and `## Context`
sections. Withhold `## Expected verdict` and everything after it — that is the answer key.

Ask for exactly three things: **fire / no-fire**, **which signal or which exclusion**, and — if
fire — **the two competing readings, written out**. Score the verdict column only; the signal
attribution is diagnostic (a right verdict for the wrong signal is a fixture worth rewriting, not
a failed case).

## Coverage

| Case | Verdict | Exercises |
|---|:-:|---|
| 01 | fire | **A5 alone** — destructive op, A1–A4 all clean |
| 02 | fire | **A6** vague verb, no named target |
| 03 | fire | **A1** target ambiguity that survives reading (three real referents) |
| 04 | fire | **A2 + A3** — ≥2 defensible cut points, deliverable unnameable |
| 05 | fire | **A7** — proceeding requires choosing which rule to violate |
| 06 | no-fire | **resolve-by-reading brake** — one grep kills the suspicion |
| 07 | no-fire | **Gate A** exclusion — status / read-only query |
| 08 | no-fire | **write-two rule** — suspicion that produces no second reading |
| 09 | no-fire | **Gate A** exclusion — preference / mode directive + 1-line ack |
| 10 | no-fire | **Gate A** — operational condition, not a request (Rule 30 autonomy, guards M5) |

Paths in these fixtures are repo-relative. Where an orchestrator-repo path is unavoidable it is
written `$AIGENTRY_ORCH_DIR/...` — never a machine path.
