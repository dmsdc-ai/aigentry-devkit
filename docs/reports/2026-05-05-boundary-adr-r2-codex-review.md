---
type: review
date: 2026-05-05
reviewer: aigentry-reviewer-boundary-r2-codex
subject: Telepty / Devkit Boundary ADR r2
subject_commit: 9384540edea18d3e87648c538fda2dfa740a8781
source_adr: ~/projects/aigentry-orchestrator/docs/adr/2026-05-05-telepty-devkit-boundary.md
prior_review: ~/projects/aigentry-devkit/docs/reports/2026-05-05-boundary-adr-codex-review.md
verdict: ACCEPT_WITH_CONDITIONS
---

# Boundary ADR r2 Codex Re-review

## Executive Verdict

**Verdict: ACCEPT_WITH_CONDITIONS.**

r2 is a material improvement over r1. The previously vague composition contracts are now mostly protocol-grade: `telepty-snippet/v1`, `[context-ref/v1]`, `scaffold/v1`, and `scaffold-shim/v1` define producers, consumers, stdout/stderr behavior, exit codes, versioning, idempotency, failure modes, and conformance fixtures.

The remaining issue is not the boundary direction. It is internal consistency: r2 defines `[context-ref/v1]` as a binding contract in §3.1.2 / §6.5, but still leaves OQ-1 saying context-ref versioning may be deferred to Phase 3. That undercuts the main r2 purpose and must be cleaned before Phase 3 dispatch.

Counts:

- Prior 5 conditions: **4 INTEGRATED, 1 WAIVED-OK, 0 MISSING, 0 SUPERFICIAL**.
- Prior 5 majors: **4 RESOLVED, 1 DEFERRED-ACCEPTABLE**.
- Prior 3 anti-patterns: **2 ADDRESSED, 1 WAIVED-RATIONALE-DEFENSIBLE**.
- Article 15 SSOT BLOCKER: **correctly framed**, but current `~/projects/aigentry-ssot/contracts/` has no visible stubs for the six r2 surfaces yet; §6.5 must block Phase 3 dispatch until they exist.
- New r2 issues: **4**; none require rejection, one requires text cleanup before status flip / sub-dispatch.
- Phase 2/3 readiness: **conditionally yes**. #8 / #10.2 / #3 are cleanly mappable to r2 sections, but dispatch should wait for the conditions in §7.

## §1 Condition Resolution Audit

### C1 — Contract spec gate

Prior condition:

> "Contract spec gate: before #8/#10.2/#3 implementation, publish SSOT entries and conformance fixtures for `telepty-snippet/v1`, `[context-ref/v1]`, `telepty list --json`, and `--scaffold`."

r2 locations:

> §3.1.1: "defines the stdout/stderr/exit-code/version contract for `telepty init --print-snippet`"

> §3.1.2: "Telepty publishes a normative grammar ... as the sole authoritative protocol artifact"

> §3.3.1: "defines the bilateral contract between `telepty session start --scaffold` ... and `aigentry scaffold --project <cwd>`"

> §6.5: "SSOT registration is a BLOCKER for Phase 3 dispatches"

Verdict: **INTEGRATED**.

Protocol-grade check:

- Snippet protocol: PASS. stdin is explicitly ignored; stdout markdown and NDJSON formats are defined; stderr is warning-only; exit codes 0/2/3/4 are defined; versioning and idempotency are defined.
- Context-ref protocol: PASS with cleanup needed in §5. Grammar, storage, receiver contract, hook payload schema, hook failure behavior, uninstall, and version handshake are present.
- Scaffold protocol: PASS. Opt-in flag, unilateral preflight, argv-only channel, before-launch ordering, timeout, non-zero behavior, no prompt, exit codes, and fixtures are specified.
- Gate nuance: r2 allows stub SSOT registration before dispatch and fixtures during Phase 3 PRs. That is acceptable if M6 remains merge-blocking.

### C2 — README conflict cleanup

Prior condition:

> "README conflict cleanup: patch telepty README to remove `telepty install hooks ...` as a proposed receiver-side command and point to devkit-owned `aigentry scaffold install-hooks <cli>`."

r2 location:

> §3.1.2.5: "Per-agent receiver integrations are out of scope for telepty core. Per-CLI hook installation lives in devkit. Run `aigentry scaffold install-hooks {claude|codex|gemini}`..."

Verdict: **INTEGRATED as ADR requirement**.

Current implementation note: live `~/projects/aigentry-telepty/README.md` still contains the old `telepty install hooks ...` follow-up language. r2's M0 gate catches this; Phase 3 must not dispatch before the doc-only cleanup lands.

### C3 — Scaffold behavior spec

Prior condition:

> "Scaffold behavior spec: define `aigentry scaffold` command shape, file targets, sentinels, dry-run/backup/uninstall behavior, exit codes, and tests before coding."

r2 locations:

> §3.3.1.4: "`aigentry scaffold --project <cwd>` ... `--integrate-telepty` ... `install-hooks <cli>` ... `--uninstall`"

> §3.3.1.6: "Telepty: `tests/scaffold-shim/v1/...`; Devkit: `tests/scaffold-project/v1/...`"

Verdict: **INTEGRATED**.

The spec covers the required CLI surface, dry-run/backup/uninstall, machine-parseable stdout, uniform exit codes, and test fixture paths. File targets for snippet and hooks are specified in §3.1.1.3 and §3.1.2.4.

### C4 — Session launch boundary audit

Prior condition:

> "Session launch boundary audit: decide whether `open-session.sh` and `aigentry session create` should keep direct terminal launch logic or delegate more of it to telepty primitives."

r2 locations:

> §6.6: "DEFERRED out of scope per r2 hard rule 'NO new boundary changes'"

> §6.6.2: "T4: 90 days post-r2 acceptance with no T1-T3 trigger"

Verdict: **WAIVED-OK**.

This is not fully integrated despite the r2 summary language. The ADR does not decide the launch boundary; it scopes and time-boxes a successor audit. That is acceptable for r2 because the unresolved overlap does not block the #8 / #10.2 / #3 protocol split, and §6.6 has real triggers, a 90-day forced audit, and concrete deliverables.

### C5 — Legacy exception policy

Prior condition:

> "Legacy exception policy: record `skill-installer.js` as grandfathered-only, with migration criteria and a ban on new installer feature expansion in telepty."

r2 location:

> §6.2.1: "`skill-installer.js` ... is the single named legacy exception... No new feature expansion..."

Verdict: **INTEGRATED**.

The policy is strong enough: no new feature expansion, required telepty AGENTS documentation, required top-of-file legacy comment, migration triggers, and migration path. As with C2, current telepty files are not patched yet; that is correctly captured by M0.

## §2 Major Resolution

1. Prior major: "`telepty init --print-snippet` lacks protocol-grade stdout/stderr/exit-code/version details."
   Resolution: **RESOLVED** by §3.1.1.

2. Prior major: "#10.2 leaves 'parser library or pure spec' undecided; that is a real boundary/dependency decision."
   Resolution: **RESOLVED** by §3.1.2.1 choosing pure spec plus telepty-internal reference parser only. See §5 issue N1 for stale contradictory text.

3. Prior major: "`telepty session start --scaffold` creates bidirectional CLI coupling without enough failure/timeout/ordering semantics."
   Resolution: **RESOLVED** by §3.3.1.1-§3.3.1.5.

4. Prior major: "Current telepty README still names `telepty install hooks ...` as follow-up, contradicting the ADR's rejection of that subcommand."
   Resolution: **RESOLVED in ADR / pending implementation gate** by §3.1.2.5 and M0. The live README is still stale today, so this must remain a tracked acceptance-side task.

5. Prior major: "`open-session.sh`, `aigentry session create`, and `telepty session start --launch` overlap enough to risk duplicate terminal/session runtime logic."
   Resolution: **DEFERRED-ACCEPTABLE**. §6.6 scope lock is sufficient for r2; forcing it into r3 would expand r2 from protocol-fidelity review into a new boundary decision.

## §3 Anti-patterns

### AP1 — Circular dependency risk

Status: **ADDRESSED**.

§3.3.1.5 explicitly says telepty CI must pass without devkit, core tests must not invoke `aigentry scaffold` outside the opt-in `--scaffold` path, and no-flag `telepty session start` remains the canonical primitive. M3 verifies this.

### AP2 — Distributed monolith risk

Status: **WAIVED-RATIONALE-DEFENSIBLE**.

§6.6 is a real escape hatch, not just kicking the can. It names the four artifacts to audit, gives dispatch triggers, includes a 90-day forced trigger, and requires a successor ADR plus migration plan. The risk remains, but it is not introduced by r2 and should not block the three Phase 3 protocol dispatches.

### AP3 — Coordination overhead

Status: **MOSTLY ADDRESSED**.

§3.6 adds ownership, consumers, fixture paths, and deprecation policy. §8 M2/M6 adds stability and fixture coverage checks. Residual: `telepty list --json` still has fixture path "(existing)" rather than a concrete schema/fixture reference, so the accountability table should be tightened before Phase 3 dispatch.

## §4 Article 15 SSOT BLOCKER Elevation

r2 correctly frames Article 15 as a **BLOCKER**:

> §5 Q8: "must be registered in `aigentry-ssot` ... before any cross-repo consumer ... implements against them"

> §6.5: "Orchestrator MUST verify each surface registered before dispatching..."

This satisfies the r1 concern. The correct operational interpretation is:

- #8 must be blocked until `telepty-snippet/v1` and the relevant scaffold consumer contract are SSOT-registered.
- #10.2 must be blocked until `[context-ref/v1]` and hook payload/schema contracts are SSOT-registered.
- #3 must be blocked until `scaffold/v1` and `scaffold-shim/v1` are SSOT-registered.
- `telepty list --json` must get a formal schema entry if devkit/orchestrator continue to depend on it.

Current repository evidence: `~/projects/aigentry-ssot/contracts/` does not yet show entries for these six surfaces. That is fine before acceptance, but not fine before Phase 3 sub-dispatch.

## §5 New Issues Introduced by r2

### N1 — BLOCKING CONDITION: `[context-ref/v1]` is both binding and deferred

§3.1.2 defines `[context-ref/v1]` as a normative grammar and §6.5 makes it an SSOT blocker. But §9 OQ-1 asks whether `[context-ref]` versioning should ship with this ADR or be deferred to Phase 3, and §11.3 says the versioning matrix is "deferred to OQ-1 / Phase 3 #10.2 spec."

This is a direct contradiction. Fix by deleting OQ-1 or rewriting it to say Phase 3 may refine implementation details but cannot change the r2 `context-ref/v1` wire contract without an ADR amendment.

### N2 — Stale "4 surfaces" language conflicts with §3.6

§3.6 says six surfaces. §4.4, §11.1, and §11.1's surrounding bullets still say "4 surfaces" / "four contract surfaces" and even "all already CLI-stable." That is stale r1 text: `aigentry scaffold` and `scaffold-shim/v1` are new surfaces, not already stable.

This is editorial but contract-relevant; update all occurrences to six surfaces and distinguish existing stable surfaces from newly specified ones.

### N3 — `telepty list --json` accountability is not yet protocol-grade

Prior C1 named `telepty list --json`. r2 registers it as a surface, but §3.6 lists its conformance fixtures as "(existing)" and does not point to a schema. If it is a Phase 3 blocking surface, it needs a concrete SSOT schema path or an explicit statement that it is outside #8/#10.2/#3 dispatch scope.

### N4 — `[context-ref/v1]` path grammar should align with actual prompts

§3.1.2.2 says `abs-path = absolute filesystem path; "~" expansion is the receiver's responsibility`. Current telepty prompts, including this review dispatch, use `~/.telepty/shared/<sha>.md`. Clarify the grammar as `path-token = absolute-path / "~/" home-relative-path` so conformance fixtures do not reject the current production form.

## §6 Phase 2/3 Readiness

#8 `telepty init`: **mappable**.

- Telepty producer: §3.1.1.1-§3.1.1.2.
- Devkit consumer: §3.1.1.3.
- Tests/SSOT: §3.1.1.4 and §6.5.

#10.2 context-ref hooks: **mappable after N1 cleanup**.

- Protocol decision: §3.1.2.1.
- Grammar / receiver contract: §3.1.2.2.
- Hook payload and installer: §3.1.2.3-§3.1.2.4.
- README cleanup gate: §3.1.2.5 / M0.

#3 project scaffold: **mappable**.

- Telepty opt-in shim: §3.3.1.1-§3.3.1.3.
- Devkit CLI shape: §3.3.1.4.
- Telepty no-hard-dependency rules: §3.3.1.5.
- Tests/SSOT: §3.3.1.6 and §6.5.

Readiness call: **not immediate dispatch-ready until §6.5/M0 are satisfied and N1 is fixed**. After those are done, the three sub-dispatches are cleanly referenceable and do not need another broad boundary ADR.

## §7 Final Verdict

**ACCEPT_WITH_CONDITIONS.**

Conditions:

1. Before status flip or Phase 3 dispatch, resolve the `[context-ref/v1]` contradiction by removing/reframing OQ-1 and §11.3 deferral language.
2. Before Phase 3 dispatch, complete §6.5/M0 gates: SSOT stubs for all six surfaces; telepty README cleanup; telepty AGENTS legacy exception; `skill-installer.js` legacy header.
3. Before Phase 3 dispatch, tighten §3.6 for `telepty list --json` with a concrete schema/fixture reference or explicitly remove it from the #8/#10.2/#3 blocking set.
4. Before conformance fixtures freeze, clarify `[context-ref/v1]` path grammar to accept both absolute and `~/` forms.

These are residuals, not grounds for rejection. The direction remains correct and the protocol fidelity is now high enough to proceed once the cleanup gates are handled.

## §8 Top Issue

`[context-ref/v1]` cannot be both a binding r2 protocol and an open question deferred to Phase 3.
