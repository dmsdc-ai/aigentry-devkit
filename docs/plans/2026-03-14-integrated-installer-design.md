# Integrated Installer Design

## Goal

Provide a single public entrypoint:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install
```

That one command should orchestrate:

1. `telepty` install + daemon start
2. `deliberation` MCP runtime install + registration
3. `dustcraw` install + `strategy.md` preset bootstrap
4. optional `brain` install + MCP registration/bootstrap
5. `registry` endpoint + API key wiring

The design must preserve project boundaries:

- `devkit` owns installer UX, compatibility matrix, config collection, and config fan-out
- `telepty` owns transport/daemon behavior
- `deliberation` owns debate state and synthesis semantics
- `brain` owns profile bootstrap and memory semantics
- `registry` owns HTTP API semantics and key issuance
- `dustcraw` owns crawler/runtime/bootstrap semantics

## Packaging Model

### Public Front Door

- Primary public installer: `@dmsdc-ai/aigentry-devkit`
- Primary invocation surface: `npx`
- Secondary surfaces:
  - `install.sh` for macOS/Linux local clone or debugging
  - `install.ps1` for Windows local clone or debugging
  - `brew` later as a convenience wrapper, not canonical

### Component Distribution

- `devkit`: npm package + shell/PowerShell installers
- `telepty`: npm global CLI/service
- `deliberation`: npm package + local MCP runtime install
- `dustcraw`: npm global CLI/service
- `brain`: npm global CLI/MCP bootstrap
- `registry`: SaaS-first, self-hosted Docker Compose secondary

## Installation Profiles

The installer should stop pretending every user needs every subsystem.
Profiles make the one-line installer simpler while keeping advanced paths possible.

### `core`

Installs:

- devkit assets
- telepty
- deliberation MCP

Use case:

- multi-session work
- telepty-routed collaboration
- deliberation without registry/brain/dustcraw

### `autoresearch-public`

Installs:

- `core`
- WTM experiment runner + `program.md` templates
- registry wiring
- optional brain bootstrap

Use case:

- experiment loop / benchmark / evaluation users

### `curator-public`

Installs:

- `core`
- dustcraw
- brain
- registry wiring

Use case:

- signal collection / curation users

### `ecosystem-full`

Installs:

- `core`
- dustcraw
- brain
- registry wiring
- WTM experiment templates

Use case:

- internal/power users

## Required User Decisions

The installer should ask only for decisions that cannot be safely inferred.

### Required

1. install profile
2. registry mode
   - cloud
   - self-hosted
   - skip for now
3. dustcraw strategy preset if dustcraw is selected
4. brain install mode if brain is selected
   - local
   - sync

### Optional

1. dustcraw GitHub token
2. registry base URL override
3. registry API key paste
4. brain remote sync URL

### Must Remain Manual

1. Node.js installation
2. native build prerequisites
   - macOS: Xcode Command Line Tools
   - Linux: build-essential + python3
   - Windows: Visual Studio Build Tools
3. browser/provider login
4. cloud auth approval and secret issuance
5. CLI restart after MCP config changes

## Dependency Graph

### Hard Dependencies

- `devkit` requires:
  - Node.js >= 18
  - npm
- `telepty` requires:
  - Node.js >= 18
  - native build prerequisites
- `deliberation` requires:
  - Node.js >= 18
  - telepty is not required to install deliberation, but is required for the routed multi-session UX
- `brain` requires:
  - Node.js >= 18
- `dustcraw` requires:
  - Node.js >= 18
- `registry` cloud wiring requires:
  - reachable base URL
  - API key or approval flow
- `registry` self-hosted requires:
  - Docker / Docker Compose

### Soft Dependencies

- `dustcraw -> registry`
  - optional; dustcraw core should still run without registry
- `dustcraw -> brain`
  - optional; dustcraw core should still run without brain
- `dustcraw -> telepty`
  - optional; bus emit should degrade gracefully if telepty daemon is unavailable
- `autoresearch / WTM -> registry`
  - optional for local-only experiments
- `autoresearch / WTM -> brain`
  - optional for summary/lesson append

## Execution Order

The installer should run in phases, with explicit checkpoints.

### Phase 0: Preflight

Hard-fail checks:

- Node.js >= 18
- npm available
- writable home/config directories

Warn-only checks:

- Claude/Codex/Gemini CLIs not installed
- tmux missing
- browser automation prerequisites missing

Native dependency checks:

- macOS: `xcode-select -p`
- Linux: presence of `python3`, `make`, compiler
- Windows: basic build tools warning

### Phase 1: Devkit Core Assets

Actions:

- install/copy skills
- install hooks
- install HUD
- install WTM runtime + built-in templates
- install config templates

Failure policy:

- hard fail if file deployment cannot complete

### Phase 2: Telepty

Actions:

- install `@dmsdc-ai/aigentry-telepty` at pinned compatible version
- verify `telepty --version`
- start/ensure daemon
- health-check daemon API
- verify session transport features required by current profile

Success criteria:

- CLI executable available
- daemon reachable

Failure policy:

- hard fail for `core`, `autoresearch-public`, `curator-public`, `ecosystem-full`

Notes:

- `devkit` should call telepty-provided install/start/check surfaces only
- do not reimplement daemon management logic in devkit

### Phase 3: Deliberation

Actions:

- install deliberation runtime to stable local path
- install npm dependencies
- register MCP server for supported targets
- generate or patch deliberation config
- run doctor/health checks

Success criteria:

- runtime exists at expected path
- MCP registration file updated
- health/doctor passes

Failure policy:

- hard fail for all public profiles

Notes:

- `devkit` should orchestrate install and config only
- judgment/synthesis semantics remain in deliberation

### Phase 4: Brain (Optional by Profile)

Actions:

- install `@dmsdc-ai/aigentry-brain`
- bootstrap local profile root
- register supported MCP targets only
- optional sync mode bootstrap
- run health check

Success criteria:

- brain binary available
- profile root initialized
- MCP registration done when requested

Failure policy:

- soft fail for `autoresearch-public`
- hard fail for `curator-public` and `ecosystem-full` if brain was explicitly selected

Notes:

- never present unsupported MCP targets as install options

### Phase 5: Dustcraw (Optional by Profile)

Actions:

- install dustcraw npm package
- initialize config dirs
- copy selected `strategy.md` preset
- initialize state/signal/telemetry dirs
- optional daemon/service registration
- optional GitHub token prompt

Success criteria:

- CLI available
- preset materialized
- config dirs initialized

Failure policy:

- hard fail for `curator-public` and `ecosystem-full`
- skipped for other profiles

Notes:

- core crawling should remain functional even if registry/brain/telepty wiring is unavailable

### Phase 6: Registry Wiring

Actions:

- ask mode:
  - cloud
  - self-hosted
  - skip
- cloud:
  - prompt browser login / key approval flow
  - persist base URL + API key locally
- self-hosted:
  - verify Docker
  - start compose stack
  - wait for `/health`
  - call bootstrap endpoint to issue first tenant/admin key
  - persist base URL + API key locally
- validate with:
  - `/health`
  - one authenticated request

Success criteria:

- base URL stored
- API key stored
- one authenticated registry call succeeds

Failure policy:

- soft fail for `core`
- hard fail for `autoresearch-public`, `curator-public`, `ecosystem-full` unless user explicitly chose skip

Notes:

- `devkit` only owns config collection and storage
- registry remains a versioned HTTP API owned by registry

### Phase 7: Config Fan-Out

Actions:

- telepty config:
  - daemon API URL if needed
- deliberation config:
  - telepty-aware routed usage hints if applicable
- brain config:
  - profile root / remote URL
- dustcraw config:
  - `brainUrl`
  - `registryApiKey`
  - strategy preset
- WTM/experiment config:
  - registry base URL + key for export

Success criteria:

- dependent tools can discover their upstream endpoints/keys without additional prompts

Failure policy:

- partial write rollback for the current component
- never leave half-written JSON if atomic write fails

### Phase 8: Smoke Test + Final Restart Instruction

Actions:

- telepty health
- deliberation MCP registration visible
- brain health if installed
- dustcraw doctor/bootstrap check if installed
- registry `/health` + one authenticated request if configured
- print restart instruction for CLI clients

## Error Handling

The installer should distinguish between:

- hard fail: cannot continue current profile
- soft fail: component skipped, core remains usable
- warn-only: UX degraded but functional

### Hard Fail Conditions

- Node.js / npm missing
- telepty install/start failure in any public profile
- deliberation runtime install/register failure
- selected profile component explicitly requested and failed
- registry chosen as required for current profile and validation failed

### Soft Fail Conditions

- optional brain install failure in `autoresearch-public`
- optional registry skip in `core`
- optional dustcraw GitHub token not provided
- browser automation prerequisites missing

### Rollback Policy

Per component rollback only.

- if a component install fails, revert only its partial files/config mutations
- preserve successful earlier phases
- print resumable recovery command

Examples:

- telepty succeeds, deliberation fails:
  - keep telepty
  - report deliberation failure
  - print `aigentry-devkit install --resume deliberation`
- registry cloud auth fails:
  - leave core installed
  - mark registry wiring incomplete

### Resume Model

The installer should persist state to something like:

`~/.aigentry/install-state.json`

Fields:

- active profile
- completed phases
- skipped phases
- failed phase
- stored answers safe to reuse

## Configuration Storage

Avoid scattering secrets across ad hoc files.

### Recommended Config Locations

- global installer state:
  - `~/.aigentry/install-state.json`
- non-secret component config:
  - component-native config files
- secrets:
  - OS keychain preferred
  - fallback file only with explicit warning and restrictive permissions

### Minimum Shared Config

Installer-owned shared values:

- `registry.base_url`
- `registry.api_key`
- `brain.profile_root`
- `brain.remote_url`
- `telepty.api_url`
- selected install profile

Consumers receive only what they need.

## Version Management

`devkit` should own the compatibility matrix.

### Why

- public users should not manually reason about compatible versions
- telepty, deliberation, brain, dustcraw, and registry clients have different release cadences

### Required Matrix Fields

- minimum/target telepty version
- minimum/target deliberation version
- minimum/target brain version
- minimum/target dustcraw version
- supported registry API contract version
- supported MCP target matrix

### Rules

- pin tested versions by default
- tolerate additive fields from registry HTTP responses
- reject incompatible major/minor combinations early
- print clear upgrade/downgrade instruction when matrix check fails

## Machine-Readable Manifest

The installer should move toward a single manifest consumed by:

- `bin/aigentry-devkit.js`
- `install.sh`
- `install.ps1`

That manifest should define:

- profiles
- components
- required/optional phases
- dependency order
- health checks
- failure policy

This avoids script drift between shell and PowerShell.

## Public Quick Start Shape

Recommended public flow:

1. run one `npx` command
2. choose profile
3. choose registry mode if needed
4. choose dustcraw preset if needed
5. restart CLI
6. run one smoke-test command

Recommended one-line message:

> Install once, choose your profile, approve one registry/login step if needed, restart your CLI, and the aigentry tools wire themselves together.

## Immediate Implementation Follow-Ups

1. introduce machine-readable installer manifest
2. add profile selection to `aigentry-devkit install`
3. extract component installers behind thin wrappers
4. add resumable install state
5. add smoke-test command per profile
