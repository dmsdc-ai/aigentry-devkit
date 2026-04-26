---
status: draft
date: 2026-04-26
topic: phase4-trial-driver-wiring
track: "#329 E27 Phase 4 (precedes runner dispatch)"
phase: 1 (spec only — implementation pending orchestrator approval)
authority:
  - ADR `~/projects/aigentry-orchestrator/docs/adr/2026-04-26-q1-prereq-redesign.md` §4.5 lines 218–229 (mechanical edits) + §4.6.9 (per-segment boundary).
  - Phase 4 plan `~/projects/aigentry-orchestrator/docs/plans/2026-04-22-phase4-plan.md` §2.1 + §2.2 (mode set + seed counts) + §3 sequencing + §4 pre-reg tag scope + §10 ownership.
  - Phase 4c V3 work-spec `~/projects/aigentry-orchestrator/docs/superpowers/specs/2026-04-26-phase4c-v3-implementation-work-spec.md` §1 ("Trial harness arm wiring edits — orchestrator dispatches these separately").
  - Pre-registration tag `exec-mode-v4-replication-preregistered-20260426` (annotation = scope lock; V3 PASS digests + 1,300-trial budget + grader pin `f5fdd3d`).
related:
  - Impl A: `bin/lib/preuse_substitute_compact/impl_a/build_substitute_compact_stdin.py` (commit d925b6d, V3 PASS).
  - Impl B: `bin/lib/preuse_substitute_compact/impl_b/build_substitute_compact_stdin.py` (commit 46c85c3, V3 PASS — kept as alternate; not invoked by trial driver).
  - V3 harness: `bin/v3-byte-equal-verify.py` (commit 8a92274).
  - Grader pin: `bin/exec-mode-grader.py` at commit `f5fdd3d` (NO modifications under this spec).
constitution_rules: [Rule 1 경량, Rule 9 독립, Rule 17 무의존, Rule 26 cross-OS]
---

# Phase 4 Trial Driver Wiring — Work-Spec

## §1 Goal + Non-Goals

### §1.1 Goal

Operationalize the **mechanical edits** itemized in ADR §4.5 lines 218–229 against
two trial-driver files in `aigentry-devkit`:

1. `bin/exec-mode-experiment.sh` — extend the `--mode` validator + Stage 1 dispatch
   to accept five new modes (`Preuse-clear`, `Preuse-substitute-compact-C1`,
   `…-C2`, `…-C3`, `…-C4`) without modifying behavior of the four Phase 3
   modes (`D`, `S`, `Pfresh`, `Pacc`).
2. `bin/exec-mode-generate-order.py` — extend run-order CSV generation to emit
   the Phase 4 budget exactly: **800 replication trials** (4 modes × 10 fixtures
   × 20 seeds) + **500 Preuse trials** (5 modes × 10 fixtures × 10 seeds) =
   **1,300 trials** per pre-registration tag scope clause.

The deliverable, when implemented, gives runner sessions a single CLI entrypoint
per arm and a deterministic CSV per arm — sufficient to fire all Phase 4 trials.

### §1.2 Non-goals

This spec deliberately does NOT govern:

1. **Phase 5 holdout** (5 new fixtures × 6 modes × 10 seeds = 300 trials per
   Phase 4 plan §2.3). Holdout uses a separate pre-registration tag
   `exec-mode-v5-holdout-preregistered-YYYYMMDD` (Phase 4 plan §4 line 95).
   Holdout fixture authorship is tracker work; driver wiring for holdout is a
   later spec (the mode set is a strict subset of this spec's mode set, so this
   spec is forward-compatible by construction).
2. **Phase 3 mode behavior changes**. The four Phase 3 modes (`D`, `S`, `Pfresh`,
   `Pacc`) are wired as-is; this spec MUST NOT alter their `case` branches,
   stdin construction, claude-invocation flags, or chain-state semantics
   (INV-1 in §10).
3. **Grader changes**. `bin/exec-mode-grader.py` is pinned at commit `f5fdd3d`
   under the pre-registration tag annotation; this spec MUST NOT modify it
   (INV-2 in §10).
4. **`substitute-compact-v1` re-implementation**. ADR §4.6 + the V3 PASS
   digest set lock the summarizer contract. This spec consumes impl A as a
   subprocess; implementation is the V3 work-spec's deliverable (already
   PASSed at commit `26f8cc4`).
5. **Per-CLI Layer 2 adapter** (Codex / Gemini routing). Per ADR §4.7.1 the
   Phase 4+5 adapter is a Claude-only stub; cross-CLI adapter rows are
   Phase 6+ work. This spec invokes `claude --print` directly (matches §4.6.9
   "cold `claude -p`").
6. **Compact detection / metrics schema rev**. Compact event metadata for
   Preuse-substitute-compact arms is recorded in `chain_state.json` (§5),
   not in `metrics.v1.json`. The metrics schema does not change.

---

## §2 Mode-by-Mode Wiring Decisions

### §2.1 Status of each mode

| Mode | Phase 3 wired? | Phase 4 change | Source of truth |
|---|---|---|---|
| **D** (dispatch per task) | ✅ `bin/exec-mode-experiment.sh:100,425` (case branch) + `:312–321` (live impl) | None | Phase 3 — preserved verbatim. |
| **S** (subagent / Task tool) | ✅ `bin/exec-mode-experiment.sh:100,426` + `:323–329` | None | Phase 3 — preserved verbatim. |
| **Pfresh** (warmup transcript replay) | ✅ `bin/exec-mode-experiment.sh:100,427` + `:335–388` | None | Phase 3 — preserved verbatim. |
| **Pacc** (accumulated) | ✅ `bin/exec-mode-experiment.sh:100,428` + `:393–417` | None to LLM invocation; **chain-state schema gains one additive field** (§5) — backward compatible | Phase 3 driver + ADR §4.6.9 chain-state delta. |
| **Preuse-clear** | ❌ NEW | Add `case` branch + new live-path helper `execmode::harness_stage1_live_Preuse_clear` (§2.3). | ADR §4.2 + Phase 4 plan §2.2 row 1. |
| **Preuse-substitute-compact-C1** | ❌ NEW | Add `case` branch + new live-path helper `execmode::harness_stage1_live_Preuse_substitute_compact` parameterized by `cut_tokens=10000` (§2.4). | ADR §4.6.9 + §4.6 (impl A consumer) + Phase 4 plan §2.2 row 2. |
| **Preuse-substitute-compact-C2** | ❌ NEW | Same helper, `cut_tokens=50000`. | Phase 4 plan §2.2 row 3. |
| **Preuse-substitute-compact-C3** | ❌ NEW | Same helper, `cut_tokens=100000`. | Phase 4 plan §2.2 row 4. |
| **Preuse-substitute-compact-C4** | ❌ NEW | Same helper, `cut_tokens=150000`. | Phase 4 plan §2.2 row 5. |

**Verification of Pacc-was-in-Phase-3 claim** (orchestrator dispatch line "(NEW): how does it differ from Pfresh?"): the dispatch question is answered NO — Pacc is NOT new. Evidence: `bin/exec-mode-experiment.sh:100` validator `D|Pfresh|Pacc|S`; `bin/exec-mode-generate-order.py:8,63–77` Pacc CSV writer; Phase 3 analyst report `~/projects/aigentry-devkit/docs/reports/2026-04-21-exec-mode-analyst-phase3.md:1,5,21,37` (mode ranking table includes Pacc, dataset path lists `{D,Pfresh,Pacc,S}`). Phase 4b §2.1 is therefore a **seed-count delta** (10→20 per Phase 3 budget; CSV widens to 20 of MASTER_SEED+offset shuffle), not a mode-set delta.

### §2.2 Mode-string convention

The `--mode` CLI flag accepts the following strings (extending the current
validator in `bin/exec-mode-experiment.sh:100–102`):

```
D | S | Pfresh | Pacc | Preuse-clear |
Preuse-substitute-compact-C1 | …-C2 | …-C3 | …-C4
```

Hyphenated tokens after the literal `Preuse-substitute-compact-` are the
**cut identifier** (`C1`/`C2`/`C3`/`C4`). The driver MUST parse the suffix
to derive `cut_tokens` from the canonical map below; cut identifiers MUST NOT
be derived from a positional argument or env var (preserves `--mode` as the
sole arm identity per pre-reg tag scope).

Cut map (ADR §4.6.9 + Phase 4 plan §2.2 + pre-reg tag annotation, in that
priority order):

| `cut_id` | `cut_tokens` (default) |
|---|---:|
| C1 | 10,000 |
| C2 | 50,000 |
| C3 | 100,000 |
| C4 | 150,000 |

Per Phase 4 plan §2.2 footnote line 46 + work-spec §7.3, P4-pre-2 percentile-anchored
values would supersede defaults at tag commit time. The pre-reg tag annotation
records that **defaults stand** (P4-pre-2 not delivered before tag commit).
The driver MUST therefore embed the default cut map verbatim — no env-var
override, no late-binding from analyst data. Re-tagging is the only path to a
different cut grid.

Storage convention for the cut suffix in the on-disk trial layout
(`bin/exec-mode-experiment.sh:122–134`): `<state-root>/<run-idx>/<mode>/<fixture>/<trial-stem>/`.
The `<mode>` segment is the **full mode string** (e.g.,
`Preuse-substitute-compact-C2`), NOT a parent dir + subdir split. This keeps
existing path-template helpers and analyzer load globs unchanged.

### §2.3 Preuse-clear wiring

**Semantics** (ADR §4.2 + Phase 4 plan §2.2 row 1): user resets context at every
task boundary in a chain of 10 positions. Each position runs in a **fresh**
`claude --print` session (no `--resume`); chain identity is preserved only for
metric assembly (cost amortization, pollution chain rate).

**Stdin composition**: identical to D mode — `setup_history.md` + `\n\n` +
`task_prompt.md`. Implementation is a thin wrapper that reuses
`execmode::harness_stage1_live_D` semantics with no `--resume` chaining
(`bin/exec-mode-experiment.sh:312–321`):

```bash
execmode::harness_stage1_live_Preuse_clear() {
  # Identical stdin + invocation to D; chain semantics live in the run-order
  # CSV (Preuse arms inherit Pacc-style session/position columns) + chain-state
  # accounting, not in the LLM call.
  execmode::harness_stage1_live_D
}
```

**Chain-state interaction**: Preuse-clear participates in the same
`chain_state.json` accounting as Pacc (§5) so that pollution chain rate +
amortized cost remain comparable across arms. The chain-state writer
(`execmode::chain_state_append`, `bin/lib/exec-mode-lib.sh:266–313`) appends
one entry per completed position. **No** `session_id` is recorded (each
position is a fresh session); `chain_state.session_id` remains empty for
Preuse-clear sessions (existing field; null/absent is already tolerated by
`chain_state_get_session_id`'s caller in Pacc pos>1 — but for Preuse-clear
pos>1 the driver MUST NOT call `chain_state_get_session_id` because the case
branch resolves to `live_Preuse_clear`, not `live_Pacc`).

**CLI argument shape**: same as Pacc — `--session-idx S --position-in-chain P`
required. Validator at `bin/exec-mode-experiment.sh:107–115` extends to require
session/position for **any** Preuse arm (Pacc + Preuse-clear + Preuse-substitute-compact-Cn).

### §2.4 Preuse-substitute-compact-Cn wiring

**Semantics** (ADR §4.6.9 lines 326–347): chain-mode like Pacc, with a
per-segment boundary that triggers a substitute compact when accumulated
input tokens cross the cut.

**Algorithm** (per position `p` in `[1..10]`):

```
if p == 1:
    # Cold start — identical to Pacc pos=1 (setup + task), capture session_id.
    invoke execmode::harness_stage1_live_Pacc body for pos=1
    set chain_state.segment_start_position = 1   # additive field, §5

else:
    # 1. Compute segment_input_tokens = sum over prior positions
    #    [chain_state.segment_start_position .. p-1] of metrics.cost.usage_buckets.input_tokens
    #    (read each prior trial's metrics.json from <state-root>/<run-idx>/<mode>/<fixture-of-position>/<trial-stem>/metrics.json).
    seg_in = execmode::preuse_compute_segment_input_tokens chain_path p run_idx mode

    if seg_in >= cut_tokens:
        # 2. Build substitute-compact manifest — see §3 manifest schema.
        manifest_json = execmode::preuse_build_manifest \
            chain_path cut_id cut_tokens run_idx session_idx p \
            chain_state.segment_start_position fixture task_prompt setup_history

        # 3. Invoke impl A as subprocess; capture stdout bytes as stage1 stdin.
        substitute_stdin_tmp = mktemp …
        LC_ALL=C python3 bin/lib/preuse_substitute_compact/impl_a/build_substitute_compact_stdin.py \
            <(echo "$manifest_json") > substitute_stdin_tmp

        # 4. Cold claude --print (NO --resume) — analogous to D's invocation
        #    but stdin is the impl-A output instead of setup+task concat.
        execmode::harness_invoke_claude_stage1 substitute_stdin_tmp stage1_jsonl_path

        # 5. Extract new session_id, overwrite chain_state.session_id.
        sid = execmode::harness_extract_session_id stage1_jsonl_path
        execmode::chain_state_set_session_id chain_path run_idx session_idx sid

        # 6. Advance segment marker.
        execmode::chain_state_set_segment_start_position chain_path p   # new helper, §5

    else:
        # Below cut — identical to Pacc pos>1 (--resume <prior_sid>, task only).
        invoke execmode::harness_stage1_live_Pacc body for pos>1
```

**Helper-function plan** (lines added to `bin/lib/exec-mode-lib.sh`, kept
small and stdlib-Python-only per Rule 17):

| New helper | Purpose | Approximate LOC |
|---|---|---:|
| `execmode::chain_state_set_segment_start_position` | Atomic update of new field; analogous to `chain_state_set_session_id` (`bin/lib/exec-mode-lib.sh:320–360`). | ~25 |
| `execmode::chain_state_get_segment_start_position` | Read with default=1 (back-compat for old chain_state.json). | ~12 |
| `execmode::preuse_compute_segment_input_tokens` | Walk `<state-root>/<run-idx>/<mode>/<fixture-of-pos>/<seed_stem>_pos<P>_sess<S>/metrics.json` for `P` in `[seg_start..p-1]`; sum `cost.usage_buckets.input_tokens`. | ~30 |
| `execmode::preuse_build_manifest` | Construct ADR §4.6.3 manifest as Python dict → write JSON to stdout via venv python; relative paths only (impl A's `__main__` resolves manifest-relative). | ~45 |

**Driver dispatch** (added to `bin/exec-mode-experiment.sh` `case` block, near
line 424–429):

```bash
case "$mode" in
  D)      execmode::harness_stage1_live_D;;
  S)      execmode::harness_stage1_live_S;;
  Pfresh) execmode::harness_stage1_live_Pfresh;;
  Pacc)   execmode::harness_stage1_live_Pacc;;
  Preuse-clear) execmode::harness_stage1_live_Preuse_clear;;
  Preuse-substitute-compact-C1) execmode::harness_stage1_live_Preuse_substitute_compact 10000  C1;;
  Preuse-substitute-compact-C2) execmode::harness_stage1_live_Preuse_substitute_compact 50000  C2;;
  Preuse-substitute-compact-C3) execmode::harness_stage1_live_Preuse_substitute_compact 100000 C3;;
  Preuse-substitute-compact-C4) execmode::harness_stage1_live_Preuse_substitute_compact 150000 C4;;
esac
```

**Why a single helper parameterized by `cut_tokens`+`cut_id` instead of four
copies**: Constitution Rule 1 경량 (one logic path; cut-grid is data, not
control flow). Four copies would be DRY-violating and would risk one cut
diverging from the others under future maintenance.

### §2.5 Impl A vs Impl B selection

Per orchestrator dispatch line "Phase 4c modes consume `bin/lib/preuse_substitute_compact/impl_a/…`
(preferred) — impl A is the canonical impl per V3 PASS, but the harness MAY
abstract via env var to allow swapping":

**Decision: hardcode impl A; do NOT abstract via env var.**

Rationale:
1. **Pre-registration scope** — the tag annotation pins the V3 PASS digest set;
   both impl A and impl B byte-equally produce those digests, so output is
   indistinguishable. Abstracting via env var would give a per-trial knob
   (which impl) that the tag does not declare — a pre-reg scope leak.
2. **Constitution Rule 1 경량** — env-var abstraction is over-engineering for a
   single-impl call site. If a future bug forces an impl swap, the change is
   one line + a re-tag (re-tag is required anyway because grader/driver
   commits are pinned in the tag annotation).
3. **Audit trail** — hardcoding the path makes the impl-A choice visible in
   `git log`/diff, not buried in environment leakage at runtime (matches
   ADR §4.6.10 ban list spirit: deterministic, traceable, no env reach-around).

Impl B is preserved on disk as the **calibration anchor** (V3 work-spec §6.5
"the non-violating impl is preserved as a calibration anchor") — invocation
by trial driver is forbidden under this spec.

---

## §3 Per-Cut C1–C4 Wiring (Manifest Construction)

### §3.1 Manifest schema (consumer-side echo of ADR §4.6.3)

The driver constructs an in-memory manifest that satisfies ADR §4.6.3 lines
251–269. Field-by-field source:

| Manifest field | Source in driver | Notes |
|---|---|---|
| `schema_version` | Constant `1` | INV-2 of V3 work-spec §10. |
| `cut_id` | Helper arg from `case` dispatch | One of `C1`/`C2`/`C3`/`C4`. |
| `cut_tokens` | Helper arg from `case` dispatch | Per §2.2 cut map. |
| `run_idx` | `--run-idx` CLI flag | Existing. |
| `session_idx` | `--session-idx` CLI flag | Existing. |
| `segment_start_position` | `chain_state_get_segment_start_position` (default 1) | New §5 helper. |
| `compact_before_position` | Current position `p` (the cold-restart position) | Set equal to `current_position` per ADR §4.6.9 step 1. |
| `current_position` | `--position-in-chain` CLI flag | Existing. |
| `current_fixture_id` | `--fixture` CLI flag | Existing. |
| `current_task_prompt_path` | `$fixture_dir/task_prompt.md` | Manifest-relative resolved by impl A's `__main__` (`bin/lib/preuse_substitute_compact/impl_a/build_substitute_compact_stdin.py:236–245`). |
| `setup_history_path` | `$fixture_dir/setup_history.md` | Manifest-relative. |
| `prior_turns[]` | Walk `chain_state.fixtures_completed` for entries with `position_in_chain` in `[segment_start_position .. current_position - 1]` (in chain-recorded order; impl A re-sorts ASC numerically per ADR §4.6.4). | One entry per prior position in segment. |
| `prior_turns[].position_in_chain` | From chain-state entry | Integer. |
| `prior_turns[].fixture_id` | From chain-state entry | Used for `PRIOR_TURN` label. |
| `prior_turns[].seed_idx` | From chain-state entry | Used for `PRIOR_TURN` label. |
| `prior_turns[].task_prompt_path` | `<fixtures_root>/<fixture_id>/task_prompt.md` | Resolved manifest-relative. |
| `prior_turns[].stage1_output_path` | `<state-root>/<run-idx>/<mode>/<fixture>/<seed_stem>_pos<P>_sess<S>/stage1_output.md` | Resolved manifest-relative. Missing file → impl A emits empty `PRIOR_ASSISTANT_OUTPUT_EXCERPT` per ADR §4.6.11 row 7 + impl A `_read_prior_assistant_or_empty`. |

### §3.2 Manifest path resolution

Impl A's `__main__` resolves manifest-declared paths against the **manifest
file's parent directory** (`bin/lib/preuse_substitute_compact/impl_a/build_substitute_compact_stdin.py:236–245`).
The driver therefore writes the manifest JSON to a temp dir whose parent
is the trial dir (`<trial_dir>/.preuse_manifest.json`), and uses paths
relative to that trial dir. Absolute paths in the manifest violate
ADR §4.6.10 ban-list item 3.

Concretely, if the trial dir is
`<state-root>/<run-idx>/Preuse-substitute-compact-C2/F5/seed03_pos7_sess2/`,
then:

- `setup_history_path = "../../../../fixtures/F5/setup_history.md"` if
  `fixtures_root` is sibling to `state_root`, OR a symlink under the trial
  dir — see §3.3.

### §3.3 Symlink staging (recommended)

To keep manifest paths short + ban-list-clean, the driver SHOULD stage symlinks
into the trial dir before manifest emission:

```
<trial_dir>/.preuse_inputs/setup_history.md         -> $fixture_dir/setup_history.md
<trial_dir>/.preuse_inputs/task_prompt.md           -> $fixture_dir/task_prompt.md
<trial_dir>/.preuse_inputs/prior/<P>_<fixture>.task -> <prior fixture>/task_prompt.md
<trial_dir>/.preuse_inputs/prior/<P>_<fixture>.out  -> <prior trial dir>/stage1_output.md
```

Then manifest paths read `.preuse_inputs/setup_history.md`, etc. — short,
manifest-relative, no absolute-path leak. Symlinks are POSIX-portable
(matches Rule 26 cross-OS for harness's bash + linux/macos targets).

Trade-off: adds ~10 LOC for staging vs ~5 LOC of relative-path arithmetic.
Symlink approach wins on auditability (a directory listing of `.preuse_inputs/`
shows manifest input set explicitly) and on resilience to trial-dir relocation.

### §3.4 Cumulative-input tracker (segment_input_tokens)

Implementation in `execmode::preuse_compute_segment_input_tokens` (helper §2.4):

1. Read `chain_state.json` at `chain_state_path`.
2. Filter `fixtures_completed` to entries with
   `segment_start_position <= position_in_chain < current_position`.
3. For each such entry, locate the prior trial's `metrics.json` at
   `<state-root>/<run-idx>/<mode>/<fixture_id>/<seed_stem>_pos<P>_sess<S>/metrics.json`
   (existing path template, `bin/exec-mode-experiment.sh:122–134`).
4. Parse `cost.usage_buckets.input_tokens` (existing field, `state/schema/metrics.v1.json`
   per `bin/exec-mode-experiment.sh:578–585`).
5. Return the sum.

If any prior `metrics.json` is missing, the driver MUST exit 5
(malformed-fixture per `bin/exec-mode-experiment.sh:21–26` exit-code contract)
— a missing prior trial in the segment means the chain state is corrupt;
proceeding with a partial sum would produce unreproducible cut-trigger behavior.

If the chain-state file does not yet record any prior position (i.e., position
1 just completed, or this is position 1 itself), `segment_input_tokens = 0`,
which never crosses any `cut_tokens >= 10000`, so the cold-restart branch is
not taken (matching ADR §4.6.9 "Before position p>1, compute …" — the check is
gated on p>1; pos=1 always uses the Pacc cold-start path).

---

## §4 Generate-Order Updates

### §4.1 Current state (Phase 3)

`bin/exec-mode-generate-order.py` writes 4 CSVs (`bin/exec-mode-generate-order.py:1–9`):

| CSV | Trials | Schema |
|---|---:|---|
| `run_order_D.csv` | 300 | `trial_idx, fixture_id, seed_idx` |
| `run_order_Pfresh.csv` | 300 | same |
| `run_order_S.csv` | 300 | same |
| `run_order_Pacc.csv` | 300 | `trial_idx, session_idx, position_in_chain, fixture_id, seed_idx` |

Master seed = 42; mode_offset = `{D:0, Pfresh:1, S:2}`; Pacc per-session order
seeded by `session_idx` (`bin/exec-mode-generate-order.py:36–77`).

Phase 3 ran with **N=10 seeds per fixture** (analyst report `…2026-04-21-exec-mode-analyst-phase3.md:1,5,21,37`)
— the runner consumed the **first 10 trials per fixture** of the 30-trial
shuffle output, NOT a regenerated CSV. This is important: the deterministic
seed coverage of Phase 3 is the first 10 of `random.Random(42 + offset).shuffle`.

### §4.2 Phase 4 deltas

| CSV | Trials (Phase 4) | Seed slice | New? |
|---|---:|---|---|
| `run_order_D.csv` | 200 (10 fixtures × 20 seeds) | first 20 of `random.Random(42 + 0).shuffle` | Regenerated; superset of Phase 3 first-10 slice. |
| `run_order_Pfresh.csv` | 200 | first 20 of `random.Random(42 + 1).shuffle` | Regenerated. |
| `run_order_S.csv` | 200 | first 20 of `random.Random(42 + 2).shuffle` | Regenerated. |
| `run_order_Pacc.csv` | 200 (20 sessions × 10 positions) | sessions 1..20 of existing per-session shuffle | Regenerated; sessions 1..20 are the prefix of the existing 30-session output, so per-session order is **unchanged** for sessions 1..20. |
| `run_order_Preuse-clear.csv` | 100 (10 sessions × 10 positions) | sessions 1..10 of per-session shuffle (seed = `session_idx`, identical scheme to Pacc) | **NEW**. |
| `run_order_Preuse-substitute-compact-C1.csv` | 100 | same scheme; sessions 1..10 | **NEW**. |
| `run_order_Preuse-substitute-compact-C2.csv` | 100 | same | **NEW**. |
| `run_order_Preuse-substitute-compact-C3.csv` | 100 | same | **NEW**. |
| `run_order_Preuse-substitute-compact-C4.csv` | 100 | same | **NEW**. |

**Total Phase 4: 1,300 trials** (200 × 4 = 800 replication + 100 × 5 = 500 Preuse).
Matches Phase 4 plan §2.4 line 58 + pre-reg tag annotation budget.

### §4.3 Constants and mode_offset extension

```python
# Phase 3 -> Phase 4 constants delta
SEEDS_PER_FIXTURE_REPLICATION = 20          # was: SEEDS_PER_FIXTURE = 30
SEEDS_PER_FIXTURE_PREUSE      = 10
PACC_SESSIONS_REPLICATION     = 20          # was: PACC_SESSIONS = 30
PREUSE_SESSIONS               = 10
PREUSE_POSITIONS              = 10          # unchanged; matches PACC_POSITIONS

MASTER_SEED = 42                            # unchanged

# Mode offset table — preserves Phase 3 D/Pfresh/S offsets; adds Preuse arms.
# Pacc + per-session-shuffle modes do NOT use mode_offset (they use session_idx
# as seed); this table only governs flat-shuffle modes.
_MODE_OFFSET = {
    "D":      0,   # Phase 3 — preserved
    "Pfresh": 1,   # Phase 3 — preserved
    "S":      2,   # Phase 3 — preserved
    # No flat-shuffle Preuse modes (all are per-session like Pacc).
}
```

**Why no new entries in `_MODE_OFFSET`**: Preuse arms are per-session-shuffle
(Pacc-shaped CSVs), not flat-shuffle (D-shaped). The per-session shuffle
function is parameterized by `session_idx` (not `mode + master_seed`), so
Preuse-clear and Preuse-substitute-compact-C{1..4} all use the **same**
per-session shuffle as Pacc. Their CSVs differ only in `(session_idx in
1..10)` slice + filename. Sessions 1..10 of every Preuse arm visit the
fixtures in the **same order** as sessions 1..10 of Pacc — this is intentional
+ pre-registered: per-arm fixture-ordering variance would confound arm
comparison.

### §4.4 Per-arm CSV writer (extended)

```python
def write_pacc_order(out: Path) -> None:
    # Phase 4 delta: PACC_SESSIONS_REPLICATION (was PACC_SESSIONS)
    rows = _per_session_rows(num_sessions=PACC_SESSIONS_REPLICATION)
    _write_csv(out, _PER_SESSION_HEADER, rows)

def write_preuse_clear_order(out: Path) -> None:
    rows = _per_session_rows(num_sessions=PREUSE_SESSIONS)
    _write_csv(out, _PER_SESSION_HEADER, rows)

def write_preuse_substitute_compact_order(out: Path, _cut_id: str) -> None:
    # cut_id is recorded only in the filename; the CSV body is identical to
    # Preuse-clear (same per-session shuffle, same seed = session_idx).
    rows = _per_session_rows(num_sessions=PREUSE_SESSIONS)
    _write_csv(out, _PER_SESSION_HEADER, rows)

def _per_session_rows(num_sessions: int) -> list[list[object]]:
    rows: list[list[object]] = []
    trial_idx = 0
    for session_idx in range(1, num_sessions + 1):
        order = list(FIXTURES)
        random.Random(session_idx).shuffle(order)   # unchanged from Phase 3
        for position, fixture in enumerate(order, start=1):
            rows.append([trial_idx, session_idx, position, fixture, session_idx])
            trial_idx += 1
    return rows
```

### §4.5 `write_all` extension

```python
def write_all(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    # Phase 3 modes (replication scope: 20 seeds, 4 modes).
    for mode in ("D", "Pfresh", "S"):
        write_flat_order(mode, output_dir / f"run_order_{mode}.csv")
    write_pacc_order(output_dir / "run_order_Pacc.csv")
    # Phase 4 Preuse arms (10 sessions, 5 modes).
    write_preuse_clear_order(output_dir / "run_order_Preuse-clear.csv")
    for cut_id in ("C1", "C2", "C3", "C4"):
        write_preuse_substitute_compact_order(
            output_dir / f"run_order_Preuse-substitute-compact-{cut_id}.csv",
            cut_id,
        )
```

`write_flat_order` updates internally to use `SEEDS_PER_FIXTURE_REPLICATION = 20`
in place of `SEEDS_PER_FIXTURE = 30` (one-line constant rename).

### §4.6 Phase 3 dataset preservation

Phase 3 datasets sit at `state/exec-mode-experiment/full-pilot-fix2/1/{D,Pfresh,Pacc,S}/…`
per analyst report `…2026-04-21-exec-mode-analyst-phase3.md:5`. Phase 4 uses a
**distinct state-root prefix** to prevent collision. Recommendation:

```
state/exec-mode-experiment/phase4-replication/1/{D,Pfresh,Pacc,S}/…
state/exec-mode-experiment/phase4-preuse/1/{Preuse-clear,Preuse-substitute-compact-C1..C4}/…
```

Runner sessions invoke `--state-root state/exec-mode-experiment/phase4-replication`
(or `phase4-preuse`) to keep arm-set partitioning + leave Phase 3 frozen.

This is a **runner contract**, not a driver contract — the driver already
takes `--state-root` as an arg (`bin/exec-mode-experiment.sh:64,87`). This
spec records the recommended convention; the runner-dispatch spec (separate
work) pins the values.

---

## §5 Chain-State Schema Additive

### §5.1 New field

ADR §4.6.9 line 343–347 specifies one additive field on `chain_state.json`:

```
chain_state.segment_start_position : integer (default 1)
```

Initialized to `1` on chain-state file creation; updated by
`execmode::chain_state_set_segment_start_position` to the position `p` that
triggered the substitute-compact (ADR §4.6.9 step 6).

### §5.2 Backward compatibility

Existing Pacc trials' `chain_state.json` files (Phase 3 datasets) MUST be
readable without modification:

- Reader helper `chain_state_get_segment_start_position` defaults to `1` when
  the field is absent — preserves Pacc-only chain-state files.
- Writer helper `chain_state_set_segment_start_position` adds the field on
  first write; never removes or renames `session_idx`, `run_idx`, `status`,
  `session_id`, or `fixtures_completed` (existing schema, `bin/lib/exec-mode-lib.sh:232–237`).
- `execmode::chain_state_append` (`bin/lib/exec-mode-lib.sh:266–313`) is NOT
  modified — `fixtures_completed` entries do not gain new fields under this
  spec (the cut event is recorded on the chain root, not per-position).

### §5.3 Pacc vs Preuse-substitute-compact behavior

| Mode | Reads `segment_start_position`? | Writes `segment_start_position`? |
|---|---|---|
| Pacc | No | No (field default holds at 1) |
| Preuse-clear | No | No |
| Preuse-substitute-compact-C{1..4} | Yes (per-trial, on pos>1) | Yes (when cut crossed; updates to current `p`) |

Pacc-mode chain-state files therefore remain byte-identical to Phase 3 outputs
(modulo the always-present default-1 field if a `set` is ever called — but
under this spec Pacc never triggers a `set`). Phase 4b replication output
matches Phase 3 chain-state schema exactly.

### §5.4 Helper signatures

```bash
# Read; default 1 if missing or file absent.
execmode::chain_state_get_segment_start_position <chain_path>
  -> stdout: integer
  -> exit 0 always (default)

# Write (atomic via tempfile + os.replace, same pattern as
# chain_state_set_session_id at bin/lib/exec-mode-lib.sh:320–360).
execmode::chain_state_set_segment_start_position <chain_path> <new_position>
  -> exit 0 on success, 3 on python-not-found
```

Implementation MUST mirror `chain_state_set_session_id` exactly (same
`tempfile.NamedTemporaryFile` + `json.dump(..., sort_keys=True)` + `os.replace`
pattern) for atomic-write parity.

---

## §6 Test Plan

### §6.1 Dry-run mode (highest-priority test surface)

`bin/exec-mode-generate-order.py` already runs without LLM calls — it is a
pure CSV writer. Test plan for it:

1. **Counts**: assert `wc -l` on each CSV equals expected (header + N rows):
   - `run_order_{D,Pfresh,S}.csv`: 1 + 200 = 201 lines each
   - `run_order_Pacc.csv`: 1 + 200 = 201 lines
   - `run_order_Preuse-clear.csv`: 1 + 100 = 101 lines
   - `run_order_Preuse-substitute-compact-C{1,2,3,4}.csv`: 1 + 100 = 101 lines each
   - **Total non-header rows across all CSVs: 1,300** (matches §4.2 / pre-reg tag).
2. **Mode set**: assert filenames match the 9-CSV set exactly (one missing
   or extra → fail).
3. **Seed coverage** (D/Pfresh/S): assert each fixture appears 20 times per
   CSV; assert the multiset of 200 `(fixture, seed)` pairs equals the first
   200 of `random.Random(42 + offset).shuffle(_flat_pairs())` for that mode.
4. **Sub-shuffle compatibility** (Pacc): assert the first 200 rows of the
   Phase 4 Pacc CSV are identical to the first 200 rows of the Phase 3 Pacc
   CSV (sessions 1..20 are a prefix of sessions 1..30 by construction
   — this guards against accidental shuffle-RNG drift).
5. **Sub-shuffle compatibility** (Preuse arms): assert sessions 1..10 of
   Preuse arms match sessions 1..10 of Pacc CSV (all use seed=session_idx).

Test harness: a thin pytest file `tests/exec-mode/test_generate_order_phase4.py`
that imports `bin.exec_mode_generate_order` (or invokes the CLI as subprocess)
and asserts the above. Stdlib + pytest only (Rule 17).

### §6.2 Driver dry-run for new modes

`bin/exec-mode-experiment.sh --dry-run` already produces synthetic metrics
without claude calls (`:185–202`). Test plan:

1. Invoke `--dry-run --mode Preuse-clear --fixture Fa --seed-idx 0
   --session-idx 1 --position-in-chain 1 --run-idx 1` — assert exit 0 + valid
   metrics.json under `<state-root>/1/Preuse-clear/Fa/seed00_pos1_sess1/`.
2. Same with each cut: `--mode Preuse-substitute-compact-C{1..4}` — assert
   exit 0 + valid metrics.json under the per-cut state-root subdir.
3. Validator-failure paths: `--mode Preuse-substitute-compact-C5` (invalid
   cut suffix) → assert exit 5; `--mode Preuse-substitute-compact` (no cut)
   → exit 5; `--mode preuse-clear` (lowercase) → exit 5.

Test harness: `tests/exec-mode/test_experiment_phase4_modes.bats` extending
the existing bats suite (the harness is already bats per the
`EXEC_MODE_HOME` / `EXECMODE_STAGE1_CMD` mock-knob hooks at
`bin/exec-mode-experiment.sh:36–43`).

### §6.3 Substitute-compact integration test (no LLM)

Invokes the live-path Preuse-substitute-compact code path with mocked
`EXECMODE_STAGE1_CMD` so impl A is exercised against real chain-state +
real metrics.json sums, but no claude call happens:

1. Pre-stage a `chain_state.json` with `segment_start_position=1` +
   `fixtures_completed` for positions 1..3 (each with a sibling `metrics.json`
   carrying a known `cost.usage_buckets.input_tokens` value).
2. Set `cut_tokens` low enough that positions 1..3's sum crosses
   (e.g., 10,000 with 3 priors of 5,000 each).
3. Invoke driver for position 4 with mocked `EXECMODE_STAGE1_CMD` =
   "tee >> $stage1_jsonl_path" (echoes manifest stdin into a known location).
4. Assert: (a) impl A produced a non-empty stdin to the mock; (b)
   `chain_state.segment_start_position` advanced to 4; (c) the manifest sent
   to impl A had `prior_turns` covering positions 1..3 (equal-length array).

This catches manifest-construction bugs without burning trial-firing budget.

### §6.4 Acceptance criteria for Phase 2 implementation

The Phase 2 implementation is **complete + ready for runner dispatch** iff:

1. All §6.1 CSV tests pass.
2. All §6.2 driver dry-run tests pass.
3. The §6.3 integration test passes against impl A (commit d925b6d).
4. No modification to `bin/exec-mode-grader.py` (`git diff f5fdd3d -- bin/exec-mode-grader.py`
   returns empty).
5. Phase 3 driver behavior unchanged: `--mode D|S|Pfresh|Pacc` runs are
   byte-identical to Phase 3 invocations on synthetic dry-run inputs (regression
   spot-check via existing bats tests).

---

## §7 Approaches MUST NOT Propose (failed-design fence)

The Phase 2 implementer MUST NOT do any of the following — each is a known
failure mode flagged by ADR / plan / pre-reg tag:

1. **Hardcode 4c arm configs into experiment.sh as a mode_to_cut_tokens map
   inside the case branches** (e.g., `if mode == "Preuse-substitute-compact-C2"
   then cut_tokens=50000 …`). Permitted: a single-line case dispatch that
   passes `cut_tokens` + `cut_id` as helper args (per §2.4 example). Forbidden:
   any per-cut `case` body that diverges in stdin construction or claude flags.
   Why: divergent per-cut bodies risk cut-specific drift that confounds the
   Phase 4d analyst's cross-cut comparison (Phase 4 plan §7 row 2).

2. **Call `claude --print` outside `execmode::harness_invoke_claude_stage1`**.
   The mock-knob `EXECMODE_STAGE1_CMD` (`bin/exec-mode-experiment.sh:42–43`)
   is the test injection seam; bypassing the helper breaks bats integration +
   bypasses the `EXEC_MODE_HOME` isolation contract per smoke report
   `~/projects/aigentry-devkit/docs/reports/2026-04-20-exec-mode-Fa-smoke.md`.

3. **Modify `bin/exec-mode-grader.py`**. Pre-reg tag annotation pins it at
   commit `f5fdd3d`. Any modification invalidates the pre-registration tag
   (Phase 4 plan §4 line 96 + pre-reg tag annotation "Pre-Registration
   Authority" section). Re-tagging is the only path to a grader change.

4. **Use `session_id` or wall-clock in trial output**. ADR §4.6.10 ban-list
   items 2 + 4. The driver already complies (it captures session_id but never
   embeds it in stage1_output.md); any new code path under this spec MUST NOT
   regress this. Specifically, the substitute-compact manifest MUST NOT
   include the prior session_id as a field (it is not in ADR §4.6.3 schema
   anyway; INV-2 of V3 work-spec).

5. **Add an env var to choose impl A vs impl B at runtime**. Per §2.5 — impl A
   is hardcoded. Env-var override would break pre-reg scope.

6. **Auto-regenerate run-order CSVs at trial-fire time**. The CSVs are a
   pre-registration artifact (committed under the pre-reg tag scope clause).
   The runner reads the committed CSV; it MUST NOT regenerate. Driver code
   MUST NOT call `bin/exec-mode-generate-order.py` from a `case` body.

7. **Mix Phase 3 and Phase 4 datasets under a shared state-root**. §4.6
   recommendation. Even if disk paths happen to be unique due to seed-count
   widening, mixing breaks analyst dataset-load conventions and risks
   trial double-counting if a runner re-runs an old `seed_idx`.

8. **Modify the chain-state file's existing fields** (`session_id`,
   `fixtures_completed`, `status`, `session_idx`, `run_idx`). §5.2 — only
   the new `segment_start_position` field is added.

---

## §8 Constitution Check

| Rule | Where it applies in this spec | Verdict |
|---|---|---|
| **Rule 1 경량** (no over-engineering) | §2.4 single helper parameterized by `cut_tokens` (vs 4 copies); §2.5 hardcoded impl A (vs env-var swap); §3.3 symlink staging (vs path arithmetic — chosen for auditability, ~10 LOC); no new abstraction layers, no plugin mechanism. | PASS |
| **Rule 2 cross** | New modes use the same `claude --print --disable-slash-commands --model claude-opus-4-7` invocation as Phase 3 modes; behavior is reproducible across Mac/Linux per existing harness `bin/lib/platform.sh` reach. | PASS |
| **Rule 3 역할** | Driver wires modes; impl A computes substitute-compact bytes; grader scores. No role overlap. | PASS |
| **Rule 9 독립** (component standalone) | `bin/exec-mode-experiment.sh` remains self-contained — no new external library. Impl A invocation is a subprocess, not an import. The driver continues to work with `--dry-run` (no claude required). | PASS |
| **Rule 17 무의존** (no plugin/library deps) | Helpers use bash + venv-Python (`json`, `pathlib`, stdlib only). No new pip packages. CSV writer remains stdlib `csv` module. | PASS |
| **Rule 26 cross-OS** (bash via `lib/platform.sh`) | New helpers use the same `mktemp -t` + `printf '%q'` pattern as existing helpers (`bin/exec-mode-experiment.sh:233`). Symlinks (§3.3) are POSIX-portable. No new bash 4+ features. | PASS |

Constitution Rule 5 최선 (3-failure rule): if Phase 2 implementation hits the
3-attempt cap on driver wiring, escalate to architect for spec amendment
(this spec is the authority; the implementer may not invent semantics).

---

## §9 Invariants (MUST hold after implementation)

| ID | Invariant | Source / verification |
|---|---|---|
| **INV-1** | Phase 3 mode behavior unchanged. `--mode D\|S\|Pfresh\|Pacc` invocations produce byte-identical metrics.json (modulo timestamps) compared to Phase 3 dry-run baselines. | Existing bats suite + §6.4 acceptance row 5. |
| **INV-2** | `bin/exec-mode-grader.py` is byte-identical to commit `f5fdd3d`. | `git diff f5fdd3d -- bin/exec-mode-grader.py` is empty. Pre-reg tag annotation pins this. |
| **INV-3** | `metrics.v1.json` schema unchanged. New mode strings flow through existing schema fields; cut + segment data live in `chain_state.json`. | `state/schema/metrics.v1.json` is byte-identical pre/post. |
| **INV-4** | Substitute-compact invocation calls **impl A only** (`bin/lib/preuse_substitute_compact/impl_a/build_substitute_compact_stdin.py` at commit d925b6d). Impl B is never invoked by the driver. | `git grep "impl_b" bin/` returns no matches in Phase 2 PR; pre-reg tag references impl A commit. |
| **INV-5** | Per-cut `cut_tokens` map: `C1=10000`, `C2=50000`, `C3=100000`, `C4=150000`. Hardcoded in driver, not env-var-driven, not config-file-driven. | Pre-reg tag annotation embeds these values; driver embeds same constants. |
| **INV-6** | `chain_state.json` schema: existing 5 fields preserved; one new field `segment_start_position` (default 1) added. No removed/renamed fields. | §5 helper signatures + §5.2 back-compat. |
| **INV-7** | Total Phase 4 trial count = 1,300 (800 replication + 500 Preuse). | §4.2 row totals + pre-reg tag annotation budget. |
| **INV-8** | Run-order CSVs are a pre-registration artifact, committed alongside the pre-reg tag. Driver does NOT regenerate at trial-fire time. | §7 row 6 + pre-reg tag annotation "Seed scheme" clause. |
| **INV-9** | Phase 3 dataset directories under `state/exec-mode-experiment/full-pilot-fix2/` are NOT touched. Phase 4 writes to a distinct `state-root` prefix. | §4.6 + runner-dispatch contract. |

Any change to INV-1 through INV-9 requires re-tagging (re-`git tag -a
exec-mode-v4-replication-preregistered-…`) which itself requires
orchestrator + user sign-off per Phase 4 plan §4 line 96.

---

## §10 Implementation Estimate

| Component | Touched file | Approximate LOC | Source of estimate |
|---|---|---:|---|
| `--mode` validator + `case` dispatch (5 new branches + 1 helper call) | `bin/exec-mode-experiment.sh:99–102, 424–429` | +18 | Mechanical extension of existing `case`. |
| Pacc-required-args extension (Preuse arms also need session/position) | `bin/exec-mode-experiment.sh:107–115` | +6 | One-line condition widening. |
| `execmode::harness_stage1_live_Preuse_clear` helper | `bin/exec-mode-experiment.sh` | +5 | Thin wrapper around `live_D`. |
| `execmode::harness_stage1_live_Preuse_substitute_compact` helper (parameterized) | `bin/exec-mode-experiment.sh` | +90 | Algorithm in §2.4: cut-check, manifest emit, impl A subprocess, sid extract, segment_start update. |
| `execmode::chain_state_set_segment_start_position` helper | `bin/lib/exec-mode-lib.sh` (new section after `chain_state_set_session_id`) | +25 | Parallel to existing `chain_state_set_session_id` (`bin/lib/exec-mode-lib.sh:320–360`). |
| `execmode::chain_state_get_segment_start_position` helper | `bin/lib/exec-mode-lib.sh` | +12 | Read-with-default, simpler than `set`. |
| `execmode::preuse_compute_segment_input_tokens` helper | `bin/lib/exec-mode-lib.sh` | +30 | venv python one-shot; sums input_tokens across prior trial metrics.json. |
| `execmode::preuse_build_manifest` helper (writes manifest JSON + symlink staging) | `bin/lib/exec-mode-lib.sh` | +55 | venv python one-shot; symlink staging per §3.3. |
| Generate-order: constants + `_per_session_rows` extraction + new writers | `bin/exec-mode-generate-order.py` | +45 | §4.4 + §4.5 listings. |
| Bats tests for §6.2 + §6.3 | `tests/exec-mode/test_experiment_phase4_modes.bats` (new) | +120 | 9 dry-run invocations + 3 validator-failure paths + 1 substitute-compact integration test (mocked stage1). |
| Pytest for §6.1 | `tests/exec-mode/test_generate_order_phase4.py` (new) | +80 | 5 assertion groups in §6.1. |
| **Subtotal driver + lib edits** | | **~241** | |
| **Subtotal new tests** | | **~200** | |
| **Total** | | **~441** | Net add. |

**Wall-clock estimate** (Phase 2): 1.0–1.5 calendar days for a single
implementer with full context. Breakdown:

- Driver + lib edits: ~3–5 hours (mechanical, traceable to spec sections).
- Bats + pytest tests: ~3–4 hours.
- Dry-run validation + small fixes: ~1–2 hours.
- Integration test (§6.3) tuning: ~1–2 hours (manifest + chain-state pre-stage
  is the trickiest part).

**Risk factors** (in descending likelihood):
1. Symlink staging (§3.3) edge cases on macos-vs-linux (POSIX symlink semantics
   are uniform; risk is `mktemp -t` differences — already handled in existing
   helper).
2. Manifest-relative path resolution off-by-one (impl A's `__main__` resolves
   against manifest parent dir; symlink staging keeps depth=1 to minimize this).
3. Chain-state read-during-write race when multiple Preuse arms run in parallel
   for the same session_idx (mitigation: runner contract MUST partition by
   session_idx — separate runner-dispatch spec).

---

## §11 Out of Scope (recap)

This spec governs **only** the trial driver wiring + run-order CSV generation.
Items expressly out of scope (already enumerated in §1.2; recapped for the
implementer's quick reference):

1. Phase 5 holdout (separate tag + spec).
2. Codex / Gemini Layer 2 adapter (Phase 6+).
3. Compact event reporting in `metrics.v1.json` (use chain_state instead).
4. Re-implementation of `substitute-compact-v1` (impl A is canonical; V3 work-spec governs).
5. Grader changes (pinned at f5fdd3d).
6. Analyst dataset loaders / Phase 4d analysis spec.
7. Runner dispatch (which sessions fire which arms; partitioning by
   session_idx; rate-limit handling) — separate spec.

---

## §12 Open Questions (defer to orchestrator)

| ID | Question | Default if unanswered | Cost of deferral |
|---|---|---|---|
| **OQ-1** | Should Preuse arms write to `state/exec-mode-experiment/phase4-preuse/` or share `state/exec-mode-experiment/phase4/{replication,preuse}/`? | Distinct `phase4-replication` + `phase4-preuse` per §4.6. | Low — runner-dispatch spec pins this; driver is `--state-root`-driven. |
| **OQ-2** | Should `execmode::preuse_compute_segment_input_tokens` exit 5 (malformed) on missing prior metrics, or treat missing as 0? | Exit 5 per §3.4 (a missing prior in segment indicates chain corruption). | Low — runner contract serializes positions per session; missing prior should never occur in normal flow. |
| **OQ-3** | Should symlink staging (§3.3) be strict (fail if symlink target doesn't exist at staging time) or lazy (fail at impl A read time)? | Strict — fail-fast per Constitution Rule 1 (smaller blast radius). | Low — both options surface the same error eventually; strict gives a cleaner stack trace. |
| **OQ-4** | When `chain_state.segment_start_position` is set on the first cross of a cut, should it be set BEFORE or AFTER the cold-restart claude call? | AFTER (so a claude failure leaves chain_state untouched, allowing retry). | Low — atomic-write semantics mean both choices are safe; AFTER aligns with existing `chain_state_set_session_id` ordering at `bin/exec-mode-experiment.sh:404–407`. |
| **OQ-5** | Should the spec reference impl A by **commit hash** (`d925b6d`) or by **path** (`bin/lib/preuse_substitute_compact/impl_a/...`)? | By path; pre-reg tag annotation pins the commit. | Low — both are auditable; path is more readable in driver source. |

OQ-1 and OQ-2 are **runner-contract-adjacent**; OQ-3 and OQ-4 are
**implementation-detail**; OQ-5 is **documentation**. None block Phase 2
implementation; the implementer SHOULD apply the defaults and surface only
post-hoc.

---

## Appendix A — Reference: Mode-by-Mode Source Lines

For Phase 2 implementer's quick reference, the existing case branches and
helpers to extend:

| Reference | File:lines | What it is |
|---|---|---|
| Mode validator | `bin/exec-mode-experiment.sh:99–102` | Add 5 new pipe-separated tokens. |
| Pacc-arg validator | `bin/exec-mode-experiment.sh:107–115` | Widen condition to all chain modes. |
| Trial-stem composition | `bin/exec-mode-experiment.sh:122–134` | Reuse Pacc shape for Preuse arms. |
| Stage 1 case dispatch | `bin/exec-mode-experiment.sh:419–432` | Extend with 5 new branches. |
| `claude --print` invocation helper | `bin/exec-mode-experiment.sh:226–241` | Reuse unchanged. |
| `harness_extract_session_id` | `bin/exec-mode-experiment.sh:246–262` | Reuse unchanged. |
| `harness_stage1_live_D/S/Pfresh/Pacc` | `bin/exec-mode-experiment.sh:312–417` | Reference pattern for new helpers. |
| Chain-state path | `bin/lib/exec-mode-lib.sh:239–243` | Reuse unchanged. |
| Chain-state crash check | `bin/lib/exec-mode-lib.sh:246–262` | Reuse unchanged for Preuse arms. |
| Chain-state append | `bin/lib/exec-mode-lib.sh:266–313` | Reuse unchanged. |
| `chain_state_set_session_id` | `bin/lib/exec-mode-lib.sh:320–360` | Pattern for new `set_segment_start_position`. |
| Generate-order Phase 3 writers | `bin/exec-mode-generate-order.py:32–98` | Extend per §4.4 + §4.5. |
| Impl A entrypoint | `bin/lib/preuse_substitute_compact/impl_a/build_substitute_compact_stdin.py:235–245` | Driver invokes via `python3 <path> <manifest>`. |
| V3 PASS digest set | tag `exec-mode-v4-replication-preregistered-20260426` annotation | Driver MUST NOT alter substitute-compact behavior; digests pin output. |
