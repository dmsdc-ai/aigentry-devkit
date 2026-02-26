---
phase: 1
name: Discovery
active_lens: null
---

# Phase 1: Discovery

## Objective
Understand what the user wants to build. Extract requirements, user stories, and acceptance criteria.

## Prerequisites
- Phase 0 GATE passed (project context loaded)

## Actions
1. Analyze the user's feature request
2. Extract: business logic, constraints, acceptance criteria
3. Identify user stories: As a [role], I want [goal], so that [benefit]
4. Classify each requirement's TDD tier (Tier 1/2/3)
5. In boost mode: infer requirements from context, minimize questions

## Active Lens: None
Discovery is analyst work, no specific lens activated.

## Gate (Exit Criteria)
- [ ] Requirements documented with clear acceptance criteria
- [ ] User stories identified
- [ ] TDD tier classification for each component

## Output Format
```
Phase 1: Discovery
──────────────────────────────────
Requirements:
1. [requirement 1] (Tier [1/2/3])
2. [requirement 2] (Tier [1/2/3])

User Stories:
- As a [role], I want [goal], so that [benefit]

Constraints:
- [constraint 1]

Acceptance Criteria:
- [ ] [criterion 1]
- [ ] [criterion 2]
```

## Mode-Specific Behavior
| Mode | Behavior |
|------|----------|
| boost | Infer requirements, minimize clarification |
| captain | Auto-infer all requirements without asking |
| plan | Document thoroughly for planning output |
