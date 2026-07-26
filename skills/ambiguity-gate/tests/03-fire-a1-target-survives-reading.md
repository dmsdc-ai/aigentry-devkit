---
case: "03"
metric: M2
date: 2026-07-26
expected: fire
signals: [A1]
gate_a: pass
brake: applied and failed — reading confirms three referents instead of eliminating two
---

# Case 03 — A1 target ambiguity that survives reading

## Request

> "Gate 문서 업데이트 해줘."

## Context

Reading the glossary (`$AIGENTRY_ORCH_DIR/CONTEXT.md`) and grepping `Gate` returns **three**
distinct, currently-live referents:

| Referent | Where |
|---|---|
| spawn-capability **Gate** | `src/gate/` — who is allowed to spawn |
| **HITL Gate** | `state/hitl/` + `bin/hitl.sh` — resumable human decision point |
| **Ambiguity Gate** | this skill + Rule 37 |

Each has its own documentation surface. Nothing in the request or the preceding turn picks one.

## Expected verdict

**FIRE** — Gate A passes, **A1** fires.

## Why

A1's firing test is "≥2 concrete referents in the repo match the named target and the request does
not disambiguate." Here there are three, all real, all documented, all plausibly the one meant.

This case exists to separate the brake from the signal. The brake **was** applied — the grep ran —
and it *increased* certainty about the ambiguity rather than resolving it. That is the difference
between "resolvable by reading" (case 06) and "residual after reading" (this case).

**The two readings** (a third exists; two is the bar):

1. The HITL Gate docs — it landed 2026-07-26 and its `CONTEXT.md` glossary entry is still owed.
2. The spawn-capability Gate docs in `src/gate/` — the oldest of the three and the most likely to
   have drifted.
