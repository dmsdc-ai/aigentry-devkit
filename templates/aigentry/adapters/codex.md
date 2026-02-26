---
platform: codex-cli
file_reference_strategy: explicit_read
max_core_tokens: 1700
last_verified: 2026-02-25
---

# Aigentry for Codex CLI

## Installation

1. Copy `AGENTS.md` to your project root
2. Place `.aigentry/` directory in your project root
3. Codex CLI automatically reads `AGENTS.md` at project root

```bash
# Copy template to your project
cp -r templates/aigentry/.aigentry /path/to/your/project/
cp templates/aigentry/AGENTS.md /path/to/your/project/AGENTS.md
```

## Core

Use the full `AGENTS.md` as-is (~1,700 tokens). No adaptation needed.

Codex supports AGENTS.md chains — it will follow file references in the document. The meta-directive "Read `.aigentry/phases/phase-N-*.md`" will trigger Codex to use its file read tools.

## Limitations

- **AGENTS.md loaded every turn**: The ~1,700 tokens are consumed each interaction, reducing available context for code/output
- **No native include**: Codex reads referenced files via tool calls, not auto-include. The meta-directive must be explicit.
- **Sandbox restrictions**: Some file operations may be limited depending on Codex's approval mode

## Tips

- Codex excels at TDD workflows — Builder lens + RED-GREEN-REFACTOR cycle works naturally
- Use `turbo` mode for parallel implementation of independent components
- State persistence via `.aigentry/state.json` works fully
- For large projects, consider keeping AGENTS.md minimal and relying on Phase documents for details
- Codex's `codex exec` can run tests automatically for TDD evidence collection
