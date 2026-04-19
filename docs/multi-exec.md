# multi-exec — Plan-driven Orchestration Runner

Spec: `aigentry-orchestrator/docs/superpowers/specs/2026-04-19-multi-exec-automation-design.md`
Phase: 1 MVP (review loop deferred to Phase 2)

Drives a plan file from frontmatter to finish: parses the `multi_exec:` block, injects a full SAWP envelope per task into the coder session via `telepty`, waits for a `REPORT:` ref, enforces chunk gates, and emits an event log. No review loop, no fix loop — that is Phase 2 and later.

## Usage

```bash
~/projects/aigentry-devkit/bin/multi-exec.sh <plan-file> [--strict] [--auto-trust] [--dry-run]
```

| Flag | Effect |
|------|--------|
| `--strict` | Exit 3 if the plan has no `multi_exec:` frontmatter (default: no-op exit 0). |
| `--auto-trust` | Record that first inject should also run `trust-path.sh`. Advisory in Phase 1. |
| `--dry-run` | Print the dispatch order (chunk/task/line/coder_session/chunk_gates) and exit 0. No inject. |

## Plan file frontmatter

```yaml
---
multi_exec:
  enabled: true
  coder_session: E22-coder-294
  reviewer: subagent        # logged only in Phase 1
  max_fix_iterations: 5     # logged only in Phase 1
  chunk_gates:
    - after_chunk: 1
      type: user_approval   # or auto_approved
---
```

Only `coder_session` is required. Missing → exit 6.

## Phase 1 behaviour

1. Parse frontmatter (awk state machine + jq normalisation, pure bash/jq — Rule 17 무의존).
2. Acquire per-plan lockfile (`<plan>.multi-exec.lock`, flock preferred; atomic `mkdir` + PID-liveness fallback).
3. Acquire orchestrator-wide pid mutex (`$HOME/.wtm/contexts/orchestrator/multi-exec.pid`) so the orchestrator's own manual inject log stays silent.
4. For each `### Task N:` heading in the plan:
   - Emit `dispatch` event.
   - `telepty inject --ref <(echo "<SAWP+instructions>") --from aigentry-orchestrator <coder_session>` then `telepty enter`.
   - Block on `$HOME/.telepty/shared/*.md` (event-driven `fswatch -1`, fallback `sleep 5`) until a new ref parses as this task's `REPORT:`.
   - Emit `impl_done` + `review_skipped` events.
5. At each chunk boundary run the `chunk_gates[after_chunk == n]` gate:
   - `auto_approved` — emit `chunk_complete`, continue.
   - `user_approval` — block until a ref matches `^[[:space:]]*\[CHUNK n APPROVED\]` **and** does not start with `REPORT:`. Scans both already-present refs and newly created ones.
6. Emit `runner_end` and release lock + pid mutex via `EXIT` trap.

Timeouts surface as `stuck` events followed by the corresponding exit code.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MULTI_EXEC_TIMEOUT` | `600` | Seconds to wait for a task `REPORT:` ref before exit 7. |
| `MULTI_EXEC_GATE_TIMEOUT` | `3600` | Seconds to wait for a `[CHUNK N APPROVED]` ref before exit 8. |

## REPORT grammar

Strict (recommended):

```
REPORT: Task <N> complete
files: <comma-separated>
tests: <pass>/<total>
commits: <sha>
issues: <text or "none">
next: <Task N+1 | AWAIT <gate>>
```

Legacy one-liner (still parsed):

```
REPORT: Task 4 complete | files: a,b | tests: 14/14 | commits: 3325b5b | issues: none | next: Task 5
```

`parse_report` emits `{task, files, tests, commit, issues, next}` JSON.

## Exit codes

| Code | Meaning |
|:----:|---------|
| 0 | Success |
| 1 | Usage shown (missing plan arg or `-h`) |
| 2 | Unknown flag |
| 3 | `--strict` and `multi_exec:` frontmatter missing |
| 4 | pid mutex rejected (another runner holds it) |
| 5 | Per-plan lockfile rejected |
| 6 | `coder_session` missing from frontmatter |
| 7 | Task REPORT timeout |
| 8 | Chunk gate timeout |

## Event log

Events flow through `wtm-context log orchestrator exec-event <event> <meta-json>`, so they land in `~/.wtm/contexts/orchestrator/journal.jsonl`. Event types:

- `runner_start`, `runner_end`
- `dispatch`, `impl_done`, `review_skipped`, `stuck`
- `chunk_gate_waiting`, `chunk_approved`, `chunk_complete`

Missing `wtm-context` degrades silently — events are dropped, the runner still proceeds.

## Reserved resources

- File descriptor **9** is reserved for the `flock` lockfile. Scripts that `source` `multi-exec-lib.sh` must not reuse fd 9.
- `$HOME/.wtm/contexts/orchestrator/multi-exec.pid` holds the pid mutex.
- `$HOME/.telepty/shared/*.md` is the ref inbox — both REPORTs and chunk approvals route through here.

## Out of scope (Phase 2+)

- Automatic reviewer dispatch / fix loop.
- Parallel coder sessions.
- Metrics aggregator CLI.
