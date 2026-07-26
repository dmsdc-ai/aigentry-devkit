---
case: "06"
metric: M2
date: 2026-07-26
expected: no-fire
signals: []
gate_a: pass
brake: RESOLVES — one grep, one referent
---

# Case 06 — the resolve-by-reading brake kills it

## Request

> "drift guard 의 regex 고쳐줘 — de-listed 스킬까지 잡아버려."

## Context

- `lib/skills-drift.js` contains exactly **one** regular expression:
  `/^skills\/([^/*]+)\/\*\*$/`, used to read shipped skill names out of `package.json` `files[]`.
- The symptom named in the request ("de-listed 스킬까지 잡아버려") maps to that one regex and to
  no other code in the file.
- `tests/skills-drift/v1/skills-drift.test.js` states the intended behaviour as an assertion.

## Expected verdict

**NO-FIRE** — Gate A passes, but no signal survives the brake.

## Why

Gate A passes: this mutates a source file. The gate still must not fire.

"regex" reads like an A1 target ambiguity, and "고쳐줘" reads like an A6 vague verb. Both dissolve
in **one tool call**: the file has a single regex, and the test file pins the expected behaviour,
so A3 (name the deliverable — `lib/skills-drift.js`) and A4 (name the pass/fail condition — the
existing test) are both answerable after reading.

This is the case the brake exists for. Firing here is the **over-trigger failure mode** (§4 Q5):
"고쳐줘" is a vague verb, but A6's firing test requires vague verb **and no named target** — the
target is named, so A6 does not fire. Reading comes first, and reading finished the job.

Recording it for the reader who fires on the verb alone: that reading turns Rule 37 into an
interview before every bug fix, which is precisely what makes users route around the gate.
