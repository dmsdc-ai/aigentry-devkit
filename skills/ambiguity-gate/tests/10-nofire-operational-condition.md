---
case: "10"
metric: M2
date: 2026-07-26
expected: no-fire
signals: []
gate_a: FAIL — operational condition, not a user request
brake: not reached
guards: M5 (autonomy non-regression)
---

# Case 10 — operational condition, not a request

## Request

There is none. This is the observed state at an orchestrator turn:

> A dispatched worker's pane is showing a sandbox trust prompt and has not moved for 12 minutes.
> A second session's pane is blank. `state/dispatch/active.json` has a row past its 30-minute
> AUTO_REPORT window.

## Context

- No user message accompanies any of this.
- **Rule 30** 자율 처리 영역 lists sandbox prompts, trust modals, blank panels, stuck sessions,
  stale cleanup, and AUTO_REPORT as autonomous — the orchestrator handles them without asking.
- Handling them mutates durable state (answering the prompt, re-dispatching, cleaning up).

## Expected verdict

**NO-FIRE** — **Gate A fails**. Handle it autonomously, exactly as today.

## Why

Gate A's subject is a **task-shaped request**. These are operational conditions: nobody asked for
anything, so there is no request to have ≥2 readings *of*. The write-two rule has no input.

This is the fixture that guards **M5 (autonomy non-regression)**: Rule 37 must not convert
autonomous operational handling into user-facing questions. Success threshold for M5 is **zero**
new escalations, and a reader who fires here is the mechanism by which that regression would
happen — "stuck session, ≥2 possible causes, therefore ambiguous" reaches for the signal table
without passing Gate A.

Ambiguity about **how to fix an operational condition** is a diagnosis question — route to
`diagnose`, not to this gate ("wrong axis entirely — no ambiguity gate on a reproduction").
