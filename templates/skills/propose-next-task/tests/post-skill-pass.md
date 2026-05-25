---
phase: GREEN
date: 2026-05-25
scenario: orchestrator idle turn — propose next task WITH skill installed (~/.claude/skills/propose-next-task/SKILL.md symlinked to devkit SSOT)
subagent_type: general-purpose
input_file: /Users/duckyoungkim/projects/aigentry-orchestrator/state/task-queue.json
result: PARTIAL-PASS — every baseline failure F1–F7 closed, BUT 5 new rationalizations (L1–L5) surfaced; REFACTOR required
---

# GREEN Test — same scenario, skill present

## Compliance against RED baseline failures

| baseline | how skill closed it | subagent compliance evidence |
|---|---|---|
| **F1** silent truncation | Algorithm step 1 + red-flag "Missing `scanned N pending / M total` line" | "scanned 65 pending P0+P1 / 429 total" emitted as first output line |
| **F2** no leverage tracking | `leverage_score = (.blocks \| length)` column | column present (all 0 in this run — none of selected candidates had `blocks`) |
| **F3** keyword-only conflict | Step 3 hybrid score + step 5 semantic re-check | applied `+1` semantic bumps on #353 / #354 ("shares aterm-release surface") beyond raw heuristic |
| **F4** §4 never re-read | Body line "Re-read AGENTS.md §4 in cwd this turn" + red-flag | "AGENTS.md §4 re-read this turn: yes (also §7, §3)" — confirmed |
| **F5** unilateral demotion | "Surface, do not demote" — mandatory Conflict-coordinate section + required action per row | emitted 3-row Conflict-coordinate with explicit actions including `block-#52-instead` for #354 (skill let subagent escalate a P0 against the in-progress task) |
| **F6** schema decoupled from heuristic | Deterministic 7-column output schema | both sections emitted in exact schema; conflict_score arithmetic shown inline |
| **F7** no staleness check | `staleness_flag` column + 30-day rule | all rows flagged stale with "36d" annotation |

**Verdict: F1–F7 all addressed.** Skill is GREEN against the RED baseline.

## New rationalizations / loopholes surfaced (REFACTOR required)

The subagent self-disclosed these — each is a real ambiguity the skill must close.

### L1. "Top 6 semantic re-check" — top 6 of what?
> "skill says 'top 6' — top 6 of what? I interpreted as top 6 of the sorted candidate list (which were all conflict=0 P0s). If the intent was 'top 6 across both buckets including conflict≥3', the re-check should have re-scored #353/#354 too."

**Risk**: under literal "top 6 of sorted list" reading, conflict-bucket candidates never get semantic re-check, so subsystem-overlap escalation (which is exactly when re-check matters most) is skipped. Subagent did the right thing here only by initiative.

**Counter to add**: rewrite step 5 to explicitly say "top 6 of the priority+id-sorted list **before conflict filtering**, so that conflict-bound candidates are also re-scored."

### L2. Conflict-coordinate cardinality across priorities
> "skill says 'top 3' but never specifies whether priority tier-break applies inside this bucket. … A loophole reading would let me drop the P1 row entirely since only 2 P0 rows exist; I chose to fill with the highest-conflict P1 to honor 'surface, do not demote.'"

**Risk**: literal reader could emit a 2-row Conflict-coordinate section (or zero rows if no conflicts in the P0 strata) and silently drop conflicting P1s. Defeats the surface-don't-demote spirit.

**Counter to add**: rewrite Conflict-coordinate spec to say "top 3 across all priority tiers — pad with the next-highest-conflict candidates regardless of priority until you hit 3 rows or the conflict pool is exhausted (whichever comes first); never drop below the conflict pool size if it's ≥ 1."

### L3. Staleness false-positives from null `updated_at`
> "Many of these are recently-discussed in live sessions but never re-stamped — the flag is technically correct but noisy. Skill could distinguish 'never-stamped' from 'stamped-and-aged.'"

**Risk**: orchestrator dismisses real candidates as stale because the underlying queue rarely stamps `updated_at`.

**Counter to add**: split into two values: `stale?` (stamped and > 30d) vs `unstamped?` (no `updated_at` ever). Output as combined token: `stale:36d` / `unstamped` / `fresh`.

### L4. Semantic re-check stops at top 6 (not a loophole — confirmation)
> "I did not run a full semantic re-check on tasks ranked 7+ in the P0+P1 list. The skill only requires top-6 semantic; everything below was scored heuristically only."

**Risk**: none — this is the intended bound. Documenting for transparency.

**Action**: no skill change; the `top 6` bound is intentional cost control.

### L5. CRITICAL — "Skip when — A delegated task is in flight" admits literal exit
> "skill's 'Skip when — A delegated task is in flight' could be read as 'if any task is delegated, skip entirely.' With #20 and #28 both delegated, that would let me bail without producing output. … Skill should rewrite this bullet to say 'skip when ALL pending work is blocked by in-flight delegations.'"

**Risk**: HIGH — this is a literal-reading loophole that produces zero output exactly when the orchestrator most needs a recommendation (delegated tasks are the default idle state for an orchestrator). A by-the-letter reader exits the skill before scanning the queue.

**Counter to add**: rewrite Skip-when bullet to:
- "The **current session itself** has a delegated task in flight (orchestrator is the dispatcher, not a worker — never skip the orchestrator turn just because subordinate sessions are delegated)."

## Decision matrix for Phase 3 REFACTOR

| loophole | severity | action |
|---|---|---|
| L1 | medium — fixable in one sentence | tighten step 5 |
| L2 | medium — defeats surface-don't-demote spirit | tighten Conflict-coordinate spec |
| L3 | low — UX noise, not a discipline failure | add `stale` vs `unstamped` distinction |
| L4 | none | no change |
| L5 | **HIGH — literal-readable exit** | rewrite Skip-when bullet immediately |

Proceed to REFACTOR iteration 1 (close L1 + L2 + L3 + L5 in one edit; L4 no change).
