---
type: review
date: 2026-05-05
reviewer: aigentry-reviewer-boundary-adr-codex
subject: Telepty / Devkit Boundary ADR
subject_commit: 3aa83d3
source_adr: ~/projects/aigentry-orchestrator/docs/adr/2026-05-05-telepty-devkit-boundary.md
origin_triage: ~/projects/aigentry-architect/docs/triage/2026-05-04-telepty-issues-triage.md
verdict: ACCEPT_WITH_CONDITIONS
---

# Telepty / Devkit Boundary ADR Review

## Executive Verdict

**Verdict: ACCEPT_WITH_CONDITIONS.**

The ADR makes the right high-level call: telepty should stay the transport/protocol owner, and devkit should own file mutation, install profiles, templates, and per-AI-CLI adaptation. That aligns with Constitution Article 3 better than the rejected alternatives.

The gap is not the direction. The gap is **contract rigor**. Several "composition contracts" are named as CLI surfaces, but not specified to a level that a telepty implementer and a devkit implementer could independently build without re-litigating behavior. The highest-risk examples are `telepty init --print-snippet`, `[context-ref]` hook integration, and `telepty session start --scaffold`.

Counts:

- Blockers: 0
- Majors: 5
- Minors: 5
- Anti-patterns flagged: 3
- Refactor cost: medium-high
- Boundary precision: edge-case-list

## §1 Boundary Precision Audit

### Mechanism vs content

The ADR states the one-line rule as:

> Telepty owns mechanisms for moving bytes between sessions; devkit owns content that lives on disk and the mechanisms for putting it there.

This is directionally correct, but it is still partly a vibe rule because two accepted exceptions immediately appear:

- Telepty owns some content: telepty command SKILL.md files and the telepty baseline snippet.
- Devkit owns some runtime-ish mechanisms: `bin/open-session.sh`, `aigentry session create`, terminal spawning, and `telepty allow` composition.

Recommended sharper rule:

1. Telepty owns transport/runtime primitives and normative protocol semantics.
2. Telepty may own reference content only when it documents telepty's own CLI/protocol surface.
3. Devkit owns all mutation of user/project files, install profiles, generated templates, and per-AI-CLI integration.
4. Devkit may own session provisioning workflows only when they are multi-component orchestration over telepty primitives, not alternative implementations of telepty primitives.

That wording handles the actual edge cases better than "mechanism vs content" alone.

### Edge case: `bin/open-session.sh`

The ADR classifies `bin/open-session.sh` as devkit and preserves the orchestrator symlink. Evidence confirms the symlink:

- `~/projects/aigentry-orchestrator/bin/open-session.sh -> ~/projects/aigentry-devkit/bin/open-session.sh`

This is acceptable only if the rationale is **session provisioning / orchestrator bootstrap**, not "session lifecycle primitive." The file currently does real runtime work: terminal detection, cmux/aterm/tmux/wezterm/iTerm/ghostty branching, `telepty allow`, daemon fallback spawn, and lifecycle cleanup.

Condition: ADR §3.3/§7 should explicitly define `open-session.sh` as a **devkit-hosted provisioning facade** over telepty primitives, and it should state that any reusable terminal/session primitive discovered there must migrate or be exposed from telepty. Otherwise devkit becomes a second session runtime.

### Edge case: SKILL.md files

The ADR's split is defensible:

- `skills/telepty-*/SKILL.md` stays in telepty as command reference / machine-readable man pages.
- Cross-cutting skills stay in devkit.

The missing precision is distribution. The ADR says devkit may mirror/link telepty skills but cannot be canonical. If mirroring is allowed, there must be a freshness rule: devkit copies must carry source package version or be generated at install time. Otherwise Article 15/SSOT drift is likely.

### Edge case: `skill-installer.js`

The ADR admits `skill-installer.js` is logically devkit but grandfathered in telepty. That is pragmatic because recent telepty 0.3.4 history includes `486bc1e feat(skill-installer): auto-detect installed AI CLIs`, and immediate migration would collide with that work.

Risk: grandfathering a known violation with only a Phase 7+ optional audit invites permanent exception creep.

Condition: mark `skill-installer.js` as a named legacy exception in telepty docs/AGENTS and add a "no new feature expansion except bugfixes" rule. New installer behavior must land in devkit.

### Cross-cutting issue placement clarity

#8 is unambiguous in placement:

- telepty emits snippet text.
- devkit edits files.

#10.2 is unambiguous in intent but ambiguous in contract:

- telepty owns `[context-ref]` protocol.
- devkit owns per-CLI hook installation.
- But "reference parser library (or pure spec)" is not a decision. A library creates a runtime dependency path; a pure spec creates implementation drift risk.

#3 is only partly unambiguous:

- devkit owns files/templates.
- telepty may invoke devkit with `--scaffold`.
- This is bilateral. The ADR must specify failure, timeout, PATH resolution, working directory, and whether telepty waits for scaffold completion before launching the session.

## §2 Composition Contract Verification

### #8: `telepty init --print-snippet` + `aigentry scaffold --integrate-telepty`

Placement is right, but the stdout contract is under-specified.

Missing contract fields:

- Exact output format: raw markdown only, or frontmatter plus body?
- Version marker location: literal `[telepty-snippet/v1]`, comment sentinel, or CLI metadata?
- Target files: `~/CLAUDE.md`, `~/AGENTS.md`, `~/GEMINI.md` all at once or selected by flag?
- Exit codes: missing telepty, unsupported telepty version, snippet generation failure.
- Stderr rules: can telepty print warnings on stderr without breaking devkit?
- Idempotency ownership: devkit owns sentinels, but the sentinel labels must be specified exactly.
- Security/escaping: what if snippet contains user-specific shell commands or paths?

Condition: before implementation, define a small `telepty-snippet/v1` spec with stdout/stderr/exit-code examples and golden tests in both repos.

### #10.2: `aigentry scaffold install-hooks <cli>`

Placement is right: per-CLI hook installation belongs in devkit.

Current live telepty README conflicts with that placement. In telepty 0.3.4, README lines 150-156 say receiver-side install commands proposed in #10 as `telepty install hooks ...` are "tracked as separate follow-up work." That wording preserves the rejected command name and will confuse implementers after ADR acceptance.

Missing contract fields:

- Is telepty providing only a markdown grammar, a JS parser module, or a CLI parser command?
- If a parser library exists, is it part of telepty's public API and semver surface?
- What does a hook receive: raw prompt text, file path, decoded body, or metadata JSON?
- How are protocol versions negotiated when devkit hook version lags telepty protocol version?
- What are CLI-specific boundaries for Claude hooks vs Codex AGENTS.md directives vs Gemini settings?

Condition: update telepty README to say receiver-side installation is devkit-owned, then specify `[context-ref/v1]` as grammar plus conformance fixtures. Do not implement `telepty install hooks`.

### #3: `aigentry scaffold --project` + `telepty session start --scaffold`

This is the highest coupling point because telepty optionally calls devkit.

Contract questions:

- Does `--scaffold` run before terminal launch or inside the launched session?
- Does a non-zero `aigentry scaffold --project` abort launch, warn and continue, or prompt?
- What timeout prevents telepty from hanging on a devkit scaffold bug?
- Is `--project <cwd>` always the current local cwd, or can it be remote cwd for future `--cwd-remote`?
- How are template versions recorded in generated `.claude/settings.json`?
- Does telepty pass AI CLI type to devkit, or does devkit infer it?

Condition: define `--scaffold` as a best-effort preflight with bounded timeout, no prompt, warn-and-continue on devkit failure unless the user passes a future strict flag.

### Existing devkit API reality check

Devkit currently has `aigentry session create`, `session list`, `session kill`, and `session inject`, but no `aigentry scaffold` command in `bin/aigentry-devkit.js`. The proposed devkit side is therefore a new CLI surface, not an extension of an existing stable command.

That is fine, but it increases refactor cost and should be treated as a Phase 3 implementation dependency, not merely "unblocked."

## §3 Refactor Cost

ADR §6.2 "no immediate code migration" is the right compatibility move, but it underestimates the operational cost of living with current artifacts.

Known existing artifacts:

- `skill-installer.js` remains in telepty although logically devkit.
- `bin/open-session.sh` is devkit-hosted and orchestrator-symlinked while also performing runtime terminal/session spawning.
- `aigentry session create` directly invokes kitty/tmux and `telepty allow`; `telepty session start --launch` also generates kitty launch flows.
- Devkit has no scaffold command today.
- Telepty README currently names `telepty install hooks ...` as follow-up, conflicting with the ADR's rejection of that command.

Cost estimate:

- Contract specs and SSOT registration: 0.5-1 day.
- Devkit `aigentry scaffold` surface for #8/#10.2/#3: 2-4 days with tests.
- Telepty `init --print-snippet` and `--scaffold` shim: 0.5-1.5 days.
- `skill-installer.js` migration with shim/deprecation: 1-2 days.
- Session launch boundary audit (`open-session.sh`, `aigentry session create`, `telepty session start --launch`): 2-4 days depending on terminal matrix.

Overall Phase 7+ audit cost: **medium-high**, roughly 4-8 engineering days if done cleanly across both repos and releases.

## §4 Anti-Pattern Detection

### 1. Circular dependency risk

The ADR creates a bidirectional CLI relationship:

- Devkit calls telepty for snippets and session primitives.
- Telepty may call devkit for `--scaffold`.

This is acceptable only because `--scaffold` is opt-in and has a fallback. But it must remain a convenience path, not a required path in telepty tests or normal operation.

Condition: telepty CI and smoke tests must pass on a clean machine without devkit installed.

### 2. Distributed monolith risk

Session launching is already split across telepty and devkit. Devkit's `aigentry session create` directly handles kitty/tmux and invokes `telepty allow`; telepty's `session start --launch` also handles kitty launch mechanics. `open-session.sh` adds a third facade.

Condition: define one canonical layer for reusable terminal launch primitives. My recommendation: telepty owns primitive session wrapping and local launch APIs; devkit owns named ecosystem workflows and config-driven orchestration.

### 3. Coordination overhead

The ADR says the composition contract is "small" at four surfaces, but each surface is cross-repo and version-sensitive. `[context-ref]` alone can become a matrix of telepty protocol version x devkit hook version x AI CLI hook format.

Condition: every accepted contract surface needs a version, conformance fixture, owning repo, consuming repo, and deprecation policy.

## §5 Constitution Adherence

### Article 1: Lightweight

Mixed. The boundary reduces conceptual complexity by preventing telepty from becoming an installer/scaffolder. But it adds new CLI surfaces (`telepty init --print-snippet`, `aigentry scaffold ...`, `telepty session start --scaffold`) and preserves overlapping session launch logic. Complexity is lower only if the contracts are tightened and duplicate launch code is audited.

### Article 3: Role separation

Mostly pass, with one fuzzy area. The telepty/devkit split maps well to "session/machine/OS connection" vs "installation/skills/templates/dev tools." The fuzzy area is devkit-hosted runtime session spawning. The ADR should distinguish provisioning workflow from runtime primitive more explicitly.

### Article 17: Zero external dependency

Pass with conditions. The ADR introduces no external dependency and preserves telepty independence by making devkit invocation opt-in. However, internal cross-repo dependence still needs a strict fallback rule: telepty must never require devkit for core commands, and devkit must fail cleanly if telepty is missing for telepty-specific integration.

### Article 15: SSOT

Concern. The ADR correctly calls SSOT registration mandatory, but until registration happens, the contract is not enforceable. Treat SSOT registration as a pre-implementation gate for #8/#10.2/#3.

## §6 BLOCKERS / MAJORS / MINORS

### Blockers

None. The ADR can be accepted as a boundary decision if the conditions below are attached before implementation begins.

### Majors

1. `telepty init --print-snippet` lacks protocol-grade stdout/stderr/exit-code/version details.
2. #10.2 leaves "parser library or pure spec" undecided; that is a real boundary/dependency decision.
3. `telepty session start --scaffold` creates bidirectional CLI coupling without enough failure/timeout/ordering semantics.
4. Current telepty README still names `telepty install hooks ...` as follow-up, contradicting the ADR's rejection of that subcommand.
5. `open-session.sh`, `aigentry session create`, and `telepty session start --launch` overlap enough to risk duplicate terminal/session runtime logic.

### Minors

1. The phrase "content vs mechanism" should be refined to cover telepty-owned reference content and devkit-owned provisioning mechanisms.
2. Devkit skill mirroring/linking needs a freshness/version rule.
3. `skill-installer.js` should be documented as a legacy exception with no new feature expansion.
4. Verification metric M1 ("next 5 PRs") is too slow for known current conflicts; add immediate doc/API checks.
5. The ADR says Phase 3 is unblocked, but devkit lacks an existing scaffold command, so Phase 3 needs a small CLI-surface spec first.

## §7 Top Conditions For Sub-ADR / Acceptance

1. **Contract spec gate**: before #8/#10.2/#3 implementation, publish SSOT entries and conformance fixtures for `telepty-snippet/v1`, `[context-ref/v1]`, `telepty list --json`, and `--scaffold`.
2. **README conflict cleanup**: patch telepty README to remove `telepty install hooks ...` as a proposed receiver-side command and point to devkit-owned `aigentry scaffold install-hooks <cli>`.
3. **Scaffold behavior spec**: define `aigentry scaffold` command shape, file targets, sentinels, dry-run/backup/uninstall behavior, exit codes, and tests before coding.
4. **Session launch boundary audit**: decide whether `open-session.sh` and `aigentry session create` should keep direct terminal launch logic or delegate more of it to telepty primitives.
5. **Legacy exception policy**: record `skill-installer.js` as grandfathered-only, with migration criteria and a ban on new installer feature expansion in telepty.

## Final Recommendation

Accept the ADR as the boundary direction, but do not treat it as implementation-ready. It is a good placement decision and a partial contract document. The next step should be a small sub-ADR or implementation spec focused only on the four contract surfaces, with fixtures and failure semantics.

