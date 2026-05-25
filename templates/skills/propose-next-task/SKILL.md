---
name: propose-next-task
description: Use when an aigentry orchestrator hits an idle/blocked/awaiting turn and must pick the next task from cwd's state/task-queue.json. Triggers — "next task", "다음 태스크", "유휴턴".
---

# propose-next-task

Idle-turn task selector for aigentry orchestrators. Implements workflow §4. **Re-read `AGENTS.md` §4 in cwd this turn** — §4 is the source of truth; this skill is just the algorithm.

## Skip when

- **The current session itself** has a delegated task in flight. The orchestrator is the dispatcher, not a worker — never skip just because subordinate sessions are delegated.
- Cwd has no `./state/task-queue.json`.
- User named a specific task — just do it.

## Input

`./state/task-queue.json` from cwd — no hardcoded paths. Object with `.tasks`. Per task: `id`, `desc`, `priority`, `status`; optional `note`, `tags`, `track`, `blocks`, `updated_at`.

## Algorithm

1. **Scan WHOLE pending pool.** Never silently truncate. Output line: `scanned N pending / M total`.
2. **In-progress set** = `status` ∈ {`in_progress`, `delegated`, `blocked`, `blocked-by-observation`}.
3. For each pending candidate (default P0+P1; `--all-priorities` adds P2):
   - **`conflict_score`** — `+3` if same file/repo/module appears in `desc`/`note`/`track`; `+1` on `tags` intersect (fallback when tags absent: shared `desc` keyword ≥ 4 chars); else `+0`.
   - **`leverage_score`** = `(.blocks | length)`.
   - **`staleness`** — token: `unstamped` (no `updated_at`), `stale:<N>d` (stamped and > 30 days), or `fresh`.
4. **Sort**: priority (P0 > P1 > P2) → `conflict_score` ASC → `leverage_score` DESC → `id` ASC.
5. **Semantic re-check on top 6 of the priority+id-sorted list BEFORE conflict filtering** (so conflict-bound candidates are re-scored too): read `desc`+`note`; bump `conflict_score` by `+1` for subsystem overlap the heuristic missed (e.g. "both touch auth").

## Output — emit BOTH sections, always

### Recommended — `conflict_score < 3`, top 3

| id | priority | desc (≤120 chars) | isolation_rationale | conflict_score | leverage_score | staleness |

### Conflict-coordinate — `conflict_score ≥ 3`, top 3 across ALL priority tiers

Same columns + `action`. **Surface, do not demote.** Pad with next-highest-conflict candidates regardless of priority until 3 rows or the conflict pool is exhausted. A higher-priority candidate is never silently dropped because it conflicts.

`action` is exactly one of (orchestrator decides):

- `defer-until-#NNN-done`
- `coordinate-with-session-X-on-#NNN`
- `block-#NNN-instead` (only when this candidate outranks the in-progress task)

## Flags

- `--json` — machine-readable
- `--include-deferred` — adds `status=="deferred"`
- `--all-priorities` — adds P2

## Red flags — STOP, fix, restart

- Omitted "Conflict-coordinate" section while a conflict pool exists → you demoted silently; re-emit.
- Conflict-coordinate has < 3 rows while the conflict pool ≥ 3 → you under-padded; refill across all priority tiers.
- < 6 rows total but pending > 50 → you truncated; rescan.
- "Recommended" row has `conflict_score ≥ 3` → sort bug.
- Conflict-coordinate row was not semantic-re-checked → step 5 says BEFORE filtering; redo.
- Skipped because subordinate sessions are delegated → misread; only the orchestrator's OWN delegation triggers skip.
- Did not re-read `AGENTS.md` §4 in cwd this turn → §4 has project-specific criteria (session-affinity, track cohesion) you missed.
- `tags` exist but you used keyword overlap → use `tags` first.
- Missing `scanned N pending / M total` line → add it.
