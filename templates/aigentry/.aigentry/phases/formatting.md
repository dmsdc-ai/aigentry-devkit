---
type: formatting
---

# Output Formatting Guide

## Phase Banner Template

Each phase output uses this consistent format:

```
Phase N: [Name]
──────────────────────────────────
[content]
──────────────────────────────────
```

## Polish Mode Star Rating

| Stars | Confidence | Quality Level |
|-------|-----------|---------------|
| 1 star | 60-79 | Basic quality |
| 2 stars | 80-94 | Good quality |
| 3 stars | 95-100 | Excellent quality |

Display: `Quality: ★★★ (confidence: 97)`

## Confidence Labels

- `CRITICAL` — confidence >= 90
- `IMPORTANT` — confidence 80-89
- Below 80 — do not report

## Mode Banner

When modes are active, display in setup:
```
Modes: [boost] [polish] [turbo]
```

## TDD Evidence Format

```
[RED]   pytest tests/test_auth.py → FAIL (exit 1) ✓
[GREEN] pytest tests/test_auth.py → PASS (exit 0) ✓
[REFACTOR] pytest tests/test_auth.py → PASS (exit 0) ✓
```
