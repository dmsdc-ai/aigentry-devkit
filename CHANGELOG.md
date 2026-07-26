# Changelog

All notable changes to `@dmsdc-ai/aigentry-devkit` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.1.14 — 2026-07-26

### Removed

- **`clipboard-image`, `youtube-analyzer`, `project-ops` un-bundled (#739
  D1/D4).** They are no longer in the npm tarball and no longer installed by
  `install.sh` / `install.ps1`; the directories stay in git. Each pulled in host
  tooling the devkit does not own (`pbpaste`/`xclip`, `yt-dlp` + Python, an
  authenticated `gh` with org secret scope), which Constitution Article 17
  forbids as an installer-wide dependency. README gains an "Un-bundled skills
  (written fallback)" section with a per-skill fallback and a hand-install
  recipe (`cp -R skills/<name> ~/.claude/skills/`).
- **`aigentry` bin alias dropped to resolve a cross-package bin-name
  collision (public-hygiene sweep).** `aigentry` is owned by the meta package
  `@dmsdc-ai/aigentry`; devkit exposed it as a duplicate alias of
  `aigentry-devkit` (same target script). The `aigentry-devkit` and
  `aigentry-devkit-bootstrap` bins are unaffected. Install `@dmsdc-ai/aigentry`
  for the `aigentry` command.

### Fixed

- **Promoted skills hard-coded `~/projects/aigentry-*` paths (#749).** Six
  shipped skills (`caveman`, `context-manage`, `diagnose`, `grill-with-adr`,
  `session-create`, `work-breakdown`) instructed sessions to read or execute
  files under `~/projects/aigentry-orchestrator` / `~/projects/aigentry`, which
  a public npm user does not have — the instructions dead-ended. Orchestrator
  references now use the `$AIGENTRY_ORCH_DIR` convention already established by
  `install.sh` / `doctor`, project-root discovery uses
  `${AIGENTRY_PROJECTS_ROOT:-$HOME/projects}`, and constitution references point
  at `~/.aigentry/CONSTITUTION.md` (installed by devkit bootstrap). Each
  affected step states what to do when the orchestrator repo is absent
  (Article 17.4 fallback).
- **`install.ps1` never installed `templates/skills/` (#739 D2).** Windows
  installs silently skipped every distributable template skill (e.g.
  `propose-next-task`) that `install.sh` had been installing since it was
  added. Both installers now walk `skills/*` and `templates/skills/*`.
- **Machine-specific absolute paths shipped in the tarball (#739 D3).**
  `templates/skills/propose-next-task/tests/*.md` embedded
  `/Users/<name>/projects/aigentry-orchestrator/state/task-queue.json`; now
  `<ORCH_DIR>/state/task-queue.json`. Same for the `wtm init` usage example.
- **`doctor` used `clipboard-image` as an install marker.** With the skill
  un-bundled that check would have gone red on a healthy install; it now probes
  `env-manager`.

### Added

- **10 cross-cutting skills promoted into the devkit SSOT (#739).** `caveman`,
  `context-manage`, `deliberation-gate`, `deliberation-test`, `diagnose`,
  `grill-with-adr`, `sawe`, `session-create`, `work-breakdown`, and
  `workspace-lifecycle` now ship in the tarball and install through both
  installers. `diagnose` carries the salvaged
  `scripts/hitl-loop.template.sh` (human-in-the-loop repro driver), referenced
  from Phase 1 of the skill.
- **`aigentry-devkit doctor --skills` drift guard (#739).** Compares each
  shipped skill against its installed `~/.claude/skills/` copy (content digest,
  symlink-aware) and reports `ok` / not installed / drift; exits non-zero on
  drift. The shipped set is derived from `package.json` `files[]`, so the
  un-bundled skills need no second list. Logic in `lib/skills-drift.js`, tests
  under `tests/skills-drift/v1/` (`npm run test:skills-drift`).
- **`@aigentry/logger` emit wiring at JS entry points (#440).** New
  CJS→ESM bridge wrapper at `lib/logger-emit.js` (lazy `import()` of
  the ESM `@aigentry/logger` from the CJS devkit). Two emit call sites:
  - `lib/bootstrap.js` `bootstrap()` → `state-change` / `install_phase`
    at start, `state-change` / `install_done` at completion.
  - `bin/aigentry-devkit.js` CLI entry → `state-change` / `module_load`
    after `--help` / dry-help short-circuits, before the command switch.
  Scope per #440 ACK decision **D3**: JS entry points only — `install.sh`
  bash phases are NOT instrumented in this dispatch (deferred to follow-up
  task #444, "logger CLI emit shim", which adds
  `bin/aigentry-logger emit ...` to the logger package).

  A1 mapping (spec event names ride `payload.subtype` on the closed
  ssot `TelemetryEventKind` enum — no ssot bump). Install-flow-centric
  context: when `AIGENTRY_ROLE` is unset the wrapper defaults to
  `'orchestrator'` (devkit is most commonly invoked from orchestrator
  install flows). Honors `AIGENTRY_LOGGER_DISABLED=1` opt-out and
  swallows all transport failures (§9 독립).
- **Wrapper unit tests** at `tests/logger-emit/v1/logger-emit.test.js`
  (7 cases) covering A1 mapping, env discovery, §9 fallback, and the
  AIGENTRY_LOGGER_DISABLED short-circuit. New script
  `npm run test:logger-emit`.
- **Scaffold test isolation.** `tests/scaffold-project/v1/helper.js`
  now exports `AIGENTRY_LOGGER_DISABLED=1` to every spawned devkit
  subprocess so `dry-run-no-writes.spec.js` and similar HOME-write
  assertions stay green (scaffold suite 11/11; install-hooks suite
  15/16 + 1 skip unchanged).
