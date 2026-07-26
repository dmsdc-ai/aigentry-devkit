---
name: ambiguity-gate
description: |
  Blocks action on an ambiguous task until the interpretation is chosen. Interactive sessions
  enter plan mode with the competing interpretations written out; dispatched workers send a HOLD
  inject instead (plan-approval UI is on a screen nobody watches). Fires on task-shaped requests
  only. Use when a request has ≥2 plausible readings of target/scope/deliverable/success-criteria,
  or implies an unbounded destructive operation.
  Triggers: "ambiguous", "not sure what you mean", "plan mode", "which one", "모호", "애매",
  "플랜 모드", "뭘 말하는지", "범위가", "어디까지".
version: 0.1.0
prerequisites:
  tool: [EnterPlanMode]
fallback: written-plan-hold
---

# Ambiguity Gate

**A task-shaped request with residual ambiguity does not get acted on until the interpretation is chosen.**

The branch variable is not your role. It is **whether a human is watching the surface on which the
question would appear.** Plan mode is a blocking modal: on a watched surface it is the cheapest
possible gate; on an unwatched one it is indistinguishable from a hung session — and it eats the
injects sent to wake it. Role is the observable proxy for "watched", nothing more.

Normative source: `docs/rules.md` **Rule 37** (HARD). This skill is its operational aid, not its
authority — the rule binds even where this skill is not installed.

## Where this skill fits

| Situation | Route to | Boundary |
|---|---|---|
| The request has ≥2 plausible readings — we do not know **what the user wants** | **`ambiguity-gate`** (this skill) | Request-space multiplicity. **Only the user can resolve it.** |
| The goal is known; **2+ equally valid approaches** to reach it | `auto-multi-llm-review` | Solution-space multiplicity. An LLM panel *can* resolve it. **If both fire, ambiguity-gate goes first** — you cannot deliberate approaches to an unknown target. Deliberation may then run inside the plan or after approval. |
| An artifact already exists (design doc, review feedback, dead-ended debug) and needs multi-AI verification | `deliberation-gate` | Fires on **outputs**; this gate fires on **inputs**. Sequential, never competing. |
| A plan exists and must be stress-tested into a written ADR (Rule 24 SPEC FIRST) | `grill-with-adr` | **Downstream exit**, not a competitor: gate → approved plan → if the decision is ADR-weight (scope ≥ cross-project, or one-way) → grill. Also: grill is user-invoked; this gate is automatic. |
| oh-my-claudecode "Broad Request Detection" → `explore` → `architect` → `plan` | Compatible — runs **inside** plan mode | OMC owns an optional *interview method*; Rule 37 owns the *gate* (no action before approval). Art.17.2: OMC must never be required — the gate uses native plan mode and works with OMC absent. Conflict exists **only** if an OMC flow acts before approval; then Rule 37 wins. |
| Design exploration before building something new | `superpowers:brainstorming` | Brainstorming explores a *chosen* direction; the gate decides *which* direction is being asked for. Brainstorm inside plan mode, or after approval. |
| "Why does this break?" rather than "what should we build?" | `diagnose` | Wrong axis entirely — no ambiguity gate on a reproduction. |

---

## Step 1 — Gate A: is this task-shaped?

The request asks for a change to durable state (files, config, running systems, dispatched work)
or for a deliverable artifact (doc, design, report). Excluded, enumerated:

| Excluded class | Example |
|---|---|
| Answerable from context already loaded | "what did #743 conclude?" |
| Status / read-only query | "which sessions are alive?" |
| 1-line ack, follow-up, `send-key`, broadcast | "ok", "go", "yes do that" |
| Preference / tone / mode directive | "caveman mode", "shorter answers" |
| Conversation about a decision already made | "why did we pick two-way?" |

Enumerating exclusions is deliberate: a positive definition of "task" drifts between readers, a
closed exclusion list does not. **Gate A fails ⇒ stop here. No gate, answer normally.**

Operational conditions are not requests. A sandbox prompt, a trust modal, a blank panel, a stuck
session, stale cleanup, AUTO_REPORT — Rule 30 autonomy is untouched by this gate.

> **If skipped:** the gate fires on chatter and status queries. Every "ok" becomes an approval round
> trip, the user learns to route around it, and the gate stops carrying information — worse than no
> gate, because it still *looks* like one.

## Step 2 — Resolve by reading first (the brake)

Cheap disambiguation comes **first**. If ~3 tool calls (a grep, a file read, a `tq-status`) resolve
the referent, it was never ambiguous and **the gate must not fire**. Only **residual ambiguity that
survives reading** triggers the gate.

This is the single most important step in the skill.

> **If skipped:** "무조건" degenerates into an interview before every task. Users approve without
> reading within days, and the gate becomes a tax that buys nothing. Over-triggering — not
> under-triggering — is the way this gate fails.

## Step 3 — Gate B: does a signal survive the reading?

Fires if **≥1** signal holds:

| # | Signal | Firing test |
|---|---|---|
| **A1** | **Target** | ≥2 concrete referents in the repo match the named target and the request does not disambiguate |
| **A2** | **Scope** | The change boundary has ≥2 defensible cut points (this call site / this module / every caller) |
| **A3** | **Deliverable** | You cannot name the exact file(s) or artifact(s) that will exist when it is done |
| **A4** | **Success criteria** | You cannot state one checkable pass/fail condition |
| **A5** | **Destructive op: unbounded *or* irreversible** | delete / overwrite / force-push / reset / drop / publish / kill that **either** (i) lacks an explicit bound (which files, which remote, which sessions), **or** (ii) **irreversibly destroys work not recoverable from any remote or backup**, absent an explicit user acknowledgement of that loss. **Fires alone, always** |
| **A6** | **Vague verb, no target** | improve / enhance / fix / refactor / 정리 / 개선 with no named file, function, or symbol |
| **A7** | **Constraint conflict** | Proceeding requires choosing which standing rule, ADR, or constitutional article to violate |

A6 is the oh-my-claudecode "Broad Request Detection" heuristic, cited rather than reinvented
(Art.1 경량; the heuristic is sound, only its plugin coupling is unacceptable).

**The write-two rule.** A signal fires **only if you can write down the ≥2 competing readings
verbatim.** Suspicion is not a signal. If you can produce two, you may not silently pick one
(응답원칙 §4); if you cannot produce two, the signal did not fire and you proceed.

The written interpretations *are* the first section of the plan — detecting the ambiguity and
drafting the plan are the same act. No extra work, and the plan cannot be vaguer than the detection.

> **If skipped:** two readers of the same request disagree on whether it fired, and the rule stops
> being enforceable. Writing the two readings is the entire mechanism for inter-reader agreement.

**Decision rule:** `Gate A pass AND (≥1 of A1–A7 survives reading) → ambiguous`.

## Step 4 — Branch by watched surface

| Branch | Condition | Action |
|---|---|---|
| **Interactive** | human watching this surface | `EnterPlanMode` → plan whose §1 is the written interpretations + recommendation → wait for approval → `ExitPlanMode` → act |
| **Dispatched worker** | nobody watching | **MUST NOT enter plan mode.** `telepty inject` **HOLD** to orchestrator with the same written interpretations + recommendation → wait. Orchestrator opens a HITL Gate (`bin/hitl.sh open --kind decision --resume reinject`) → `awaiting_user` → resume by re-inject |

**Detection signal — one env var:**

```sh
[ "${AIGENTRY_WORKER_SESSION:-}" = "1" ] && echo worker || echo interactive
```

Set to `1` by `bin/dispatch.sh` in the generated per-session `worker-launcher.sh`, for **all** CLIs
(claude / codex / gemini), and already load-bearing as the orchestrator-vs-worker discriminator in
`bin/session-cleanup.sh`. Do not infer the branch from cwd, from the `[SAWP]` envelope, or from
`TELEPTY_SESSION_ID` — the first is empirically wrong under cwd decoupling, the second is invisible
to a skill, the third is present for the orchestrator too.

**Default when unset ⇒ interactive.** Deliberately fail-open, because the two errors are not
symmetric. A false *worker* verdict on the orchestrator silently removes the user's own gate —
reintroducing exactly the failure this gate exists to eliminate, invisibly. A false *interactive*
verdict on a worker produces a plan-mode stall on an unwatched screen: bad, but already instrumented
— `dispatch-tracker.sh check` classifies it and AUTO_REPORTs or re-dispatches within 30 minutes. A
public devkit user running `claude` directly has no env var and *is* interactive; the default is
correct for them by construction.

> **If skipped (worker enters plan mode):** the approval modal renders on a screen nobody watches,
> the session looks hung, and the injects sent to wake it are swallowed by the modal (#737/#743).
> A dispatched worker never calls `EnterPlanMode` — it HOLDs.

### 4a — Interactive: the plan's §1

`EnterPlanMode`, and the plan opens with the interpretations, not with steps:

```markdown
## §1 Interpretations
1. <reading A, verbatim>
2. <reading B, verbatim>
**Recommended:** 1 — <one line why>
```

`AskUserQuestion` is the asking mechanism *inside* plan mode. No state-mutating tool call until
`ExitPlanMode` returns approved.

### 4b — Worker: the HOLD inject shape

```bash
telepty inject --from "$TELEPTY_SESSION_ID" orchestrator \
  "HOLD [<task-id>]: <one-line ambiguity> | 해석1: <A> | 해석2: <B> | 권장: 1 (<why>) | 승인 전 상태 변경 없음"
# long payload → write the interpretations to a shared ref file and use --ref FILE instead
```

Then **wait**. This is not idling — the orchestrator marks you `awaiting_user`, which excludes the
session from AUTO_REPORT, re-dispatch, and GC.

**The skill never runs `bin/hitl.sh`.** Opening the HITL Gate is the orchestrator's job on receipt
of the HOLD. A worker that opens its own gate has bypassed the human it was trying to reach.

## Step 5 — Context preservation while gated

A blocking modal swallows injects (#737) and plan-mode windows have demonstrably lost worker REPORTs
(#743). Sweep at **three** points: entry, each user-turn boundary of a multi-turn interview, and
**exit before acting**.

```sh
# entry — one 0-byte marker
mkdir -p "$HOME/.aigentry/plan-mode"
: > "$HOME/.aigentry/plan-mode/${TELEPTY_SESSION_ID:-local}.entry"

# turn boundary + exit — sweep, read anything new BEFORE acting
[ -d "$HOME/.telepty/shared" ] && find "$HOME/.telepty/shared" -name '*.md' \
  -newer "$HOME/.aigentry/plan-mode/${TELEPTY_SESSION_ID:-local}.entry" 2>/dev/null

# exit — remove marker (no GC needed: the file that creates it also removes it)
rm -f "$HOME/.aigentry/plan-mode/${TELEPTY_SESSION_ID:-local}.entry"
```

`-newer FILE` is POSIX and universal. Do **not** substitute `-newermt` — it is a GNU/BSD extension
and `bfs` (macOS `find` on many setups) rejects relative timestamps outright (Rule 26 cross-OS).

**Coverage limit, stated honestly:** this recovers **ref-carrying** injects only (`shared/*.md`).
Inline `telepty inject "<text>"` leaves no file and is not recoverable this way. Acceptable because
the high-value classes are ref-carrying by rule (every dispatch goes through `dispatch.sh --ref`;
the mandatory REPORT shape is `--ref FILE`). The residue is short inline acks.

> **If skipped (no sweep before acting):** you execute an approved plan against a stale world. The
> REPORT that landed mid-plan — a failed dispatch, an incident, a worker's HOLD — is never read, and
> the plan you just got approved was drafted without it.

## Fallback — `written-plan-hold` (§17.4)

`EnterPlanMode` is Claude-Code-only. Where it is unavailable (interactive codex/gemini): emit the N
interpretations as a numbered block, name the recommended one, and **stop — no state-mutating tool
call until the user answers.**

Same contract (no action before approval), **weaker enforcement** (discipline, not a harness modal).
Stated as weaker, not equivalent. Two facts shrink the exposure: the worker branch needs no plan mode
at all — HOLD inject is CLI-agnostic — and that is the majority of sessions.

## Exceptions

- **User overrides with ambiguity acknowledged** ("그냥 해", "네 판단대로"): name the chosen
  interpretation in **one line**, then proceed. Silently picking is the only violation.
- **Rule 30 autonomous operational domain**: unchanged. This gate does not shrink operational autonomy.

## NEVER

1. **NEVER surface N interpretations and then act in the same turn.** That is the exact failure this
   gate exists to close — 응답원칙 §4 says what to output, Rule 37 says when to stop.
2. **NEVER enter plan mode as a dispatched worker.** HOLD inject, always.
3. **NEVER call `bin/hitl.sh` from this skill.** The orchestrator opens the gate.
4. **NEVER fire on a suspicion you cannot write two readings for.** Write-two or proceed.
5. **NEVER skip the read-first brake to "be safe".** An over-triggering gate is abandoned, and an
   abandoned gate protects nothing.
