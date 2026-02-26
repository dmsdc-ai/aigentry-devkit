---
phase: 3
name: Questions
active_lens: null
---

# Phase 3: Clarifying Questions

## Objective
Resolve ambiguities before architecture design. Maximum 5 questions.

## Prerequisites
- Phase 2 GATE passed (codebase patterns identified)

## Actions
1. Identify unclear requirements from Phase 1 output
2. Present max 5 questions focused on:
   - Edge cases and error handling
   - Performance requirements
   - UI/UX details
   - Integration constraints
3. Wait for user answers before proceeding

## Active Lens: None

## Gate (Exit Criteria)
- [ ] All ambiguities resolved
- [ ] Questions answered or auto-resolved by mode

## Output Format
```
Phase 3: Questions
──────────────────────────────────
1. [question about edge case]?
2. [question about performance]?
3. [question about UI/UX]?
```

## Mode-Specific Behavior
| Mode | Behavior |
|------|----------|
| boost | Skip obvious questions, auto-answer from context |
| captain | AI answers ALL questions automatically, no user interaction |
| consult | Questions informed by 3 expert perspectives |
| plan | Ask thorough questions for complete planning |
