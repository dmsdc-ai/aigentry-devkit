---
phase: 0
name: Setup
active_lens: null
---

# Phase 0: Setup

## Objective
Establish project context, detect execution modes, and verify git branch safety.

## Prerequisites
- User has invoked Aigentry with a task description

## Actions
1. Detect language from user input (Korean if Hangul detected, else English)
2. Parse execution modes from user message (boost/polish/consult/turbo/lite/captain/persist/plan)
3. Verify git branch — MUST NOT be on main/master
4. If on main: create feature branch before proceeding
5. Read project config files (CLAUDE.md, AGENTS.md, package.json, pyproject.toml, Cargo.toml, etc.)
6. Read `.aigentry/state.json` if exists — restore previous session state
7. Check `tdd_exemptions` for expired `upgrade_deadline` — output warning if any
8. If `.aid/` directory exists, rename to `.aigentry/` (v1.0 migration)

## Active Lens: None
Setup does not activate a specific lens.

## Gate (Exit Criteria)
- [ ] Project context loaded (language, stack, config files)
- [ ] Git branch verified (not on main/master)
- [ ] Execution modes parsed and active
- [ ] State restored from `.aigentry/state.json` if applicable

## Output Format
```
Phase 0: Setup
──────────────────────────────────
Project: [name]
Branch:  [current branch]
Stack:   [detected languages/frameworks]
Modes:   [active modes]
──────────────────────────────────
```

## Mode-Specific Behavior
| Mode | Behavior |
|------|----------|
| boost | Default — auto-proceed to Phase 1 |
| captain | Same as boost + auto-answer all subsequent questions |
| persist | Record iteration count in state.json |
| plan | Normal setup, will stop after Phase 4 |
