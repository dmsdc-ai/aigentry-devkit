# Demo Video Script

Title: `Install aigentry-devkit in one command`

Target length: 2-3 minutes

## Scene 1. Problem

Visual:

- clean terminal
- brief overlay of fragmented AI tooling

Narration:

> Installing AI dev tooling one repo at a time is fragile. Different MCP servers, different CLIs, and incompatible local setup steps slow the whole workflow down.

## Scene 2. One-line install

Visual:

```bash
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install
```

Narration:

> `aigentry-devkit` is the public entrypoint. One command installs the local toolchain and wires the compatible pieces together.

## Scene 3. Profiles

Visual:

```bash
aigentry-devkit profiles
```

Show:

- `core`
- `autoresearch-public`
- `curator-public`
- `ecosystem-full`

Narration:

> You can keep it minimal with `core`, or install experiment and curation flows with profile-based setup.

## Scene 4. Installer phases

Visual:

- telepty health
- deliberation install
- optional brain
- optional dustcraw
- registry wiring

Narration:

> The installer verifies prerequisites, installs local telepty, installs the canonical deliberation MCP runtime, then optionally adds brain, dustcraw, and registry wiring.

## Scene 5. Post-install doctor

Visual:

```bash
aigentry-devkit doctor
```

Narration:

> After install, the doctor command confirms the local MCP and CLI state. If Gemini registration drifts, there is also a dedicated repair command.

## Scene 6. Gemini repair

Visual:

```bash
aigentry-devkit repair-gemini-mcp
```

Narration:

> Recovery stays thin. Devkit does not rewrite deliberation config semantics itself. It simply reruns the canonical deliberation installer and doctor path.

## Scene 7. Experiment runner

Visual:

```bash
wtm experiment init myproj:latency --goal "Reduce p95 latency"
wtm experiment run myproj:latency --eval-cmd "npm test" --decision keep --score 0.82
```

Narration:

> For autoresearch-style workflows, the built-in WTM experiment runner creates a constrained loop with program templates and structured results.

## Scene 8. dustcraw demo

Visual:

```bash
dustcraw demo --non-interactive
```

Narration:

> For curation workflows, `dustcraw` can be bootstrapped by the same installer and demonstrated immediately.

## Scene 9. Close

Visual:

- final split view: telepty, deliberation, experiment runner

Narration:

> One installer. Local-first tooling. Explicit boundaries between transport, judgment, memory, and storage.
