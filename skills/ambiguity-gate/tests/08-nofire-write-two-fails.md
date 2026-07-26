---
case: "08"
metric: M2
date: 2026-07-26
expected: no-fire
signals: []
gate_a: pass
brake: n/a — the suspicion never reaches a second reading
---

# Case 08 — suspicion without a second reading

## Request

> "package.json `files[]` 에 `\"skills/ambiguity-gate/**\"` 추가해줘."

## Context

- `files[]` is a flat array of ~40 glob strings; `lib/skills-drift.js` parses it with
  `/^skills\/([^/*]+)\/\*\*$/` and cares only about membership, not position.
- The exact string to add is quoted in the request.
- `skills/ambiguity-gate/` exists on disk.

## Expected verdict

**NO-FIRE** — Gate A passes, but the **write-two rule** is not satisfied.

## Why

The request *feels* underspecified — where in the array? alphabetical or appended? — and that
feeling is exactly what this case tests. The write-two rule says: **a signal fires only if you can
write down the ≥2 competing readings verbatim.** Try:

1. "Append it at the end of the array."
2. "Insert it next to the other `skills/…` entries."

These are not competing *readings of the request*. They produce byte-identical behaviour — the
regex is position-blind — so they are two ways to perform one unambiguous instruction, not two
things the user might have meant. Formatting latitude is not ambiguity.

A1–A4 all answer cleanly: the target is quoted verbatim, the scope is one array in one file, the
deliverable is `package.json`, and the pass/fail condition is `npm run test:skills-drift` green
plus `npm pack --dry-run` listing the skill. A5–A7 do not apply.

**Suspicion is not a signal.** Firing here spends a round trip to ask a question with no wrong
answer — the single cheapest way to train a user to stop reading the gate.
