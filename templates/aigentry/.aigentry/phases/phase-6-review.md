---
phase: 6
name: Review
active_lens: reviewer
---

# Phase 6: Quality Review

## Objective
Verify code quality meets standards across 4 dimensions.

## Prerequisites
- Phase 5 GATE passed (tests pass, coverage met)

## Actions

### Review Dimensions
1. **CORRECTNESS** — bugs, logic errors, edge cases (threshold: confidence >= 90)
2. **CODE QUALITY** — duplication, complexity, naming, SRP (threshold: >= 85)
3. **SECURITY** — input validation, injection, auth, OWASP (threshold: >= 90)
4. **CONVENTIONS** — project style, patterns, formatting (threshold: >= 80)

### Confidence Scoring
- 0-74: Do NOT report (noise)
- 75-89: Report as **IMPORTANT**
- 90-100: Report as **CRITICAL**

**Boosters**: clear evidence, violates guideline, common bug pattern, security implication
**Reducers**: pre-existing issue, intentional trade-off with comment, generated/vendor code

## Active Lens: Reviewer

### Reviewer Lens Checklist
- [ ] All 4 dimensions evaluated
- [ ] Only issues with confidence >= 80 reported
- [ ] Each issue has file:line, description, and fix suggestion

## Gate (Exit Criteria)
- [ ] Quality score >= 80
- [ ] No CRITICAL issues unresolved
- [ ] IMPORTANT issues acknowledged or fixed

## Output Format
```
Phase 6: Quality Review
──────────────────────────────────
Summary:
  Files reviewed: [N]
  Issues found: [N]
  Recommendation: APPROVE / REQUEST_CHANGES

CRITICAL (>= 90):
  1. [issue] at [file:line] — confidence: [score]

IMPORTANT (80-89):
  1. [issue] at [file:line] — confidence: [score]
```

## Mode-Specific Behavior
| Mode | Behavior |
|------|----------|
| boost | Single pass, report and proceed |
| polish | Iterate until confidence >= 95 (3 stars), max 5 iterations |
| turbo | All 4 dimensions reviewed in parallel |
