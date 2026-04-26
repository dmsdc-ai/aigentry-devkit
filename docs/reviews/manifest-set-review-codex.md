---
status: REVIEW (verdict: ACCEPT)
date: 2026-04-26
reviewer: aigentry-devkit-manifest-reviewer-codex (formerly Q1-codex-reviewer reused)
target: bin/lib/preuse_substitute_compact/manifests/ + _fixtures/
authoring_session: aigentry-devkit-manifest-author (claude)
authority: work-spec 2026-04-26-phase4c-v3-implementation-work-spec.md §5.3 step 2
---

# Phase 4c V3 Manifest Set Review

## Per-manifest verdict table

| # | Manifest | Schema | Coverage | Ban List | Length Caps | ASCII Labels | No Duplicates / Gaps |
|---:|---|---|---|---|---|---|---|
| 1 | `01-lf-only.json` | PASS | PASS | PASS | PASS | PASS | PASS |
| 2 | `02-crlf.json` | PASS | PASS | PASS | PASS | PASS | PASS |
| 3 | `03-multibyte-unicode.json` | PASS | PASS | PASS | PASS | PASS | PASS |
| 4 | `04-empty-assistant.json` | PASS | PASS | PASS | PASS | PASS | PASS |
| 5 | `05-overcap-single-line.json` | PASS | PASS | PASS | PASS | PASS | PASS |
| 6 | `06-multi-prior-turns.json` | PASS | PASS | PASS | PASS | PASS | PASS |
| 7 | `07-missing-prior-assistant.json` | PASS | PASS | PASS | PASS | PASS | PASS |
| 8 | `08-c1-cut-smallest.json` | PASS | PASS | PASS | PASS | PASS | PASS |
| 9 | `09-c4-cut-largest.json` | PASS | PASS | PASS | PASS | PASS | PASS |
| 10 | `10-segment-reset.json` | PASS | PASS | PASS | PASS | PASS | PASS |

Schema check: all 10 manifests have the exact 12 ADR §4.6.3 top-level fields and every prior turn has the exact 5 required fields with the expected scalar/container types.

Length-cap check: all fixtures are under their field caps except `m05/setup_history.md`, which is intentionally over the 16,384-byte setup cap and exercises UTF-8 boundary-safe truncation. Existing fixture files decode as UTF-8 strict.

Ban-list and label check: fixture scan found zero occurrences of reserved output labels (`SUBSTITUTE-COMPACT-V1`, `METADATA`, `SETUP_HISTORY_EXCERPT`, `PRIOR_TURN`, `PRIOR_USER_PROMPT_EXCERPT`, `PRIOR_ASSISTANT_OUTPUT_EXCERPT`, `CURRENT_TASK_PROMPT`) and zero hits for timestamp, absolute-path, session-id, or CLI-version patterns.

## System-level checks

| Check | Verdict | Evidence |
|---|---|---|
| Synthetic source (§5.1) | PASS | Fixture prose is hand-authored synthetic test content; no obvious Phase 3 runner/report signatures, timestamps, session IDs, host/user names, or CLI-version strings were present. |
| Manifest-relative paths (§4.6.10 item 3) | PASS | All `setup_history_path`, `current_task_prompt_path`, `task_prompt_path`, and `stage1_output_path` values are relative `_fixtures/...` paths. No path value starts with `/`. |
| Duplicates / gaps (§4.6.11) | PASS | Exactly 10 manifests and 29 fixture files are present. Criteria 1-10 map one-to-one to manifest numbers 01-10; no criterion is missing or duplicated. |

Path evidence examples:

```json
"current_task_prompt_path": "_fixtures/m08/task_prompt.md",
"setup_history_path": "_fixtures/m09/setup_history.md",
"stage1_output_path": "_fixtures/m07/stage1_output.txt"
```

The m07 `stage1_output_path` is manifest-relative and intentionally absent from disk, matching ADR §4.6.11 row 7.

## Open question disposition

| Question | Disposition | Rationale |
|---|---|---|
| m06 reuses one `task_prompt.md` and one `stage1_output.txt` across 4 prior turns | KEEP | ADR §4.6.11 row 6 only requires multiple prior turns (>=4) and ADR §4.6.4 requires numeric sort by `position_in_chain`. The manifest forces sorting with array order `[3,1,4,2]`; the required `PRIOR_TURN position=<n> fixture=<id> seed=<n>` header still differentiates turns even when the excerpt text is reused. Distinct text would improve human diagnostics, but it is not a conformance requirement. |
| m10 uses C2 cut (50,000) for segment reset | KEEP | ADR §4.6.11 row 10 constrains `segment_start_position > 1` and `compact_before_position > segment_start_position`; it does not constrain `cut_id`. C1 and C4 are already uniquely covered by m08 and m09, so C2 does not create a duplicate/gap. |

## Overall verdict

ACCEPT.

The manifest set conforms to ADR §4.6 and work-spec §5.2/§5.3 for freeze. No blockers, reject conditions, or required edits were found.

## Sentinel evidence

### Evidence 1: m02 CRLF bytes

`m02/setup_history.md` contains CRLF (`0d 0a`) line endings:

```text
00000020: 72 65 20 6d 30 32 2e 0d 0a 54 68 69 73 20 6d 61  re m02...This ma
00000050: 61 74 69 6f 6e 2e 0d 0a 41 6c 6c 20 74 68 72 65  ation...All thre
```

All three m02 fixtures contain CR bytes:

```text
setup_history.md  3
stage1_output.txt 3
task_prompt.md    2
```

### Evidence 2: m03 multi-byte UTF-8 bytes

`m03/setup_history.md` begins with Korean and Chinese UTF-8 multi-byte sequences:

```text
00000000: ed 94 84 eb a1 9c ec a0 9d ed 8a b8 20 ea b0 9c  ............ ...
00000040: b8 ad e6 96 87 e6 ae b5 e8 90 bd ef bc 9a e7 94  ................
```

`m03/stage1_output.txt` also contains multi-byte prior-assistant output:

```text
00000000: ec 8b a4 ed 96 89 20 ec 9a 94 ec 95 bd 3a 20 ec  ...... ......: .
00000030: b8 ad e6 96 87 e8 be 93 e5 87 ba ef bc 9a e8 be  ................
```

### Evidence 3: m05 over-cap UTF-8 boundary

`m05/setup_history.md` is 16,486 bytes, single-line, and has zero CR/LF bytes. Around the 16,384-byte cap, the UTF-8 sequence for a 3-byte character straddles the boundary:

```text
00003ff0: 41 41 41 41 41 41 41 41 41 41 41 41 41 41 41 ed  AAAAAAAAAAAAAAA.
00004000: 95 9c 41 41 41 41 41 41 41 41 41 41 41 41 41 41  ..AAAAAAAAAAAAAA
```

The cap at `0x4000` would include only byte `ed` of the three-byte sequence (`ed 95 9c`), so a conforming implementation must back off to the prior valid UTF-8 boundary.

### Evidence 4: m06 sort forcing

`06-multi-prior-turns.json` supplies prior turns out of order and therefore exercises numeric sorting:

```text
[3,1,4,2]
[1,2,3,4]
```

### Evidence 5: m10 segment reset

`10-segment-reset.json` satisfies the reset predicate and keeps prior turns within the active segment:

```text
segment_start_position=3
compact_before_position=5
current_position=5
prior positions=[3,4]
```
