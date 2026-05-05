# Boundary ADR r3 Codex Review (2026-05-05)

## §1 Summary
- Verdict: ACCEPT_WITH_CONDITIONS
- Top issue: r3 resolves the main N1 contradiction, but N2/N3 are not fully clean: one stale 4-surface count remains and `telepty-list-json/v1` has a field-contract ambiguity.

## §2 N1 Option C Resolution Audit
- (a) Verbatim r2 §5 N1 answered? yes. §3.1.2.1.1 says "Phase 3 may refine ONLY non-wire-contract implementation details" and says Phase 3 specs that change the locked subset "require a `[context-ref/v2]` ADR"; it also says Option C matches the r2 fix: "Phase 3 cannot mutate the locked subset."
- (b) Option A/B rejection rationales hold? yes. Option A is correctly rejected for forcing hook UX, error text, and log formats into this ADR; Option B is correctly rejected because draft status would undermine the stable composition contract and §6.5 SSOT registration.
- (c) OQ-1 removed? yes for the old OQ. `rg` still finds historical quotes and the new renumbered OQ-1, but the active old question ("Should `[context-ref]` protocol versioning ship... or be deferred to Phase 3?") is gone as a live open question.
- (d) §11.3 rewritten consistently? yes. §11.3 now says the version matrix is governed by §3.1.2.1.1 and "is no longer 'deferred'; it is governed."

## §3 Each of 4 r2 New Issues — RESOLVED check
- N1: ✅ Resolved. `[context-ref/v1]` wire-contract binding is now explicit in §3.1.2.1.1, v2+ is reserved for successor ADR work, and active OQ deferral language is removed.
- N2: ⚠️ Partially resolved. §3.6, §4.4, and §11.1 now use the 6-surface / 3-stable + 3-new split, but §5 Q2 still says: "§3.6 composition contract enforces thin-wrapper only (4 contract surfaces)." That is the exact stale-count class N2 was meant to remove.
- N3: ⚠️ Mostly resolved, with one protocol-grade cleanup needed. §3.6.1 adds an envelope, field names/types, four fixture paths, and an SSOT path. However, the session-object example includes `"version": "telepty-list-json/v1"` while the field semantics table defines only top-level `version`, not `sessions[].version`; the stated "envelope + 11 fields" contract is therefore ambiguous. The four fixture paths also do not currently exist in `~/projects/aigentry-telepty`; r3 makes them Phase 3/M6 deliverables, but §3.6.1 should state that explicitly as TBD-with-owner or create the files.
- N4: ✅ Resolved. §3.1.2.2 adopts `path-token = absolute-path / home-relative-path`, defines `~/` expansion by receivers, and requires absolute plus home-relative fixtures.

## §4 §6.5.1 G1-G9 Gate Testability
| Gate | artifact path? | POSIX cmd? | pass criterion? | independently runnable? |
|---|---|---|---|---|
| G1 | yes | yes | yes | yes |
| G2 | yes | yes | yes | yes |
| G3 | yes | yes | yes | yes |
| G4 | yes | yes | yes | yes |
| G5 | yes | yes | yes | yes |
| G6 | yes | yes | yes | yes |
| G7 | yes | yes | yes | yes |
| G8 | yes | yes | yes | yes |
| G9 | yes | yes | yes | yes |

- M0 audit script: composes G1-G9 correctly? yes. The script checks all six SSOT stubs plus README cleanup, AGENTS legacy exception, and `skill-installer.js` header.
- M0 measurable? yes. The pass condition is unambiguous: all commands exit 0 and print `M0 ALL GATES PASS`.
- Current artifact state: expected pre-acceptance gaps remain. The report evaluates gate testability, not live M0 success; G1-G9 are designed to fail until acceptance follow-up artifacts land.

## §5 Prior Fixes Re-Verification
- C4 WAIVED-OK: still defensible? yes. r3 does not alter session-launch ownership and §6.6 still has T1-T4 triggers plus deliverables.
- Major-5 DEFERRED: still acceptable? yes. Folding the launch-boundary audit into r3 would violate the locked review scope; §6.6 remains the right container.
- AP2 WAIVED: still defensible? yes. r3 adds protocol/gate detail only; it does not create new reusable terminal launch primitives or change §6.6 trigger boundaries.
- Article 15 SSOT: §3.6.1 path satisfies? yes for the SSOT path and G5 gate. The fixture-path caveat in §3 is separate: §3.6.1 should mark absent fixture files as telepty-owned Phase 3 TBD or create them.

## §6 New Issues Introduced BY r3 (if any)
- R3-1: `telepty-list-json/v1` schema ambiguity. The new §3.6.1 session-object example includes a `version` field, but the field semantics table only defines top-level `version`; implementers cannot tell whether `sessions[].version` is required, optional, or accidental.

## §7 Conditions for ACCEPT (if ACCEPT_WITH_CONDITIONS)
1. Fix the remaining N2 stale count. Current §5 Q2 quote: "§3.6 composition contract enforces thin-wrapper only (4 contract surfaces)." Replace with "6 contract surfaces" and, ideally, the same "3 stable + 3 newly specified" wording used in §3.6/§4.4.
2. Make `telepty-list-json/v1` field semantics exact. Current §3.6.1 schema example includes `"version": "telepty-list-json/v1"` inside each session object, while the field table only defines `version` as the envelope wire tag. Either remove session-level `version` from the session-object example or add `sessions[].version` to the field table with type/required semantics; also restate the exact 11-field count.
3. Satisfy the fixture-path requirement for §3.6.1. Current fixture quote: `~/projects/aigentry-telepty/tests/list-json/v1/golden-empty.json` plus three sibling files. Since those files are absent today, either create stubs now or add explicit wording that they are "TBD Phase 3, owner: aigentry-telepty, merge-blocked by M6."

## §8 Verdict + Recommendation
- Final verdict: ACCEPT_WITH_CONDITIONS.
- Next action recommendation: targeted r4 text patch only. No boundary-direction re-review is needed after the three conditions are patched; N1/N4 and the prior waiver/deferral decisions are defensible.
