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

## §2 Contract per Component

Each block: **Invocation · State · Lifecycle · Examples · When to use / NOT**.
Missing facts are tagged `⚠️ 확인 필요` rather than guessed.

### §2.1 brain

- **Invocation**: MCP tool call from LLM session (`brain_append`, `brain_query`, …). CLI fallback: `aigentry-brain` / `brain` (npm). See `aigentry-brain/AGENTS.md`.
- **State**: per-user brain store (Entry records with `scope`, `category`, `content`, `tags`). ⚠️ 확인 필요 — exact store path.
- **Lifecycle**: long-term. Entries survive sessions, compacts, reinstalls. Immutable append-only.
- **Examples**:
  - `brain_append scope=app:orchestrator category=learning content="…"` — promote journal LEARNING: line.
  - `brain_append scope=app:{project} category=decision content="[abc123] feat: …"` — commit milestone (ctx-router §5.3).
  - `brain_query scopes=['app:{project}'] tags=['orch-migration-2026-04-15']` — orchestrator rule 7-1 lessons lookup.
- **When to use**: anything that should survive a session (learnings, decisions, summaries, facts).
- **When NOT**: session-scoped state (use wtm-context); real-time inter-session signalling (use telepty); task board (use task-queue).

### §2.2 deliberation

- **Invocation**: MCP tool call (`deliberation_start`, `deliberation_speaker_candidates`, `deliberation_route_turn`, `deliberation_respond`, `deliberation_synthesize`, …). 28 tools total; session & decision families.
- **State**: deliberation server per-session (`session_id`) — turn history, speakers, transport state. Synthesis can emit an `ExecutionContractV2` for implementation handoff.
- **Lifecycle**: session (active → awaiting_synthesis → completed). Archived sessions persist; active is memory-resident.
- **Examples**:
  - `deliberation_start topic="…" rounds=3 first_speaker=claude` → returns `session_id`.
  - `deliberation_route_turn session_id=… speaker=codex` — dispatch next turn (cli/browser/clipboard/telepty transports).
  - `deliberation_synthesize session_id=…` — close session with contract-shaped summary.
- **When to use**: ≥3 parallel sessions need to converge; trade-off decisions with disagreement; formal decision recording needed.
- **When NOT**: 1–2 sessions (direct `telepty inject` is cheaper); simple status polls; anything requiring no history.

### §2.3 wtm (wtm-context, wtm-create, …)

- **Invocation**: bash CLI (`wtm context <sub>`, `wtm create`, `wtm list`, `wtm-context orphan-check`, `wtm-context rebind`). Sourced by shell hooks and by orchestrator.
- **State**: `~/.wtm/` — `sessions.json` (`{version, sessions:{sid:{cwd, last_active, context:{…}}}}`), `contexts/<project>/<type-name>/journal.jsonl`, handoff fields on sessions.
- **Lifecycle**: ephemeral per session; handoff survives until overwritten, journal rotates at N=500.
- **Examples**:
  - `wtm context log <sid> note "…"` — append journal entry.
  - `wtm context handoff <sid> "summary"` — save handoff before session ends.
  - `wtm context resume <sid>` — print last handoff + recent journal (what the new session reads).
  - `wtm-context orphan-check [cwd]` — find the most-recent session matching cwd after a crash.
- **When to use**: session-scoped state (open files, pending tasks, activity trail); short handoffs between successive sessions in the same tree.
- **When NOT**: cross-session knowledge to keep forever (use brain); task board (use task-queue); real-time messaging (use telepty).

### §2.4 task-queue

- **Invocation**: direct JSON read/write by orchestrator; bash helpers `bin/tq-status.sh`, `bin/tq-focus.sh`, `bin/tq-track.sh` (all read-only); orchestrator edits the file directly or via plan-specific scripts.
- **State**: per-project `state/task-queue.json` (schema v2: `{schema_version, tracks, tasks[], resume_context, blocks}`).
- **Lifecycle**: per-project, persistent across sessions. Committed to git.
- **Examples**:
  - `bash bin/tq-status.sh` — global status overview.
  - `bash bin/tq-focus.sh <track>` — show pending tasks on a track.
  - Direct jq edit to flip `.tasks[].status = "done"` (no generic mutator script).
- **When to use**: project-level task board, track decomposition, dependency/blocks tracking, resume context for orchestrator.
- **When NOT**: cross-project work (each project keeps its own); session-lifetime todos (use `TaskCreate` / conversation state).

### §2.5 telepty

- **Invocation**: `telepty` CLI → HTTP/WS against daemon on `:3848`. Key commands: `telepty daemon`, `telepty allow --id <name> <cli>`, `telepty list`, `telepty inject [--ref] [--submit] --from <from> <to> "<msg>"`, `telepty broadcast`, `telepty tui`.
- **State**: daemon in-memory (session table, event bus, allow-bridges); auth UUID token; session log files. Inject routes via kitty `send-text` → WS → PTY fallback.
- **Lifecycle**: per-session (session exists while the underlying CLI PTY lives). Daemon persists until killed.
- **Examples**:
  - `telepty inject --ref --from E22-coder-294 aigentry-orchestrator "REPORT: …"` — report on task completion.
  - `telepty allow --id aigentry-builder-claude claude` — register a wrapped session.
  - `telepty broadcast "merge-freeze until 18:00"` — notify all sessions.
- **When to use**: real-time signalling between live sessions; orchestrator delegation; ACKs and reports.
- **When NOT**: persistent state (use brain / wtm / task-queue); intra-aterm IPC (use `aterm inject` instead); archival of a decision (use brain).

### §2.6 aterm

- **Invocation**: inside an aterm window — `aterm list`, `aterm inject <workspace> "<msg>"`, `aterm status <workspace>`, `aterm tasks …`, `aterm lessons …`, `aterm dispatch …`. Detected via `$ATERM_IPC_SOCKET`.
- **State**: aterm process owns IPC socket; per-workspace session tables; task/lesson state held by the enclosing aterm app (see `aigentry-aterm/AGENTS.md`).
- **Lifecycle**: per-session (per aterm window). State lost when app quits.
- **Examples**:
  - `aterm list` — enumerate sessions in the current aterm.
  - `aterm inject ghostty 'make build'` — inject into a sibling workspace.
  - `aterm dispatch <task-id>` — auto-decompose + spawn subsessions + collect.
- **When to use**: only when `$ATERM_IPC_SOCKET` is set (inside aterm). Short-path local IPC without going through the telepty daemon.
- **When NOT**: cross-machine (use telepty); when `$ATERM_IPC_SOCKET` is unset (fall back to `telepty`).

### §2.7 auto-memory

- **Invocation**: none — Claude reads/writes it autonomously per system prompt rules. Explicit `remember` / `forget` requests from the user trigger it.
- **State**: markdown files under `~/.claude/projects/<proj-slug>/memory/` with `MEMORY.md` index + individual typed entries (user / feedback / project / reference).
- **Lifecycle**: long-term. Survives across Claude Code conversations indefinitely.
- **Examples**:
  - User says "remember I'm a Go dev new to React" → Claude writes `user_role.md`.
  - User says "don't mock the DB" → Claude writes a `feedback_*.md` with Why / How-to-apply.
  - User says "forget that preference" → Claude removes the entry.
- **When to use**: stable user facts, durable preferences, pointers to external systems. Claude-facing only.
- **When NOT**: code patterns / architecture / file layout (derive from source); in-flight conversation state (use plans / TaskCreate); anything `git log` already answers.

---

## §3 Decision Tree

### §3.1 Which component?

```
Q: LLM session calling directly?
├─ YES → Q: Structured Entry (scope + category) needed?
│         ├─ YES → brain  (learning / decision / summary / fact)
│         └─ NO  → Q: Multi-agent deliberation required?
│                   ├─ YES → deliberation (deliberation_start + …)
│                   └─ NO  → bash CLI is enough — call via Bash tool:
│                           wtm context resume, tq-status, telepty inject, …
│
└─ NO (hook / orchestrator / human calling) →
        Q: Real-time cross-session signal?
        ├─ YES → telepty (inject / broadcast)   — or aterm inject (inside aterm)
        └─ NO  → Q: Persistent state?
                  ├─ YES → task-queue (work board) or wtm-context (journal/handoff)
                  └─ NO  → plain bash script (trust-path.sh, open-session.sh, …)
```

### §3.2 Ephemeral vs long-term

```
Q: Data lifespan?
├─ Must survive session end → brain Entry  /  git commit  /  auto-memory
├─ Session-scoped (open files, pending tasks) → wtm-context (journal + handoff)
└─ Project-wide work tracking → task-queue (state/task-queue.json)
```

No ambiguous leaves. If none of the above fit, the use case is an anti-pattern — see §5.

---

## §4 Examples

Each example shows the actual call and the expected outcome.

### §4.1 Record an ADR / decision

Call:

```
brain_append scope=app:{project} category=decision content="[abc123] <title>"
```

Expected: entry persisted with scope + category; `brain_query scopes=['app:{project}'] category=decision` finds it across sessions. Auto-emitted by the git post-commit template from #294 (`ctx-router on-git-commit`).

### §4.2 Hand off file-edit state between sessions

Call:

```
wtm context handoff <sid> "<summary>" '["a.ts","b.ts"]' '["impl-x"]'
```

Expected: `~/.wtm/sessions.json` gets `context.last_handoff.{timestamp,summary,open_files,pending_tasks}`. Next session reads via `wtm context resume <sid>` — prints handoff + last 10 journal entries.

### §4.3 Urgent cross-session message

Call:

```
telepty inject --submit --from <self-sid> <target-sid> "REPORT: <blocker>"
```

Expected: delivered via kitty `send-text` (primary) → WS → PTY fallback; `--submit` presses Return in the target. No state retained beyond the target's inbox; use `--ref` if the message body should be copied into the shared transcript.

### §4.4 Check task-queue progress

Call:

```
bash aigentry-orchestrator/bin/tq-status.sh
```

Expected: reads `state/task-queue.json` and prints status counts, pending/in_progress/blocked lists. Read-only — mutation happens via direct jq edits in the orchestrator session.

### §4.5 Preserve context across `/compact`

**Depends on #294 (ctx-router).** After `bash aigentry-devkit/bin/ctx-install.sh`, Claude's PreCompact + SessionStart hooks run `ctx-router on-precompact` / `on-session-start` automatically: the precompact step writes a wtm handoff + brain summary; the session-start step emits `hookSpecificOutput.additionalContext` JSON (capped at 16 KB) so the compacted session boots with the prior handoff already in context.

Fallback (ctx-router not installed): write `.context-snapshot.md` by hand before running `/compact`, then read it back in the new session. Brittle — install ctx-router once.

### §4.6 Resume a session

Call:

```
wtm context resume <sid>
# or, via ctx-router bundled form:
ctx-router.sh restore <sid>
```

Expected: handoff + last 10 journal entries (`wtm`) plus `brain_query scopes=['session:<sid>'] slot=conversation_summary` (`ctx-router`). The `ctx-router restore` subcommand merges both into a single markdown payload.

### §4.7 Record an external research finding

Call:

```
brain_append scope=app:{project} category=learning content="upstream issue #485: <note>"
```

Expected: queryable later by scope + category when the same problem resurfaces. Use `category=learning` for lessons, `category=fact` for pinned knowledge.

### §4.8 Cross-role research → analysis handoff

Orchestrator dispatches `aigentry-dustcraw-*` to gather upstream material, then dispatches `aigentry-analyst-*` with the dustcraw report + runtime logs attached.

Transport (each leg):

```
telepty inject --ref --from aigentry-orchestrator-claude <target-sid> "[SPEC FIRST] …"
```

Expected: analyst closes the loop with a `REPORT:` back to orchestrator. No direct session-to-session chatter — if ≥3 sessions need to converge, route through `deliberation_start` instead.

### §4.9 Recover a session after an orphaned crash

A session dies before writing a handoff; a new one spawns with a different sid.

```
wtm-context orphan-check [cwd]
wtm-context rebind <cwd> <new-sid>
wtm context resume <new-sid>
```

Expected: `orphan-check` surfaces the most-recent session whose cwd matches (exact, prefix, or parent). `rebind` is fail-loud (exit 1 if no orphan matches) and creates a new sessions.json entry under `<new-sid>` with `rebound_from` + `rebound_at`. Resume then sees the old handoff.

### §4.10 Parallel-task decomposition

Orchestrator splits a feature into N file-disjoint parcels (rule 9: different files → different sessions) and dispatches each to a separate `aigentry-{project}-*` session. Each session `telepty inject`s a `REPORT:` on completion; orchestrator merges.

For ≥3 concurrent parcels with risk of contention (e.g. shared APIs), route through `deliberation_start` — let it track conflicts + route turns instead of hand-coordinating with raw `telepty inject`.

---

## §5 Anti-Patterns

1. **Storing ephemeral state in brain** — e.g. `brain_append category=learning content="just restarted daemon"`. Pollutes long-term memory, dilutes real learnings. Use `wtm context log` instead.

2. **Storing long-term knowledge in wtm-context** — journal bloats, no scoped/tagged search, gets rotated/archived. Promote to brain on session-end (ctx-router does this automatically for lines tagged `LEARNING:`).

3. **Spinning up a new MCP server to "unify" contracts** — more context tax on every session, solves nothing structural. Plan #295 was cancelled for this reason. Use the existing services + decision tree.

4. **Manual context snapshots instead of ctx-router hooks** — writing `.context-snapshot.md` by hand before every compact is brittle and forgetful. Install ctx-router (#294) once; the PreCompact hook handles it.

---
