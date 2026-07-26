---
case: "09"
metric: M2
date: 2026-07-26
expected: no-fire
signals: []
gate_a: FAIL — preference/mode directive, then 1-line ack
brake: not reached
---

# Case 09 — Gate A exclusion: mode directive + ack

## Request

Two consecutive turns.

> Turn 1: "앞으로 좀 짧게 대답해줘. caveman mode."
>
> Turn 2: "ok, 그거대로 가."

## Context

- Turn 1 changes how the agent talks, not what it builds.
- Turn 2 follows an approved plan already agreed earlier in the conversation.
- No file, config, running system, or dispatch is touched by either turn.

## Expected verdict

**NO-FIRE** on both turns — **Gate A fails** on both. Gate B is never evaluated.

## Why

| Turn | Excluded class |
|---|---|
| 1 | Preference / tone / mode directive |
| 2 | 1-line ack, follow-up, `send-key`, broadcast |

Turn 1 is the enumerated "caveman mode" example. Turn 2 is the enumerated "ok", "go" class.

The trap in turn 2 is that acting on it **does** mutate durable state — it releases work that
changes files. Gate A is still failed, because the gate attaches to the **request that carries the
ambiguity**, not to the acknowledgement that releases an already-approved one. Gating an ack is an
infinite regress: the approval of a plan would itself need approving.

If the earlier plan was ambiguous, the gate fired **then**. If it did not fire then, an "ok" does
not create ambiguity retroactively.
