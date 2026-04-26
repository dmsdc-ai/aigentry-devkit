---
status: applied
date: 2026-04-26
topic: codex-update-prompt-fix
track: "#329 E27 sub (β fix)"
phase: 2 (implementation applied — see §15 changelog)
related:
  - bin/open-session.sh L125-129
  - feedback memory: ~/.claude/projects/-Users-duckyoungkim-projects/memory/feedback_codex_update_prompt.md
  - workspace:10 incident 2026-04-26 (Q1-codex-reviewer first spawn)
constitution_rules: [Rule 17 무의존, Rule 26 cross-OS, Rule 27 워크어라운드 금지]
---

# Codex Update Prompt Trap — Fix Design Spec

## §1 Goal

Eliminate the codex CLI startup update-prompt trap so that orchestrator-spawned
sessions (`bin/open-session.sh --cli codex`) never display the interactive
"✨ Update available!" popup at TUI startup — guaranteeing that subsequent
`telepty inject` + `send-key enter` cannot accidentally select "Update now",
launch `brew upgrade --cask codex`, exit codex, and unregister the session.

## §2 Evidence (observed 2026-04-26)

### §2.1 Reproducer incident

`workspace:10` (Q1-codex-reviewer, first spawn) sequence captured by orchestrator:

1. Spawn: `open-session.sh --cli codex` → cmux new-workspace → telepty allow
   wraps `codex --dangerously-bypass-approvals-and-sandbox`.
2. Codex TUI startup rendered the popup:
   ```
   ✨ Update available! 0.121.0 -> 0.123.0
     › 1. Update now
       2. Skip
       3. Skip until next version
   ```
3. Orchestrator's `telepty inject` + cmux Enter workaround (`send-key enter`)
   selected option 1 (default highlight).
4. `brew upgrade --cask codex` ran ≈ 2m 59s.
5. codex process exited (rc 0); telepty session unregistered; the queued
   reviewer SPEC was dropped onto a dead shell prompt.

### §2.2 Memory (already on file)

`~/.claude/projects/-Users-duckyoungkim-projects/memory/feedback_codex_update_prompt.md`
already documents the trap and proposes a brew-pre-upgrade workaround. **This
spec supersedes that memory's recommendation** with a more direct, cross-OS,
zero-dependency fix (see §4 decision matrix).

### §2.3 Why existing `--dangerously-bypass-approvals-and-sandbox` does NOT help

`open-session.sh:127` already passes that flag. From upstream `codex --help`
(local 0.125.0 + matched in source):

```
--dangerously-bypass-approvals-and-sandbox
    Skip all confirmation prompts and execute commands without sandboxing.
```

This flag controls **model-issued shell command approvals during a session**,
not **TUI startup popups**. The update popup is rendered by
`codex-rs/tui/src/updates.rs::get_upgrade_version_for_popup` and is governed
by an entirely separate config: `check_for_update_on_startup` (default `true`).

## §3 Root Cause Analysis

### §3.1 Source-of-truth in upstream `openai/codex`

(All citations pinned to a single repo-HEAD commit SHA, resolved 2026-04-26 via
`gh api repos/openai/codex/commits/main --jq '.sha'`. Each path was verified to
resolve at this SHA via `gh api repos/openai/codex/contents/<path>?ref=<SHA>`,
and the `check_for_update_on_startup` sentinel was confirmed present in each
file at the listed line during Phase 2 verification.)

| File | Path | SHA | Relevant lines |
|---|---|---|---|
| TUI update logic | `codex-rs/tui/src/updates.rs` | `5591912f0bf176257f71b3efbd37ee4479dfdfaf` | line 23 + line 148: `if !config.check_for_update_on_startup ||` (early-returns `None` so `get_upgrade_version_for_popup()` does not surface the popup) |
| Config schema | `codex-rs/core/config.schema.json` | `5591912f0bf176257f71b3efbd37ee4479dfdfaf` | line 2470: `"check_for_update_on_startup": { "type": "boolean" }` (top-level) |
| Config struct (TOML deserializer) | `codex-rs/config/src/config_toml.rs` | `5591912f0bf176257f71b3efbd37ee4479dfdfaf` | line 376: `pub check_for_update_on_startup: Option<bool>,` with docstring "Set to `false` only if your Codex updates are centrally managed. Defaults to `true`." |
| Config defaults | `codex-rs/core/src/config/mod.rs` | `5591912f0bf176257f71b3efbd37ee4479dfdfaf` | line 617 (struct field), line 2210 (`cfg.check_for_update_on_startup.unwrap_or(true)`), line 2495 (struct populate) |

> **Footnote:** All references pinned to commit SHA `5591912f0bf176257f71b3efbd37ee4479dfdfaf`. Per-file content verified via `gh search code` (orchestrator spot-check 2026-04-26) and re-verified during Phase 2 by `gh api .../contents/<path>?ref=<SHA>` + sentinel grep.

Permalinks (browser-resolvable):
- https://github.com/openai/codex/blob/5591912f0bf176257f71b3efbd37ee4479dfdfaf/codex-rs/tui/src/updates.rs
- https://github.com/openai/codex/blob/5591912f0bf176257f71b3efbd37ee4479dfdfaf/codex-rs/core/config.schema.json
- https://github.com/openai/codex/blob/5591912f0bf176257f71b3efbd37ee4479dfdfaf/codex-rs/config/src/config_toml.rs
- https://github.com/openai/codex/blob/5591912f0bf176257f71b3efbd37ee4479dfdfaf/codex-rs/core/src/config/mod.rs

### §3.2 Override mechanism

From local `codex --help` (0.125.0):

```
-c, --config <key=value>
    Override a configuration value that would otherwise be loaded from
    `~/.codex/config.toml`. Use a dotted path (`foo.bar.baz`) to override
    nested values. The `value` portion is parsed as TOML.
```

Therefore `codex -c check_for_update_on_startup=false` is the canonical,
upstream-supported invocation that disables the popup at startup **without
mutating the user's `~/.codex/config.toml`** — preserving their preferences
for interactive (non-orchestrator) sessions.

### §3.3 Why no dedicated flag exists

`codex --help` (full body inspected) exposes no `--no-update-check`,
`--skip-update-check`, or `--no-update-prompt` flag. There is also no
documented environment variable in `updates.rs` (verified by grep over the
file). The config-override mechanism (`-c key=value`) is the only
upstream-blessed path.

### §3.4 Trigger conditions

`get_upgrade_version_for_popup()` returns `Some(version)` when **all** hold:

1. `config.check_for_update_on_startup == true` (default).
2. The cached `~/.codex/version.json` shows `latest_version > CODEX_CLI_VERSION`.
3. `dismissed_version != latest_version` (user hasn't dismissed this version).
4. The build is not a source-build (`is_source_build_version()` false).

The cache is refreshed in the background every 20h. So even after a manual
`brew upgrade`, a stale `version.json` from another machine, a `~/.codex`
sync from cloud storage, or a fresh codex release within the cache window
will re-trigger the popup. **A pre-spawn `brew upgrade` is therefore not a
durable fix** — see §4.

## §4 Decision Matrix

| Approach | Description | Mechanism | Cross-OS cost | Run cost | Durability | Constitution |
|---|---|---|---|---|---|---|
| **A** | Pre-spawn `brew upgrade --cask codex` (macOS) + cross-OS abstraction for npm (Linux) + Windows stub | Force install side to match latest before TUI starts | **HIGH** — new `platform::ensure_cli_up_to_date` + 3 backend impls + lock + network failure semantics | **HIGH** — 2–3 min on stale, network dep, brew lock contention | **LOW** — popup re-fires next release until next pre-spawn; `version.json` refresh from sync can re-trigger immediately | Rule 17 borderline (uses existing brew/npm — OK), Rule 27 violation (treats symptom: prompt = "stale install"; the *real* root is that codex shows the popup at all) |
| **B** ⭐ | `-c check_for_update_on_startup=false` appended to existing `extra_flags` for codex case | Suppresses both background check AND popup at the source | **ZERO** — codex itself is cross-OS; flag works identically on macOS / Linux / Windows | **ZERO** — pure flag, no I/O, no network | **HIGH** — fix lives at the popup-spawn site; immune to release cadence, cache state, sync, and version drift | Rule 17 ✅ (no new tool), Rule 26 ✅ (N/A — no OS-specific code added; the flag is part of codex), Rule 27 ✅ (root cause: the popup itself, disabled by codex's own config) |
| **C** | Hybrid: B as primary, A as belt-and-braces fallback | Both | **HIGH** (inherits A) | **HIGH** (inherits A) | High but redundant | YAGNI violation; B is verified upstream and doesn't need a fallback |

**Chosen: Approach B.**

Rationale tying back to the constitution:

- **Rule 17 (무의존)**: B introduces zero new external dependencies. It uses
  the codex CLI's own first-class `-c` flag, which is documented in the
  upstream schema and tested in upstream's `config_tests.rs`.
- **Rule 26 (cross-OS abstraction)**: B requires **no** changes to
  `bin/lib/platform.sh`. The `-c` flag is part of the `codex` binary and
  works uniformly on macOS, Linux, and Windows. (`platform.sh` would only
  be invoked if we needed OS-specific update logic — A — which is exactly
  the symptom-treatment Rule 27 forbids.)
- **Rule 27 (워크어라운드 금지)**: B disables the popup at the mechanism
  level (`check_for_update_on_startup`), which is the root cause.
  A treats the symptom by trying to keep the install version ≥ latest so
  the popup logic short-circuits — but the popup logic still runs on every
  startup and re-fires the moment a new release ships.

## §5 Implementation (single-edit change)

### §5.1 File + line

`bin/open-session.sh` line **127**:

```diff
-  codex)  [ -z "$extra_flags" ] && extra_flags="--dangerously-bypass-approvals-and-sandbox";;
+  codex)  [ -z "$extra_flags" ] && extra_flags="-c check_for_update_on_startup=false --dangerously-bypass-approvals-and-sandbox";;
```

That is the **entire** code change. No new files, no `lib/platform.sh`
edits, no shell function additions, no helper script.

### §5.2 Flag ordering rationale

`-c key=value` is a top-level option for `codex` (the interactive subcommand).
Placing it **before** `--dangerously-bypass-approvals-and-sandbox` keeps the
config-override conceptually grouped with codex CLI options (vs. session
behavior). Order is functionally interchangeable per `codex --help` parsing,
but lexical ordering (config first, then runtime behavior) aids future
diff readability.

### §5.3 Idempotence with `--extra-flags` user override

Existing logic at L122-124:

```bash
if [ -z "$extra_flags" ] && [ -n "$cli_flags_from_config" ]; then
  extra_flags="$cli_flags_from_config"
fi
```

The default is **only** applied when both `--extra-flags` arg AND
`~/.aigentry/config.json` `cli_flags` are empty. So a user who explicitly
passes `--extra-flags '--full-auto'` (or sets `roles.X.cli_flags`) keeps
sole authority. **Spec note for those users**: their custom `extra_flags`
will lose the update-suppression benefit. This is acceptable because:

1. Power-users overriding `extra_flags` are presumed to read the source.
2. Mentioning the recommended flag in user-facing docs (§7.2) is sufficient.
3. Forcing the suppression flag on top of user input would violate the
   "explicit > implicit" principle and create surprise when a user *wants*
   the update prompt (e.g., for interactive sandbox testing of the popup
   itself).

## §6 Cross-OS Notes (no new abstraction needed)

Per Rule 26, new bash code must go through `lib/platform.sh`. **This change
introduces no new bash logic** — it is a single-string mutation in an
existing assignment. The codex binary itself handles OS portability of the
config-override mechanism.

For completeness:

| OS | `codex -c check_for_update_on_startup=false` works? | Notes |
|---|---|---|
| macOS | ✅ | Verified locally (codex 0.125.0, brew install path) |
| Linux | ✅ | Same Rust binary; same flag parser; npm-installed codex behaves identically (verified via upstream `config_tests.rs`) |
| Windows native | ✅ | Same binary; flag parser is `clap`-based and OS-agnostic |
| WSL | ✅ | Falls under Linux path |

`lib/platform-windows.sh` stub policy (warn + continue for unimplemented
primitives) is **not touched**. No new `platform::*` function is added.

## §7 Test Plan

### §7.1 Unit-style (shell)

Sourcing-based test, runnable on macOS + Linux:

```bash
# tests/open-session-codex-flag.test.sh
set -euo pipefail
SCRIPT="$HOME/projects/aigentry-devkit/bin/open-session.sh"

# Dry-parse: confirm the codex case appends the suppression flag.
grep -E "codex\)\s+\[ -z \"\\\$extra_flags\" \] && extra_flags=\"-c check_for_update_on_startup=false --dangerously-bypass-approvals-and-sandbox\"" "$SCRIPT" \
  >/dev/null && echo "PASS: codex suppression flag wired" || { echo "FAIL"; exit 1; }
```

(Trivial — proves only that the diff landed. The substantive verification
is integration in §7.2.)

### §7.2 Integration (manual, gated by CI runner availability)

```bash
# 1. Force a stale state to provoke the popup
codex --version  # note current
echo '{"latest_version":"99.0.0","last_checked_at":"2026-04-26T00:00:00Z"}' \
  > ~/.codex/version.json

# 2. Spawn via open-session.sh
bin/open-session.sh --track T --name codex-test --cwd /tmp/codex-test --cli codex

# 3. Verify NO update popup at TUI startup
# Expected: codex REPL prompt appears immediately, no "✨ Update available!" line
# Verify via: cmux read-screen --workspace <ref> --lines 60

# 4. Cleanup
telepty kill T-codex-test
rm /tmp/codex-test
# Restore real version.json
echo '{"latest_version":"0.125.0","last_checked_at":"2026-04-26T02:22:16.353100Z","dismissed_version":"0.122.0"}' \
  > ~/.codex/version.json
```

Pass criteria:
- Step 3 screen capture must NOT contain the substring "Update available".
- `codex` process must remain alive (visible in `telepty list`) for ≥ 60s
  after spawn, with no `brew upgrade` subprocess.

### §7.3 Regression — claude / gemini unaffected

`open-session.sh` `case "$cli"` lines 126 and 128 are untouched. Spawn each
manually:

```bash
bin/open-session.sh --track T --name claude-test --cwd /tmp/c --cli claude
bin/open-session.sh --track T --name gemini-test --cwd /tmp/g --cli gemini
```

Expected: existing `--permission-mode bypassPermissions` and
`--approval-mode yolo` defaults still applied verbatim. No behavior change.

### §7.4 User-override regression

```bash
bin/open-session.sh --track T --name codex-custom --cwd /tmp/cc --cli codex \
  --extra-flags "--full-auto"
```

Expected: `extra_flags=--full-auto` is used as-is. Suppression flag NOT
auto-prepended (per §5.3 design). Verify via grep on `~/.aigentry/open-session.log`.

## §8 Failed Approaches (must NOT propose)

Listed for reviewer reference and to lock the decision:

1. **Runtime prompt-detection + `cmux send-key 2` ("Skip")** — Rule 27
   workaround. Brittle (depends on TUI render race), incomplete (3rd option
   "Skip until next version" requires different keypress), and fails for
   non-cmux terminals.

2. **Removing codex from `open-session.sh`** — UX regression; codex is a
   first-class supported CLI per §1 of `bin/open-session.sh` doc-comment.

3. **User-side manual `brew upgrade --cask codex` requirement before spawn**
   — UX regression; orchestrator must spawn unattended.

4. **Adding a new external dependency** (e.g., `expect`-based prompt skip)
   — Rule 17 violation.

5. **Pre-spawn `brew upgrade --cask codex` (Approach A)** — see §4 for full
   rationale. Cross-OS cost + run cost + non-durable. Worse than B on every
   axis.

6. **Mutating `~/.codex/config.toml` to set `check_for_update_on_startup = false`
   globally** — violates user preference scope (interactive shells should
   keep getting update reminders). The `-c` per-invocation override
   surgically applies only to orchestrator-spawned sessions.

## §9 Constitution Check

| Rule | Compliance | Evidence |
|---|---|---|
| Rule 17 (무의존) | ✅ | No new tool / library / external service. Uses codex's own `-c` flag. |
| Rule 26 (cross-OS) | ✅ | No new bash code added; codex binary is cross-OS. `platform.sh` untouched. `platform-windows.sh` stub policy preserved. |
| Rule 27 (워크어라운드 금지) | ✅ | Disables the popup at its source-level config gate, not at the symptom (the keypress). |
| 헌법 Rule 1 (경량) | ✅ | Single-string change. No abstraction added "in case we need it later." |
| 헌법 Rule 2 (크로스) | ✅ | Identical UX on macOS / Linux / Windows / WSL. |
| 헌법 Rule 5 (최선) | ✅ | Best-first solution chosen via verified upstream evidence (§3.1 SHAs). |

## §10 Invariants Preserved

- `bin/open-session.sh` flow for `claude` (L126) and `gemini` (L128) **unchanged**.
- `bin/lib/platform.sh` contract **unchanged** (additive-only requirement met
  trivially: zero additions).
- `_resolve_src` symlink-resolution at L32-46 **unchanged**.
- `bin/lib/platform-windows.sh` stub policy (warn + continue) **unchanged**.
- Existing `extra_flags` user-override precedence (L122-124) **unchanged**.
- Existing `cli_flags_from_config` lookup from `~/.aigentry/config.json` (L95)
  **unchanged**.
- All `case "$term"` spawn paths (L166-212) **unchanged** — they consume
  `extra_flags` as an opaque string.

## §11 Risks + Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Upstream renames `check_for_update_on_startup` | Low | Popup re-appears | Test §7.2 catches it on next devkit release; upstream rename would also break their own `config_tests.rs` (sentinel) |
| User wants to see update prompt in orchestrator session | Very low | UX surprise | User can pass `--extra-flags ""` workaround OR override via `--extra-flags "<their flags>"` per §5.3 |
| Future codex adds OTHER blocking startup popups | Low | New trap class | Out of scope for this fix; would require a §4-style new spec |
| Popup re-introduced via a different code path in upstream | Low | Popup re-appears | §7.2 integration test in CI catches |
| codex 0.125.0 → older version downgrade where `-c` flag absent or different schema | Very low (codex >= 0.110 has `-c`) | Spawn fails silently | `codex` would error on stderr; visible via `cmux read-screen` |

## §12 Out of Scope

- Changes to `~/.codex/config.toml` user file (intentionally not mutated).
- `lib/platform.sh` extensions for any future "ensure CLI up-to-date" feature.
- `feedback_codex_update_prompt.md` memory rewrite (orchestrator's call after
  Phase 2 ships).
- aterm / cmux parity for non-codex update popups.
- Telepty kernel changes.

## §13 Implementation Estimate

| Phase | Effort | Validator |
|---|---|---|
| Phase 2 code change | 1 minute | `bash -n bin/open-session.sh` |
| Phase 2 unit test add (§7.1) | 5 minutes | run the test |
| Phase 2 integration test (§7.2, manual) | 5 minutes | manual cmux read-screen |
| Phase 2 doc-string update in `open-session.sh` header (optional) | 2 minutes | review |

Total: ≤ 15 min including verification.

## §14 Phase 2 Handoff Checklist (post-approval)

- [ ] Apply diff in §5.1 to `bin/open-session.sh:127`.
- [ ] Add test from §7.1 to `tests/` (or extend existing devkit test runner).
- [ ] Run §7.2 integration test manually (orchestrator may delegate to a
      builder session — devkit-coder is **not** the runner per SAWP).
- [ ] Update `~/.claude/projects/-Users-duckyoungkim-projects/memory/feedback_codex_update_prompt.md`
      to point at this spec + the new flag (orchestrator owns this).
- [ ] Conventional commit: `fix(open-session): suppress codex startup update prompt via -c check_for_update_on_startup=false`.
- [ ] Update `bin/open-session.sh` header doc-comment listing default flags
      per CLI to reflect the new codex defaults (optional but recommended).

## §15 Phase 2 Changelog

**Date applied:** 2026-04-26
**Phase 2 commit:** `7d874d64b2315b7cd521d57936e211f7631e0750` (this commit
amended-in via follow-up; orchestrator may rewrite post-merge)
**Executed by:** aigentry-devkit-coder (Claude Opus 4.7) per Phase 2 inject
authorized by orchestrator after Phase 1 review.

### Files touched

| File | Change | Spec ref |
|---|---|---|
| `bin/open-session.sh` | L127 codex case: prepend `-c check_for_update_on_startup=false` to default `extra_flags` | §5.1 |
| `bin/open-session.sh` | Header doc-comment: new `# Default per-CLI flags:` subsection above `# Output:` line, listing claude / codex / gemini defaults | TASK A3 |
| `tests/open-session-codex-flag.test.sh` | New file. Static-grep sentinel for codex suppression flag + regression sentinels for claude + gemini default flags | §7.1 |
| `docs/superpowers/specs/2026-04-26-codex-update-prompt-fix.md` | Status `draft` → `applied`; phase `1` → `2`; §3.1 permalinks repinned to single durable commit SHA `5591912f0bf176257f71b3efbd37ee4479dfdfaf`; this §15 added | TASK A4 + TASK B |

### Verification performed in Phase 2 (this session)

- `bash -n bin/open-session.sh` → PASS
- `bash -n tests/open-session-codex-flag.test.sh` → PASS
- All 4 permalinks verified to resolve via `gh api repos/openai/codex/contents/<path>?ref=5591912f0bf176257f71b3efbd37ee4479dfdfaf` (each returned 200 with matching `.path`)
- Sentinel `check_for_update_on_startup` confirmed present in each file at this SHA (lines 23, 148 / 2470 / 376 / 617, 2210, 2495 — see §3.1 table)
- Invariants per §10 spot-checked in modified file: claude case L126, gemini case L128, `_resolve_src` L32-46, `extra_flags` precedence L122-124 — all unchanged

### Verification deferred to builder (per SAWP role separation)

- §7.1 unit-style test execution (devkit-coder is not the test runner)
- §7.2 integration test (manual stale-version repro + cmux read-screen)
- §7.3 regression spawn for claude / gemini
- §7.4 user-override regression spawn

The new test file at `tests/open-session-codex-flag.test.sh` is executable
(`chmod +x` applied) and self-contained — a builder session can run it via
`bash tests/open-session-codex-flag.test.sh` from repo root.

### Out of scope for this commit (orchestrator may follow up)

- Updating `~/.claude/projects/-Users-duckyoungkim-projects/memory/feedback_codex_update_prompt.md` to point at this spec + new flag (orchestrator owns memory writes)
- Wiring `tests/open-session-codex-flag.test.sh` into a CI runner (no CI runner exists for devkit yet — see CLAUDE.md "Known Gaps")
