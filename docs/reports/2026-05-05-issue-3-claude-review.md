# Issue #3 Claude Review of Codex Implementation (2026-05-05)

Reviewer: Claude (cross-LLM review per session feedback rule — implementer ≠ reviewer).
Range: `729058d^..a5acf1f` (2 commits).
Spec under review: `~/projects/aigentry-devkit/docs/specs/2026-05-05-issue-3-bootstrap-spec.md` (commits `fa1228d → 094b52d`, status `proposed`, iter-1 absorbed).
Boundary ADR: `~/projects/aigentry-orchestrator/docs/adr/2026-05-05-telepty-devkit-boundary.md` (commit `e4b072b`).
Constitution rules: Articles 1, 2, 3, 9, 15, 17 + Rule 29 (orchestrator AGENTS.md `d9bf7f5`).
Implementer: `aigentry-devkit-coder-issue-3` (Codex).
Tests: 11/11 PASS (9 fixture files; `fresh.spec.js` and `malformed-settings.spec.js` carry 2 cases each).

---

## §1 Summary

- **Verdict: ACCEPT_WITH_CONDITIONS**
- **Top issue**: `package.json` adds a `test:scaffold-install-hooks` script that references `tests/scaffold-install-hooks/v1/*.test.js` — a forward-looking touch outside Issue #3 scope (belongs to Issue #10.2 per spec §3.2). Minor Rule 29 violation, low-severity condition.
- Spec fidelity is otherwise high. The MAJOR iter-1 fix (discriminator `"x-aigentry-scaffold": "v1"` instead of `"$schema": "scaffold/v1"`) is implemented exactly as spec §6.3 / §14.1 #1 dictate. Boundary ADR is respected by construction. All 9 conformance fixtures map 1-for-1 to spec §10 V6.

---

## §2 Spec Fidelity Audit (per checklist §1)

| # | Requirement | Status | Evidence |
|---|---|:-:|---|
| 1 | CLI surface verbatim | ✅ | `lib/scaffold/project/index.js:27-75` parses `--project|--cwd`, `--cli`, `--dry-run`, `--backup|--no-backup`, `--template-dir`, `--uninstall`, `--orchestrator-session-id`, `--no-auto-report-errors`. All flags from spec §6.1 covered. |
| 2 | Stdout `<verb> <abs-path> [SP "(" reason ")"] LF` | ✅ | `lib/scaffold/project/stdout.js:5-11` formats `${verb} ${path}${reason}` where `reason = action.reason ? \` (${reason})\` : ""`. Verb set `{create, merge, skip, backup, remove, noop}` matches spec §6.4 exactly. `tests/scaffold-project/v1/helper.js:61` regex `^(create|merge|skip|backup|remove|noop) \/[^ ]+(?: \([^)]+\))?$` enforces grammar including the leading-`/` absolute-path requirement. |
| 3 | Exit codes 0/2/3/4 | ✅ | Argv error → 2 (`index.js:79,87,90`); template-dir / cwd inaccessible → 3 (`index.js:102,109,123`); malformed settings / missing templates → 4 (`index.js:105,154`). `unknown-cli-flag.spec.js:13`, `malformed-settings.spec.js:19,38` verify. |
| 4 | 9 conformance fixtures at `tests/scaffold-project/v1/` | ✅ | Files present: `fresh, reapply, uninstall, unknown-cli-flag, malformed-settings, template-override, sentinel-drift, non-interactive, dry-run-no-writes`. Helper + golden-diff-allowlist also present. |

**Minor**: spec §6.4 specifies "no padding, no trailing whitespace, no column alignment, no CRLF". `stdout.js` emits via `${verb} ${path}${reason}\n` — single LF, single ASCII space, no padding. Compliant.

**Minor**: spec §6.4 forbids whitespace in `cwd`. `index.js:19-21` rejects via `isAbsoluteNoWhitespace` before any I/O with exit 2 + correct stderr message (`error: cwd contains whitespace; not supported in v1`). Compliant.

---

## §3 Module Structure Audit (per checklist §2 — Approach C)

| Sub-module | Required | Implemented | Notes |
|---|---|:-:|---|
| `lib/scaffold/project/index.js` | Orchestrator + public `scaffoldProject(opts)` + `workspaceInitCompat` | ✅ | Returns `{actions, exitCode}` per spec §6.5. |
| `lib/scaffold/project/generate.js` | Per-CLI matrix + skip-on-exist for `.md` | ✅ | `createOrSkipFile()` at line 170-175 implements full-file skip-on-exist. `buildGenerationActions` produces ordered action list. |
| `lib/scaffold/project/merge.js` | `settings.json` deep-merge + sentinel | ✅ | `mergeSettings`, `mergePermissions`, `mergeHooks` implement §6.3 step 2 rules verbatim. `PERMISSIONS_ALLOW = ["Bash(aterm *)", "Bash(telepty *)"]` (line 12) — exact spec content. |
| `lib/scaffold/project/sentinel.js` | Marker/discriminator helpers | ✅ | `DISCRIMINATOR_KEY = "x-aigentry-scaffold"`, `DISCRIMINATOR_VALUE = "v1"` (lines 3-4). `isManagedBlock` test matches spec §6.3 verbatim. |
| `lib/scaffold/project/uninstall.js` | Sentinel-bracketed removal + always-on `.bak` | ✅ | `removeSettingsBlocks` strips managed blocks; `--no-backup --uninstall` against malformed JSON → exit 2 (line 60) per spec §6.1 + §10 V6 `malformed-settings`. |
| `lib/scaffold/project/stdout.js` | Machine-parseable verb emitter | ✅ | `VALID_VERBS` set matches spec §6.4 exhaustive vocab. |

**`lib/workspace-init.js` preserved as alias**: ✅ — `lib/workspace-init.js` (8 lines) re-exports `lib/scaffold/project` and aliases `workspaceInit → workspaceInitCompat`. Matches spec §9.1 #3 verbatim.

**Alias stderr note**: ✅ — `index.js:299`: `[alias] consider 'aigentry scaffold --project --cli <cli> --cwd <cwd>' (workspace-init form retained for compat)\n`. Byte-for-byte match with spec §9.1 #1.

**Backwards-compat golden tests**: `fresh.spec.js:32` compares `AGENTS.md` to `expectedLegacyAgents()` which renders the template + Worker role text inline. The Worker text in `expectedLegacyAgents` (helper.js:71-73) is byte-identical to `generate.js:158-160`. CLAUDE.md is compared against the unrendered template with `{{WORKSPACE_NAME}}` substitution. State files are compared against `expectedStateFile()` which mirrors `buildStateFiles()` in generate.js. **Caveat (F4 lesson)**: this is a template-fidelity test, not a pre-refactor binary diff. The pre-refactor capture (`lib/workspace-init.js@094b52d^`) was not preserved as a test fixture. Spec §10 V3 calls for a pre-refactor capture; this is mitigated in practice because the rendering logic is shared via the same templates, but a strict reading of V3 expects fixture-based diff. **Low-severity**: the rendering paths converge to identical output for the cases tested.

---

## §4 Per-CLI Matrix Audit (per checklist §3 — Q2=b)

| CLI | Spec §6.2 | Implementation | Test evidence |
|---|---|---|---|
| **claude** | `AGENTS.md` + `CLAUDE.md` + `.claude/settings.json` + `state/{task-queue,lessons}.json` | `generate.js:214-226` writes AGENTS.md + (claude branch) CLAUDE.md + state actions; `index.js:134-170` emits settings.json create/merge | `fresh.spec.js:24-30` — 5 create lines in exact order |
| **codex** | `AGENTS.md` (`AGENTS.codex.md` brief variant) + `state/*.json`; no `.claude/settings.json` | `generate.js:144` selects `AGENTS.codex.md` source; `index.js:135` returns `[]` for non-claude (no settings.json) | `fresh.spec.js:51-60` (workspace-init alias test) and `template-override.spec.js:18-21` verify codex AGENTS.md content + no `.claude/` directory |
| **gemini** | `AGENTS.md` + `GEMINI.md` + `state/*.json`; no `.claude/settings.json` | `generate.js:219-224` (gemini branch writes GEMINI.md); `index.js:135` skips settings.json for non-claude | `non-interactive.spec.js:18-20` confirms `AGENTS.md` + `GEMINI.md` exist |

Per-CLI conformance: **100% match**. Note the dispatch envelope said "codex: AGENTS.md only" but the spec §6.2 row for codex includes `state/{task-queue,lessons}.json` — implementation matches the spec, not the abbreviated envelope (correct).

---

## §5 Existing-File Behavior (per checklist §4 — Q3=hybrid; esp. JSON-Schema $id collision fix)

| Behavior | Spec | Implementation | Test |
|---|---|---|---|
| `.md` files: skip-on-exist (preserve user content) | §6.2 | `generate.js:170-175` `createOrSkipFile` returns `{verb: 'skip', reason: 'exists'}` | `reapply.spec.js:33-35` — second run emits `skip AGENTS.md (exists)`, `skip CLAUDE.md (exists)` |
| Discriminator `"x-aigentry-scaffold": "v1"` (NOT `$schema`) — MAJOR fix | §6.3 + §14.1 #1 | `sentinel.js:3-4` literal constants; `merge.js:46,52` wraps blocks via `withDiscriminator` | `fresh.spec.js:43-46` asserts settings has `permissions["x-aigentry-scaffold"] === "v1"`; `sentinel-drift.spec.js:35-38` verifies persistence after merge |
| `.bak.<ISO8601>` always-on; `--no-backup` opt-out | §6.1 | `index.js:23-25` `backupPathFor()` uses `new Date().toISOString()`; `--no-backup` → `opts.backup = false` (line 59); merge path emits backup conditional on `config.backup` (`index.js:165-167`) | `uninstall.spec.js:19` matches `^backup .../settings.json.bak.`; `malformed-settings.spec.js:23` regex `\\.bak\\.` |
| `permissions.allow[]` exact-string dedup | §6.3 step 2c | `merge.js:62-69` `mergeAllow` uses `merged.includes(entry)` (===) — non-string entries (line 60) pass through untouched | `sentinel-drift.spec.js:35-38` — drift mode replaces managed-block fully, so dedup tested implicitly via reapply.spec.js where second run emits `skip ... (unchanged)` |
| `--no-backup --uninstall` against malformed JSON forbidden | §6.1 | `uninstall.js:59-61` throws `error: --no-backup forbidden when uninstalling from malformed settings.json` exit 2 | `malformed-settings.spec.js:30-41` — exit 2 + exact stderr match |

**Sentinel-drift handling** (the most semantically intricate part of the spec):

`merge.js:88-148` distinguishes three states per top-level key:
1. Block absent → insert spec block (line 92).
2. Block present + `isManagedBlock(...)` → replace verbatim (lines 97-100, 130-138).
3. Block present + discriminator absent or different → deep-merge (`mergeAllow`, `mergeHookEntries`).

This matches spec §6.3 step 2 a/b/c precisely. `sentinel-drift.spec.js` exercises path #2 (managed block with stale content `Bash(old *)`, `command: "old"`) and verifies the new emission overwrites it while preserving sibling keys (`UserPromptSubmit`, `env`, `mcpServers`, `model`).

**Subtle correctness**: when an existing `hooks` block is `isManagedBlock`-tagged, `mergeHooks` (lines 130-138) preserves non-`PostToolUse|Stop` keys via `stripOwnedHookKeys` and re-emits with the spec's incoming `PostToolUse|Stop`. This is the right semantics — `UserPromptSubmit` survives drift correction. ✅

---

## §6 Settings.json Scope (per checklist §5 — Q5)

| # | Requirement | Status | Evidence |
|---|---|:-:|---|
| 1 | `permissions.allow: ["Bash(aterm *)", "Bash(telepty *)"]` | ✅ | `merge.js:12` constant |
| 2 | `hooks.PostToolUse[Bash]` + `hooks.Stop` | ✅ | `merge.js:18-42` `buildClaudeHooks` returns both arrays with `matcher: "Bash"` for PostToolUse and the `_ORCH` resolution wrapper. Hook content matches the existing `workspace-init.js` lines 340-364 spec reference. |
| 3 | `hooks.UserPromptSubmit`: NOT TOUCHED (deferred to #10.2) | ✅ | `merge.js:18-42` `buildClaudeHooks` does NOT emit `UserPromptSubmit`. `mergeHooks` (lines 108-148) only walks `PostToolUse` and `Stop` (line 143). `sentinel-drift.spec.js:23-24,40` injects pre-existing `UserPromptSubmit` and asserts byte-equal preservation. |
| 4 | `mcpServers`: NOT in settings.json (writes to `~/.claude/.mcp.json`) | ✅ | `merge.js` does not reference `mcpServers`. `index.js:218-231` `registerMcp` calls `registerClaudeMcp/registerGeminiMcp/registerCodexMcp` from `lib/bootstrap.js` (global MCP paths). `sentinel-drift.spec.js:43` asserts pre-existing project-level `mcpServers` preserved untouched. |
| 5 | Unknown keys preserved by-name | ✅ | `merge.js:150-155` `mergeSettings = clone(existing)` then mutates only `permissions` and `hooks`. `sentinel-drift.spec.js:42-44` verifies `env: {KEEP: "1"}`, `mcpServers: {existing: ...}`, `model: "keep-model"` survive merge. |

**Hook emission gating**: spec §6.6 says hooks block emitted only when `cli=claude AND autoReportErrors AND orchestratorSessionId resolves`. Implementation: `merge.js:51-53` — `if (autoReportErrors && orchestratorSessionId) settings.hooks = ...`. `index.js:184-191` resolves orchestrator id and emits the `info: no orchestrator session id resolved` stderr note when null. Compliant. `--no-auto-report-errors` → only `permissions.allow` written, no `hooks` block (verified by `fresh.spec.js:42-47` which uses `--no-auto-report-errors`).

---

## §7 Boundary + Constitution + Rule 29 (per checklists §6+§7)

### Boundary ADR e4b072b (BINDING — I4)

| Rule | Status |
|---|:-:|
| §3.4 row 1 — devkit owns content (no telepty file editing) | ✅ — implementation only writes within `<cwd>` and respects `~/.claude/.mcp.json` for global MCP |
| `--project` MUST NOT call telepty | ✅ — no `spawnSync('telepty', ...)` anywhere in `lib/scaffold/project/*`. The `telepty inject ...` strings are *embedded as content* in the PostToolUse/Stop shell hooks (matches spec §6.6); they only execute when the user later runs Claude Code, not at scaffold time. Article 9 satisfied. |
| §3.3.1.4 surface alignment | ✅ — CLI grammar matches |
| G3 SSOT stub `~/projects/aigentry-ssot/contracts/scaffold-v1.md` | Not in this commit range — owned by architect at status flip per spec §10 V5. Not a coder responsibility. |

### Constitution Articles

| Article | Check | Status |
|---|---|:-:|
| 1 (경량) | No premature abstractions | ✅ — module split is per spec §4.1 table, not speculative. Each module ~150-300 lines max. One borderline finding: `sentinel.js:35-43 removeMarkdownScaffoldBlock` is parser-only with no corresponding emitter (generate.js never inserts BEGIN/END markers in `.md` since policy is skip-on-exist). It is dead-by-design today. Spec §4.1 calls for the parser as preparation for future re-application; defensible per spec text. **Mention only.** |
| 2 (크로스) | POSIX-portable APIs | ✅ — `path.join`, `fs.mkdirSync({recursive})`, `path.isAbsolute`. `helper.js:38-43` test runner is platform-neutral via `process.execPath`. |
| 3 (역할) | devkit-only operations | ✅ — no telepty calls; only `aterm list --json` autodetect (line 76 of generate.js) which falls back gracefully on absence per spec §6.6. |
| 9 (독립) | Runs without telepty | ✅ — V4 metric: scaffold operates with zero telepty exec. Hook content embeds `telepty inject` strings, but invocation is deferred to runtime. |
| 15 (SSOT) | G3 referenced | ✅ — spec §13.6 references G3 stub; coder produced no SSOT changes (architect owns). |
| 17 (무의존) | No new external deps | ✅ — `package.json` diff: only adds 2 npm scripts, no `dependencies` mutation. All modules use Node stdlib (`fs`, `path`, `child_process`, `crypto` not even needed since spec §11.1 R1 sha256 was deferred). |

### Rule 29 외과적 변경 (orchestrator AGENTS.md `d9bf7f5`)

> Every changed line traces to spec. NO drive-by reformatting/refactoring of unrelated files. Dead code: mention only, not deleted.

**Files changed in range**:

| File | Change | Traces to spec | Verdict |
|---|---|:-:|:-:|
| `bin/aigentry-devkit.js` | +scaffold dispatch (line 1461-1474), +help text (4 lines), workspace-init dispatch refactored to call `parseProjectArgv` (lines 1475-1488) | spec §6.1 (CLI surface), §9.1 #1 (alias) | ✅ |
| `lib/scaffold/project/{index,generate,merge,sentinel,uninstall,stdout}.js` | New modules | spec §4.1 table | ✅ |
| `lib/workspace-init.js` | -407 lines, +8-line re-export | spec §9.1 #3 | ✅ |
| `package.json` | +`test:scaffold-project` script (line 58), +`test:scaffold-install-hooks` script (line 59) | `test:scaffold-project` — spec §10 V6. **`test:scaffold-install-hooks`** — out of scope (Issue #10.2, spec §3.2). | ⚠️ **CONDITION** |
| `tests/scaffold-project/v1/*.spec.js` (+helper.js, +golden-diff-allowlist.txt) | New conformance fixtures | spec §10 V6, §13.5 | ✅ |

**Rule 29 finding (LOW-severity, condition)**:

`package.json:59` adds:
```json
"test:scaffold-install-hooks": "node --test tests/scaffold-install-hooks/v1/*.test.js"
```

This script references a fixture directory that does not exist in the working tree (`ls tests/scaffold-install-hooks` would fail). It is forward-looking infrastructure for Issue #10.2 (`scaffold install-hooks <cli>`, spec §3.2). Spec §3.2 explicitly lists this as out-of-scope for Issue #3. Per Rule 29 / I5, this is an outside-scope edit and a condition for revision (REQUEST minor revision). Either remove the line or split into a follow-up commit aligned with Issue #10.2.

**No drive-by reformatting** detected in `bin/aigentry-devkit.js`: the workspace-init dispatch refactor (lines 1475-1488) is necessary to thread the alias through the new module — the surface (--cli, --cwd, --orchestrator-session-id, --no-error-hooks) is preserved and now also accepts the scaffold superset. Spec §9.1 #1 calls workspace-init "Identical behavior (same module)" — strict reading is "identical for the legacy flag set". The new dispatch broadens the surface (e.g., `workspace-init --dry-run` is now valid) which previously was silently ignored. **Low-severity behavior expansion**, defensible per spec §9.1 #1 alias semantics; not a Rule 29 violation per se, but document.

---

## §8 Test Coverage vs Spec Map (9 fixtures → spec sections)

| Fixture file | Spec §10 V6 name | Spec section(s) covered | Assertion strength | Findings |
|---|---|---|:-:|---|
| `fresh.spec.js` (2 cases) | `fresh` | §6.2, §6.3 (no-hooks branch), §6.4 | Strong | Asserts exact line list (deepEqual) + byte-exact AGENTS.md/CLAUDE.md/state files + exact settings.json shape + `.claude/settings.local.json` ABSENT. Second case covers §9.1 #1 alias. |
| `reapply.spec.js` | `reapply` | §10 V2 (idempotency) | Strong | Asserts exact 5-line skip list + mtime preservation (no rewrite). |
| `uninstall.spec.js` | `uninstall` | §6.4 verb `remove`+`backup`+`noop`, §11.2 | Strong | Validates first line is `backup ...bak.<ts>`, then exact 5 follow-up lines; final settings.json = `{}`. |
| `unknown-cli-flag.spec.js` | `unknown-cli-flag` | §8 (exit 2 before any I/O) | Strong | Empty stdout + exact stderr match + empty project dir. |
| `malformed-settings.spec.js` (2 cases) | `malformed-settings` | §8 row "malformed JSON", §6.1 `--no-backup --uninstall` forbidden | Strong | Exit 4 + backup line + AGENTS.md NOT created. Second case exit 2 + exact stderr. |
| `template-override.spec.js` | `template-override` | §6.2 templates source step 1 | Medium | Verifies override applied; doesn't test missing-template-dir → exit 3 path (covered by `index.js:102` but no test). Acceptable. |
| `sentinel-drift.spec.js` | `sentinel-drift` | §6.3 step 2b (managed-block replace) + step 3 (unknown-key preservation) + §6.5 hooks UserPromptSubmit preservation | **Very strong** | Exercises the highest-stakes semantic invariant. Asserts deep-equal on `permissions`, `hooks`, `env`, `mcpServers`, `model`. |
| `non-interactive.spec.js` | `non-interactive` | §10 V9, §8 "non-interactive enforcement" | Medium-strong | 2000ms timeout (stricter than spec's 10s). Doesn't assert NO `readline`/`prompts`/`inquirer` import, but the timeout-based check is the spec's defined verification. |
| `dry-run-no-writes.spec.js` | `dry-run-no-writes` | §6.1 `--dry-run` short-circuit, §6.4 plan emission | Strong | Exact line list + project dir empty + HOME dir empty (catches rogue MCP writes). |

**Tests↔spec consistency**: 9/9 fixtures consistent. 11/11 test cases pass. Assertions match spec text for the 9 named scenarios; no test stretches spec wording.

**Spec sections NOT covered by fixtures** (not required by V6, but documented for completeness):
- §8 row "Disk full mid-write" — ENOSPC handling. Hard to fixture; defensive code paths in `index.js:262,289` exist (return `{actions: completed, exitCode: 4}`).
- §8 row "MCP registration partial failure" — `index.js:226-230` warn-and-continue. Not fixtured.
- §8 row "cwd does not exist & cannot create" → exit 3. `index.js:120-124` raises; no dedicated fixture but `unknown-cli-flag` tests early exit-before-I/O. Acceptable.

These omissions are within V6's nine-fixture mandate; the spec did not require fixtures for every error row.

---

## §9 Cross-LLM Blind Spot Findings

Searched for Codex tendencies per dispatch envelope §8.

### Defensive / future-proofing code (F3 lesson)

**Finding 1 (LOW)** — `lib/scaffold/project/sentinel.js:35-43` `removeMarkdownScaffoldBlock` parses `<!-- BEGIN aigentry scaffold/v1 ... <!-- END aigentry scaffold/v1 -->` markers. However, `generate.js` never *emits* these markers in `.md` files (policy is skip-on-exist, full-file). The parser is dead-by-design today.

- **Defensible**: spec §4.1 table calls for the sentinel module to "Parse / emit ... markers". Parser-half is in scope per spec.
- **Concern**: spec §11.1 R1 says "sha256 in BEGIN comment (where applicable for `.md`)" — sha256 is *not* implemented. The current regex has no integrity check, so any third-party-inserted block matching the regex would be silently removed during uninstall. Low impact (no current emitter), but the sha256 mention in spec is unfulfilled.
- **Recommendation**: mention only — do not delete (Rule 29). Address in OQ-2 (template freshness) when re-application semantics are designed.

### Helper functions added "for clarity" not in spec

**Finding 2 (NIT)** — `index.js:64`: `if (args[i + 1] === "project") i += 1;` swallows an optional positional `project` after `--uninstall`. Spec §6.1 grammar is `[--uninstall]` (boolean only). Implementation accepts both `--uninstall` and `--uninstall project`. Minor scope expansion accepting an undocumented form. No test exercises this path; suggests defensive add-in.

- **Recommendation**: remove the `if (args[i + 1] === "project") i += 1;` line OR document in spec. Low priority.

**Finding 3 (NIT)** — `index.js:67`: alias `--no-error-hooks` for `--no-auto-report-errors`. Same for `--orchestrator-session` aliasing `--orchestrator-session-id`. Spec §6.1 names only the long forms. The aliases preserve compatibility with the legacy `workspace-init.js` argv parsing (visible in the bin diff: pre-refactor accepted `--no-error-hooks` and `--orchestrator-session`). This is *backward-compat* maintenance, not scope creep.

- **Verdict**: acceptable per spec §9 (preserve existing surface for `workspace-init` callers).

### Test assertions vs spec text (F1+F4 lesson)

**Finding 4** — Reviewed all 11 test cases: assertions are exact-match (deepEqual on stdout lines, byte-equal on file content, regex on path patterns). No assertion is weaker than the spec text. The discriminator value `v1` is asserted as exact string `"x-aigentry-scaffold": "v1"` in `fresh.spec.js:44` and `sentinel-drift.spec.js:36` — would catch any drift.

**Finding 5** — Pre-refactor binary fixture is missing (spec §10 V3). The golden test verifies template-rendered output matches `expectedLegacyAgents()` derived from the *current* templates, not a frozen pre-refactor capture. If `templates/workspace/AGENTS.md` were edited in the same commit, this test would silently absorb the change. **Today this is moot** because no template edits accompany the refactor (template files are not in the diff). **Mention only**.

### Test-induced design drift (F2 lesson)

Spot-checked 3 tests vs spec text:
- `fresh.spec.js:42-47` settings.json shape asserts exactly `{permissions: {x-aigentry-scaffold, allow}}` — matches spec §6.3 sentinel layout for the no-hooks branch.
- `uninstall.spec.js:27` asserts `readJson(settingsPath) deepEqual {}` after uninstall. Spec §6.3 says blocks "may co-exist with user-authored keys"; when only managed blocks exist, removal yields `{}`. Test reflects spec.
- `sentinel-drift.spec.js:39-41` asserts `settings.hooks` after merge is `{UserPromptSubmit: [...]}` — `x-aigentry-scaffold` discriminator absent. This is correct: when a managed `hooks` block is fully replaced via drift correction *but* the user has also added `UserPromptSubmit`, `stripOwnedHookKeys` (sentinel.js:26-33) preserves UserPromptSubmit AND drops the discriminator. Examining `mergeHooks` carefully: line 132-137 emits `[DISCRIMINATOR_KEY]: incomingHooks[DISCRIMINATOR_KEY]`. But in this test path, autoReportErrors=false (line 30: `--no-auto-report-errors`), so `buildClaudeSettings` does NOT include `hooks` in `incoming` — `incomingHooks` is `undefined`, and `mergeHooks` enters the early-return at lines 112-122 which calls `stripOwnedHookKeys` and re-emits without the discriminator. **Test is correct; implementation is correct.** Subtle but matches spec §6.3 step 2b for the "incoming = no hooks block" case.

**No test-induced drift detected.**

---

## §10 Conditions (ACCEPT_WITH_CONDITIONS)

Total: **3 conditions, all LOW-severity**.

| # | Severity | Type | File | Condition |
|---|:-:|---|---|---|
| C1 | LOW | Rule 29 (I5) | `package.json:59` | Remove `test:scaffold-install-hooks` npm script — references future Issue #10.2 fixtures not in this commit range. Either delete the line, or move to a #10.2-scoped commit. |
| C2 | LOW (mention only) | F3 (defensive) | `lib/scaffold/project/sentinel.js:35-43` | `removeMarkdownScaffoldBlock` is dead-by-design today (no emitter). Spec §4.1 calls for it as preparation; spec §11.1 R1 mentions sha256 which is not implemented. **Do not delete** (Rule 29). Track in OQ-2. |
| C3 | NIT | Spec wording | `lib/scaffold/project/index.js:64` | Optional positional `project` after `--uninstall` is undocumented; remove the swallow OR add to spec §6.1 grammar. |

C1 is the only condition that warrants a coder fix-up commit. C2 and C3 are mention-only.

---

## §11 Verdict + Push Recommendation

- **Verdict**: **ACCEPT_WITH_CONDITIONS**
- **Spec fidelity**: 4/4 §1 checklist + 4/4 §2 + 3/3 §3 + 4/4 §4 + 5/5 §5 + 3/3 §6 + 5/5 §7 (constitution) = **28/28** binding-checklist items pass.
- **Boundary ADR**: PASS.
- **Per-CLI matrix**: PASS.
- **Hybrid existing-file**: PASS.
- **Settings.json scope**: PASS.
- **Constitutional + Rule 29**: 4/5 (Rule 29 = condition C1).
- **Tests↔spec consistent**: 9/9.
- **Push readiness**: **YES** — conditional on coder addressing C1 (one-line removal in `package.json`). C2/C3 do not block push; track as follow-up.

**Recommended next action** (orchestrator):
1. Dispatch `aigentry-devkit-coder-issue-3` with a focused fix: remove `package.json:59` `test:scaffold-install-hooks` script line. Single-line revert.
2. After fix-up commit, push branch / open PR with this report linked.
3. C2 (sentinel emitter / sha256) — file as OQ-2 follow-up; do not block #3 ship.
4. C3 (`--uninstall project` positional) — file as a one-line cleanup in #3 r2 or `--project` v1 docs revision.

---

*Reviewer signature*: Claude (cross-LLM) — read-only audit, 2026-05-05. No code changes performed (I1 invariant honored).
