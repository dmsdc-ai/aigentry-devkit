# aigentry Ecosystem Contracts

Single-source guide for "which component do I use in situation X?" — for LLM sessions and human orchestrators. No implementation details; see each component's own `AGENTS.md` for those.

- Spec: `aigentry-orchestrator/docs/superpowers/specs/2026-04-19-ecosystem-contract-doc-design.md`
- Last verified: 2026-04-19
- Not auto-loaded. Import explicitly when needed: `@docs/ecosystem-contract.md`.

---

## §1 Components Overview

### §1.1 Services & Tools

| Component | Contract | Install | Main caller | Purpose | Lifecycle | Last-verified |
|-----------|---------|---------|-------------|---------|-----------|:-------------:|
| brain | MCP | `npm i -g @dmsdc-ai/aigentry-brain` + `claude mcp add` | LLM session | Long-term structured memory (Entry: learning / decision / summary / fact) | long-term | 2026-04-19 |
| deliberation | MCP | `npm i -g @dmsdc-ai/aigentry-deliberation` + `claude mcp add` | LLM session | Multi-agent deliberation sessions + decision synthesis | session → persistent | 2026-04-19 |
| wtm (wtm-context, wtm-create, …) | bash + file | `aigentry-devkit/install.sh` | hook / orchestrator / human | Worktree + session lifecycle, activity journal, handoff | ephemeral (per session) | 2026-04-19 |
| task-queue | bash + JSON | per-project `state/task-queue.json` | orchestrator / hook | Task board (pending / in_progress / done) | per-project | 2026-04-19 |
| telepty | bash + socket | `@dmsdc-ai/aigentry-telepty` (daemon on :3848) | hook / session / orchestrator | Real-time inter-session messaging (inject / broadcast / bus) | per-session | 2026-04-19 |
| aterm | Swift app + Rust core + IPC socket | aterm `.app` (macOS) | sessions inside aterm | Session container + internal `aterm inject` IPC | per-session | 2026-04-19 |
| auto-memory | markdown files | Built into Claude Code | Claude auto | Claude's cross-conversation memory (`~/.claude/projects/**/memory/`) | long-term | 2026-04-19 |

### §1.2 Role Sessions (role-per-folder convention)

Role sessions are dispatch targets, not separate services. A CLI session (claude / codex / gemini) loads a role AGENTS.md and behaves per that role. Contract = "orchestrator calls via `telepty inject`".

| Session pattern | Purpose | Invocation | Role MD |
|-----------------|---------|-----------|---------|
| `aigentry-architect-*` | System design, ADR / SPEC authoring, trade-off analysis, constitutional review. No code. | `telepty inject <sid> "<spec>"` | `aigentry-architect/AGENTS.md` |
| `aigentry-analyst-*` | Runtime log / data analysis, root-cause judgement (already-happened). | same | `aigentry-analyst/AGENTS.md` |
| `aigentry-builder-*` | Build / app run / deploy only. No log analysis. | same | `aigentry-builder/AGENTS.md` |
| `aigentry-tester-*` | Test execution, TC authoring, regression. | same | `aigentry-tester/AGENTS.md` |
| `aigentry-logger-*` | Log capture + forwarding. No judgement. | same | `aigentry-logger/AGENTS.md` |
| `aigentry-dustcraw-*` | External research, web search, upstream issue/PR lookup. | same | `aigentry-dustcraw/AGENTS.md` |
| `aigentry-{project}-*` | Code changes in the matching project only. | same | `{project}/AGENTS.md` |

Role → workflow routing: see §3 Decision Tree and `aigentry-orchestrator/AGENTS.md` "전담 세션 역할" table.

---
