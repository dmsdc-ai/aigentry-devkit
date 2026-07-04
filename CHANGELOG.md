# Changelog

All notable changes to `@dmsdc-ai/aigentry-devkit` are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Removed

- **`aigentry` bin alias dropped to resolve a cross-package bin-name
  collision (public-hygiene sweep).** `aigentry` is owned by the meta package
  `@dmsdc-ai/aigentry`; devkit exposed it as a duplicate alias of
  `aigentry-devkit` (same target script). The `aigentry-devkit` and
  `aigentry-devkit-bootstrap` bins are unaffected. Install `@dmsdc-ai/aigentry`
  for the `aigentry` command.

### Added

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
