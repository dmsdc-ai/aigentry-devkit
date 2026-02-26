---
platform: gemini-cli
file_reference_strategy: explicit_read
max_core_tokens: 1700
last_verified: 2026-02-25
---

# Aigentry for Gemini CLI

## Installation

1. Copy `AGENTS.md` content to `~/.gemini/instructions.md`
2. Place `.aigentry/` directory in your project root
3. Gemini CLI reads `instructions.md` on every invocation

```bash
# Copy template to your project
cp -r templates/aigentry/.aigentry /path/to/your/project/
cp templates/aigentry/AGENTS.md ~/.gemini/instructions.md
```

## Core

Use the full `AGENTS.md` as-is (~1,700 tokens). No adaptation needed.

**Important**: Add this line to the top of `instructions.md`:
```
When entering a Phase, read .aigentry/phases/phase-N-*.md for detailed instructions.
```

Gemini CLI has file system access, so it can read Phase documents when instructed.

## Limitations

- **Single instructions file**: `~/.gemini/instructions.md` is global, not per-project
- **Workaround**: Use project-level `.gemini/instructions.md` if supported, or reference project-specific `.aigentry/` paths
- **No automatic include**: Must explicitly instruct to read Phase files (the meta-directive in AGENTS.md handles this)

## Tips

- Gemini CLI can execute shell commands, so TDD evidence collection works naturally
- Use `persist` mode for long-running refactoring tasks
- State persistence via `.aigentry/state.json` works fully since Gemini can read/write files
