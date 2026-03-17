# Quick Start

`aigentry-devkit` is the public installer and compatibility manager for the local aigentry toolchain.

Use one command, choose a profile, restart your CLI, then run a smoke test.

## Prerequisites

- Node.js 18+
- npm
- Optional but recommended:
  - Claude Code CLI
  - Gemini CLI
  - Codex CLI

Platform notes:

- macOS / Linux: the installer runs through `install.sh`
- Windows: the installer runs through `install.ps1`
- `tmux` is recommended on macOS / Linux for deliberation monitoring

## One-Line Install

Default profile:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install
```

List available profiles first:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit profiles
```

Install a specific profile:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install --profile autoresearch-public
```

Force reinstall:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install --force
```

## Profiles

`core`

- devkit core assets
- telepty
- deliberation

`autoresearch-public`

- `core`
- WTM experiment runner
- registry wiring
- optional brain

`curator-public`

- `core`
- brain
- dustcraw
- registry wiring

`ecosystem-full`

- everything above in one profile

## What The Installer Does

1. Verifies prerequisites
2. Installs devkit assets
3. Installs and health-checks local `telepty`
4. Installs and verifies the canonical `deliberation` MCP runtime
5. Optionally installs `brain`
6. Optionally installs and boots `dustcraw`
7. Optionally wires registry credentials
8. Writes shared local install state and env fan-out

## After Install

Restart your CLI processes so MCP and skill changes are picked up.

Then run:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit doctor
```

Useful local checks:

```bash
telepty --version
curl -sf http://localhost:3848/api/meta
npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-doctor
aigentry-brain health
dustcraw demo --non-interactive
```

## Registry

Cloud / self-hosted registry is optional.

Runtime contract is:

- `AIGENTRY_API_URL`
- `AIGENTRY_API_KEY`

If you skip registry during install, you can add it later and rerun the installer.

## Cross-Machine

Cross-machine setup is per-machine bootstrap.

- devkit installs only the local machine
- remote machines bootstrap their own local `telepty`
- cross-machine coordination happens at runtime through telepty/deliberation surfaces

## Local Clone Path

If you prefer a checked-out repo:

macOS / Linux:

```bash
git clone https://github.com/dmsdc-ai/aigentry-devkit.git
cd aigentry-devkit
bash install.sh
```

Windows:

```powershell
git clone https://github.com/dmsdc-ai/aigentry-devkit.git
cd aigentry-devkit
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Troubleshooting

If install fails:

1. Run `aigentry-devkit doctor`
2. Re-run with `--force`
3. Use `--dry-run` to inspect the resolved profile/manifest plan
4. Restart your CLI after MCP changes
