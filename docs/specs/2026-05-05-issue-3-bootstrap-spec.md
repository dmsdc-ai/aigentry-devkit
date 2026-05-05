---
name: 2026-05-05-issue-3-bootstrap-spec
description: aigentry scaffold --project <cwd> — devkit-side project file scaffolding (CLAUDE.md/AGENTS.md/GEMINI.md/.claude/settings.json/state/) implementing the scaffold/v1 --project row from ADR 2026-05-05-telepty-devkit-boundary §3.3.1.4
type: spec
scope: cross-project
decision_type: two-way
status: proposed
tier: T1
reviewers_required: 1
created: 2026-05-05
authors: [aigentry-architect-bootstrap-spec (claude)]
ssot_contract: scaffold/v1
ssot_path: ~/projects/aigentry-ssot/contracts/scaffold-v1.md
parent_adr: ~/projects/aigentry-orchestrator/docs/adr/2026-05-05-telepty-devkit-boundary.md
parent_adr_commit: e4b072b
m0_audit_window: 2026-05-12
related_specs:
  - 2026-05-05-issue-8-integrate-telepty-spec.md (TBD — sibling subcommand)
  - 2026-05-05-issue-10-2-install-hooks-spec.md (TBD — sibling subcommand)
gates_contributed:
  - G3 (scaffold/v1 SSOT stub) — primary
  - G2 (context-ref/v1 boundary respect — by exclusion; UserPromptSubmit deferred to #10.2)
  - M6 (conformance fixture coverage — fixtures listed in §10)
---

# Spec — Issue #3: `aigentry scaffold --project <cwd>` (Bootstrap Spec)

> Implements the `--project` row of the `scaffold/v1` CLI surface locked by ADR 2026-05-05-telepty-devkit-boundary §3.3.1.4 (commit `e4b072b`). Delivers project-level CLAUDE.md / AGENTS.md / GEMINI.md / `.claude/settings.json` / `state/` bootstrapping in devkit, callable manually or as the unilateral preflight target of telepty's opt-in `--scaffold` shim (ADR §3.3.1.2-3).

---

## §1 Context

Three concurrent issues (#3, #8, #10.2) were blocked on the devkit/telepty boundary question. The boundary ADR (`e4b072b`, 2026-05-05) resolved the question with a 4-rule mechanism-vs-content split (§3.1) and locked a `scaffold/v1` CLI surface (§3.3.1.4) with four subcommands. **Issue #3 is the `--project <cwd>` row of that surface.**

Today, devkit already exposes a near-equivalent operation as `aigentry-devkit workspace-init --cli <cli> --cwd <path>` (`bin/aigentry-devkit.js:1503`, backed by `lib/workspace-init.js`). The existing implementation covers per-CLI AGENTS.md/CLAUDE.md/GEMINI.md generation, `state/{task-queue,lessons}.json` provisioning, `.claude/settings.local.json` deep-merge with PostToolUse + Stop hooks, and CLI-specific MCP brain registration. Idempotency is enforced via `existsSync`-skip.

This spec **does not invent a new operation**; it refactors the existing operation to match the ADR-locked surface, adds the four required behaviors absent today (`--dry-run`, `--backup`, `--uninstall`, machine-parseable `<verb> <path>` stdout), and aligns file naming (`settings.json` per ADR §3.4 row #3 verbatim, replacing `settings.local.json`). The `aigentry-devkit workspace-init` form survives as a thin alias for backward compatibility.

The spec is a Phase 3 deliverable per ADR §6.3 / §6.5.1 G3. Cross-LLM consensus on the boundary is preserved (gemini r1 ACCEPT + codex r3 ACCEPT_WITH_CONDITIONS resolved); this spec inherits that consensus by construction (refactor only, no boundary changes).

---

## §2 Goal

Provide a single, idempotent, deterministic command that bootstraps an aigentry-compatible project workspace. The command is callable in three modes:

1. **Manual user invocation** — `aigentry scaffold --project /abs/path/to/repo --cli claude`.
2. **Telepty `--scaffold` opt-in shim preflight** — telepty execs the same command before launching a session terminal; ADR §3.3.1.2 ordering applies.
3. **Other devkit commands** — internal callers (`aigentry up`, `aigentry start`, `aigentry session create`) use the same module via the alias path.

Success means: the user can run the command in any cwd, with any of the three supported AI CLIs, on any supported OS (macOS/Linux/Windows per Article 2), without prompting, without external dependencies, with safe re-run semantics, and with stdout that another tool can parse.

---

## §3 Scope

### §3.1 In scope (this spec)

| Item | Locked surface |
|---|---|
| `aigentry scaffold --project <cwd>` (canonical) | `bin/aigentry-devkit.js` dispatch entry |
| `aigentry-devkit workspace-init` (alias, deprecation note) | `bin/aigentry-devkit.js` dispatch entry |
| Per-CLI file matrix | §6.2 table |
| `.claude/settings.json` (NOT `.local.json`) sentinel-merge | §6.3 |
| `--dry-run`, `--backup`, `--uninstall`, `--template-dir` flags | §6.1 |
| Machine-parseable stdout vocabulary | §6.4 |
| Uniform exit codes (0 / 2 / 3 / 4) | §8 |
| Conformance fixtures `tests/scaffold-project/v1/` | §10 V6 |
| Backward-compat path for existing `workspace-init` callers | §9 |

### §3.2 Out of scope (lessons F1 — explicit)

| Item | Owner |
|---|---|
| `aigentry scaffold --integrate-telepty` body | Issue #8 spec (`scaffold/v1` row 2) |
| `aigentry scaffold install-hooks <cli>` body | Issue #10.2 spec (`scaffold/v1` row 3) |
| Telepty `--scaffold` shim implementation | telepty repo, `scaffold-shim/v1` (ADR §3.3.1.2-3) |
| `[context-ref/v1]` UserPromptSubmit hook configuration | Issue #10.2 (devkit boundary respect — `--project` MUST NOT touch this hook) |
| Global `~/CLAUDE.md` / `~/AGENTS.md` / `~/GEMINI.md` editing | Issue #8 (`--integrate-telepty`) |
| New external runtime dependencies | Forbidden by ADR §8 M4 |
| `.gemini/settings.json` project-level merge | Deferred — gemini settings are global today; spec OQ-3 |
| `.codex/config.toml` project-level merge | Deferred — codex config is global today; spec OQ-3 |
| Template authoring / template content updates | Deferred — templates live in `templates/workspace/`; this spec consumes only |
| Multi-project bootstrap (`aigentry session create` orchestration) | Already exists; consumes this spec's module |

---

## §4 Approach

### §4.1 Chosen — Refactor `lib/workspace-init.js` into `lib/scaffold/project/*` (Approach C)

Rename `lib/workspace-init.js` to `lib/scaffold/project/index.js` and split its responsibilities across five sub-modules:

| Sub-module | Purpose | Origin |
|---|---|---|
| `lib/scaffold/project/index.js` | Orchestrator: argv → action plan → execute. Owns dry-run / backup / uninstall switches. Public entry: `scaffoldProject(opts) → {actions, exitCode}`. | New (extracted from old `workspaceInit`) |
| `lib/scaffold/project/generate.js` | Per-CLI file matrix; reads templates; emits action plan with skip-on-exist for full-file `.md` targets. | Refactored from `workspaceInit` body |
| `lib/scaffold/project/merge.js` | `settings.json` deep-merge with sentinel-bracketed sections. Generalizes existing `deepMergeSettings`. | Generalized from existing |
| `lib/scaffold/project/sentinel.js` | Parse / emit `<!-- BEGIN aigentry scaffold/v1 ... -->` … `<!-- END -->` markers; carries sha256 of body for drift detection. | New |
| `lib/scaffold/project/uninstall.js` | Sentinel-bracketed removal from `.md` files; deep-purge of sentinel-tagged keys from `settings.json`. `.bak.<ISO8601>` always on. | New |
| `lib/scaffold/project/stdout.js` | Machine-parseable `<verb> <path>` emitter. Vocab: `create / merge / skip / backup / remove / noop`. | New |

Backward-compat alias: `bin/aigentry-devkit.js` keeps the `workspace-init` subcommand which prints `[alias] aigentry scaffold --project --cli <cli> --cwd <cwd>` to stderr and calls the same `scaffoldProject(opts)` module. Existing callers (`aigentry up`, `aigentry start`, `aigentry session create`) require zero source changes; their imports continue to resolve via a re-export shim at `lib/workspace-init.js` → `module.exports = require('./scaffold/project').workspaceInitCompat;`.

### §4.2 Alternative A — Thin CLI wrapper over existing `workspaceInit()` (rejected)

Add a new `scaffold --project` dispatch that calls existing `workspaceInit({...})` and layers an adapter for dry-run / backup / uninstall / sentinel-merge.

- **Pros**: Smallest blast radius; reuses existing code 100%.
- **Cons**: Two CLI surfaces for the same operation (`workspace-init` AND `scaffold --project`) — direct hit on codex r1 anti-pattern 3 (coordination overhead, ADR §11.4.3). File-choice mismatch (`settings.local.json` vs `settings.json`) becomes adapter complexity. Sentinel-merge layered on top of a non-sentinel-aware module = leaky abstraction. Future `--integrate-telepty` and `install-hooks` cannot reuse the wrapper cleanly.
- **Eviction reason**: Two-surface drift contradicts ADR §11.4.3 anti-pattern 3 mitigation; Article 15 SSOT prefers a single source of truth.

### §4.3 Alternative B — Net-new `lib/scaffold/*` greenfield; deprecate `workspace-init` (rejected)

Build greenfield `lib/scaffold/{project,integrate-telepty,install-hooks,uninstall}.js`. Mark `lib/workspace-init.js` as deprecated; eventually delete.

- **Pros**: Cleanest naming alignment with ADR §3.3.1.4; no refactor of working code.
- **Cons**: Largest initial implementation cost (~2-3× chosen). Deprecation window risks behavior drift between legacy `workspaceInit` and new module if either receives bugfixes. All call sites (`aigentry up` / `start` / `session create`) eventually migrate — that work is real and deferred (M5 latency risk).
- **Eviction reason**: M5 (≤14d Phase 3 unblock) is harder to hit; parallel-implementation tax is permanent until full migration; chosen approach C delivers the same end state with less intermediate state.

### §4.4 Selection rationale

- **Article 1 (경량)**: Approach C produces the least net code (one module path replaces one).
- **Article 15 (SSOT)**: Single canonical scaffold surface aligns 1-for-1 with ADR §3.3.1.4 G3 SSOT entry.
- **ADR §11.4.3 anti-pattern 3 mitigation**: Single owning module + single fixture set + single doc path.
- **M5 latency**: Refactor + alias preserves all existing call sites; no migration storm.
- **Future #8 / #10.2 alignment**: Sibling sub-modules `lib/scaffold/integrate-telepty/` and `lib/scaffold/install-hooks/` slot into the same namespace without retrofit.

---

## §5 Constitution Check (위헌 심사)

Per `references/constitution-check.md` — 5 mandatory questions.

### Q1 — AI 기술 격차 해소에 복무하는가?

**PASS**. The chosen surface (`aigentry scaffold --project <cwd>`) is one command, with predictable defaults, zero prompts, and machine-parseable output. New contributors and end users get a deterministic bootstrap path; advanced users can override via `--template-dir`. This satisfies Article 11 (격차 해소) and Article 10 (원클릭).

### Q2 — 이 기능은 어느 컴포넌트의 역할인가? (Article 3)

**PASS**. ADR §3.4 row #3 places this exactly in devkit ("Devkit owns all template content (CLAUDE.md, settings.json) and the file-generation logic in `aigentry scaffold`"). Telepty's `--scaffold` is opt-in unilateral preflight only — devkit does not call telepty for `--project` operation. Boundary respected by construction.

### Q3 — 이 프레임워크/라이브러리가 정말 필요한가? (Articles 1, 17)

**PASS**. **Zero** new external dependencies. Implementation uses Node.js stdlib (`fs`, `path`, `crypto.createHash`, `child_process`) — same baseline as existing `workspace-init`. ADR §8 M4 (no new external deps) is preserved by construction.

### Q4 — 모든 크로스 환경에서 동작하는가? (Article 2)

**PASS**. POSIX-portable file APIs; no platform-specific assumptions beyond what existing `workspace-init` already requires (verified working on macOS + Linux today). Windows path normalization handled via `path.resolve` (Article 2 §2). Per-CLI matrix is symmetric across claude/codex/gemini (Article 2 §7).

### Q5 — 사용자에게 "어떻게"를 강요하지 않는가? (Article 11)

**PASS**. Default invocation requires only `--cli` and `--cwd`. All other behavior is convention-driven (templates from devkit, settings.json deep-merge, `.bak.<ISO8601>` backup ON for merge-targets). `--dry-run` lets users preview. `--template-dir` lets users override without forcing them to learn the override mechanism upfront.

### Q6 (Article 9 — Independence)

**PASS**. `aigentry scaffold --project` runs identically on a machine with telepty and on a machine without. No `command -v telepty` call. No `telepty *` exec. V4 verification metric (§10) tests this directly.

### Q7 (Article 17 — 무의존)

**PASS**. No new mandatory deps. `--template-dir` override is opt-in fallback path for users with custom templates. Default path uses devkit-bundled templates (already shipped today).

---

## §6 Components

### §6.1 CLI surface

```
aigentry scaffold --project <cwd> --cli {claude|codex|gemini}
                  [--dry-run] [--no-backup] [--uninstall]
                  [--template-dir <path>]
                  [--orchestrator-session-id <id>]
                  [--no-auto-report-errors]

# Backward-compat alias (prints stderr deprecation note, same behavior):
aigentry-devkit workspace-init --cli {claude|codex|gemini} --cwd <cwd>
                               [...same flags...]
```

**Required**: `--cli`, `--cwd` (absolute path).

**Backup behavior** (rewritten for clarity — no "default ON for X, OFF for Y" magic):
- Scaffold **always** writes `.bak.<ISO8601>` before any merge or uninstall mutation, irrespective of flag.
- Scaffold **never** writes `.bak` for first-time `create` actions (no source file to back up).
- `--no-backup` opts out of the always-on `.bak` write for merge / uninstall. **Not recommended.** Implementation MUST refuse the combination `--no-backup --uninstall` against a malformed-JSON `settings.json` (cannot safely uninstall sentinel blocks from unparseable JSON without a recovery copy) → exit 2 with `error: --no-backup forbidden when uninstalling from malformed settings.json`.
- `--dry-run` short-circuits all I/O (no writes, no `.bak`); plan is emitted to stdout only.

**Hook-related flags** (parameterize the `hooks` block emitted to `.claude/settings.json` per §6.6):
- `--orchestrator-session-id <id>`: literal session ID embedded into the PostToolUse `[BUILD ERROR]` and Stop `[SESSION_IDLE]` injection commands. If omitted, falls back to `$ATERM_ORCHESTRATOR_SESSION` env var → `~/.config/aterm/aterm.json` orchestrator.session_id → `aterm list --json` autodetect. If all three resolve to nothing, hook entries are **skipped entirely** (PostToolUse + Stop arrays empty) and stderr emits `info: no orchestrator session id resolved; auto-report-error hooks omitted`. Behavior preserved verbatim from existing `workspace-init.js` lines 61-101 + 326-374.
- `--no-auto-report-errors`: explicit opt-out — even when an orchestrator id resolves, do not emit PostToolUse or Stop hook entries; only `permissions.allow` is written. Useful for sandbox / isolated workspaces where cross-session error injection is undesired.

**Exit codes** (uniform across `scaffold/v1` per ADR §3.3.1.4):

| Code | Meaning |
|---|---|
| 0 | Success — actions emitted on stdout |
| 2 | Invalid argv (missing flag, unknown CLI, relative cwd) |
| 3 | Scope inaccessible (cwd unreadable, template-dir missing, permission denied) |
| 4 | Internal failure (malformed existing settings.json, disk full, bundled templates missing) |

### §6.2 Per-CLI file matrix

| CLI | Files written (first run) | Merge-target on re-run | Skip-on-exist (full file) |
|---|---|---|---|
| **claude** | `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`, `state/task-queue.json`, `state/lessons.json` | `.claude/settings.json` (sentinel-bracketed JSON sections) | `AGENTS.md`, `CLAUDE.md` |
| **codex** | `AGENTS.md` (uses `templates/workspace/AGENTS.codex.md` brief variant), `state/task-queue.json`, `state/lessons.json` | none in v1 (codex config is global; project-level deferred per OQ-3) | `AGENTS.md` |
| **gemini** | `AGENTS.md`, `GEMINI.md`, `state/task-queue.json`, `state/lessons.json` | none in v1 (gemini settings are global; project-level deferred per OQ-3) | `AGENTS.md`, `GEMINI.md` |

**Templates source**:
1. `--template-dir <path>` if provided and readable
2. Otherwise `<devkit-package-root>/templates/workspace/`

**Template variable substitution** (preserved from existing `workspace-init`):
- `{{WORKSPACE_NAME}}` — `path.basename(cwd)`
- `{{BUILD_CMD}}` / `{{TEST_CMD}}` — autodetected via `detectProjectType(cwd)` (rust → `make app` / `cargo test`; node → `npm run build` / `npm test`; python → `python -m pytest`; custom from `~/.config/aterm/aterm.json` `sawp.{buildCmd,testCmd}`)

**State directory**: `<cwd>/state/{task-queue,lessons}.json`. For workspaces named `orchestrator`, state files are symlinked to `~/.aigentry/data/` (preserves existing behavior).

**Re-application to existing `.md` files**: when an `.md` target already exists, scaffold's policy is **skip-on-exist** (full file). Constitution / template updates therefore do NOT propagate via `aigentry scaffold --project`. Users wanting to re-apply template-driven changes (e.g., constitutional appends like "Session Communication Rules" / "Mandatory Reporting") run the existing `aigentry-devkit update-md` command (see `lib/update-md.js` + §13.2). The two commands are deliberately split: `scaffold --project` owns *creation* under skip-on-exist; `update-md` owns *append-style update* of existing files. This split is preserved by this spec.

**MCP registration**: `--project` invokes `registerClaudeMcp() / registerGeminiMcp() / registerCodexMcp()` from `lib/bootstrap.js` (write to `~/.claude/.mcp.json`, `~/.gemini/settings.json`, `~/.codex/config.toml` — **GLOBAL paths**, not project-level — preserves existing behavior; out-of-scope for sentinel-merge in this spec).

### §6.3 `.claude/settings.json` deep-merge with sentinel sections

**Filename**: `.claude/settings.json` (canonical per ADR §3.4 row #3 verbatim). NOT `.claude/settings.local.json` — see §9 for migration semantics.

**Discriminator**: scaffold-managed top-level blocks carry the namespaced key `"x-aigentry-scaffold": "v1"`. This is a **project-namespaced extension key** (`x-` prefix per RFC 6648 / OpenAPI extension convention) — chosen explicitly NOT to use `$schema`, which is reserved for JSON-Schema URIs and would collide with consumers (Claude Code itself or third-party validators) expecting a schema-URI string there.

**Sentinel layout** (top-level JSON; spec-managed blocks may co-exist with user-authored keys):

```json
{
  "permissions": {
    "x-aigentry-scaffold": "v1",
    "allow": [
      "Bash(aterm *)",
      "Bash(telepty *)"
    ]
  },
  "hooks": {
    "x-aigentry-scaffold": "v1",
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "<error-injection one-liner>" }
        ]
      }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "<idle-injection one-liner>" } ] }
    ]
  }
}
```

**Re-run merge rules** (deterministic; preserves user edits):

1. Read existing `.claude/settings.json` (if any). Parse as JSON; on parse failure → exit 4 with `.bak.<ISO8601>` written first.
2. For each top-level key the spec writes (`permissions`, `hooks`):
   - **Block absent** → insert spec block verbatim (with `x-aigentry-scaffold: "v1"`).
   - **Block present and `x-aigentry-scaffold === "v1"`** → replace block with current spec emission. Drift is silently corrected (this is how spec evolves alongside template updates).
   - **Block present and discriminator differs / absent** → user-authored block. **Never overwrite.** Deep-merge:
     - `permissions.allow[]`: append spec entries not already present. Dedup is **exact-string equality** (`===`); any non-string entries (objects, etc.) pass through untouched. Order: existing entries first, then appended spec entries.
     - `hooks.PostToolUse[]` / `hooks.Stop[]`: append entries whose first `hooks[0].command` string is not already present anywhere in the existing array. (Matches existing `deepMergeSettings` semantics.)
3. **Top-level keys not owned by this spec** (`mcpServers`, `env`, `apiKeyHelper`, `model`, `plugins`, and any other Claude Code or user-authored keys): preserved untouched. The merger walks only `permissions` and `hooks`; all other keys pass through verbatim. Explicit by-name preservation guarantee for known Claude Code keys: `mcpServers`, `env`, `apiKeyHelper`, `model`, `plugins`, `disableAllHooks`, `theme`.
4. Write `.bak.<ISO8601>` of the original before any mutation when backup is in effect (default per §6.1 — always ON for merge / uninstall, irrespective of flag, unless `--no-backup` opts out).
5. Emit `merge <abs-path>` on stdout per §6.4.

**`UserPromptSubmit` hook**: explicitly NOT touched by `--project` (ADR §3.4 row #10.2 ownership; deferred to Issue #10.2 spec).

**`mcpServers` key**: explicitly NOT **written** into project `settings.json` by this spec. MCP brain registration writes to global `~/.claude/.mcp.json` per existing `bootstrap.js` behavior — avoids project-level MCP conflicts when multiple projects coexist. **Pre-existing project-level `mcpServers`** (if a user has one): preserved untouched per rule 3 above; not stripped, not warned about.

### §6.4 Stdout vocabulary (machine-parseable)

One line per action. Format is **strictly deterministic** (no padding, no trailing whitespace, no column alignment):

```
<verb> SP <abs-path> [SP "(" <reason> ")"] LF
```

- `<verb>` ∈ `{ create, merge, skip, backup, remove, noop }` (4-6 chars, no padding).
- Single ASCII space (`SP`) between verb and path.
- `<abs-path>` is always absolute (guaranteed by `path.resolve`); paths containing literal spaces are **forbidden** by precondition (§8 — implementation rejects cwd whose `path.resolve` result contains spaces with exit 2 and stderr `error: cwd contains whitespace; not supported in v1`). This keeps the format space-delimited without quoting.
- Optional parenthesized `<reason>` follows the path with a single leading space (only present for `skip`, `remove`, `noop` to clarify rationale).
- Lines terminated with single LF (no CRLF).

Examples:
```
create /abs/cwd/AGENTS.md
create /abs/cwd/CLAUDE.md
merge /abs/cwd/.claude/settings.json
skip /abs/cwd/state/task-queue.json (exists)
backup /abs/cwd/.claude/settings.json.bak.2026-05-05T12:34:56Z
remove /abs/cwd/.claude/settings.json (sentinel block)
noop /abs/cwd/AGENTS.md (no sentinel block to remove)
```

Verbs (exhaustive set for v1):
- `create` — new file written
- `merge` — JSON deep-merge applied; user keys preserved
- `skip` — file exists; full-file skip-on-exist policy hit; no write
- `backup` — `.bak.<ISO8601>` written prior to merge or uninstall
- `remove` — sentinel-bracketed section removed (uninstall path)
- `noop` — uninstall target absent or unchanged; no work to do

Stderr is reserved for warnings (deprecated alias note, MCP partial registration failure, settings.local.json detection note) and errors (exit codes 2/3/4 messages). Devkit consumers may safely tee stderr without affecting stdout pipelines.

### §6.5 Module API (public)

```pseudo
// illustrative module shape; non-executable. Actual implementation produced by Phase 3 coder dispatch.
// lib/scaffold/project/index.js — public entry

scaffoldProject(opts: ScaffoldProjectOpts) → Promise<ScaffoldProjectResult>

ScaffoldProjectOpts = {
  cwd:                    string  // absolute path (required)
  cli:                    'claude' | 'codex' | 'gemini'  // required
  dryRun:                 boolean   // default false
  backup:                 boolean   // default true; --no-backup sets false
  uninstall:              boolean   // default false
  templateDir:            string | null   // default null → devkit-bundled
  orchestratorSessionId:  string | null   // null → resolved via env / aterm.json / aterm list
  autoReportErrors:       boolean   // default true; --no-auto-report-errors sets false
}

ScaffoldProjectResult = {
  actions:   Action[]
  exitCode:  0 | 2 | 3 | 4
}

// Side effects: emits one stdout line per action via lib/scaffold/project/stdout.js
// Action shape (sum type; documented for fixture-test consumers):
Action =
  | { verb: 'create',  path: string, source: string }
  | { verb: 'merge',   path: string, sentinelTag: 'scaffold/v1' }
  | { verb: 'skip',    path: string, reason: 'exists' | 'unchanged' }
  | { verb: 'backup',  path: string, original: string }
  | { verb: 'remove',  path: string, sentinelTag: 'scaffold/v1' }
  | { verb: 'noop',    path: string, reason: string }

module exports: { scaffoldProject, workspaceInitCompat }
```

`workspaceInitCompat(opts)` is the alias entry that prints the deprecation note to stderr and calls `scaffoldProject(opts)` with the same opts shape.

### §6.6 Hook block emission (parameterized by §6.1 hook flags)

The `hooks` block in `.claude/settings.json` (§6.3 sentinel layout) is emitted only when `--cli claude` AND `autoReportErrors === true` AND an orchestrator session id resolves (via `--orchestrator-session-id` flag, then `$ATERM_ORCHESTRATOR_SESSION` env, then `~/.config/aterm/aterm.json`/`~/.aterm/aterm.json` `orchestrator.session_id`, then `aterm list --json` autodetect on session names matching `/orchestrator/i`).

When emitted, the block contains exactly two hook-type entries (verbatim from existing `workspace-init.js` lines 340-364):

- **`PostToolUse[Bash]`** — one-liner shell command that, on non-zero `$CLAUDE_TOOL_EXIT_CODE`, performs `telepty inject --from "$TELEPTY_SESSION_ID" "$_ORCH" "[BUILD ERROR] session: ... | exit_code: ..."` with a 10-second debounce file at `/tmp/.aigentry-berr-${TELEPTY_SESSION_ID}`.
- **`Stop`** — one-liner that injects `[SESSION_IDLE] session: $TELEPTY_SESSION_ID stopped responding` to the orchestrator.

When `--no-auto-report-errors` is passed, only `permissions.allow` is emitted; the entire `hooks` block is omitted (no empty arrays, no orphan `x-aigentry-scaffold` discriminator).

The orchestrator id is **embedded literally** as a fallback default within the shell command (`_ORCH="${ATERM_ORCHESTRATOR_SESSION:-<resolved-id>}"`) — preserves existing behavior + survives env var unset at runtime.

**Rationale for keeping these flags in §6.1**: removing them would silently eliminate a behavior current `workspace-init` consumers depend on (V3 backward-compat threshold). Documenting them here keeps F1 (explicit out-of-scope) honored while preventing scope-creep accusations: hook *content* is owned by this spec because it's part of `permissions/hooks` block ownership; hook *protocol* (`[context-ref/v1]` UserPromptSubmit) remains owned by Issue #10.2.

---

## §7 Data Flow

```
                  ┌──────────────────────────────────────────────┐
                  │  bin/aigentry-devkit.js                      │
                  │  argv → { cwd, cli, flags }                  │
                  └────────────────────┬─────────────────────────┘
                                       │
                                       ▼
                  ┌──────────────────────────────────────────────┐
                  │  scaffoldProject(opts)  [index.js]           │
                  │  1. validate opts → exit 2 on argv error     │
                  │  2. probe cwd writable / template-dir → exit 3│
                  │  3. build action plan (no I/O writes yet)    │
                  └────────────────────┬─────────────────────────┘
                                       │
                  ┌────────────────────┴─────────────────────────┐
                  │ if uninstall:                                │
                  │   plan = uninstall.js → list of 'remove' +   │
                  │                          'backup' + 'noop'   │
                  │ else:                                        │
                  │   plan = generate.js (per-CLI matrix)        │
                  │            ⊕ merge.js (settings.json)        │
                  └────────────────────┬─────────────────────────┘
                                       │
                  ┌────────────────────┴─────────────────────────┐
                  │ if dryRun:                                   │
                  │   stdout.emit(plan); exit 0                  │
                  │ else:                                        │
                  │   for action in plan:                        │
                  │     if backup-target → write .bak.<ISO8601>  │
                  │     execute action; on exception → exit 4    │
                  │     stdout.emit(action)                      │
                  │   exit 0                                     │
                  └──────────────────────────────────────────────┘
```

**Key invariants** (cross-checked against existing `workspace-init` behavior):

1. **No interleaved reads/writes** — full plan computed before any write. Allows clean dry-run + atomic-feeling rollback semantics on failure (the only writes that occur before `exit 4` are completed `.bak` files + already-completed actions; `.bak` covers rollback for merge-targets).
2. **No prompts** — non-interactive throughout. ADR §3.3.1.3 "Devkit scaffold prompts interactively" is enforced as a NEVER.
3. **Sequential execution** — actions execute in plan order. Order: create-only files → backup writes → merge applies → state dir creation → MCP registration. Reversed for uninstall.
4. **One stdout line per action** — buffered emission OK; final stdout is plan-order-deterministic across runs (stable diff for golden-file fixtures).

---

## §8 Error Handling

| Scenario | Behavior | Exit | stdout | stderr |
|---|---|:-:|---|---|
| `--cli` invalid / missing | abort before any I/O | 2 | (none) | `error: --cli must be one of claude, codex, gemini (got: <X>)` |
| `--cwd` missing or relative | abort before any I/O | 2 | (none) | `error: --cwd must be an absolute path (got: <X>)` |
| `--cwd` does not exist & cannot create | abort | 3 | (none) | `error: cwd inaccessible: <path> (errno=<N>)` |
| `--template-dir` provided but missing/unreadable | abort | 3 | (none) | `error: --template-dir not found: <path>` |
| Devkit-bundled templates missing (install corrupt) | abort | 4 | (none) | `error: bundled templates missing — devkit install corrupt; reinstall @dmsdc-ai/aigentry-devkit` |
| Existing `settings.json` malformed JSON | write `.bak` first; abort | 4 | `backup <path>.bak.<ts>` | `error: existing .claude/settings.json malformed JSON; backup written; aborting (re-run after fix or use --uninstall)` |
| Disk full mid-write | abort; remaining actions skipped | 4 | partial up to failure point | `error: write failed: <path> (ENOSPC); previous actions retained; .bak files preserved` |
| MCP registration partial failure (claude OK, gemini fail) | warn-and-continue (existing behavior) | 0 | unchanged | `warn: gemini MCP registration failed: <reason>; continuing` |
| Uninstall target absent (no sentinel block) | emit `noop` per file | 0 | `noop <path> (...)` | (none) |
| Re-run with no changes needed | all actions are `skip` or `noop` | 0 | per-file skip/noop | (none) |
| Telepty NOT installed when called via `--scaffold` shim | irrelevant — `--project` does not call telepty | 0 | unchanged | (none) |

**Non-interactive enforcement**: implementation MUST NOT call `readline`, `prompts`, `inquirer`, or any tty-blocking API. Tests verify by running with `stdin` closed.

**Stdout / stderr separation**: machine consumers (telepty `--scaffold` shim per ADR §3.3.1.2 row "stdout: tee to telepty stdout") read stdout for action plan; stderr for warnings. Stderr never carries action lines.

---

## §9 Backward Compatibility

### §9.1 Three behavior changes visible to existing devkit users

| # | Change | Mitigation |
|---|---|---|
| 1 | `aigentry-devkit workspace-init` becomes a stderr-noted alias for `aigentry scaffold --project` | Identical behavior (same module). Note text: `[alias] consider 'aigentry scaffold --project --cli <cli> --cwd <cwd>' (workspace-init form retained for compat)` |
| 2 | **Filename: `.claude/settings.local.json` → `.claude/settings.json`** | When `settings.local.json` exists with content matching scaffold's intended write, emit one-time stderr note: `info: existing settings.local.json detected; v1 writes settings.json (canonical per ADR 2026-05-05); local overrides will be supported via 'aigentry scaffold --project --local' in v2 (deferred). The two files coexist; settings.local.json is NOT modified.` |
| 3 | Module rename `lib/workspace-init.js` → `lib/scaffold/project/index.js` | `lib/workspace-init.js` becomes a re-export shim: `module.exports = require('./scaffold/project').workspaceInitCompat;` — internal devkit imports continue to resolve. Re-export shim removed in next major after one minor cycle. |

### §9.2 Existing devkit consumers — surface impact

| Consumer | Impact | Action |
|---|---|---|
| `aigentry up` (devkit) | Imports via `lib/workspace-init` re-export | None — re-export shim preserves behavior |
| `aigentry start` (devkit) | Imports via `lib/workspace-init` re-export | None |
| `aigentry session create` (devkit) | Composes telepty + workspace-init | None — alias path resolves |
| `bin/aigentry-devkit.js workspace-init` (CLI users) | argv shape unchanged | None — alias prints stderr note only |
| Telepty `--scaffold` shim (ADR §3.3.1.2) | Will call `aigentry scaffold --project <cwd> [--cli <cli>]` | Already in plan; no current consumer to break |

### §9.3 Migration path (single-direction)

- v1 (this spec): canonical = `aigentry scaffold --project`; alias = `workspace-init` (stderr note); file = `settings.json`.
- v2 (future, deferred): `--local` flag for `settings.local.json` mode; existing `settings.local.json` users opt in explicitly.
- vN+: removal of `workspace-init` alias + `lib/workspace-init.js` re-export shim. Out of scope for v1; tracked as OQ-1.

### §9.4 No-op assertion (where applicable)

The MCP registration codepath, the per-CLI template selection logic, the `state/` symlink behavior for orchestrator workspaces, and the `detectProjectType` autodetection are byte-for-byte preserved. V3 (§10) verifies via golden-file diff against pre-refactor outputs.

---

## §10 Verification Plan

| Metric | Method | Threshold | Failure → action |
|---|---|---|---|
| **V1 — Surface conformance** | `aigentry scaffold --project --help` matches §6.1 grammar; `--dry-run` against fresh fixture cwd emits only verbs from §6.4 vocabulary; exit codes match §6.1 table | 100% match | spec REQUEST-REVISION |
| **V2 — Idempotency** | Run `aigentry scaffold --project` twice with same args; second run emits only `skip` / `noop` actions; no file mtime change beyond first run | 0 unintended writes on second run | impl bug — gate PR |
| **V3 — Backward compat (golden file diff)** | Capture pre-refactor `workspaceInit({cli:'claude', cwd:<fixture>})` output; run post-refactor `scaffoldProject({cli:'claude', cwd:<fixture>})`; diff every generated file | (a) every `.md` target byte-identical to pre-refactor; (b) `state/*.json` byte-identical; (c) `.claude/settings.json` is byte-identical to pre-refactor `.claude/settings.local.json` modulo a documented diff allowlist: { top-level filename rename `settings.local.json` → `settings.json`; addition of `"x-aigentry-scaffold": "v1"` discriminator inside `permissions` and `hooks` blocks }. The allowlist is committed alongside fixtures at `tests/scaffold-project/v1/golden-diff-allowlist.txt` and asserted exhaustive by V3 runner. | revert refactor; switch to Approach A or B |
| **V4 — Boundary respect (Article 9)** | Clean machine without telepty installed: `aigentry scaffold --project /tmp/test --cli claude`; verify exit 0 and `strace -e trace=execve` shows zero `telepty` exec attempts | 0 telepty exec; exit 0 | M3 fail; spec REQUEST-REVISION |
| **V5 — G3 SSOT registration** | Post-acceptance: `~/projects/aigentry-ssot/contracts/scaffold-v1.md` exists and references this spec doc by absolute path | `grep -q '2026-05-05-issue-3-bootstrap-spec.md' ~/projects/aigentry-ssot/contracts/scaffold-v1.md` exits 0. **Stub authoring owner**: aigentry-architect at the moment of status flip from `proposed` to `accepted` (this session, after user gate). **Minimum stub content**: title `scaffold/v1 contract`, parent ADR link (`~/projects/aigentry-orchestrator/docs/adr/2026-05-05-telepty-devkit-boundary.md` §3.3.1.4), absolute-path reference to this spec, and TBD-marker for sibling specs (#8 + #10.2). Conformance fixture commit follows during Phase 3 implementation per M6. | orchestrator dispatches G3 fix before #8/#10.2 |
| **V6 — Conformance fixtures (M6)** | Implementation PR ships `~/projects/aigentry-devkit/tests/scaffold-project/v1/{fresh,reapply,uninstall,unknown-cli-flag,malformed-settings,template-override,sentinel-drift,non-interactive,dry-run-no-writes}.spec.js` | All 9 fixtures present and green | M6 fail; PR blocked |
| **V7 — Sentinel preservation** | Manually edit a non-`scaffold/v1`-tagged top-level key in `settings.json`; re-run scaffold; user edit must remain byte-identical | 100% user-key preservation | impl bug — gate PR |
| **V8 — Cross-OS (Article 2)** | Run V1 + V2 on macOS, Linux, Windows (CI matrix) | All three platforms green | spec REQUEST-REVISION on platform-specific bug |
| **V9 — Non-interactive enforcement** | Run with `</dev/null` redirected stdin; verify exit 0 (or expected error code) without hang within 10s wall clock | No hang; deterministic exit | impl bug — gate PR |

**M0 audit window (per ADR §6.5.1)**: G3 stub registration MUST be filed within 7 days of this spec's acceptance (by 2026-05-12). G3 stub may reference this spec at `proposed` status; full conformance evidence (V6 fixtures) follows during implementation per M6.

**Rollback trigger composite**: any 2 of {V1 fail, V3 fail, V4 fail, V7 fail} → spec moves to `revision`; architect re-dispatches.

---

## §11 Risks & Failure Modes

### §11.1 Risks

| # | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Sentinel collision: user manually edited the sentinel-bracketed JSON section between runs | Low | Medium | sha256 in BEGIN comment (where applicable for `.md`); for JSON, `$schema: "scaffold/v1"` discriminator + deep-merge fallback when missing/changed |
| R2 | Templates drift from constitution updates (aterm-centric `templates/workspace/*` lags behind constitution) | Medium | Low | V2 idempotency catches stale-vs-fresh; template freshness gating tracked in `~/projects/aigentry-ssot/contracts/scaffold-v1.md` (parallel to ADR §3.4 telepty `Source: telepty@<version>` rule for skill mirrors) — full freshness rule deferred to OQ-2 |
| R3 | `settings.local.json` vs `settings.json` migration confusion | Medium | Low | §9.1 stderr note + future `--local` v2 flag |
| R4 | Telepty `--scaffold` shim (ADR §3.3.1.2) calls before user installed devkit | Low | Low | Already mitigated in ADR §3.3.1.3 (telepty falls back to bare session). This spec adds nothing; `--project` is simply not invoked. |
| R5 | Disk full / permission denied mid-write produces partial state | Low | Medium | `.bak` files preserved on exit 4; sequential execution makes the partial state diagnosable; manual recovery via `aigentry scaffold --project --uninstall` + `.bak` restore |
| R6 | Implementation regression breaks `aigentry up` / `start` / `session create` (existing call sites) | Medium | High | V3 golden-file diff is gating; pre-refactor capture must be committed as test fixture before refactor |

### §11.2 Failure modes (per ADR §6.2 lesson — dependency-component-failure analysis)

- **Templates directory deleted** (`rm -rf templates/workspace/`): exit 4 with reinstall message; no partial writes. Recovery: `npm install -g @dmsdc-ai/aigentry-devkit@latest` re-extracts templates.
- **MCP brain registration target file unwritable** (e.g., read-only `~/.claude/.mcp.json`): warn-and-continue (existing behavior); scaffold operation succeeds; MCP brain not registered for that CLI. User notified via stderr.
- **Concurrent invocation** (two `aigentry scaffold --project` against same cwd simultaneously): no locking in v1. Last writer wins for any merge-target. Mitigation deferred to OQ-3; documented as known limitation. Telepty `--scaffold` shim is naturally serialized (one shim per session start).
- **Symlink loop in cwd** (e.g., `cwd/state` symlinked to `cwd`): `fs.mkdirSync(stateDir, { recursive: true })` raises; exit 4. No mitigation in v1 (extreme edge case).

---

## §12 Open Questions

- **OQ-1**: When should `lib/workspace-init.js` re-export shim be removed? Architect lean: one minor cycle after this spec's accepted version ships (~30 days post-implementation merge). Deferred to v2 spec.
- **OQ-2**: Should `templates/workspace/*` be SSOT-registered with a freshness rule (parallel to ADR §3.4 telepty skill mirror rule)? Architect lean: yes, but as a separate sub-spec scoped to template governance. Defer.
- **OQ-3**: Concurrent-invocation locking — `flock(2)` on `<cwd>/.claude/.scaffold.lock` or rely on natural serialization? Architect lean: rely on natural serialization for v1; locking is YAGNI until evidence of concurrent corruption. Revisit if R5 incident occurs.
- **OQ-4**: `.gemini/settings.json` and `.codex/config.toml` project-level merge — postponed to vN. Architect lean: defer until per-CLI demand surfaces. Article 1 (경량) says don't speculate.
- **OQ-5**: `--cli` auto-detection from `$TELEPTY_SESSION_ID` suffix (e.g., `aigentry-coder-claude` → `claude`)? Architect lean: defer; require explicit `--cli` for v1 (Article 1 — predictable, no hidden state).

---

## §13 References

### §13.1 Binding (this spec is dependent on)

- ADR `~/projects/aigentry-orchestrator/docs/adr/2026-05-05-telepty-devkit-boundary.md` (commit `e4b072b`):
  - §3.3.1.4 — `scaffold/v1` CLI surface shape (locked)
  - §3.4 row #3 — placement; opt-in `--scaffold` shim semantics
  - §3.5 row 3 — codex r1 condition 3 verbatim integration
  - §3.6 — composition contract; surface accountability table
  - §6.5.1 G3 — `scaffold/v1` SSOT stub gate
  - §8 M0 / M3 / M4 / M5 / M6 — verification metrics inherited
- aigentry CONSTITUTION (`~/projects/aigentry/docs/CONSTITUTION.md`): Articles 1, 2, 3, 9, 10, 15, 17

### §13.2 Existing code touched / consumed

- `~/projects/aigentry-devkit/bin/aigentry-devkit.js:1503` (workspace-init dispatch)
- `~/projects/aigentry-devkit/lib/workspace-init.js` (refactored into `lib/scaffold/project/`)
- `~/projects/aigentry-devkit/lib/bootstrap.js` (MCP registration helpers; reused as-is)
- `~/projects/aigentry-devkit/lib/update-md.js` (post-bootstrap update path; not touched by this spec)
- `~/projects/aigentry-devkit/templates/workspace/{AGENTS.md, AGENTS.codex.md, AGENTS.orchestrator.md, CLAUDE.md, GEMINI.md}` (templates; consumed unchanged in v1)
- `~/projects/aigentry-devkit/config/settings.json.template` (existing skeleton; informational reference)

### §13.3 Triage

- `~/projects/aigentry-architect/docs/triage/2026-05-04-telepty-issues-triage.md` lines 254-264 (`#3` row — confirms architect lean of "telepty calls devkit's scaffold as opt-in")

### §13.4 Sibling specs (TBD)

- Issue #8: `aigentry scaffold --integrate-telepty` (`~/projects/aigentry-devkit/docs/specs/2026-05-XX-issue-8-integrate-telepty-spec.md` — pending dispatch)
- Issue #10.2: `aigentry scaffold install-hooks <cli>` (`~/projects/aigentry-devkit/docs/specs/2026-05-XX-issue-10-2-install-hooks-spec.md` — pending dispatch)

### §13.5 Conformance fixture target path (M6)

`~/projects/aigentry-devkit/tests/scaffold-project/v1/{fresh,reapply,uninstall,unknown-cli-flag,malformed-settings,template-override,sentinel-drift,non-interactive,dry-run-no-writes}.spec.js`

### §13.6 SSOT registration target (G3)

`~/projects/aigentry-ssot/contracts/scaffold-v1.md` — must reference this spec doc + sibling spec docs (#8, #10.2) as conformance evidence.

---

## §14 Appendix — Pre-submit Self-Check (CLAUDE.md §6 7-item rubric)

| # | Question | Pass | Evidence |
|---|---|:-:|---|
| 1 | Context §1 explains why this decision is needed | ✅ | §1 cites three blocked issues and ADR §3.3.1.4 lock |
| 2 | Decision (Approach §4.1) has minimum 2 alternatives + tradeoffs | ✅ | §4.2 Approach A + §4.3 Approach B both with pros/cons + eviction reasons |
| 3 | Each alternative selection/rejection grounded in evidence | ✅ | §4.4 cites Article 1, 15, ADR §11.4.3 anti-pattern 3, M5 latency |
| 4 | Consequences §11 includes failure modes | ✅ | §11.1 R1-R6 risk table + §11.2 dependency-failure analysis |
| 5 | Backward Compat §9 analyzed | ✅ | §9.1 three changes table + §9.2 consumer impact matrix + §9.3 migration path |
| 6 | Constitution Check §5 filled | ✅ | Q1-Q7 with PASS + Article citations |
| 7 | Verification Plan §10 metrics measurable | ✅ | V1-V9 each with measurement method + threshold + failure action |

**Self-check verdict**: 7/7 PASS. Ready for spec-document-reviewer dispatch (Phase 6).

### §14.1 Iter-1 review patches applied (2026-05-05, claude-backed reviewer)

10 patches absorbed (5 MAJOR + 5 MINOR):

1. §6.3 discriminator: `"$schema": "scaffold/v1"` → `"x-aigentry-scaffold": "v1"` (avoids JSON-Schema URI collision with Claude Code / external validators).
2. §10 V3 threshold rewritten with explicit diff allowlist (rename + discriminator additions); allowlist file path declared.
3. §6.5 fence changed to ` ```pseudo ` with non-executable comment (F3 compliance).
4. §6.4 stdout grammar tightened: no padding, no column alignment, formal grammar `<verb> SP <abs-path> [SP "(" reason ")"] LF`; whitespace-in-cwd rejected with exit 2.
5. §10 V5 G3 stub ownership made explicit: architect at status flip, with minimum content list.
6. §6.1 backup semantics rewritten: `[--no-backup]` opt-out, always-on for merge/uninstall, `--no-backup --uninstall` against malformed JSON forbidden.
7. §6.6 added: hook flags (`--orchestrator-session-id`, `--no-auto-report-errors`) explicitly described with resolution chain + emission rule.
8. §6.2 added: re-application policy clarified — `scaffold --project` is skip-on-exist; `update-md` is the existing path for re-applying template-driven changes.
9. §6.3 step 3 expanded: explicit by-name preservation guarantee for `mcpServers`, `env`, `apiKeyHelper`, `model`, `plugins`, `disableAllHooks`, `theme`.
10. §6.3 step 2c: `permissions.allow[]` dedup rule made exact-string equality with object-passthrough explicitly stated.

### §14.2 Iter-2 review pending (cross-LLM — codex)

Per session feedback rule: implementer ≠ reviewer. Iter 1 was claude-backed; iter 2 dispatches to codex for cross-LLM verification before Phase 7 user gate.
