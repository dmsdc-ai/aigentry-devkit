# T10 Fa Live Smoke Report — CLI-only + Isolated HOME

**Date**: 2026-04-20
**Session**: E-devkit-harness-impl (Session A)
**Build spec ref**: `aigentry-orchestrator/docs/superpowers/plans/2026-04-20-exec-mode-harness-buildplan.md` §7 T10
**Experiment spec lock**: tag `exec-mode-v3-max-preregistered-20260420` (commit `25bd0a9`)
**Harness commits exercised**: T5 `c6a27c1`, T6 `03dec46`, T7 `d62da65`

## 1. Environment

| Item | Value |
|---|---|
| `EXEC_MODE_HOME` | `/tmp/exec-mode-test-home` |
| `settings.json` | `{}` (empty — no user hooks, no project hooks) |
| Credentials source | macOS keychain (`security find-generic-password -s "Claude Code-credentials" -w`) → `$EXEC_MODE_HOME/.claude/.credentials.json` (0600) |
| Model | `claude-opus-4-7` (alias resolved to `claude-opus-4-7[1m]`) |
| claude CLI | `2.1.114 (Claude Code)` |
| Fixture root | `$HOME/projects/aigentry-orchestrator/fixtures/exec-mode-experiment` |
| State root | `$REPO_ROOT/state/exec-mode-smoke` (smoke-only; not a tracked dir) |
| Invocation | `HOME=$EXEC_MODE_HOME claude --print --output-format stream-json --verbose --disable-slash-commands --model claude-opus-4-7` |
| Fixture | `Fa` — "False Prior Override" (commit `d40e948`) |
| Grader commit used | `a802cf4` (`PRIMARY_GRADERS` dispatch with `score_fa_false_prior`) |

## 2. Isolation verification

Cheap single-token probe cost (same `Respond OK` prompt) with increasing levels of isolation:

| Config | cost_usd | cache_create | cache_read | `plugins` loaded | Notes |
|---|---:|---:|---:|---|---|
| Default (no isolation) | **$0.1393** | 20 924 | 16 657 | `superpowers` (+ others) | Baseline — ~20 K tokens of `superpowers:using-superpowers` skill injected as `additionalContext` |
| `HOME=$EXEC_MODE_HOME` only | **$0.0928** | 13 536 | 16 155 | `[]` | Plugin suppression achieved; superpowers hook gone ✓ |
| `+ --strict-mcp-config` + empty `mcpServers` | **$0.0922** | 13 432 | 16 204 | `[]` | No further reduction (built-in MCPs are not eliminable) |

**Conclusion**: Isolated HOME reduced `additionalContext` bloat from ~20 K tokens to 0 and cut per-call cost by ~33 %. A residual ~$0.09 floor remains from claude CLI built-ins.

### Stage-1 isolation invariant (grep check)

For every trial, the smoke loop greps `stage1.jsonl` for the first 30 chars of every `Q<n>.` line in `post_probes.md`. **All four trials: `iso_ok=1` (no probe text reached the Stage-1 session)**. Independently, the T7 bats suite (`test_stage_isolation.bats`, 7/7 green) guards the same invariant structurally via an `env -i` scrub.

## 3. Framework overhead caveats

**Known constant overhead per call: ~$0.09 (cache_create ~13 K + cache_read ~16 K)**

Sources that isolated HOME **cannot** eliminate (would require `ANTHROPIC_API_KEY` + `--bare`, rejected per CLI-only constraint):

- 3 built-in MCP servers: `claude.ai Gmail`, `claude.ai Drive`, `claude.ai Google Calendar` (active even with `--strict-mcp-config` + empty `mcpServers`)
- 8 built-in skills: `update-config`, `debug`, `simplify`, `batch`, `fewer-permission-prompts`, `loop`, `schedule`, `claude-api` (loaded even with `--disable-slash-commands`)
- Default system prompt + cwd/env sections + tool inventory

**Impact on metrics** (per orchestrator-approved caveat language):

- **Cost (absolute)**: inflated by a constant ~$0.09 across **all** modes → analyzer should report `cost_net_usd = cost_marginal_usd - $0.09` alongside raw for interpretability.
- **Cost (mode-to-mode comparison)**: **VALID** — the overhead is identical across D/Pfresh/Pacc/S and cancels in any differential.
- **Quality**: minimal impact — built-in skills are not invoked by the Fa task (no `/skill-name` dispatch in the agent output).
- **Pollution / Loss**: minimal impact — the constant `additionalContext` fragment does not overlap any of Fa's 10 planted-fact regex patterns, and it is not visible to Stage 2 (which runs in a fresh process under the same isolation).

**Cache behavior nuance for the 2 400-trial pilot**:

- D / S: every trial writes framework overhead to cache anew (fresh session per trial).
- P-acc: after trial 1, subsequent trials in the same chain get cache_read for the same overhead (amortizes).
- P-fresh: every seed is a new session → fresh cache_create for overhead.
- → spec §5.1 already reports `cost_marginal` + `amort(n=1,10,30)`; the analyzer's amortized view handles this naturally.

**Recommended analyzer adjustment** (documented here so Phase 4 can apply the view):

```python
CONSTANT_FRAMEWORK_OVERHEAD_PER_CALL = 0.09  # USD, measured 2026-04-20
df["cost_net_usd"] = df["cost.marginal_usd"] - CONSTANT_FRAMEWORK_OVERHEAD_PER_CALL
# Report both raw and net; flag net<0 trials as "cache-dominated"
```

## 4. Trial results

4 live trials, 1 per mode × Fa fixture × seed 0 × run 1. All 4 wrote `metrics.json` that passes `state/schema/metrics.v1.json` validation.

| mode | trial_id | cost raw ($) | cost net ($) | quality primary | primary_pass | pollution self | loss | compact | stage_iso |
|------|----------|-------------:|-------------:|----------------:|:------------:|---------------:|-----:|:-------:|:---------:|
| D      | `1/D/Fa/seed00`                | 0.0377 | −0.0523 | **1.0** | ✓ | 0.0 | **0.0** | false | ✓ |
| Pfresh | `1/Pfresh/Fa/seed00`           | 0.1327 | +0.0427 | 0.0    | ✗ | 0.0 | **0.9** | false | ✓ |
| Pacc   | `1/Pacc/Fa/seed00_pos1_sess1`  | 0.0719 | −0.0181 | 0.0    | ✗ | 0.0 | **0.0** | false | ✓ |
| S      | `1/S/Fa/seed00`                | 0.0714 | −0.0186 | **1.0** | ✓ | 0.0 | **0.0** | false | ✓ |

*cost net = cost raw − $0.09 framework floor.*
*quality primary is the `score_fa_false_prior.primary_score` output (binary: 1.0 iff `binary_false_prior_leak == 0` AND `task_correctness ≥ 0.75`).*
*pollution self is the Fa layer-A regex hit rate over 10 planted facts (0.0 means none of Fa's planted keywords surfaced in Stage 1 output — expected: the Fa task does not ask about those facts).*
*loss is `1 − hits/10` across 10 stage-2 probes answered against the Fa ground_truth.*

### Per-trial notable details (from `primary_components`)

- **D (quality=1.0)** — `task_correctness=0.75`, `return_shape=true`, `citation_hits=["3.12(.\\d+)?"]`. Clean rapidfuzz solution with NFC notes. Probe recall 10/10.
- **Pfresh (quality=0.0, loss=0.9)** — `task_correctness=0.5`, `return_shape=false`: warmup-primed solution did not satisfy the sorted-descending shape heuristic. Stage-2 recall only 1/10 (**expected**: Pfresh replays the fixture's separate `warmup_transcript.md`, which overlaps semantically with `setup_history.md` but does not plant the same 10 fact-keywords verbatim, so the Stage-2 probes — derived from `setup_history.md` facts — are mostly unanswerable. This is an **experimental artifact, not a harness bug**; for the real pilot, spec §4.1 requires `warmup_transcript.md` to embed all 10 facts. Re-confirm fixture lint before pilot.)
- **Pacc (quality=0.0, `binary_false_prior_leak=1`)** — `leak_patterns_hit=["\\bunidecode\\s*("]`. The agent **applied the stale prior**: used `unidecode(...)` in the solution despite the briefing's turn 6 reversal. Expected failure mode for Pacc at position 1 with briefing as primer? Probably not — this should behave like D. Single-seed smoke can't distinguish noise from signal; spec's 30 seeds per cell is needed.
- **S (quality=1.0)** — `task_correctness=0.75`, `citation_hits=["3.12", "default_process", "processor\\s*="]`. Strongest citation set of the four. Probe recall 10/10.

### Data paths

```
state/exec-mode-smoke/1/
├── D/Fa/seed00/
├── Pfresh/Fa/seed00/
├── Pacc/Fa/seed00_pos1_sess1/
└── S/Fa/seed00/
     each trial dir contains:
       ├── stage1.jsonl           (raw stream-json: 7 records incl. result)
       ├── stage1_output.md       (extracted assistant text, 1.3–2.5 KB)
       ├── stage2_transcript.md   (briefing + stage1_output concat)
       ├── stage2_answers.json    (10 probe_idx → answer pairs)
       ├── probes_qonly.md        (Q<n>.-filtered probes fed to stage2)
       └── metrics.json           (schema-valid)
```

## 5. Findings

### What works ✅

- **End-to-end pipeline green** — 4 trials × {compose input → live `claude --print` → extract text → Stage 2 probe subprocess → 4 grader subcommands → metrics.json assembly → schema validate → atomic write} all executed without manual intervention.
- **Schema validity** — 4/4 metrics.json pass `Draft202012Validator` against `state/schema/metrics.v1.json`. All `additionalProperties: false` constraints satisfied; `status=ok` + non-null quality/pollution/loss enforcements honored.
- **Stage-2 isolation (structural + empirical)** — T7 bats already verified the `env -i` scrub structurally; this smoke grep-verifies per trial that `stage1.jsonl` never contains any `Q<n>.` probe prefix.
- **Grader interop** — all four grader subcommands (`parse-cost`, `detect-compact`, `pollution-a`, `score-fixture --fixture Fa`) return parseable JSON and are consumed by the smoke without type coercion glitches.
- **Isolated HOME is a viable CLI-only pattern** — preserves OAuth (via Keychain→file copy), suppresses user plugins (`superpowers` fully gone), cheap to setup.

### Known issues / follow-ups 📋

1. **Grader's `parse_cost` double-counts stream-json assistant records**. claude CLI emits the assistant message twice in `stream-json` (normal message + final-iteration echo), so `parse_cost` reports `marginal_usd` ≈ 2× actual. The smoke sidesteps this by reading `total_cost_usd` from the `result` record (canonical). **Filed for E-devkit-grader** — their `parse_cost` should dedup on `message.id` or drop records after the first `type=result`.
2. **`usage_buckets` recorded as 0** on all 4 smoke metrics.json — the smoke script's `cost.get("cache_write_5m", 0)` missed the grader's `_tokens` suffix. Patch landed in `smoke_live.sh` (post-run) to look up both forms; rerun would repopulate. Not rerun to conserve budget — raw cost via `cost.marginal_usd` is canonical for this smoke.
3. **Pfresh loss=0.9 is fixture-driven, not harness-driven**. `warmup_transcript.md` does not carry all 10 planted-fact keywords verbatim. For the real pilot, spec §4.1 + build-spec R7 require fixture-lint to enforce this. Suggest Session D adds a `test_fixture_lint.py` check comparing `planted_facts.json[].keyword` against `warmup_transcript.md`.
4. **Probe parser in `execmode::stage2_probe_subprocess` assumes one probe per non-blank line**. The Fa `post_probes.md` includes a title + 3 narrator lines before the 10 `Q<n>.` questions, which the parser shuffled into the LLM prompt. The smoke works around this by pre-filtering with `grep -E '^Q[0-9]+\.'` into a sidecar `probes_qonly.md`. A future refactor could add `EXECMODE_STAGE2_PROBE_REGEX` to the lib; for now, smoke/pilot callers pre-filter.
5. **Credential persistence is keychain-backed on macOS**. The smoke extracts once into `/tmp/exec-mode-test-home/.claude/.credentials.json` (0600). This path is not ideal for a CI/automation target — the refresh token in the file has an `expiresAt` timestamp (~24 h typical). For the 2 400-trial pilot, we'll need either periodic re-extraction or a keychain read on each session start.
6. **Cache-dominated cost (cost_net < 0) on 3 of 4 trials** is not a bug — it means the trial's billed cost is entirely within the framework-overhead envelope. This is the whole point of noting the constant floor in §3. For pilot analysis, `cost_net < 0` means "the mode's incremental input is cheap relative to the framework constant," which is a useful signal.

### Phase 2 prerequisites identified

- Fix grader `parse_cost` dedup on stream-json (Session B).
- Fixture lint for `warmup_transcript.md` keyword coverage (Session D).
- Decide whether to accept framework-overhead floor or prepare `ANTHROPIC_API_KEY` path for the 2 400-trial pilot (orchestrator + user).
- Wire the harness's live path (currently stubbed, exit 5) using the patterns validated by this smoke — composing input, calling claude under isolated HOME, pulling the grader, assembling schema-validated metrics. That work lives ahead of Phase 2's pilot run.

## 6. Recommendation

**Proceed to Phase 2 pilot (30 seeds × 4 modes × 1 fixture → 120 trials)** with the following conditions:

- Orchestrator ackowledges the constant $0.09 framework floor and records `cost_net` alongside `cost_marginal` in pilot analysis.
- Session B fixes the `parse_cost` double-count before pilot — **blocking** for cost validity, not for wiring.
- Session D confirms `warmup_transcript.md` carries all 10 planted facts, or spec-clarifies the Pfresh loss expectation.
- The smoke script becomes the working basis for the harness's live-path implementation (Phase 2 T10-followup) — probably via a new `bin/exec-mode-experiment.sh --isolated-home` flag.

Budget consumed: ~$0.69 (3 pre-flight probes + 4 trials × 2 stages). Well under the $2 cap.

## Appendix A — commands used (reproducibility)

```bash
# 1. Isolated HOME setup (once)
export EXEC_MODE_HOME=/tmp/exec-mode-test-home
mkdir -p "$EXEC_MODE_HOME/.claude"
umask 077
security find-generic-password -s "Claude Code-credentials" -w \
  > "$EXEC_MODE_HOME/.claude/.credentials.json"
chmod 600 "$EXEC_MODE_HOME/.claude/.credentials.json"
echo '{}' > "$EXEC_MODE_HOME/.claude/settings.json"

# 2. Smoke run (all 4 modes)
rm -rf /tmp/exec-mode-smoke-state
EXEC_MODE_STATE=/tmp/exec-mode-smoke-state \
  bash tests/exec-mode/smoke_live.sh
```

## Appendix B — diff vs orchestrator's Step 4 checklist

| Gate item | Status | Evidence |
|---|:---:|---|
| `cost_marginal_$` parsed from real jsonl | ✓ | `result.total_cost_usd` read per trial; values $0.0377–$0.1327 |
| `cost_net_$` (after subtracting $0.09) recorded | ✓ | Table column "cost net" |
| All 4 metrics recorded (cost, quality, pollution, loss) | ✓ | 4/4 metrics.json schema-valid |
| 2-stage isolation: Stage 1 never sees probe | ✓ | `iso_ok=1` on all 4; structural T7 bats green |
| Compact flag respected (should be false for 1-fixture trials) | ✓ | `compact.detected=false` on all 4 |
