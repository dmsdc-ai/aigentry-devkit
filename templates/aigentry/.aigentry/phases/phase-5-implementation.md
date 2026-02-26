---
phase: 5
name: Implementation
active_lens: builder
---

# Phase 5: Implementation (TDD)

## Objective
Build the feature using TDD, tier-appropriate testing strategy.

## Prerequisites
- Phase 4 GATE passed (design option selected)

## Actions

### Tier 1 (Strict) — Business logic, API, data processing
Follow RED-GREEN-REFACTOR cycle. See `.aigentry/tdd-policy.md` for full details.

1. **RED**: Write failing test → verify FAIL
2. **GREEN**: Write minimal implementation → verify PASS
3. **REFACTOR**: Improve code → verify still PASS

### Tier 2 (Flexible) — UI components, styling
- Visual verification or snapshot tests acceptable
- Coverage target: >= 50%

### Tier 3 (Exempt) — Infra, config, prototypes
- Manual verification allowed
- Record exemption in `.aigentry/state.json`
- Auto-upgrade deadline: 2 weeks

## Active Lens: Builder

### Builder Lens Checklist
- [ ] Test written before implementation (Tier 1)
- [ ] Minimal code to pass test
- [ ] No over-engineering
- [ ] Coverage targets met per tier
- [ ] All evidence recorded in state.json

## Gate (Exit Criteria)
- [ ] All tests pass
- [ ] Coverage: Tier 1 >= 80%, Tier 2 >= 50%
- [ ] Integration tests >= 70% (if applicable)
- [ ] TDD evidence recorded for each feature

## Mode-Specific Behavior
| Mode | Behavior |
|------|----------|
| boost | Auto-fix simple errors (syntax, import, type, lint) |
| turbo | Implement independent components in parallel |
| lite | Use smaller models for straightforward implementations |
| persist | Retry failed implementations, max 10 iterations |
