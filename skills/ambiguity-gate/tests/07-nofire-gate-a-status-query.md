---
case: "07"
metric: M2
date: 2026-07-26
expected: no-fire
signals: []
gate_a: FAIL — status / read-only query
brake: not reached
---

# Case 07 — Gate A exclusion: status query

## Request

> "지금 살아있는 세션 어떤 것들이야? 그리고 #743 은 결론이 뭐였지?"

## Context

- The session list is a read-only lookup.
- #743's conclusion was discussed earlier in this same conversation and is still in context.
- Nothing durable is being changed and no artifact is being produced.

## Expected verdict

**NO-FIRE** — **Gate A fails**. Gate B is never evaluated.

## Why

Two enumerated exclusion classes, both present:

| Excluded class | Which half of the request |
|---|---|
| Status / read-only query | "지금 살아있는 세션 어떤 것들이야?" |
| Answerable from context already loaded | "#743 은 결론이 뭐였지?" |

The exclusion list is closed and enumerated precisely so this verdict is mechanical rather than
judged. A reader who reaches for A1 here ("which sessions?" — ≥2 referents!) has skipped Gate A;
the signal table is only consulted **after** Gate A passes.

Answer the question normally. No plan mode, no HOLD.

**Write-two check** (for the reader who wants to argue it): there is no pair of competing readings
of "which sessions are alive" that lead to different durable outcomes — both halves have one
correct answer, retrievable rather than chosen.
