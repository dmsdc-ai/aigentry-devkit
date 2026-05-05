# Issue #10.2 Claude Review of Codex Implementation (2026-05-05)

**Reviewer**: Claude (cross-LLM rule: Codex impl → Claude review)
**Implementer**: Codex (`aigentry-devkit-coder-issue-10-2`, closed)
**Commit under review**: `7aeb198` — "Implement context-ref install-hooks scaffold" (1,606 LOC, 11 files)
**Spec**: `~/projects/aigentry-devkit/docs/specs/2026-05-05-issue-10-context-ref-spec.md` @ `46b38ee` (FROZEN)
**ADR (binding)**: `2026-05-05-telepty-devkit-boundary` @ `e4b072b`
**SSOT G2**: `~/projects/aigentry-ssot/contracts/context-ref-v1.md` @ `3d31472`
**Constitution**: Articles 1, 3, 9, 15, 17 + Rule 29 외과적 변경 (`d9bf7f5`)
**Tests**: 10 PASS + 1 SKIP (gemini-deferred, expected per §4.3.0) — re-run verified locally (1,728 ms)

---

## §1 Summary

- **Verdict**: **ACCEPT_WITH_CONDITIONS**
- **Top issue**: Spec §14.1 mandates `lib/scaffold/scope.js` and `lib/scaffold/payload-schema.js` (the latter exporting `Object.freeze({CONTEXT_REF_V1_SCHEMA})` per §6.1) as **NEW** sibling modules; both are missing. Scope resolution is inlined into `dispatcher.js#resolveScope`, and the wire-locked schema is materialised only as a literal JS object inside the bash hook's inlined Node block (`templates/scaffold/hooks/claude/context-ref.sh:99–105`). Per Invariant I2 ("Spec FROZEN, match impl to spec literal text"), this is a structural deviation; functionally harmless today (claude is the only consumer; codex is markdown-only; gemini is a stub) but fails the spec-literal test. Recommend either restoring the two modules or filing a spec-amendment patch with explicit rationale.

The implementation is functionally correct, contract-faithful, and surgical. All wire-contract requirements (Q3) are honored end-to-end including runtime re-check + fall-open. Rule 29 is well-followed: only 2 hunks in `bin/aigentry-devkit.js` (~10 lines) plus 1 line in `package.json` outside the new files.

---

## §2 Spec Fidelity (per checklist §1)

| Item | Status | Evidence |
|------|--------|----------|
| CLI surface `aigentry scaffold install-hooks <cli> [--global\|--project] [--dry-run] [--uninstall] [--all] [--force] [--json]` | **PASS** | `dispatcher.js:43-94 parseArgs` accepts all flags from spec §3.1-§3.2; help text emits all flags |
| Stdout `<verb> <path>` per file | **PASS** | `dispatcher.js:165-169 emitHuman`: `${file.action} ${file.path}` |
| Exit codes 0/2/3/4 | **PASS** | 0 success/noop, 2 unknown CLI/flag (`dispatcher.js:198,205`), 3 scope inaccessible (`dispatcher.js:121`), 4 install failure (claude `mapJsonParseError` + script user-modified throw) |
| `--all` fan-out claude→codex→gemini sequential, max exit aggregation | **PASS** | `dispatcher.js:10 orderedAll`, `:215 results.map(executeOne)`, `:217 Math.max(...exitCodes)` — sequential by JS map ordering |
| Help text §3.5 (usage + flags + exit codes + ADR pointer + examples) | **PASS** | `dispatcher.js:12-41 helpText()` covers all 5 elements; verified by `manifest-version` test L262-266 |

**Score**: 5/5

---

## §3 Module Structure (per checklist §2 — Approach 1 layout)

Spec §2.1 + §14.1 layout:

```
lib/scaffold/install-hooks/dispatcher.js   ✓
lib/scaffold/install-hooks/claude.js       ✓
lib/scaffold/install-hooks/codex.js        ✓
lib/scaffold/install-hooks/gemini.js       ✓ (stub)
lib/scaffold/idempotent.js                 ❌  shipped at lib/scaffold/install-hooks/idempotent.js
lib/scaffold/scope.js                      ❌  MISSING (inlined into dispatcher.js#resolveScope L100-125)
lib/scaffold/payload-schema.js             ❌  MISSING (Object.freeze schema absent — §6.1 requires it)
```

**Score**: 4/7 modules present at the spec's path; remaining 3 either relocated (idempotent) or inlined (scope, payload-schema).

**Severity**: payload-schema.js absence is the most material because spec §6.1 explicitly mandates `CONTEXT_REF_V1_SCHEMA = Object.freeze({...})` for runtime tamper-resistance and to prevent hook scripts from "adding or renaming fields" (§16.2 anti-pattern explicitly avoided). The hook payload is constructed as a JS object literal inside `templates/scaffold/hooks/claude/context-ref.sh:99-105`. Codex's commit text claims "Spec deviations: NONE", but §6.1 + §14.1 are unambiguous module mandates.

**Verdict**: FAIL on literal text; PARTIAL on functional intent.

---

## §4 Templates External (per checklist §3)

| Template | Path | Status |
|----------|------|--------|
| claude | `templates/scaffold/hooks/claude/context-ref.sh` | ✓ external (117 lines, loaded via `fs.readFileSync` in `claude.js:58`) |
| codex | `templates/scaffold/hooks/codex/agents-md-block.md` | ✓ external (21 lines, loaded in `codex.js:27`) |
| gemini | `templates/scaffold/hooks/gemini/context-ref.js` | ✓ external (8 lines stub, loaded only via `package.json` fileset) |

`package.json` correctly extends `files[]` with `templates/scaffold/**` (1-line surgical edit).

**Score**: PASS (3/3 templates external; no inline string literals in the per-CLI modules).

---

## §5 Per-CLI Uniform Interface (per checklist §4)

Spec §2.1 mandates each module export `cliName, detect, install, uninstall, verify`:

| Module | cliName | detect | install | uninstall | verify |
|--------|---------|--------|---------|-----------|--------|
| `claude.js:344-350` | ✓ | ✓ L304 | ✓ L164 | ✓ L237 | ✓ L328 |
| `codex.js:171-177` | ✓ | ✓ L79 | ✓ L96 | ✓ L117 | ✓ L158 |
| `gemini.js:49-55` | ✓ | ✓ L28 | ✓ L37 | ✓ L41 | ✓ L45 |

**Score**: PASS — all 4 functions exported on all 3 modules.

**Note**: dispatcher.js consumes only `install`/`uninstall`. `detect`/`verify` are exported but unreferenced from the dispatcher (potential consumers: `aigentry doctor`, future doctor wiring). Acceptable per spec §2.1 + §10 backward-compat ("update-md.js may eventually subsume idempotent.js — out of scope").

---

## §6 3 Idempotency Primitives (per checklist §5)

| Primitive | Spec §5 Required | Impl | Notes |
|-----------|------------------|------|-------|
| `markdownSentinel.{detect,upsert,remove}` | ✓ | `idempotent.js:128-225` | Detects nesting (multi-BEGIN/END = malformed). Atomic write-temp-rename via `atomicWriteFile`. Backup before rename ✓ (§5.4). |
| `jsonNamedKey.{detect,upsert,remove}` | ✓ | `idempotent.js:227-274` | Deep-merge with predicate-based identifier, indent preservation, `JSON.stringify(_, null, parsed.indent)`. |
| `scriptSha256.{detect,write,render}` | ✓ | `idempotent.js:293-342` | Full 64-char hex (`HASH_ZERO = "0".repeat(64)`). User-modified detection + force gate. Mode 0755 for `.sh`, 0644 for `.js`. |

Atomicity (§5.4): `atomicWriteFile` writes to `<file>.tmp.<pid>.<rand>`, fsyncs fd, renames, then fsyncs the dir. ✓

**Score**: PASS (3/3 primitives present, signatures match §5.1-§5.3).

**Caveat — production usage gap (Cross-LLM blind spot)**: `jsonNamedKey` is exported and exercised in the `idempotency` test (L74-80) but **NOT used by `claude.js`**. Claude's settings.json edits go through bespoke `upsertClaudeEntry`/`removeClaudeEntry` functions (`claude.js:79-111`) because the predicate must scan **all** items in `hooks.UserPromptSubmit[]`, not just index 0. The spec §5.2 example uses `keyPath = 'hooks.UserPromptSubmit.0.hooks'` (fixed index 0); spec §4.1.2 says "MUST append, not replace" if other entries exist. There is a real mismatch between the §5.2 keyPath grammar and the §4.1.2 requirement. The bespoke claude logic is correct; the primitive is under-leveraged. Recommend either generalising `jsonNamedKey` to accept a multi-array search predicate, or removing it from prod and keeping it test-only — but as-is it is dead production code (Article 1 — 경량 risk).

---

## §7 Wire Contract Honored (per checklist §6)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Scripts emit `# context-ref-installer/v1 sha256=...` header | **PASS** | `templates/scaffold/hooks/claude/context-ref.sh:2`, `gemini/context-ref.js:2`. Matches dispatch envelope §6 wording. **Note**: spec §4.1.3 describes a different header format (`# script-sha256: <hex>` on a separate line). Impl combines version+sha into one line. Minor literal-text drift; envelope-aligned. |
| Runtime re-check at hook invocation | **PASS** | `context-ref.sh:42-58`: hook reads its own `# min telepty version: ...` line, probes `telepty --version`, semver-compares; on absent/unparseable/older → fall-open with stderr diagnostic. |
| Fall-open on version mismatch (per ADR §3.1.2.4) | **PASS** | `fall_open()` at L11-14; called at L48,52,56 for telepty failures and L72,77,86 for prompt-format failures. `manifest-version` test asserts `pass-through` text. `claude-fresh` test L138-146 verifies downgraded telepty (0.3.0 < 0.4.0) → exit 0 + stderr `older than required 0.4.0; pass-through`. |
| `aigentry_context_ref` includes all 6 ADR §3.1.2.3 fields incl. `ref_body` | **PASS** | Inlined Node block at L98-109: `{ version, ref_path, ref_sha256, ref_body, inline_message, decoded_at }` — all 6 fields, exact names. Test L125-132 asserts sorted-key equality against the literal 6-field set. |

**Score**: 4/4 (1 minor literal-text drift on the header line format vs spec §4.1.3, but envelope-aligned).

---

## §8 Boundary + Constitution + Rule 29 Compliance (per checklist §7+§8)

| Item | Status | Evidence |
|------|--------|----------|
| Devkit owns hook installation (ADR §3.5) | **PASS** | All hook code lives in devkit; no telepty changes in commit 7aeb198 (telepty `git log` confirms last touch is pre-2026-05-04). |
| `[context-ref/v1]` LOCKED — no v2+ logic (ADR §3.1.2.1.1 Option C) | **PASS** | All version literals are `context-ref/v1` (`grep "context-ref/v"` in lib + templates returns only v1). |
| G2 SSOT stub referenced (`3d31472`) | **PASS** | Template comments cite "ADR 2026-05-05-telepty-devkit-boundary section 3.1.2 (commit e4b072b)". G2 contract not directly imported (it has no API surface; it's a documentation artifact). Implicit reference via spec→ADR chain. |
| Telepty NOT modified | **PASS** | `~/projects/aigentry-telepty` `git log --since=2026-05-04` shows zero commits in this window. |
| Article 1 경량 (no premature framework) | **PASS** | Approach 1 chosen; no manifest engine; gemini stub deferred. Total 5 production .js files + 3 templates. |
| Article 3 역할 (per-CLI knowledge isolated) | **PASS** | Each CLI's idempotency primitive selection lives in its own module; dispatcher is router-only. |
| Article 9 독립 (each CLI module standalone) | **PASS** | Tests use `mkdtemp` + telepty shim (`makeTeleptyShim` L16-23); production `$HOME` untouched (M5 metric). |
| Article 15 SSOT (G2 referenced) | **PARTIAL** | Spec links G2 (`3d31472`) but commit doesn't add an explicit pointer in code. Acceptable since G2 is a doc artifact. |
| Article 17 무의존 (no new external deps) | **PASS** | `package.json` diff: only `templates/scaffold/**` glob added, no `dependencies` change. |
| **Rule 29 외과적 변경**: every changed line traces to spec, NO drive-by refactor | **PASS** | bin/aigentry-devkit.js diff is 2 hunks (~10 lines), each adding a route to the new dispatcher. package.json adds 1 line. All other deltas are NEW files. No incidental edits to existing logic. ✓ |

**Score**: 9/10 (Article 15 PARTIAL — symbolic-only G2 reference; not a blocker).

---

## §9 Test Coverage Map (per checklist §9)

| Envelope §9 expected test | Codex test | Status |
|---------------------------|------------|--------|
| claude-fresh | L96-147 | ✓ |
| claude-reapply | L149-161 | ✓ |
| claude-uninstall | L163-179 | ✓ |
| codex-fresh | L181-193 | ✓ |
| codex-reapply | L195-204 | ✓ |
| codex-uninstall | L206-217 | ✓ |
| gemini-deferred | L219 (skip with reason) | ✓ |
| all-fanout | L221-233 | ✓ |
| idempotency (3 primitives unit) | L56-94 | ✓ |
| dry-run | L235-246 | ✓ |
| manifest-version (header + runtime re-check + help text) | L248-267 | ✓ |

**Score**: 11/11 envelope tests present + 10/11 PASS + 1/11 SKIP (expected).

**Spec §9.1 vs delivered (gap analysis)**:

Spec §9.1 calls for ~14 distinct test files in 4 subdirs (`unit/`, `integration/`, `conformance/`, `fixtures/`). Codex shipped one combined file `tests/scaffold-install-hooks/v1/install-hooks.test.js` (267 lines, 11 tests). The dispatch envelope §9 cited the simpler 11-test list and Codex matched the envelope.

Spec-mandated tests **not** delivered:
- `claude-version-bump.test.js` — version bump replace path
- `codex-corrupted-sentinel.test.js` — half-deleted sentinel handling (spec F5 / §4.2.3)
- `dry-run-output.test.js` for codex/all (only claude path tested at L235-246)
- `--all` mixed-failure test (one CLI fails, others succeed; aggregated exit = max)
- `conformance/replay-fixtures.test.js` + 6 fixture cases (path-absolute, path-home-relative, fall-open-malformed-prefix, fall-open-relative-path, fall-open-missing-file, fall-open-wrong-mode)

**Verdict on tests↔spec consistency**: **9/11** (envelope-consistent; spec-incomplete). Recommend adding the 5 missing test groups in a follow-up dispatch (not blocker for #10.2 acceptance, but blocker for spec §12.1 M3/M4 acceptance metrics if those were to be measured against this commit).

---

## §10 Gemini Stub Audit (verify minimal — Invariant I6)

I6: "Gemini portion MUST be MINIMAL stub only (TODO comment + skipped test). Anything more = REQUEST_CHANGES."

`lib/scaffold/install-hooks/gemini.js` (55 lines):
- Exports the **uniform 4-fn interface** required by spec §2.1 + §4 so the dispatcher can route `--all` and individual `gemini` calls without crashing.
- All 4 fns return constant `skipped`/`info` results citing "deferred by spec section 4.3.0".
- No real install logic. No file writes. No template materialization (gemini.js never reads `templates/scaffold/hooks/gemini/context-ref.js`).

`templates/scaffold/hooks/gemini/context-ref.js` (8 lines):
- Pure pass-through: `process.stdin.pipe(process.stdout)` after a stderr breadcrumb.
- Carries the `context-ref-installer/v1 sha256={{SCRIPT_SHA256}}` header (placeholder unsubstituted because gemini.js never installs anything).

`tests/.../install-hooks.test.js:219`:
- `test("gemini-deferred", { skip: "..." }, () => {})` — single skip with reason. ✓

**Verdict**: gemini stub is **minimal-acceptable**, not "TODO + skip" pure-minimal. Justification: the dispatcher's `--all` fan-out and the `all-fanout` test (L231-232) **require** `gemini.install()` to be callable and emit a `skipped` action so the test can assert `skipped .+\.gemini\/settings\.json` in stdout. Pure "TODO + skip" (i.e., no exports) would crash `--all`. The 55-line scaffold is the minimum needed to satisfy the uniform interface.

**Strict reading of I6** would require slimmer code (e.g., a one-liner `module.exports = { ...sharedDeferStub('gemini') }`). I judge this an over-strict interpretation given the §2.1 uniform-interface mandate. Flag as **minor over-implementation** but not REQUEST_CHANGES.

---

## §11 Cross-LLM Blind Spot Findings

Per envelope §10 and lessons F1-F4, scanning for Codex tendencies:

1. **"Tests bend spec wording"** — None found. Tests assert against spec literals (e.g., `decoded.aigentry_context_ref.version === "context-ref/v1"`, all 6 keys exact). The header-format test (`/^# context-ref-installer\/v1 sha256=[0-9a-f]{64}$/`) matches the **envelope** literal but diverges from spec §4.1.3's `# script-sha256:` literal. Flag as test-aligns-to-impl-not-spec, but envelope authority overrides here.

2. **"Helper functions added 'for clarity' not in spec"** — Two cases:
   - `removeEmptyDir(dirPath)` in `claude.js:298-302` — used to clean empty `.claude/` and `.claude/hooks/` after uninstall. Not in spec. Minor.
   - `shellQuote(value)` in `claude.js:45-47` — needed for safe path embedding in `bash '<path>'` command string. Defensible (security: paths with apostrophes).

3. **"Codex defensive coding — unused try/catch, optional flags, future-proofing"** — Spotted:
   - `fsyncDir` (`idempotent.js:20-31`) wraps in try/catch with comment "Some filesystems do not allow fsync on directories". Reasonable cross-FS defense, in line with §5.4 atomicity.
   - `parseJsonError` parses `position N` fragment from JS engine error message (L65-72). Engine-specific (V8 emits this; other engines may not). Marginal portability concern but devkit ships only on Node, so OK.

4. **"gemini.js stub does more than skeleton"** — see §10 above. 55 lines vs ideally ≤20. Justifiable for uniform-interface compatibility.

5. **"Idempotency primitive over-abstraction (Article 1 violation)"** — One concern:
   - `jsonNamedKey` is exported and tested but **not used by `claude.js`** (which has bespoke iteration logic). Either generalise the primitive to handle multi-array predicates, or remove it from prod and keep it test-only. As-is it is unreferenced by production code.

6. **"Implement what spec implies vs literal text"** — Three cases:
   - **Codex sentinel block has an extra `<!-- context-ref-installer/v1 sha256={{BLOCK_SHA256}} -->` line** (`templates/scaffold/hooks/codex/agents-md-block.md:4`) NOT in spec §4.2.2's canonical block. Codex added this for symmetry with the script-side `# context-ref-installer/v1 sha256=` header. Pragmatic but spec-deviating.
   - **Header format `# context-ref-installer/v1 sha256=<hex>` vs spec §4.1.3 `# script-sha256: <hex>`** — combined into one line vs separate. Envelope-aligned, spec-divergent.
   - **`payload-schema.js` module elided** — spec §6.1 is explicit; impl materialises the 6-field shape only inside the bash hook's inlined Node block. Object.freeze tamper-resistance not realised at module level.

7. **Punctuation drift** — em-dashes (—) in spec §4.1.3 + §4.2.2 collapsed to ASCII hyphens (-) in templates ("EDIT —" → "EDIT -"). Cosmetic.

---

## §12 Conditions

For **ACCEPT_WITH_CONDITIONS**, the following must be addressed before push (or recorded as accepted-deltas via spec patch):

| # | Severity | Condition | Spec ref | Suggested resolution |
|---|----------|-----------|----------|----------------------|
| C1 | **MAJOR** | Add `lib/scaffold/payload-schema.js` exporting `Object.freeze({CONTEXT_REF_V1_SCHEMA})` per §6.1 | spec §6.1, §14.1 | Either create the module (preferred — keeps a single source for the 6-field schema) OR file a spec patch acknowledging the inlined schema is sufficient because there's no Node-side runtime importer. |
| C2 | **MEDIUM** | Add `lib/scaffold/scope.js` (extract `resolveScope` from `dispatcher.js`) per §14.1 | spec §14.1 | Move `dispatcher.js:100-125` into `lib/scaffold/scope.js`. Pure refactor; no test changes. |
| C3 | **MEDIUM** | Decide `idempotent.js` location — spec calls for `lib/scaffold/idempotent.js`; impl ships at `lib/scaffold/install-hooks/idempotent.js` | spec §2.1, §14.1 | Move file (and update the 3 importers in claude.js/codex.js/test) OR file a spec patch acknowledging the relocation. |
| C4 | **MINOR** | Codex sentinel block adds `<!-- context-ref-installer/v1 sha256=... -->` line not in spec §4.2.2 | spec §4.2.2 | Document in spec §4.2.2 (suggested — improves symmetry with §4.1.3 header) OR remove the line. |
| C5 | **MINOR** | Header format `# context-ref-installer/v1 sha256=<hex>` vs spec §4.1.3 `# script-sha256: <hex>` separate-line format | spec §4.1.3 | Update spec §4.1.3 to reflect the chosen single-line format (which the dispatch envelope §6 already uses). |
| C6 | **MINOR** | `jsonNamedKey` primitive declared and tested but unused by production claude.js | Article 1 경량 | Either generalise the primitive to accept a multi-array predicate (so `claude.js#upsertClaudeEntry` can use it) OR remove `jsonNamedKey` from production exports and keep test-local. |
| C7 | **MEDIUM** | Spec §9.1 mandated test groups missing: claude-version-bump, codex-corrupted-sentinel, --all mixed-failure, 6 conformance fixtures | spec §9.1, M3/M4 | Follow-up coder dispatch to add these. Not a #10.2 blocker (envelope §9 was satisfied) but spec acceptance metrics M3 (conformance) and M4 (5-input adversarial fail-open) are unmet. |

**Total conditions**: 7 (1 MAJOR, 3 MEDIUM, 3 MINOR).

---

## §13 Verdict + Push Recommendation

### Verdict: **ACCEPT_WITH_CONDITIONS**

The implementation is contract-faithful, surgical, and tests-green. It honors the wire contract end-to-end: 6-field payload, runtime re-check, fall-open mandatory, fall-open everywhere with stderr diagnostics on failure paths, version-locked at v1, telepty repo untouched, devkit-owned per ADR §3.5. Rule 29 외과적 변경 is exemplary — the bin/ + package.json edits are minimal additive routes only.

The **structural deviations** (C1-C3) are real but functionally inert today: no consumer imports `payload-schema.js`, `scope.js`, or the differently-located `idempotent.js`, so the missing/relocated modules don't affect runtime behavior. The **literal-text deviations** (C4-C5) align with the dispatch envelope wording, suggesting they were tacitly accepted at orchestrator level but never propagated back to the spec. The **test gap** (C7) reflects a tension between spec §9.1 (~14 files across 4 subdirs) and envelope §9 (11-test list); Codex matched the envelope.

### Push Readiness

**Push readiness: yes** — for the #10.2 deliverable as scoped by the dispatch envelope. The 11 tests pass, the wire contract is honored, and the boundary ADR is respected. Conditions C1-C7 should be tracked as follow-up but should NOT block #10.2 merge. They're better resolved via:

- a small "spec amendment" PR (resolves C4, C5, possibly C3 by re-routing spec to match impl); and
- a separate "spec §9.1 conformance harness" coder dispatch (resolves C2, C7, and optionally C1 via a clean module extraction).

### Score Summary (for envelope REPORT)

| Field | Value |
|-------|-------|
| spec fidelity | 5/5 §1 + 4/7 §2 + 3/3 §3 + 3/3 §4 + 3/3 §5 + 4/4 §6 = **22/25** (88%) |
| module structure | **FAIL** (literal text — 4/7 modules at spec paths) |
| templates external | **PASS** |
| per-CLI interface | **PASS** |
| 3 primitives | **PASS** |
| wire contract | **PASS** |
| boundary + constitution + Rule 29 | **9/10** (Article 15 PARTIAL on explicit G2 code-side reference) |
| gemini stub minimal | **yes** (functionally minimal; 55 lines for uniform-interface compliance) |
| tests↔spec consistent | **9/11** (envelope-aligned; spec §9.1 missing 5 groups) |
| conditions | **7** (1 MAJOR, 3 MEDIUM, 3 MINOR) |
| push readiness | **yes** |
| commit | **7aeb198** |

---

*End of review — 2026-05-05, Claude reviewer, cross-LLM rule honored.*
