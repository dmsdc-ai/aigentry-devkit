---
name: grill-with-adr
description: Adversarial spec interview that grills your plan against existing domain language and decisions, capturing crystallised choices into ADRs (docs/adr/YYYY-MM-DD-<topic>.md) and the project glossary inline. Use when user wants to stress-test a plan, write a spec before code (AGENTS.md Rule 24 SPEC FIRST), or says "스펙 그릴", "ADR 압박", "스펙 적대 인터뷰", "grill this plan".
license: MIT
---

<what-to-do>

Interview the user relentlessly about every aspect of this plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

This is the operational form of **AGENTS.md Rule 24 (SPEC FIRST)** — no implementation begins until the spec survives the grill. The output is a written ADR (or set of ADRs), not a verbal agreement.

</what-to-do>

<supporting-info>

## Domain awareness

During codebase exploration, also look for existing documentation. The aigentry ecosystem layout:

```
<project-root>/
├── AGENTS.md                          ← agent role + rules
├── CLAUDE.md                          ← claude-specific overrides
├── docs/
│   ├── rules.md                       ← rule definitions referenced from AGENTS.md
│   └── adr/
│       ├── 2026-04-22-rule-4-mode-selection.md
│       ├── 2026-05-01-rule-4-a-step-4-final-lock.md
│       └── 2026-05-04-phase6-conclusion.md
└── src/ (or bin/, lib/, etc.)
```

Glossary lives in `AGENTS.md` (role table + rule table) and `~/projects/aigentry/docs/CONSTITUTION.md` (18 articles + amendments). Treat both as the canonical glossary — terminology drift between them is itself a finding.

Create files lazily — only when you have something to write. If no `docs/adr/` exists, create it when the first ADR is needed. Do not pre-scaffold.

## During the session

### Challenge against the constitution and rules

When the user uses a term that conflicts with the existing language in `~/projects/aigentry/docs/CONSTITUTION.md` or the project's `AGENTS.md`, call it out immediately. "The constitution Article 3 defines 'session role' as the component-boundary contract, but you seem to mean the running tmux pane — which is it?"

When a proposed plan conflicts with a rule (e.g., AGENTS.md Rule 4-A mode selection, Rule 9 file-per-session, Rule 27 no-workaround), surface the rule reference and force a choice: amend the rule, or amend the plan.

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'session' — do you mean the telepty pty, the cmux workspace, or the role-bearing aigentry session? Those are different things."

### Discuss concrete scenarios

When boundaries are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts. Ecosystem-flavoured examples: "What happens if dustcraw and analyst both want to write to the same `.context-snapshot.md` simultaneously?" "If Pacc is sunset 2026-08-01, what does the selector do for chain_length=7 on 2026-09-01?"

### Cross-reference with code and ADR history

When the user states how something works, check whether the code agrees, and whether existing ADRs already settled it. If you find a contradiction, surface it: "ADR `2026-05-04-phase6-conclusion.md` §4.2 says the Layer 1 selector is 4-way, but you just described a 3-way decision tree — which is right?"

### Update the glossary inline

When a new term is resolved, capture it where domain experts will look — usually `AGENTS.md` role table, `docs/rules.md`, or the relevant ADR. Don't batch these; capture as they happen.

Do not couple the glossary to implementation details. Only include terms meaningful to a future maintainer reasoning about the system.

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful (e.g., a public contract, a rule binding, a cross-component invariant).
2. **Surprising without context** — a future reader will wonder "why did they do it this way?".
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any of the three is missing, skip the ADR. Otherwise:

- **Path**: `docs/adr/YYYY-MM-DD-<topic>.md` (today's absolute date — convert any relative date the user gives).
- **Status flow**: `proposed → accepted` (revisions tracked as `r1`, `r2`, … in a History section, not as new files).
- **Front matter**: title, date, status, decision-makers, related ADRs.
- **Body**: Context → Decision → Consequences → Alternatives Considered → Open Questions.

Mirror the format used in existing project ADRs (`docs/adr/2026-05-04-phase6-conclusion.md` is a good current reference). If the project has its own ADR template, prefer that.

### When to stop the grill

The grill ends when:

- Every open question has either an answer in the spec/ADR or an explicit "deferred to <future ADR / decision point>".
- The user can paraphrase the plan back without using vague terms.
- Implementation could begin without further architectural decisions.

If the grill exposes that the plan is fundamentally wrong, say so and offer to restart from the failing premise. Do not patch a broken plan with caveats.

</supporting-info>

---

## Attribution

Adapted from [`mattpocock/skills`](https://github.com/mattpocock/skills) (MIT) — `skills/engineering/grill-with-docs`. Distillation: ADR write-back generalised for the aigentry `docs/adr/YYYY-MM-DD-<topic>.md` layout, glossary anchored to `AGENTS.md` + constitution instead of `CONTEXT.md`, AGENTS.md Rule 24 (SPEC FIRST) cross-reference added, KR trigger keywords for telepty session discoverability.
