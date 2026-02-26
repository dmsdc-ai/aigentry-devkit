---
platform: cursor
file_reference_strategy: auto_include
max_core_tokens: unlimited
last_verified: 2026-02-25
---

# Aigentry for Cursor

## Installation

Cursor supports multiple rule files in `.cursor/rules/`. Split Aigentry across files for automatic loading:

```bash
# Create rules directory
mkdir -p /path/to/your/project/.cursor/rules

# Copy core
cp templates/aigentry/AGENTS.md /path/to/your/project/.cursor/rules/aigentry-core.md

# Copy Phase documents
for f in templates/aigentry/.aigentry/phases/phase-*.md; do
  cp "$f" /path/to/your/project/.cursor/rules/aigentry-$(basename "$f")
done

# Copy TDD policy
cp templates/aigentry/.aigentry/tdd-policy.md /path/to/your/project/.cursor/rules/aigentry-tdd-policy.md

# Copy state template
cp -r templates/aigentry/.aigentry /path/to/your/project/
```

## Core

**No token limit concerns.** Cursor auto-loads all files in `.cursor/rules/`, so the full L1 + L2 content is available without adaptation.

File naming convention in `.cursor/rules/`:
```
aigentry-core.md           ← AGENTS.md
aigentry-phase-0-setup.md  ← phase-0-setup.md
aigentry-phase-1-discovery.md
...
aigentry-phase-7-delivery.md
aigentry-tdd-policy.md
aigentry-formatting.md
```

## Limitations

- **No shell execution**: Cursor cannot run tests directly, so TDD evidence must be collected by the user
- **No state.json auto-management**: User must manage `.aigentry/state.json` manually or via terminal
- **Rules directory can get crowded**: Prefix all files with `aigentry-` to avoid conflicts

## Tips

- Cursor is the **most compatible platform** for Aigentry — all content auto-loaded
- Use Cursor's built-in terminal to run tests and collect TDD evidence
- The Composer feature works well with Aigentry's multi-phase workflow
- For Cursor Agent mode, the full Aigentry workflow is available automatically
- Consider adding `.aigentry/` to `.cursorignore` to prevent indexing state files
