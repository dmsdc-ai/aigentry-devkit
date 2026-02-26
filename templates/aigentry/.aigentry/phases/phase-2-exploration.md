---
phase: 2
name: Exploration
active_lens: scout, scanner
---

# Phase 2: Exploration

## Objective
Understand the existing codebase and evaluate available external tools.

## Prerequisites
- Phase 1 GATE passed (requirements documented)

## Actions

### [SCOUT LENS] — External Library Research
1. Search for relevant external libraries/packages
2. Evaluate: stars, downloads, last commit, license, bundle size
3. Quality gates: stars > 1000, downloads > 100k/month, last commit < 6 months, permissive license
4. Recommend top 3 with pros/cons comparison
5. Note: Scout accuracy may be limited by training data cutoff. Use web search tools when available.

### [SCANNER LENS] — Internal Pattern Extraction
1. Scan project for: file structure, naming conventions, import patterns
2. Identify: architecture style, testing framework, formatting rules
3. Find reusable code, existing components, shared utilities
4. Score relevance of each pattern found

## Active Lens: Scout, then Scanner
Apply both lenses sequentially (or in parallel in turbo mode).

## Gate (Exit Criteria)
- [ ] External library recommendations documented
- [ ] Internal codebase patterns identified
- [ ] Reusable components/utilities catalogued

## Output Format
```
Phase 2: Exploration
──────────────────────────────────
[SCOUT] External Libraries:
1. [lib] — [pros] / [cons]
2. [lib] — [pros] / [cons]
Recommendation: [lib]

[SCANNER] Internal Patterns:
- Architecture: [style]
- Testing: [framework]
- Reusable: [components]
```

## Mode-Specific Behavior
| Mode | Behavior |
|------|----------|
| boost | Quick evaluation, top recommendation only |
| turbo | Scout and Scanner in parallel |
| lite | Skip deep evaluation, surface-level scan |
