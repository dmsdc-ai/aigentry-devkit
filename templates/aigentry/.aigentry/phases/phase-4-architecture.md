---
phase: 4
name: Architecture
active_lens: architect
---

# Phase 4: Architecture Design

## Objective
Design the technical solution with trade-off analysis.

## Prerequisites
- Phase 3 GATE passed (ambiguities resolved)

## Actions
1. Generate 3 design options:
   - **Option A**: Simple/Minimal — least complexity, fastest to build
   - **Option B**: Balanced/Clean — recommended default
   - **Option C**: Advanced/Scalable — most flexible, highest complexity

2. Evaluate each with trade-off matrix:
   - Complexity (20%), Scalability (25%), Performance (20%), Maintainability (25%), Cost (10%)

3. Present recommendation with rationale

## Active Lens: Architect

### Architect Lens Checklist
- [ ] Evaluated separation of concerns
- [ ] Identified component boundaries
- [ ] Assessed data flow and state management
- [ ] Considered error handling strategy
- [ ] Validated against project conventions (from Scanner)

## Gate (Exit Criteria)
- [ ] Design option selected with rationale
- [ ] Trade-off matrix completed
- [ ] Component boundaries defined

## Output Format
```
Phase 4: Architecture
──────────────────────────────────
Option A (Simple):    [summary] — Score: [N]
Option B (Balanced):  [summary] — Score: [N]
Option C (Advanced):  [summary] — Score: [N]

Recommendation: Option [X]
Rationale: [why]
```

## Mode-Specific Behavior
| Mode | Behavior |
|------|----------|
| boost | Auto-select best scoring option |
| consult | 3 expert perspectives (performance/maintainability/security), iterate to 80% consensus |
| polish | Iterate design until confidence >= 95 |
| captain | Auto-select + auto-proceed |
| plan | Document all 3 options thoroughly, stop after this phase |
