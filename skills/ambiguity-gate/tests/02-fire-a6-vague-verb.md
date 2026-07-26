---
case: "02"
metric: M2
date: 2026-07-26
expected: fire
signals: [A6, A2, A3]
gate_a: pass
brake: reading widens the candidate set instead of narrowing it
---

# Case 02 — A6 vague verb, no target

## Request

> "dispatch 쪽 좀 정리해줘."

## Context

- The repo has `bin/dispatch.sh`, `bin/dispatch-tracker.sh`, `state/dispatch/active.json`, and a
  `tests/dispatch/` suite.
- No file, function, or symbol is named in the request.
- Nothing earlier in the conversation narrows "dispatch 쪽".

## Expected verdict

**FIRE** — Gate A passes, **A6** fires (with A2 and A3 riding along).

## Why

"정리" is enumerated in A6 alongside improve / enhance / fix / refactor / 개선, and no file,
function, or symbol accompanies it. The brake does not save this one: grepping `dispatch` returns
**more** candidates, not fewer — reading widens the ambiguity rather than resolving it, which is
the definition of residual.

A2 also holds (script internals / registry data / test suite are three defensible cut points) and
A3 holds (no file list can be named for "when it is done"). Any one of the three is sufficient.

**The two readings:**

1. Refactor `bin/dispatch.sh` — the 600-line script has accumulated duplicated argument parsing.
2. Prune `state/dispatch/active.json` — stale rows from completed sessions have accumulated.

These are different files, different risk classes, and different definitions of done. Picking one
silently is the failure Rule 37 exists to prevent.
