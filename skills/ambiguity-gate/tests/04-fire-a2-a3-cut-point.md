---
case: "04"
metric: M2
date: 2026-07-26
expected: fire
signals: [A2, A3]
gate_a: pass
brake: applied — it resolves the target (A1 clean) but not the boundary
---

# Case 04 — A2 scope + A3 deliverable

## Request

> "inject 경로에 타임아웃 좀 넣어줘."

## Context

- One grep locates the shared helper that every inject path routes through — **A1 is clean**, the
  target is unambiguous after ~1 tool call.
- That helper has 7 callers across 4 files.
- No existing timeout constant, config key, or default is present anywhere in the path.

## Expected verdict

**FIRE** — Gate A passes, **A2** and **A3** fire.

## Why

The brake did its job on the *target* and stopped there. What survives is the **boundary**: A2's
own worked example is "this call site / this module / every caller", and all three are defensible
here — guard the one hot caller, guard the shared helper, or thread a timeout through all 7.

A3 fires with it: no file list can be stated for "when it is done", because the answer depends on
which cut point is chosen, and the timeout value itself is unspecified (a hardcoded constant, a
config key, and an argument with a default are three different deliverables).

This is the case that shows a signal surviving a **partially** successful brake. Resolving the
target is not resolving the request.

**The two readings:**

1. One guard in the shared helper — smallest diff, covers all 7 callers at once, one fixed default.
2. A per-caller timeout argument with a default — configurable, but touches 4 files and changes a
   public signature.
