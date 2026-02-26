---
phase: 7
name: Delivery
active_lens: shipper
---

# Phase 7: Delivery

## Objective
Summarize completed work and prepare for handoff.

## Prerequisites
- Phase 6 GATE passed (quality score >= 80)

## Actions
1. Compile summary of implemented features
2. List all files changed/created
3. Report test results and coverage
4. Document follow-up tasks or known limitations
5. Prepare git commit with conventional format
6. Update `.aigentry/state.json` to reflect completion

## Active Lens: Shipper

### Shipper Lens Checklist
- [ ] All features summarized
- [ ] File change list complete
- [ ] Test results included
- [ ] Known limitations documented
- [ ] Git status clean, ready for commit

## Gate (Exit Criteria)
- [ ] Delivery summary presented
- [ ] User informed of next steps (commit, push, MR)
- [ ] State saved to `.aigentry/state.json`

## Output Format
```
Phase 7: Delivery
──────────────────────────────────
Completed:
- [feature 1]: [description]
- [feature 2]: [description]

Files Changed:
- [file 1] (new/modified)
- [file 2] (new/modified)

Tests: [X] passed, [Y] failed, [Z]% coverage

Next Steps:
1. git diff
2. git commit -m "type(scope): subject"
3. git push -u origin [branch]
4. Create MR/PR
```

## Mode-Specific Behavior
| Mode | Behavior |
|------|----------|
| boost | Auto-prepare commit message |
| persist | Check if more tasks remain, loop to Phase 0 if needed |
| plan | Output plan summary instead of delivery |
