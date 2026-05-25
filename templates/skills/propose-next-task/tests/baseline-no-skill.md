---
phase: RED
date: 2026-05-25
scenario: orchestrator idle turn — propose next task without any helper skill (only AGENTS.md §4)
subagent_type: general-purpose
input_file: /Users/duckyoungkim/projects/aigentry-orchestrator/state/task-queue.json
input_state_snapshot:
  total_tasks: 429
  pending: 188
  in_progress: 1   # #52 aterm npm publish (5-platform)
  delegated: 2     # #20 dustcraw MD research, #28 aterm 5-platform research
  blocked: 2       # #182 RTM, #161 split pane
  blocked_by_observation: 1  # #455 Phase 5b npm publish bundle
---

# RED Baseline — propose-next-task WITHOUT the skill

## Pressure scenario sent to subagent

Identical prompt to Phase 2 (must be re-runnable for GREEN comparison):

> You are an aigentry orchestrator at an idle turn. AGENTS.md §4 says "유휴턴 시 다음 태스크 추천 from state/task-queue.json." No helper skill installed. Produce top-3 candidates + conflict analysis vs in_progress/delegated/blocked. Be honest about shortcuts.

## Subagent response (verbatim recommendation table)

| id | priority | rationale (subagent's own words) |
|----|----------|----------------------------------|
| 313 | P0 | "Critical safety fix, no `blocked_by`, ecosystem-wide — security/eval injection risk; quick, isolated patch." |
| 315 | P0 | "Critical, unblocked, narrow scope (2 hook scripts). Hook failures silently break every Claude session — high blast-radius, low effort." |
| 446 | P0 | "Critical, unblocked, single helper script. Codex sessions are currently dying silently." |

## Documented failure modes / rationalizations (VERBATIM)

These are the gaps the skill MUST close in GREEN phase.

### F1. Truncation of candidate pool — silent
> "I did not scan all 188 pending. I filtered to P0+P1 (~60 tasks) and only fully read P0 desc text. P2/no-priority pending were ignored entirely — a P2 with strong 'unblocks 5 others' leverage would be missed."

**Failure**: orchestrator silently drops candidates without surfacing the truncation, hiding leverage opportunities.

### F2. Crude ranking heuristic — `desc-length` as isolation proxy
> "Ranking heuristic was crude: priority (P0 first) → `blocked_by` empty → desc-length short proxy for 'small/isolated'. I did not compute `blocks` graph reach, so I may have skipped P1s that unblock many downstream tasks."

**Failure**: ignores the `blocks` graph (downstream unblock count) — high-leverage upstream tasks under-ranked.

### F3. Conflict check = string match only
> "Conflict check was keyword-only, not file-path-aware. I did not open any source files or check git blame for who-last-touched. 'No conflict' means 'no obvious string overlap' — a hidden shared subsystem could still clash."

**Failure**: misses semantic conflicts (same subsystem, different keywords). Heuristic produces false negatives.

### F4. AGENTS.md §4 never actually re-read
> "Did not consult AGENTS.md §4 itself — the prompt summarized the rule and I trusted it; I never read the actual file to verify the §4 selection algorithm has more criteria (e.g., session-affinity, track-cohesion) I should have weighted."

**Failure**: workflow §4 spec drift — agent works from a summary, not source.

### F5. Conservative conflict resolution without explicit policy
> "P0 #353/#354 (aterm IME, aterm supply-chain) were demoted because #52 (in_progress) is the aterm npm publish — same repo, near-certain merge conflict. That call is conservative; orchestrator could argue #353 should block #52 instead."

**Failure**: agent makes unilateral demotion calls instead of surfacing the conflict + recommended action (block / coordinate / parallel-with-care) to the orchestrator.

### F6. Adjacency penalty applied inconsistently
> "#446 — Mild adjacency to delegated dustcraw sessions (#20/#28) since they may spawn via telepty, but no file overlap; #450/#460 (pending telepty version-mismatch P1s) overlap the same telepty surface — coordinate or batch with #446 to avoid double-edit churn."

**Failure**: "mild adjacency" noted in prose but NOT reflected in the score; #446 still appears in top-3 without penalty. Heuristic and output are decoupled.

### F7. Staleness not checked
> "No verification of staleness — some 'pending' P1s date from early May (#363 dogfood-2026-05-06); I didn't check if they're silently obsolete."

**Failure**: pending list treated as fresh; no `updated_at` recency filter or "is this still relevant" sanity check.

## Pattern summary (one line for REPORT)

Without a skill, the orchestrator silently truncates candidate pool to P0+P1, ranks by crude heuristics (priority + empty `blocked_by` + desc-length proxy), runs keyword-only conflict checks decoupled from final scoring, and unilaterally demotes conflicting P0s without surfacing the trade-off — producing recommendations that look defensible but hide truncation, leverage-blindness, false-negative conflicts, and stale candidates.

## What the GREEN skill must enforce

1. **Whole-pool scan** (or explicit "scanned N of M; truncation policy: …" disclosure).
2. **Hybrid conflict score** that actually filters/sorts, not just narrates.
3. **`blocks`-graph leverage** as a tie-breaker for same-priority candidates.
4. **Surface-don't-demote** policy for conflicting P0s — orchestrator decides, not the skill.
5. **Recency / staleness flag** for `updated_at` older than N days (or note absence).
6. **Stable, deterministic output schema** (id | priority | desc | isolation_rationale | conflict_score | staleness_flag) so the orchestrator can act without re-reading the queue.
