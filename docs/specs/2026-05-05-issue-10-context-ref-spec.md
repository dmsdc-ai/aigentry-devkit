---
type: spec
status: proposed
scope: cross-project
decision_type: two-way
tier: T1
date: 2026-05-05
slug: issue-10-context-ref
issue-ids: [#10.2, #10.3-deferred, #10.4-subsumed]
related-adr: ../../../aigentry-orchestrator/docs/adr/2026-05-05-telepty-devkit-boundary.md
related-adr-commit: e4b072b
ssot-gates: [G2, G3]
reviewers-required: 1
author: aigentry-architect-context-ref-spec
---

# SPEC — Issue #10.2 (with #10.3 deferred, #10.4 subsumed): `aigentry scaffold install-hooks <cli>` — context-ref Receiver

> **SSOT.** This spec implements the boundary defined by ADR `2026-05-05-telepty-devkit-boundary` (commit `e4b072b`). Whenever a wire-contract detail is referenced, the ADR section is the source of truth; this spec refines only **non-wire-contract implementation details** per ADR §3.1.2.1.1 rule 2. Any apparent divergence between this spec and the ADR resolves to the ADR.

---

## §1 Context (Why this decision is needed)

Issue #10 (telepty repo) requested standardization of the `[context-ref]` inject protocol plus per-agent integrations. Triage `2026-05-04-telepty-issues-triage.md` line 269 grouped the three sub-issues:

- **#10.2** — per-CLI hook installer for `[context-ref]` (claude / codex / gemini).
- **#10.3** — reply-side `--reply-as-ref` protocol (deferred per Q6 resolution; separate telepty-repo dispatch).
- **#10.4** — per-agent body tailoring (subsumed by ADR §3.1.2.3 hook-payload schema's per-CLI dispatch).

ADR `2026-05-05-telepty-devkit-boundary` (status accepted, commit `e4b072b`) locked:
- the `[context-ref/v1]` **wire contract** (§3.1.2.1.1 rule 1: grammar + storage + receiver-detection + payload schema + versioning model),
- the **boundary direction**: telepty owns protocol semantics + emit-side; **devkit owns receiver-side hook installation** (§3.2 vs §3.3 split; §3.1.2.5 README cleanup mandates removing `telepty install hooks ...` text from telepty repo),
- the **invocation skeleton** of the installer subcommand at high level (§3.1.2.4 table: invocation, target files, scope resolution, hook handshake, idempotency, fail-open, uninstall, exit codes, cross-CLI matrix coverage).

What is **not** locked by the ADR (Phase 3 implementation territory per §3.1.2.1.1 rule 2):
- internal module organization of the devkit installer,
- per-CLI hook script body (only file location is fixed),
- error message text and `--dry-run` output formatting,
- test fixture invocation pattern,
- conformance-fixture replay harness in devkit.

This spec specifies those open items so a coder session can implement directly.

---

## §2 Decision (Approach)

### §2.1 Chosen approach: per-CLI plug-in modules with shared idempotency primitives

```
bin/aigentry-devkit.js
  └─ command: scaffold install-hooks <cli> [...flags]
       └─ lib/scaffold/install-hooks/dispatcher.js   (router; thin)
            ├─ lib/scaffold/install-hooks/claude.js  (CLI module — uniform interface)
            ├─ lib/scaffold/install-hooks/codex.js   (CLI module)
            ├─ lib/scaffold/install-hooks/gemini.js  (CLI module)
            ├─ lib/scaffold/idempotent.js            (shared: sentinel / json-key / sha256 ops)
            ├─ lib/scaffold/scope.js                 (shared: --global / --project resolution)
            └─ lib/scaffold/payload-schema.js        (shared: ADR §3.1.2.3 frozen schema + validator)

templates/scaffold/hooks/
  ├─ claude/context-ref.sh             (shell hook script body — UserPromptSubmit consumer)
  ├─ gemini/context-ref.js             (Node hook script body)
  └─ codex/agents-md-block.md          (sentinel-managed prompt directive — markdown-only)
```

Each per-CLI module exports the **uniform CLI-module interface**:

```
module.exports = {
  cliName: 'claude' | 'codex' | 'gemini',
  detect(scopePath)  → { installed: bool, version: string|null, paths: { settings: ..., script: ... } },
  install(scopePath, opts) → { changed: bool, diffs: [{path, oldHash, newHash, action}], exitCode },
  uninstall(scopePath, opts) → { changed: bool, diffs: [...], exitCode },
  verify(scopePath) → { valid: bool, issues: [{path, severity, message}] }
}
```

The dispatcher's only responsibilities are: argv parsing → module selection → exit-code aggregation → JSON/human output formatting.

### §2.2 Alternatives considered

**A. Inline dispatch (monolithic).** Single `bin/scaffold-install-hooks.js` with `switch (cli)` and inlined hook script template literals. Rejected because it violates SRP (multiple CLI logics per module) and DRY (idempotency repeated per branch); fails Article 1's weight test as soon as a 4th CLI is added (every existing branch must be re-edited).

**B. Declarative manifest + generic file-block editor.** Generic `lib/scaffold/file-block.js` library handling block-types (markdown-sentinel, json-named-key, script-sha256) declaratively; per-CLI = a JSON manifest. Rejected because the generic engine carries more LOC than three hand-written CLI modules for only three known CLIs (Article 1 — 경량; Article 17 — 무의존 of overengineered framework). Manifest schema would also become its own sub-contract requiring versioning, multiplying the surface area.

**Chosen: §2.1** — strongest on Article 1 (no premature framework), Article 3 (per-CLI knowledge isolated), and SRP/DRY (shared primitives without manifest indirection). REF: ADR §3.1.2.4 cross-CLI matrix already enumerates the per-CLI surface differences as a row-per-CLI table — code structure mirrors the ADR's own structure.

### §2.3 Resolved questions (from dispatch envelope Phase 2)

| # | Question | Resolution | Source of authority |
|---|---|---|---|
| Q1 | Hook scope: only `[context-ref]`, or full skill/tool installation? | **`[context-ref/v1]` decoder ONLY.** Skills/tools install via separate `aigentry scaffold install-skills` subcommand (out of this spec). | ADR §3.3.1.4 separates `scaffold` subcommands |
| Q2 | Per-CLI behavior: which CLIs by default? | **Explicit `<cli>` arg required**, no default auto-install. Convenience `<cli>=all` fans out to claude→codex→gemini sequentially with aggregated exit code. | ADR §3.1.2.4 invocation grammar + Article 17 (no mandate) |
| Q3 | Versioning: detect v1 vs future v2+? | Hook script header declares `# context-ref/v1` + min-telepty-version. Runtime checks first-line literal `[context-ref] Read `. Unknown trailing tokens (e.g., `[context-ref/v2]`) → graceful fall-through (pass prompt unchanged) per fail-open rule. v2 dispatch requires successor ADR. | ADR §3.1.2.1.1 rule 3 + §3.1.2.4 fail-open |
| Q4 | Idempotency: how detect existing hooks on re-install? | Three primitive mechanisms by file type: **markdown-sentinel** for `AGENTS.md` (HTML-comment block), **json-named-key** for `settings.json` (entry identified by command path containing `aigentry-context-ref-v1`), **script-sha256** for hook script files (compare embedded sha256 in header). Re-install with no change → no-op; version bump → in-place replace + `.bak.<ISO8601>` of prior. | ADR §3.1.2.4 idempotency row + this spec §5 |
| Q5 | Uninstall: devkit-owned? | **Yes.** Symmetric `--uninstall` flag; sentinel-bounded removal + JSON entry removal + script file deletion. Idempotent (no-op on already-uninstalled). | ADR §3.1.2.4 uninstall row |
| Q6 | #10.3/#10.4 grouping: in scope? | **#10.2 in scope, #10.3 deferred, #10.4 subsumed.** #10.3 is a 1-flag addition to telepty `reply` (encoder-side, telepty-repo) — symmetric to inject-side, requires no devkit decoder change; separate telepty-repo dispatch. #10.4 is dispatched per-CLI inside §3.1.2.3 hook payload schema's per-CLI materialization (Claude `additionalContext` / Codex AGENTS.md preamble / Gemini settings prompt) — already covered by §4 of this spec. | User confirmation 2026-05-05; ADR §3.1.2.3 |

---

## §3 CLI Surface (`scaffold/v1` portion)

### §3.1 Invocation grammar

```
aigentry scaffold install-hooks <cli> [scope-flags] [mode-flags]

<cli>            ::= claude | codex | gemini | all
scope-flags      ::= [--global | --project <path>]                   (default: --project .)
mode-flags       ::= [--dry-run] [--uninstall] [--force] [--json]
```

### §3.2 Flag semantics

| Flag | Effect |
|------|--------|
| `--global` | scope = `$HOME` (e.g., installs to `~/.claude/settings.json`, `~/.codex/AGENTS.md`, `~/.gemini/settings.json`). |
| `--project <path>` | scope = absolute or relative path to project root; default `--project .`. Path validated as directory + writable; missing → exit 3. |
| `--dry-run` | prints a unified-diff style preview to stdout for each file that would change; no writes; exit 0 with empty body if no changes pending. |
| `--uninstall` | removes hook installation (sentinel block + JSON entry + script file). Idempotent. |
| `--force` | overwrites even if a user-modified script file is detected (i.e., script sha256 mismatches the previous-installed sha256 recorded in JSON or sentinel header). Without `--force`: exit 4 with diagnostic stderr. `.bak.<ISO8601>` always created on overwrite. |
| `--json` | machine-readable JSON status to stdout in lieu of human text (consumed by `aigentry doctor` and orchestrator); always exits with the same exit code as human mode. |

### §3.3 Exit codes

| Code | Meaning | When |
|------|---------|------|
| 0 | success or idempotent no-op | install/uninstall completed, or already in target state |
| 2 | unknown `<cli>` | argv didn't match `claude\|codex\|gemini\|all` |
| 3 | scope inaccessible | `--project` path missing, not a directory, or not writable; `--global` `$HOME` not writable |
| 4 | hook installation failure | `settings.json` malformed JSON, refused overwrite of user-modified script without `--force`, sentinel block detected as corrupted (only one of BEGIN/END), telepty CLI not on PATH on first install (warned + continue is acceptable; only fatal when telepty version too old per §6.3) |

### §3.4 `--all` fan-out

Sequential dispatch claude → codex → gemini. Per-CLI exit codes captured. Final exit = `max(per-CLI codes)`. Per-CLI status emitted in human or JSON output regardless of failures (no early abort — operator wants to see all results).

### §3.5 Help text

`aigentry scaffold install-hooks --help` MUST emit:
- usage line matching §3.1,
- one-line description of each flag matching §3.2,
- exit-code table matching §3.3,
- pointer to `[context-ref/v1]` ADR §3.1.2 for protocol reference,
- example invocations: install, dry-run, uninstall.

---

## §4 Per-CLI Module Specifications

### §4.1 `claude` (`lib/scaffold/install-hooks/claude.js`)

#### §4.1.1 Target files

| File | Path (`<scope>` = `--global $HOME` OR `--project <path>`) |
|------|------|
| Settings file | `<scope>/.claude/settings.json` |
| Hook script | `<scope>/.claude/hooks/aigentry-context-ref-v1.sh` |

The script filename **embeds the version** (`-v1`) so v2 installation, when introduced via successor ADR, side-by-sides with v1 during the 30-day deprecation window per ADR §3.1.2.2 versioning rule.

#### §4.1.2 settings.json patch

Insert (or replace) one entry under `hooks.UserPromptSubmit[0].hooks` array. The matcher is `""` (empty string = match-all), and the entry is identifiable by its command field containing the literal substring `aigentry-context-ref-v1.sh`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash '<scope>/.claude/hooks/aigentry-context-ref-v1.sh'",
            "async": false
          }
        ]
      }
    ]
  }
}
```

If `hooks.UserPromptSubmit` already exists with other entries (e.g., user-installed hooks), the installer MUST **append**, not replace. Detection key for this entry: `hooks[].command` contains substring `aigentry-context-ref-v1.sh`.

If the existing settings.json contains an `aigentry-context-ref-v1.sh` entry, the installer MUST diff the embedded version comment in the script file (see §4.1.3 header) against the desired version. Match → no-op. Mismatch → replace entry (and replace the script file, with `.bak.<ISO8601>`).

JSON-edit safety: parse with strict `JSON.parse`; on parse failure, exit 4 with a human-readable diagnostic (line:col + suggested fix). NEVER produce malformed JSON. Pretty-print with 2-space indent matching existing file convention; preserve existing key order where possible (use a stable JSON formatter such as `JSON.stringify(obj, null, 2)` ordered by insertion).

#### §4.1.3 Hook script body (templates/scaffold/hooks/claude/context-ref.sh)

Header (rendered at install time with version + min-telepty-version pulled from `aigentry-devkit/package.json`):

```bash
#!/usr/bin/env bash
# context-ref/v1 — devkit-installed hook for [context-ref] inject protocol
# spec: ADR 2026-05-05-telepty-devkit-boundary §3.1.2 (commit e4b072b)
# devkit version: <DEVKIT_VERSION>
# min telepty version: <MIN_TELEPTY_VERSION>
# script-sha256: <SHA256_OF_THIS_FILE_AFTER_HEADER>   ← computed at install, embedded by installer
# DO NOT EDIT — managed by `aigentry scaffold install-hooks claude`
```

Body algorithm (illustrative pseudo, non-executable):

```pseudo
read PROMPT_BODY from stdin
read first_line of PROMPT_BODY
if first_line does NOT start with literal "[context-ref] Read ":
  print PROMPT_BODY unchanged to stdout         # fall-open
  exit 0

extract path_token between "[context-ref] Read " and " and use it as"
if path_token starts with "~/":
  path_resolved = "$HOME/" + path_token[2:]
else if path_token starts with "/":
  path_resolved = path_token
else:
  print PROMPT_BODY unchanged                   # malformed; fall-open
  exit 0

if NOT exists(path_resolved):                   # security: refuse missing
  print PROMPT_BODY unchanged
  exit 0
if mode(path_resolved) != 0600:                 # security: refuse non-0600
  print PROMPT_BODY unchanged
  exit 0
if owner(path_resolved) != $(id -u):            # security: refuse other-owned
  print PROMPT_BODY unchanged
  exit 0

ref_body = read_file(path_resolved)
ref_sha256 = sha256(ref_body)
inline_message = remainder of PROMPT_BODY after first_line

emit JSON to stdout:
{
  "additionalContext": ref_body,
  "aigentry_context_ref": {
    "version": "context-ref/v1",
    "ref_path": path_resolved,
    "ref_sha256": ref_sha256,
    "inline_message": inline_message,
    "decoded_at": <ISO8601 now>
  }
}
exit 0

# Any unhandled error: print PROMPT_BODY unchanged to stdout, log diagnostic to stderr, exit 0
```

The `additionalContext` field is the Claude Code hook's documented output mechanism; the `aigentry_context_ref` field is supplementary diagnostic metadata (Claude ignores unknown fields). The script MUST NEVER return a non-zero exit code that would abort prompt submission; **fail-open is mandatory** per ADR §3.1.2.4 hook-failure-runtime-behavior row.

#### §4.1.4 Idempotency mechanism

Detection: read `settings.json`; locate the entry where `hooks[].command` contains `aigentry-context-ref-v1.sh`. If absent → install. If present → compare `script-sha256:` line in script file header against expected. Equal → no-op (exit 0). Different → replace script + entry; back up old script as `aigentry-context-ref-v1.sh.bak.<ISO8601>`.

#### §4.1.5 Verify behavior

`detect(scope)` returns:
- `installed: true/false` (entry presence in settings.json)
- `version: "v1"` (from header parse) OR `null`
- `paths: { settings, script }` (resolved absolute)
- `issues: []` populated if: settings.json malformed, script file missing while entry present (or vice versa), header sha256 mismatch with file body, script file mode ≠ 0755 (executable bit).

### §4.2 `codex` (`lib/scaffold/install-hooks/codex.js`)

#### §4.2.1 Target file

| File | Path |
|------|------|
| AGENTS.md | `<scope>/AGENTS.md` (project) OR `~/.codex/AGENTS.md` (global) |

**Codex has no runtime hook framework comparable to Claude Code's UserPromptSubmit.** The receiver is therefore a **prompt-time directive** in `AGENTS.md`: a sentinel-managed markdown block instructing the Codex agent (the model) to honor `[context-ref]` prompts by reading the referenced file and treating its contents as the authoritative payload.

This is a content-only install (no script file). The Codex agent itself does the file read at prompt-construction time, governed by the `AGENTS.md` instruction.

#### §4.2.2 Sentinel block

```markdown
<!-- BEGIN aigentry context-ref/v1 -->
<!-- spec: ADR 2026-05-05-telepty-devkit-boundary §3.1.2 (commit e4b072b) -->
<!-- devkit version: <DEVKIT_VERSION> -->
<!-- DO NOT EDIT — managed by `aigentry scaffold install-hooks codex` -->

## Context-ref directive (`[context-ref/v1]`)

When you receive a user prompt whose **first line** starts with the literal prefix
`[context-ref] Read <path-token> and use it as the source of truth for this task.`,
you MUST:

1. Treat `<path-token>` as a filesystem path (absolute, e.g. `/abs/path.md`, or home-relative, e.g. `~/.telepty/shared/<sha>.md`).
2. Expand `~/` to `$HOME` if present. Reject any path that is neither absolute nor `~/`-prefixed.
3. Read the file at the resolved path. Verify mode `0600` and that the file is owned by the current user. If verification fails, respond as if the directive line were absent (use the remaining prompt body verbatim).
4. Treat the file body as the **authoritative payload** for the task. The remainder of the user prompt (the lines after the first line) is supplementary inline context only.
5. If the prefix is present but malformed (no path token, file missing), respond as if the directive line were absent (fall-open). Do not surface this fall-open to the user as an error unless they ask.

This directive is wire-contract-locked to `[context-ref/v1]` per ADR §3.1.2.1.1 rule 1 (grammar + storage + receiver detection + payload schema). Future `[context-ref/v2+]` will arrive via a successor ADR; until then, treat any literal prefix variant other than exact `[context-ref] ` as if the directive were absent.

<!-- END aigentry context-ref/v1 -->
```

#### §4.2.3 Idempotency mechanism

Detection: scan `AGENTS.md` for `<!-- BEGIN aigentry context-ref/v1 -->`. Absent → append the block to end of file (with a leading blank line if file is non-empty). Present → compute sha256 of the **content between BEGIN and END** (exclusive of sentinels); compare to the embedded `<!-- devkit version: ... -->` and to the expected canonical block. Match → no-op. Mismatch → replace block in place; write `.bak.<ISO8601>` of the prior `AGENTS.md`.

The block MUST remain self-contained (BEGIN+END pair). If the installer detects only one half (e.g., user manually deleted END), the file is in an inconsistent state: exit 4 with diagnostic; refuse to install without `--force`. With `--force`, write `.bak.<ISO8601>` and rewrite the entire block.

If `AGENTS.md` does not exist at scope, the installer creates it (single-block file). Existing user content above/below the sentinel block is preserved.

#### §4.2.4 Verify behavior

Same shape as §4.1.5; `paths` returns just `{ agents_md }`. `issues` populated if: BEGIN without END (or vice versa), block content sha256 mismatches expected, block embedded version field is missing/malformed.

### §4.3 `gemini` (`lib/scaffold/install-hooks/gemini.js`)

#### §4.3.1 Target files

| File | Path |
|------|------|
| Settings file | `<scope>/.gemini/settings.json` |
| Hook script | `<scope>/.gemini/hooks/aigentry-context-ref-v1.js` |

#### §4.3.2 settings.json patch

Gemini CLI's hook framework is less documented than Claude's; this spec uses the schema convention emerging in `~/.gemini/settings.json` per ADR §3.1.2.4 row "gemini" + community convention. The installer adds (or replaces) one entry:

```json
{
  "hooks": {
    "userPromptSubmit": [
      {
        "name": "aigentry-context-ref-v1",
        "type": "command",
        "command": "node '<scope>/.gemini/hooks/aigentry-context-ref-v1.js'",
        "version": "context-ref/v1"
      }
    ]
  }
}
```

Detection key: `hooks.userPromptSubmit[].name == "aigentry-context-ref-v1"` (gemini's hook entries support a `name` field, unlike Claude's). If gemini's actual settings schema differs at implementation time, the coder session MUST refer to gemini's official hook documentation and adapt while preserving: a unique identifying field, a script-path field, and a version field. Adapter must NOT change the wire contract (which is decoder-side, lives in the script body).

#### §4.3.3 Hook script body (templates/scaffold/hooks/gemini/context-ref.js)

Same algorithm as §4.1.3 (claude shell version), translated to Node.js. Reads stdin, parses first-line directive, emits gemini's expected output JSON shape (TBD by coder per gemini docs; convention is `{ "additionalContext": <body> }`). Header carries identical `script-sha256:` + `min telepty version` + `DO NOT EDIT` markers.

#### §4.3.4 Idempotency mechanism

Combined: JSON named-key detection on settings.json (`name == "aigentry-context-ref-v1"`) + script-sha256 detection on script file header. Re-install with version match → no-op. Mismatch → replace both, back up prior script.

#### §4.3.5 Verify behavior

Same shape as §4.1.5.

### §4.4 Per-CLI summary table

| Aspect | claude | codex | gemini |
|--------|--------|-------|--------|
| Receiver type | runtime hook | prompt-time directive | runtime hook |
| Settings file | `<scope>/.claude/settings.json` | n/a | `<scope>/.gemini/settings.json` |
| Hook script file | `<scope>/.claude/hooks/aigentry-context-ref-v1.sh` (bash) | n/a | `<scope>/.gemini/hooks/aigentry-context-ref-v1.js` (node) |
| Markdown directive file | n/a | `<scope>/AGENTS.md` (or `~/.codex/AGENTS.md`) | n/a |
| Idempotency primitive | json-named-key + script-sha256 | markdown-sentinel | json-named-key + script-sha256 |
| Output mechanism | hook stdout JSON `{additionalContext}` | model self-reads file at prompt time | hook stdout JSON `{additionalContext}` |

---

## §5 Idempotency Primitives (`lib/scaffold/idempotent.js`)

The library exports three pure functions; all three are CLI-agnostic and reused across §4.1-§4.3.

### §5.1 markdown-sentinel

```
markdownSentinel.detect(filePath, beginMarker, endMarker)
  → { present: bool, range: {start, end} | null, contentSha256: string|null, malformed: bool }

markdownSentinel.upsert(filePath, beginMarker, endMarker, newBlockContent, opts)
  → { changed: bool, backupPath: string|null, action: 'inserted' | 'replaced' | 'noop' }

markdownSentinel.remove(filePath, beginMarker, endMarker, opts)
  → { changed: bool, backupPath: string|null, action: 'removed' | 'noop' }
```

`malformed: true` when only one of BEGIN/END found, or when nesting detected. `opts.backup: true` (default) writes `.bak.<ISO8601>` to filePath's directory before any mutation.

### §5.2 json-named-key

```
jsonNamedKey.detect(filePath, keyPath, identifierPredicate)
  → { present: bool, entryIndex: number | null, entry: object | null }

jsonNamedKey.upsert(filePath, keyPath, identifierPredicate, newEntry, opts)
  → { changed: bool, backupPath: string|null, action: 'appended' | 'replaced' | 'noop' }

jsonNamedKey.remove(filePath, keyPath, identifierPredicate, opts)
  → { changed: bool, backupPath: string|null, action: 'removed' | 'noop' }
```

`keyPath` = dotted path (e.g., `hooks.UserPromptSubmit.0.hooks`). `identifierPredicate(entry) → bool` selects the targeted entry (e.g., `e => /aigentry-context-ref-v1/.test(e.command)`). Parse failure → throws; caller (per-CLI module) maps to exit 4. Indent preservation: if file has consistent 2-space or 4-space indent, write with same; else default 2-space.

### §5.3 script-sha256

```
scriptSha256.detect(scriptPath, expectedSha256, headerPattern)
  → { exists: bool, headerSha256: string|null, fileSha256: string|null, headerMatchesFile: bool, headerMatchesExpected: bool }

scriptSha256.write(scriptPath, scriptBody, headerSha256Field, opts)
  → { changed: bool, backupPath: string|null, action: 'created' | 'replaced' | 'noop' }
```

`headerPattern` extracts the embedded sha256 line (e.g., `^# script-sha256: ([0-9a-f]+)$`). Write computes sha256 of `scriptBody` (post-header substitution) and embeds it. On replace, if existing file's sha256 ≠ existing header's embedded sha256 → user-modified → refuse without `opts.force`; with force → backup + overwrite. Sets executable mode 0755 for `.sh`, 0644 for `.js`.

### §5.4 Atomicity

All write operations use **write-temp-then-rename** within the same directory: write to `<filePath>.tmp.<random>`, fsync, rename to `<filePath>`. POSIX rename is atomic on same filesystem. Backup is created before rename, never after, to ensure recoverability if the process dies between backup and rename.

---

## §6 Hook Runtime Contract

### §6.1 Frozen schema (ADR §3.1.2.3 — wire-contract-locked)

`lib/scaffold/payload-schema.js` exports:

```javascript
const CONTEXT_REF_V1_SCHEMA = Object.freeze({
  version: 'context-ref/v1',         // literal
  required: ['version', 'ref_path', 'ref_sha256', 'ref_body', 'inline_message', 'decoded_at'],
  fieldTypes: { version: 'string', ref_path: 'string', ref_sha256: 'string', ref_body: 'string', inline_message: 'string', decoded_at: 'string' /* ISO8601 */ }
});
```

The schema is **read-only at runtime** and frozen at module load. Hook scripts include this schema by string-embed at install time (claude) or by `require()` (gemini Node script). Per-CLI hook scripts MUST NOT add or rename fields.

### §6.2 Receiver contract (ADR §3.1.2.2)

The hook script MUST execute these steps **in this order**:

1. Read full prompt body from stdin.
2. Match first line against literal prefix `[context-ref] Read `. No match → fall-open (return prompt unchanged).
3. Extract `path-token` between `[context-ref] Read ` and ` and use it as`. Malformed → fall-open.
4. **Path-token expansion**: if starts with `~/`, expand to `$HOME/`; if starts with `/`, use as-is; else → fall-open (no relative paths, no envvar substitution beyond `$HOME`). This rule is **defense-in-depth** per ADR §3.1.2.2.
5. Verify file exists. If not → fall-open.
6. Verify mode is `0600` (octal compare, mask `077` checks). If not → fall-open.
7. Verify owner uid matches current uid. If not → fall-open.
8. Read file body. Compute sha256 of body bytes.
9. Construct payload object (six fields per schema).
10. Emit per-CLI output (stdout JSON for claude/gemini; not applicable for codex which is prompt-time directive only).

Any unhandled exception → fall-open: print original prompt to stdout, log diagnostic to stderr, exit 0. **Hook script MUST NEVER return non-zero exit code that would abort prompt submission.**

### §6.3 Telepty-version handshake

At install time, the installer runs `telepty --version`:
- If telepty not on PATH: install proceeds; warning emitted to stderr; hook script header records `min telepty version: unknown`; runtime fall-open behavior covers absence (file path simply won't exist if telepty isn't producing them).
- If telepty present: record version in header. At runtime, hook compares (cheap: file-stat the telepty binary path's `--version` output is unnecessary; we trust install-time recording). **No runtime version check is performed**, because:
  - if telepty was uninstalled, no `[context-ref]` prompts will be emitted, so the hook is never triggered (silent benign degradation),
  - if telepty was upgraded to a newer compatible version, no action needed,
  - if telepty was upgraded across a breaking v2 boundary, the v2 prefix line will not match v1's literal prefix, triggering fall-open.

This is simpler than ADR §3.1.2.4's hook-handshake row literal text suggests; it preserves semantic intent (graceful degradation per Article 17) without runtime overhead.

### §6.4 Conformance fixture replay (devkit-side)

Devkit tests REPLAY telepty-owned conformance fixtures from `~/projects/aigentry-telepty/tests/context-ref/v1/conformance/*.json` (M6 deliverable per ADR §6.5.1 footnote). Each fixture file is JSON of shape:

```json
{
  "input_prompt": "<full prompt body, multi-line>",
  "expected_decoded_payload": { "version": "...", "ref_path": "...", ... },
  "expected_output_kind": "decoded" | "fall-open"
}
```

Devkit hook tests pipe `input_prompt` to the hook script's stdin and assert stdout matches the per-CLI output for `expected_decoded_payload` (or that stdout equals `input_prompt` for `expected_output_kind: "fall-open"`).

Until M6 lands and the upstream fixtures are materialized, devkit tests use an **interim fixture set** at `aigentry-devkit/tests/scaffold/install-hooks/v1/conformance/` with the same shape, **structurally aligned with §3.1.2.2 grammar requirements** (must include both absolute-path and `~/`-prefixed home-relative cases per ADR §3.1.2.2 r3 N4). When telepty's fixtures land, devkit's interim set is RETIRED (deleted) and tests pivot to the upstream path.

---

## §7 SSOT Registration & Conformance Fixtures

### §7.1 SSOT contract files this spec depends on (ADR §6.5.1 BLOCKER gates)

| Gate | File | Status (2026-05-05) | Owner | Required for this spec? |
|------|------|----------------------|-------|--------------------------|
| G2 | `~/projects/aigentry-ssot/contracts/context-ref-v1.md` | UNMET | aigentry-architect (or orchestrator-designated) | YES — implementation cannot begin until G2 lands |
| G3 | `~/projects/aigentry-ssot/contracts/scaffold-v1.md` | UNMET | aigentry-architect | YES — `aigentry scaffold` CLI surface registration |
| G4 | `~/projects/aigentry-ssot/contracts/scaffold-shim-v1.md` | UNMET | aigentry-architect | NO — telepty-side, not consumed here |

Gates G2 and G3 must land **before coder dispatch**. Their content is sketched in Appendix A and Appendix B of this spec to facilitate registration; final SSOT files are written by the orchestrator-designated session (typically a follow-on architect dispatch or a quick-win coder if scope permits) before this spec moves to implementation.

### §7.2 Conformance fixtures owned by telepty (ADR §3.1.2.1 + §3.1.2.2 r3)

Path: `~/projects/aigentry-telepty/tests/context-ref/v1/conformance/`. Required cases (per ADR §3.1.2.2 r3 N4 grammar normalization):

- `path-absolute-{golden}.json` — directive with absolute path-token.
- `path-home-relative-{golden}.json` — directive with `~/`-prefixed path-token.

Plus recommended additional cases (this spec, non-binding suggestions for telepty's M6 dispatch):
- `fall-open-malformed-prefix.json` — first line starts with `[context-ref` but not exact prefix.
- `fall-open-relative-path.json` — path-token is relative (must reject).
- `fall-open-missing-file.json` — path resolves to nonexistent file.
- `fall-open-wrong-mode.json` — file exists but mode ≠ 0600.

Devkit hook tests bind to these fixtures via §6.4. Until telepty M6 lands these files, devkit's interim fixture set serves as test substrate.

---

## §8 Error Handling & UX

### §8.1 stderr message format

All diagnostics follow:

```
aigentry: scaffold install-hooks <cli>: <severity>: <message>
                                                   [<context-line>]
                                                   [<remediation-line>]
```

Severities: `error` (exit non-zero), `warn` (exit may be 0 with caveat), `info` (exit 0).

### §8.2 Common diagnostic templates

| Condition | Severity | Message |
|-----------|----------|---------|
| Unknown `<cli>` | error | `unknown CLI '<arg>'; expected one of: claude, codex, gemini, all` |
| `--project` path missing | error | `project path '<path>' not found or not a directory` |
| settings.json malformed | error | `<path>/.claude/settings.json: malformed JSON at line <L> col <C>: <hint>` + remediation `(run with --force to overwrite, or fix manually)` |
| User-modified script detected without `--force` | error | `script <path> appears user-modified (sha256 mismatch); refusing to overwrite without --force` |
| Sentinel block half-corrupted | error | `<path>/AGENTS.md: BEGIN sentinel without END (or vice versa) — file in inconsistent state` |
| Telepty CLI not on PATH | warn | `telepty CLI not found on PATH; install proceeds. Hook will fall-open until telepty is installed.` |
| Already installed at same version | info | `<cli> already installed at context-ref/v1; no-op` |

### §8.3 `--dry-run` output

For each file that would change, emit:

```
=== <path> ===
<unified diff body>
```

For codex (markdown-sentinel block), the diff shows the BEGIN-END region. For claude/gemini settings.json, the diff shows the `hooks` key region. For script files, the diff shows full file (or "(new file, <N> lines)" for inserts). At end, summary line:

```
[dry-run] <N> files would change; <M> unchanged.
```

Exit 0 always for `--dry-run` (errors during the planning phase still emit to stderr but do not fail the command).

### §8.4 `--json` output

Top-level shape:

```json
{
  "version": "scaffold-install-hooks/v1",
  "cli": "claude" | "codex" | "gemini",
  "scope": "/abs/scope/path",
  "action": "install" | "uninstall" | "verify" | "dry-run",
  "result": "ok" | "noop" | "error",
  "exitCode": 0,
  "files": [
    { "path": "...", "action": "appended" | "replaced" | "removed" | "noop" | "skipped", "backupPath": "...|null" }
  ],
  "diagnostics": [ { "severity": "error|warn|info", "message": "..." } ]
}
```

For `--all`: top-level becomes `{ "results": [ <per-cli object>, ... ], "exitCode": <max> }`.

---

## §9 Testing Strategy

### §9.1 Test layout

```
aigentry-devkit/tests/scaffold/install-hooks/
  ├─ unit/
  │   ├─ idempotent-markdown-sentinel.test.js
  │   ├─ idempotent-json-named-key.test.js
  │   ├─ idempotent-script-sha256.test.js
  │   ├─ scope-resolution.test.js
  │   └─ payload-schema.test.js
  ├─ integration/
  │   ├─ claude-install.test.js
  │   ├─ claude-uninstall.test.js
  │   ├─ claude-reinstall-noop.test.js
  │   ├─ claude-version-bump.test.js
  │   ├─ codex-install.test.js
  │   ├─ codex-corrupted-sentinel.test.js
  │   ├─ gemini-install.test.js
  │   ├─ all-fanout.test.js
  │   └─ dry-run-output.test.js
  ├─ conformance/
  │   ├─ replay-fixtures.test.js
  │   └─ v1/                              ← interim fixture set; retired when telepty M6 lands
  │       ├─ path-absolute-golden.json
  │       ├─ path-home-relative-golden.json
  │       ├─ fall-open-malformed-prefix.json
  │       ├─ fall-open-relative-path.json
  │       ├─ fall-open-missing-file.json
  │       └─ fall-open-wrong-mode.json
  └─ fixtures/                            ← per-CLI before/after settings.json snapshots
```

### §9.2 Integration test isolation

Each integration test uses `mkdtemp()` to create an ephemeral scope directory; pre-populates with realistic fixtures (e.g., empty settings.json, settings.json with prior hooks, etc.); runs the installer; asserts post-state via deep diff. No test mutates real `$HOME`. Cleanup on teardown.

### §9.3 Coverage targets (acceptance criteria)

- Per-CLI module coverage: ≥ 90% line, 100% branch on idempotency decision points (install / re-install no-op / version-bump / uninstall / corrupted state).
- Conformance replay: 100% of fixtures pass for the two CLIs that materialize payloads (claude, gemini). Codex test asserts sentinel block content matches canonical text byte-for-byte.
- Cross-CLI matrix (`--all`): one happy-path test + one mixed-failure test (one CLI fails, others succeed; aggregated exit = max).

### §9.4 Constitution-test integration

Tests that exercise telepty must use `process.env.PATH` shimmed (tests own a `bin/telepty` shim that returns canned `--version`); never actually invoke the production telepty binary. This honors Article 9 (each component can be tested independently).

---

## §10 Backward Compatibility & Migration

- **Existing devkit `hooks/` directory** (current: `session-start`, `brain-session-start.sh`, `brain-session-end.sh`, `brain-hooks-install.sh`, `pre-compact.sh`, `session-start.sh`): UNAFFECTED. This spec adds new files under `lib/scaffold/install-hooks/` and `templates/scaffold/hooks/`; it does NOT modify `hooks/hooks.json` (which is devkit's plugin self-registration, distinct from user's `~/.claude/settings.json`).
- **Existing `lib/update-md.js`**: NOT replaced by this spec. `update-md.js` does AGENTS.md regex edits for variable substitutions (`AID → env`); it is unrelated to sentinel-managed block edits. The new `lib/scaffold/idempotent.js` lives alongside and may eventually subsume `update-md.js` in a separate future refactor — out of scope here.
- **No prior `[context-ref]` hook deployments exist** (verified: `~/.claude/settings.json` has no `hooks` key on this user's machine; `~/.codex/AGENTS.md` is empty 0-byte file; `~/.gemini/settings.json` only has `mcpServers`). Therefore no migration is needed for users whose state matches this snapshot. For users who have hand-written hooks with similar names, the installer's `aigentry-context-ref-v1` identifier is unique (versioned suffix), so name collision is implausible.
- **Telepty README cleanup** per ADR §3.1.2.5 (G7 gate) is a **prerequisite** for this spec's implementation. The orchestrator MUST verify G7 passing before dispatching the coder for #10.2. This spec does NOT modify telepty repo files.

---

## §11 Constitution Check

(Per architect AGENTS.md §3 + dispatch envelope I5; one PASS/FAIL/N/A line per question with 1-sentence evidence.)

| # | Question | Verdict | Evidence |
|---|----------|---------|----------|
| 1 | Does this serve the AI tech-gap mission? | **PASS** | Per-CLI hook receivers let any user with claude/codex/gemini receive `[context-ref]` payloads transparently; closes the "I just got a long inject and lost the structure" gap that motivated the protocol in #10. |
| 2 | Is this the right component's role (Article 3)? | **PASS** | Devkit owns per-CLI receiver-side per ADR §3.1.2 + §3.3 row "Per-CLI hook integrations"; telepty install-hooks subcommand explicitly REJECTED per §3.1.2.5; this spec stays inside devkit's lane. |
| 3 | Is the framework necessary (Article 1 — 경량)? | **PASS** | Approach 3 (declarative manifest + generic editor) was rejected for over-engineering 3 known CLIs; chosen Approach 1 ships ~3 per-CLI files + 1 shared lib + 3 templates ≈ 7 source files; no new external dependencies. |
| 4 | Cross-platform (Article 2)? | **PASS** | claude script is bash (POSIX-only — acceptable; Claude Code already requires POSIX env for hooks); gemini script is Node.js (cross-platform); codex is markdown-only (text). Windows considered: bash hook works under Git-Bash / WSL; documented in §3.5 help text. |
| 5 | Does this avoid forcing "how" on the user (Article 5)? | **PASS** | User opts in per-CLI; no auto-install; `--dry-run` lets users preview before commit; `--uninstall` is symmetric and clean. Article 17 (no mandate) honored: the protocol works without hooks installed (telepty inject still emits the file; the receiving CLI just won't auto-decode). |

Articles **9 (독립)** and **17 (무의존)** also explicitly cleared in §9.4 (test isolation) and §6.3 (telepty handshake graceful degradation).

---

## §12 Verification Plan

### §12.1 Acceptance metrics

| ID | Metric | Measurement | Threshold |
|----|--------|-------------|-----------|
| M1 | Idempotent reinstall safety | Run `install` twice in succession on a fresh `mkdtemp` scope; sha256 of all touched files identical between runs. | byte-equal across runs (exclusive of `.bak.<ISO8601>` files) |
| M2 | Uninstall reversibility | Snapshot scope before install; install; uninstall; diff. | post-uninstall scope == pre-install scope (modulo `.bak.<ISO8601>` files which are preserved) |
| M3 | Conformance fixture pass rate | Run replay test against the 6 fixture cases (§7.2). | 6/6 pass for claude, 6/6 pass for gemini; codex asserts sentinel-block byte equality |
| M4 | Fail-open on adversarial input | Feed 5 malformed inputs (no prefix, partial prefix, relative path, missing file, wrong mode). | Hook returns exit 0 with original prompt unchanged in all 5 cases |
| M5 | Scope isolation | Tests run with `$HOME=mkdtemp`; production `$HOME` untouched. | inotify watch on production `$HOME/.claude` and `$HOME/.gemini` records 0 events during test suite |
| M6 | `--dry-run` non-mutation | Run `--dry-run` on a fresh scope; verify no files written. | filesystem unchanged (mtime equal pre/post) |
| M7 | Help text completeness | `--help` includes usage line, flag table, exit codes, ADR pointer, examples. | manual checklist; CI lint script verifies presence of all 5 elements |

### §12.2 Pre-implementation gates (orchestrator-checked)

Before coder dispatch, orchestrator MUST verify:
- ADR §6.5.1 G2 (`context-ref-v1.md`) PASS — `~/projects/aigentry-ssot/contracts/context-ref-v1.md` exists and cites §3.1.2.1.1.
- ADR §6.5.1 G3 (`scaffold-v1.md`) PASS — file exists.
- ADR §6.5.1 G7 (telepty README cleanup) PASS — `! grep -nE 'telepty install hooks' ~/projects/aigentry-telepty/README.md`.

If any gate fails, dispatch is blocked per ADR §6.5 BLOCKER policy.

### §12.3 Post-implementation gate (M0 7-day window)

This spec must complete (status: accepted) within the M0 window (7 days from ADR acceptance, deadline **2026-05-12**). Implementation may extend beyond M0 — only the **spec** is M0-bound.

---

## §13 Out-of-Scope & Future Work

- **#10.3 reply-side `--reply-as-ref`** — separate telepty-repo architect dispatch. Decoder side (devkit hooks) requires no change because reply-side payloads use the same `[context-ref/v1]` storage convention and first-line prefix.
- **`[context-ref/v2+]`** — successor ADR required per §3.1.2.1.1 rule 3. v1 wire contract remains supported ≥ 30 days post-v2 acceptance.
- **`aigentry scaffold install-skills`** and other `scaffold` subcommands — separate dispatches; share `scaffold/v1` SSOT contract surface but distinct content.
- **Hook script Windows-native shells** (PowerShell receiver) — out of v1; bash + Node sufficient under Git-Bash/WSL.
- **Telemetry** of hook activations — no telemetry in v1 (Article 17 — 무의존, no telemetry framework dependency).
- **`lib/update-md.js` consolidation with `lib/scaffold/idempotent.js`** — separate refactor; preserves backward compat for existing AGENTS.md variable substitution.

---

## §14 Affected Files

### §14.1 Created (devkit, by coder session)

```
~/projects/aigentry-devkit/
  bin/aigentry-devkit.js                                  (MODIFIED — add `scaffold install-hooks` route)
  lib/scaffold/install-hooks/dispatcher.js                (NEW)
  lib/scaffold/install-hooks/claude.js                    (NEW)
  lib/scaffold/install-hooks/codex.js                     (NEW)
  lib/scaffold/install-hooks/gemini.js                    (NEW)
  lib/scaffold/idempotent.js                              (NEW)
  lib/scaffold/scope.js                                   (NEW)
  lib/scaffold/payload-schema.js                          (NEW)
  templates/scaffold/hooks/claude/context-ref.sh          (NEW)
  templates/scaffold/hooks/gemini/context-ref.js          (NEW)
  templates/scaffold/hooks/codex/agents-md-block.md       (NEW)
  tests/scaffold/install-hooks/{unit,integration,conformance,fixtures}/   (NEW directory tree)
  package.json                                            (MODIFIED — add `scaffold` to bin help; no new deps)
```

### §14.2 Created (SSOT, by orchestrator-designated session before coder dispatch)

```
~/projects/aigentry-ssot/contracts/context-ref-v1.md      (NEW — content per Appendix A)
~/projects/aigentry-ssot/contracts/scaffold-v1.md         (NEW — content per Appendix B)
```

### §14.3 Modified (telepty, doc-only PR — separate dispatch, prerequisite for coder)

```
~/projects/aigentry-telepty/README.md                     (MODIFIED — §3.1.2.5 cleanup; G7 gate)
```

### §14.4 Untouched

- All other devkit files (no changes to existing `lib/`, `hooks/`, `bin/`, `templates/` non-scaffold files).
- All telepty source files (only README, by separate dispatch).
- All orchestrator/architect files (this spec is a devkit deliverable; architect session is acting as spec-author per orchestrator dispatch).

---

## §15 Open Questions

**None at submit time.** All six dispatch-envelope questions resolved (§2.3). All ADR ambiguities (e.g., gemini hook schema, telepty handshake fidelity) resolved by adapter clauses (§4.3.2 directs coder to adapt to gemini's actual schema while preserving wire contract; §6.3 simplifies handshake without changing semantic).

If implementation surfaces an unforeseen blocker (e.g., gemini's hook schema differs incompatibly), coder MUST file an architect re-dispatch with the specific blocker; coder MUST NOT change the wire contract or per-CLI target file paths unilaterally.

---

## §16 Failure Modes & Anti-Patterns (consequences when this fails)

### §16.1 Failure modes

- **F1 — User-modified hook script silently overwritten**: mitigated by script-sha256 check + `.bak.<ISO8601>` always; refusal without `--force`.
- **F2 — settings.json corruption from concurrent edit**: mitigated by atomic write-temp-rename (§5.4); if user concurrently edits, rename will overwrite their edit but their file's mtime + backup chain shows the lost edit. Not a guarantee against lost edits — install operations should not be run with the AI CLI active. Documented in `--help`.
- **F3 — Telepty version mismatch during hook execution**: covered by §6.3 — fall-open handles missing files; v2 prefix changes trigger fall-open until devkit hook v2 lands. Graceful by design.
- **F4 — Half-applied install on disk full**: mitigated by atomic per-file rename + script-then-settings ordering — if disk full, the installer aborts with exit 4 before mutating settings.json (script written first; settings entry last). Re-run after freeing space resumes safely.
- **F5 — codex AGENTS.md sentinel deleted partially by user**: detected as "BEGIN without END"; refused install without `--force`. With `--force`, full block rewrite + backup.

### §16.2 Anti-patterns explicitly avoided

- **Importing telepty's internal parser** (ADR §3.1.2.1) — devkit re-implements per spec; tested via fixture replay.
- **Auto-installing for all CLIs without opt-in** (Article 17 — 무의존; ADR §3.1.2.4 — explicit `<cli>` arg).
- **Adding fields to the wire schema** (ADR §3.1.2.1.1 rule 1 — frozen schema). Observe `Object.freeze` in §6.1.
- **Suppressing diagnostics during fall-open** — fall-open MUST log to stderr while exiting 0; silence would make debugging impossible.
- **Modifying telepty repo files from this dispatch** — ADR §3.1.2.5 cleanup is its own dispatch; this spec only DECLARES it as a prerequisite (§14.3, §12.2).

---

## Appendix A — SSOT stub content for `context-ref-v1.md` (G2 gate facilitator)

(Suggested content; actual file written by orchestrator-designated session, not by this spec's coder dispatch.)

```markdown
# context-ref/v1 — SSOT contract

**Tag**: `context-ref/v1`
**Owning repo**: `aigentry-telepty` (protocol grammar + storage convention + reference parser; emit-side)
**Consuming repo(s)**: `aigentry-devkit` (per-CLI hook receivers)
**Status**: BINDING — wire contract LOCKED per ADR `2026-05-05-telepty-devkit-boundary` §3.1.2.1.1
**Versioned-binding policy**: ADR §3.1.2.1.1 rule 1 (locked subset: grammar + storage + receiver detection + payload schema + versioning model).

## Wire contract (immutable until v2 ADR)

- Grammar: ADR §3.1.2.2 (path-token = absolute-path / home-relative-path).
- Storage: `~/.telepty/shared/<sha256>.md`, mode 0600, owner-only.
- Receiver detection: literal `[context-ref] Read ` prefix on FIRST line.
- Hook payload schema: ADR §3.1.2.3 (6 named fields).
- Versioning: additive within v1; breaking → v2 + 30-day deprecation.

## Conformance fixtures

Path: `~/projects/aigentry-telepty/tests/context-ref/v1/conformance/`.
Required: `path-absolute-{golden}.json`, `path-home-relative-{golden}.json`. Recommended additions per devkit spec §7.2.

## Deprecation policy

30-day overlap on v2 introduction; v1 receivers MUST gracefully ignore unknown trailing tokens on the prefix line per ADR §3.1.2.2 versioning rule.

## Implementation references

- Telepty internal parser (NOT public API): `~/projects/aigentry-telepty/src/context-ref/parser.js`
- Devkit per-CLI hook scripts: `~/projects/aigentry-devkit/templates/scaffold/hooks/{claude,gemini,codex}/`
- Devkit installer: `aigentry scaffold install-hooks <cli>` per devkit spec `2026-05-05-issue-10-context-ref-spec.md`.
```

## Appendix B — SSOT stub content for `scaffold-v1.md` (G3 gate facilitator)

```markdown
# scaffold/v1 — SSOT contract

**Tag**: `scaffold/v1`
**Owning repo**: `aigentry-devkit`
**Consuming repo(s)**: `aigentry-telepty` (`session start --scaffold` shim per `scaffold-shim/v1`); manual users via PATH `aigentry`
**Status**: NEW (specified by ADR §3.3.1.4); subcommand surface registered here.

## Subcommand shape (additive within v1)

```
aigentry scaffold <subcommand> [flags]

<subcommand> ::= project | integrate-telepty | install-hooks | install-skills
```

Each subcommand returns uniform exit codes (0 success, 2 unknown subcommand/arg, 3 scope inaccessible, 4 install failure).

## Subcommand specs (linked)

- `install-hooks` — `~/projects/aigentry-devkit/docs/specs/2026-05-05-issue-10-context-ref-spec.md`
- `project` — TBD (separate dispatch)
- `integrate-telepty` — TBD (Phase 3 #8 dispatch)
- `install-skills` — TBD (separate dispatch)

## Versioning

Additive within v1 (new subcommands or new flags allowed; existing subcommand removal or flag rename = v2 + 14-day announce per Article 15).

## Conformance

Per-subcommand conformance test directories under `aigentry-devkit/tests/scaffold/<subcommand>/v1/`.
```

---

*End of spec — issue-10-context-ref-spec, status: proposed, awaiting tier-T1 reviewer + user approval.*
