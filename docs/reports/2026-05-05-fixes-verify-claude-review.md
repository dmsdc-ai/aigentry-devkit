# Fix Verify Review (2026-05-05)

Reviewer: Claude (aigentry-reviewer-fixes-claude)
Range: `feedcdf..fb4dc69` (devkit, already pushed to `origin/main` at `fb4dc69`)
Implementer: Codex (aigentry-devkit-coder-fixes — closed)
Cross-LLM rule: post-fact verification (Codex pushed before this review).

## §1 Summary

- **Verdict: ACCEPT**
- Top issue: none blocking. One Rule-29-borderline drive-by (tilde-expansion shell quoting fix in `context-ref.sh`) was required for the new C7 conformance test to pass on stricter bash environments — treated as test-driven correctness, not refactor drift.
- Push readiness reaffirmed: **yes** (no fix-up commits required).

## §2 #3 Conditions Resolution Audit

Source review: `docs/reports/2026-05-05-issue-3-claude-review.md` (commit `291fa4e`).

| # | Severity | Condition | Status | Evidence |
|---|---|---|---|---|
| C1 | LOW | `package.json` `test:scaffold-install-hooks` round-trip (forward-touch from #3) | ✅ | `c174872` removed; `fb4dc69` re-added with proper #10.2 fixture context (4 new `.test.js` files now exist). Net at `fb4dc69`: present + valid. |
| C2 | mention only | `lib/scaffold/project/sentinel.js` dead-by-design parser — Rule 29 keep | ✅ | File still at `lib/scaffold/project/sentinel.js`. `git log feedcdf..fb4dc69 -- lib/scaffold/project/sentinel.js` returns no output → not touched in fix range. |
| C3 | NIT | `lib/scaffold/project/index.js` `--uninstall project` token-swallow — remove | ✅ | `c174872` deletes line `if (args[i + 1] === "project") i += 1;` at the `--uninstall` branch. Verified by `git show c174872`. |

## §3 #10.2 Conditions Resolution Audit

Source review: `docs/reports/2026-05-05-issue-10-2-claude-review.md` (commit `feedcdf`).

| # | Severity | Condition | Status | Evidence |
|---|---|---|---|---|
| C1 | MAJOR | `lib/scaffold/payload-schema.js` exists with Object.freeze + 6 fields | ✅ | File present (`d12b805`). `Object.freeze({...required: Object.freeze([...]), fieldTypes: Object.freeze({...})})`. **Note:** the verify-checklist's listed field names (`ref_id, ref_kind, ref_origin, ref_path, ref_meta, ref_body`) do **not** match spec §6.1 line 477-479. The implementation correctly mirrors the spec authority: `version, ref_path, ref_sha256, ref_body, inline_message, decoded_at`. Spec is the source of truth → C1 PASS. |
| C2 | MEDIUM | `lib/scaffold/scope.js` exists (extracted `resolveScope`); `dispatcher.js` no longer inlines it | ✅ | `3f51c69` adds `lib/scaffold/scope.js:10` `function resolveScope(...)` and `dispatcher.js:1` `const { resolveScope } = require("../scope")`. Inline copy in `dispatcher.js` deleted (-33 lines). |
| C3 | MEDIUM | `idempotent.js` relocated to `lib/scaffold/`; `claude.js`/`codex.js` imports updated | ✅ | `d12b805` rename `lib/scaffold/{install-hooks => }/idempotent.js`. `lib/scaffold/install-hooks/claude.js:10` and `codex.js:8` both read `require("../idempotent")`. No production consumer references the old path (grep `scaffold/install-hooks/idempotent` only hits the historical review doc). Lesson F4 satisfied. |
| C4 | MINOR | Codex sentinel sha256 line removed from `agents-md-block.md` | ✅ | `d18761f` deletes the line; current file (verified) has no `<!-- block sha256: ... -->` marker (4 sentinel comments, none referencing sha256). |
| C5 | MINOR | Header format spec §4.1.3 amended OR impl changed | ✅ | Both sides changed: (a) spec §4.1.3 amendment paragraph at line 206 added in `d18761f`; (b) impl `templates/scaffold/hooks/claude/context-ref.sh:2` carries single-line `# context-ref-installer/v1 sha256={{SCRIPT_SHA256}}`. Amendment + impl align. |
| C6 | MINOR | `jsonNamedKey` production-only OR test-local | ✅ | `d18761f` strips 88 lines from `idempotent.js` (export list at `idempotent.js:269-277` no longer contains `jsonNamedKey`). Spec §5.2 amendment landed at line 447. Tests use a test-local `testJsonNamedKey()` helper (`tests/scaffold-install-hooks/v1/install-hooks.test.js:45,120`). Grep confirms zero `jsonNamedKey` references in `lib/`. |
| C7 | MEDIUM | 4 missing test groups added | ✅ | `fb4dc69` adds: `claude-version-bump.test.js` (version bump replaces older managed script), `codex-corrupted-sentinel.test.js` (refuse-without-force / recover-with-force), `all-mixed-failure.test.js` (`--all` aggregates mixed exit code while continuing later CLIs), `conformance-fail-open.test.js` (absolute + home-relative decode + 5 adversarial fail-open). Each maps directly to spec §9.1 layout (line 672-676) and §3.1.2.2 r3 N4 grammar requirements. Lesson F3 satisfied. |

## §4 Test Verification

Run from devkit repo root, fresh against working tree at `fb4dc69`:

| Suite | Result | Pass / Fail / Skip |
|---|---|---|
| `npm test` (CLI `--help`) | PASS | exit 0 |
| `node --test tests/scaffold-project/v1/*.spec.js` | PASS | 11 / 0 / 0 |
| `node --test tests/scaffold-install-hooks/v1/*.test.js` | PASS | 15 / 0 / 1 |

Total install-hooks subtest evidence:

```
ok 1 - --all aggregates mixed failure exit code while continuing later CLIs
ok 2 - claude version bump replaces a valid older managed script
ok 3 - codex refuses corrupted sentinel without force and recovers with force
ok 4 - claude hook decodes absolute and home-relative conformance inputs
ok 5 - claude hook fails open for five adversarial inputs
ok 6 - idempotency
ok 7..12  - claude-fresh / claude-reapply / claude-uninstall / codex-fresh / codex-reapply / codex-uninstall
ok 13 - gemini-deferred # SKIP (spec §4.3.0 dustcraw research precondition)
ok 14..16 - all-fanout / dry-run / manifest-version
```

Aggregate (non-`npm test` suites): **26/26 pass + 1 skip-by-design**, matching implementer claim.

## §5 Boundary + Rule 29 Compliance

### Boundary (telepty repo)

`git -C ~/projects/aigentry-telepty log --since="2026-05-05 19:00" --until="2026-05-05 20:00" --oneline` → empty. Top of telepty `main` remains `d06e1e9` (review-of-#8 docs). **No telepty mutations during the fix window.** Boundary respect: **PASS**.

### Rule 29 — surgical commits

5 commits, each traces to a named condition:

| Commit | Condition(s) | Files |
|---|---|---|
| `c174872 fix(issue-3): resolve review cleanup conditions` | #3 C1 + C3 | `package.json`, `lib/scaffold/project/index.js` |
| `d12b805 feat(scaffold): add payload schema and relocate idempotent` | #10.2 C1 + C3 (impl side) | `lib/scaffold/payload-schema.js` (new), `lib/scaffold/idempotent.js` (rename), `claude.js`/`codex.js` import update, single-comment annotation in `context-ref.sh:96` cross-linking the schema, install-hooks test require-path update |
| `3f51c69 refactor(scaffold): extract install-hooks scope resolution` | #10.2 C2 | `lib/scaffold/scope.js` (new), `dispatcher.js` (inline removed) |
| `d18761f fix(issue-10): resolve install-hooks minor review conditions` | #10.2 C4 + C5 + C6 (incl. spec amendments) | `agents-md-block.md` (sha256 line removed), `idempotent.js` (-88 jsonNamedKey), `codex.js`, spec §4.1.3 + §5.2 amendments, install-hooks test extension |
| `fb4dc69 test(install-hooks): cover review-required conformance cases` | #10.2 C7 | 4 new `.test.js` files, `helpers.js` (new), `package.json` re-add of `test:scaffold-install-hooks`, `context-ref.sh:81` quoting fix |

**Drive-by note on `fb4dc69` `context-ref.sh:81`** (`${path_token#~/}` → `${path_token#"~/"}`): this is a bash parameter-expansion correctness fix for tilde-stripping. The new `conformance-fail-open.test.js` exercises home-relative path tokens (`[context-ref] Read ~/.telepty/shared/home.md ...`) directly, so the correction is test-required, not aesthetic refactoring. Treated as in-scope for C7.

## §6 Spec Amendment Verification

Both amendments are committed, not merely claimed (Lesson F2):

| Amendment | Location | Commit | Verified |
|---|---|---|---|
| §4.1.3 single-line header `# context-ref-installer/v1 sha256=<hex>` supersedes draft `# script-sha256:` | spec line 206 | `d18761f` | ✅ + impl alignment at `templates/scaffold/hooks/claude/context-ref.sh:2` |
| §5.2 `jsonNamedKey` test-local until production consumer (e.g., future gemini) needs it | spec line 447 | `d18761f` | ✅ + impl alignment (export list no longer contains `jsonNamedKey`; tests use local helper) |

`git diff feedcdf..fb4dc69 -- docs/specs/2026-05-05-issue-10-context-ref-spec.md` shows exactly two `+` blocks, both spec-amendment paragraphs.

Minor documentation quirk (NOT a blocker): the §4.1.3 canonical pseudo-header still includes the original `# script-sha256: <SHA256_OF_THIS_FILE_AFTER_HEADER>` line, while the amendment paragraph immediately below explains it is superseded. The amendment is the binding text per its own wording. Future spec-touch could collapse both into a single canonical block, but that is a §4.1.3 housekeeping issue, not a deviation from the fix scope.

## §7 New Issues Introduced

None blocking. Two observations:

1. **Verify-checklist field-name mismatch (verify envelope authoring issue, not impl issue).** The verify checklist for #10.2 C1 lists schema fields `ref_id, ref_kind, ref_origin, ref_path, ref_meta, ref_body`. These do not match spec §6.1 (line 477-479) which canonicalizes `version, ref_path, ref_sha256, ref_body, inline_message, decoded_at`. The impl correctly follows the spec. The verify envelope itself appears to be the stale party. No fix-up needed in code; suggest correcting the SAWP envelope template before reuse.
2. **§4.1.3 canonical pseudo-header retains superseded `# script-sha256:` line.** The amendment paragraph supersedes it, so behavior is unambiguous for implementers, but a reader-friendly future tidy would remove the stale draft from the canonical block. Out of scope for this fix.

## §8 Verdict + Push Readiness Reaffirmation

- **Final verdict: ACCEPT**
- All 10 conditions resolved (#3: 2 done + 1 SKIP-as-expected; #10.2: 7 done).
- All scaffold tests green at `fb4dc69` (26/26 pass + 1 documented skip).
- Boundary respected (no telepty mutations).
- Both spec amendments landed in `d18761f`.
- Each commit surgically scoped to a condition.
- **No additive fix-up commits required** (push allows additive only since cross-LLM rule was procedurally violated by Codex pre-push, but no substantive issues found that warrant correction).

Cross-LLM procedural note (Lesson F1): Codex pushed before review. This review is post-fact verification. Implementer claims fully reproduced; no rollback/amend needed.
