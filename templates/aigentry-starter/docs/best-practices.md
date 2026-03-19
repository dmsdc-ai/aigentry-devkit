# aigentry Best Practices

40 practices from 8 ecosystem sessions.

## devkit (Installation & Orchestration)
1. **Architect verification is mandatory**: Always run Architect agent after completing changes — it catches bugs automated tests miss (awk portability, API pattern misuse).
2. **Parallel sub-agents for 3x speed**: Delegate independent tasks to multiple executor-low agents simultaneously. Only serialize when files overlap.
3. **Document non-obvious code patterns in CLAUDE.md**: Functions with surprising return types (e.g., `readAigentrYml()` returns `{ raw, path }` not parsed config) must be documented.
4. **Module adapter pattern for decoupling**: Each module declares capabilities via `*.adapter.json`. The orchestrator never reads module internals.
5. **installer-manifest as single source of truth**: Profiles, components, dependencies in one JSON. CLI, installer, and doctor all reference the same file.

## amplify (Content & Distribution)
6. **TDD for content pipelines**: Write tests for content transformation before implementation — catches format/encoding issues early.
7. **Parallel delegation for multi-platform**: Delegate each platform's publishing to separate agents.
8. **dry-run before publish**: Always test content generation with `--dry-run` before actual publishing.
9. **File-based communication for large payloads**: Store content in files, send file paths via telepty instead of inline content.
10. **Minimize external dependencies**: Each additional API dependency is a failure point. Prefer built-in Node.js capabilities.

## brain (Memory & Learning)
11. **Scope isolation with app prefix**: Always use `scope='app:<module>'` to prevent cross-module memory pollution.
12. **Structured payload with dual storage**: Store both human-readable summary and machine-parseable structured_payload in every memory entry.
13. **Test MCP tools in 3 places simultaneously**: Verify MCP operations via Claude Code, direct CLI, and programmatic API.
14. **Capacity branching, not blocking**: When limits are reached, degrade gracefully (compact old entries) instead of blocking operations.
15. **Inbox IPC pattern**: Use brain's inbox for async inter-session messages that persist across session restarts.

## dustcraw (Signal Crawling)
16. **Seed presets for fast onboarding**: Provide pre-configured seed sets (tech-business, humanities, finance, creator) — users start collecting in 3 minutes.
17. **Auto mode as default**: Default to autonomous operation. Manual mode only when explicitly requested.
18. **Brain scope isolation for signals**: Tag all signals with `scope='app:dustcraw'` to prevent contaminating other modules' memory.
19. **Decompose large tick() methods**: Split monolithic processing loops into discrete pipeline stages for testability.
20. **Graceful entitlement degradation**: When free tier limit reached, show friendly upgrade prompt — never throw errors.

## ssot (Contracts & Schema)
21. **Consumer-side contract verification**: Don't just define contracts — verify that consumers actually implement them correctly.
22. **Two-phase contract approach**: Draft contract first, get consumer feedback, then finalize. Prevents ivory-tower specifications.
23. **ToolSearch before assuming tools exist**: Always verify MCP tool availability via ToolSearch before referencing in contracts.
24. **Integration section in every contract**: Each contract must specify which projects consume it and how.
25. **CLAUDE.md boot speed matters**: Keep CLAUDE.md under 100 lines. Every line is loaded into context on session start.

## telepty (Session Transport)
26. **osascript submit for macOS automation**: Use osascript to programmatically submit text to Claude Code terminals.
27. **--from flag is mandatory**: Always include `--from` in telepty inject for traceability. Anonymous messages cause confusion.
28. **Version alignment across ecosystem**: Ensure telepty version matches the manifest target. Use `sort -V` for semver comparison.
29. **Document inject paths**: Map out which sessions communicate with which — prevents circular injection loops.
30. **TUI before features**: Get the terminal UI right first. Users judge tools by their interactive experience.

## deliberation (Multi-AI Discussion)
31. **safeToolHandler wraps all MCP calls**: Never let raw MCP errors propagate to users. Wrap in safe handlers with fallbacks.
32. **initDeps for dependency injection**: Use DI pattern for all external dependencies — enables testing without live services.
33. **MCP tool list in CLAUDE.md**: List all available MCP tools so Claude knows what's available without ToolSearch.
34. **Dual artifact strategy**: Generate both human-readable (Markdown) and machine-readable (JSON) outputs from every deliberation.
35. **Environment variable overrides**: Allow env vars to override all config values — essential for CI/CD and Docker.

## registry (Experiment Tracking)
36. **Check existing API before building new**: Always verify if an endpoint already exists before implementing. Prevents duplicate routes.
37. **Parallel agent delegation for migrations**: Use multiple agents for independent database migration tasks.
38. **Explicit .venv path in all Python commands**: Always prefix Python commands with venv path to avoid system Python conflicts.
39. **ruff --fix before commit**: Auto-fix linting issues before committing. Don't waste review cycles on formatting.
40. **telepty consensus before breaking changes**: Get agreement from affected sessions via telepty before making API changes.
