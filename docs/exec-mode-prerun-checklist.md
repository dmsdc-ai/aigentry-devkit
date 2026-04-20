# Exec-Mode Experiment — Pre-Run Checklist

Owner: Session D (orchestrator-fixtures). Last updated: 2026-04-20.

This checklist **must be green** before tagging `exec-mode-prerun` and launching the 10-fixture × 4-mode × 30-seed campaign. Gate references spec + build plan section numbers for traceability.

---

## 1. Fixture lint gate (build spec §6.3)

Run:
```bash
cd "$HOME/projects/aigentry-devkit"
.venv-exec-mode/bin/python tests/exec-mode/test_fixture_lint.py \
  "$HOME/projects/aigentry-orchestrator/fixtures/exec-mode-experiment/"
```

All 10 fixtures must pass. Per-fixture criteria (§6.3):

- [ ] `setup_history.md` ≤ 2500 tokens (cl100k_base tokenizer)
- [ ] `warmup_transcript.md` ≤ 2500 tokens (fairness parity with D/S briefing)
- [ ] `planted_facts.json` has exactly 10 entries
- [ ] All 10 `planted_facts[*].keyword` values unique
- [ ] No pairwise substring overlap between keywords
- [ ] `probe_answers.json` aligned 1:1 with `post_probes.md` Q ordering
- [ ] `post_probes.md` keywords NOT present in `task_prompt.md` (R11)
- [ ] `post_probes.md` answer values NOT present in `task_prompt.md`
- [ ] `warmup_transcript.md` contains same 10 planted facts as `setup_history.md` (exact keyword match)
- [ ] All turn delimiters well-formed (`--- Turn N ---` or `--- User|Agent (Turn N) ---`, sequential from 1)

Current status (2026-04-20 self-lint via `/tmp/exec_mode_lint.py`):

| Fixture | Cluster | Setup tok | Warmup tok | Lint |
|---|---|---:|---:|:---:|
| Fa  | Harmful carry-over   | 1342 | 1219 | ✅ |
| F2  | Cluster 3 (P-acc)    | 1190 | 1024 | ✅ |
| F3  | Cluster 2 (S)        | 1118 |  965 | ✅ |
| F4  | Cluster 1 (D/S)      | 1199 |  955 | ✅ |
| F5  | Cluster 2 (S)        | 1091 |  887 | ✅ |
| F6  | Cluster 3 (P-acc)    | 1082 |  893 | ✅ |
| F7  | Cluster 3 (P-acc)    | 1460 | 1091 | ✅ |
| F8  | Cluster 3 (P-acc)    | 1648 | 1358 | ✅ |
| F9  | Cluster 3 (P-acc)    | 1284 | 1075 | ✅ |
| F10 | Cluster 1 (D)        | 1015 |  796 | ✅ |

**Canonical templates** (locked):
- [ ] `fixtures/exec-mode-experiment/canonical_briefing.md` unchanged since 2026-04-20 baseline
- [ ] `fixtures/exec-mode-experiment/warmup_transcript.md` unchanged since 2026-04-20 baseline

---

## 2. Harness readiness (build plan §7 T1–T7)

- [ ] `.venv-exec-mode/` created from `requirements-exec-mode.txt` (T1)
- [ ] `state/schema/metrics.v1.json` present and valid JSON Schema (T1)
- [ ] `bin/lib/exec-mode-lib.sh` helpers pass `bats tests/exec-mode/test_execmode_lib.bats` + `shellcheck` clean (T2)
- [ ] `bin/exec-mode-grader.py` Part 1 (`score_fa_false_prior` dispatcher) + Part 2 (pollution/loss dual) pass pytest (T3, T4, T9)
- [ ] `bin/exec-mode-experiment.sh --dry-run --mode D --fixture Fa` emits valid `metrics.json` (T5)
- [ ] P-fresh / P-accumulated `--dry-run` paths green (T6)
- [ ] Stage 2 probe-replay subprocess isolates session env (T7); `test_stage_isolation.bats` green

---

## 3. Grader coverage (build plan §7 T9, T16)

For each fixture, corresponding grader entry must exist in `bin/exec-mode-grader.py` dispatch registry:

- [ ] `score_fa_false_prior` → binary leak + task correctness + citation
- [ ] `score_f2_invariants_preservation` → 8 invariants regex (INV-1…INV-8)
- [ ] `score_f3_severity_weighted_f1` → 5 ground-truth issues, 2 distractors, severity weights {Crit:4, High:2, Med:1}
- [ ] `score_f4_oracle_graph` → 14 nodes, 9 edges, FFI boundary pair
- [ ] `score_f5_research_citation` → URL HEAD liveness + primary domain allowlist + 3-spot claim-citation Claude CLI judge
- [ ] `score_f6_fix_loop` → build-pass binary + turns-to-success (optimal=2 remaining)
- [ ] `score_f7_decision_propagation` → Option+Result present, Either absent, Turn 6/8 cited
- [ ] `score_f8_dedup_refactor` → hidden test pass + duplication delta + test-edit penalty (jscpd measurement)
- [ ] `score_f9_root_cause` → R4 (CircuitOpenError) picked, Turn 5 cited, fix diff regex matches, evidence rules out ≥2 red herrings
- [ ] `score_f10_resume_and_reject` → unresolved application (U1 email, U2 tests) + stale rejection (S1/S2/S3 of Turn 7 list)

Jury batching (T16) for Layer 2: 5 judges across Anthropic / OpenAI / Google families.

---

## 4. Run order pre-registration (spec §4.4)

- [ ] `run_order_D.csv` (300 rows, seed=42) committed
- [ ] `run_order_Pfresh.csv` (300 rows) committed
- [ ] `run_order_S.csv` (300 rows) committed
- [ ] `run_order_pacc.csv` (30 sessions × 10 fixtures, balanced position) committed
- [ ] All four CSVs regenerate bit-identically via `bin/exec-mode-generate-order.py` with seed=42

---

## 5. Smoke test (build plan §7 T10)

- [ ] `tests/exec-mode/smoke_live.sh` run: 1 trial × Fa × {D, P-fresh, P-acc, S} = 4 real trials
- [ ] All 4 trials emit schema-valid `metrics.json`
- [ ] 4 orthogonal metrics present per trial: `cost_*`, `quality_primary`, `pollution_layer_a_rate`, `loss_rate`
- [ ] 2-stage isolation verified: `grep CLAUDE_SESSION_ID` against Stage 2 env → empty
- [ ] Compact detection flag toggleable (simulate via input token spike fixture)
- [ ] Report posted to `docs/reports/2026-04-??-exec-mode-Fa-smoke.md`

---

## 6. Environment & hygiene

- [ ] `.venv-exec-mode/` in `.gitignore`
- [ ] No hard-coded `/Users/duckyoungkim` in `bin/exec-mode-*` or `tests/exec-mode/` (spec Rule 14):
  ```bash
  rg -n 'duckyoungkim' bin/exec-mode-* tests/exec-mode/ | grep -v -E '(\.pyc|__pycache__)' || echo "clean"
  ```
- [ ] CLI pins recorded: `claude --version`, `codex --version`, `gemini --version`, `telepty --version` written to `state/cli-versions.lock.json`
- [ ] Python deps pinned: `pip freeze > state/pip-freeze.lock.txt`

---

## 7. Budget & safety guardrails

- [ ] Per-trial cost cap enforced in harness (abort if single trial > $5)
- [ ] Rate-limit backoff verified (60s cool-off + 3 retries, spec §7.1)
- [ ] Jury + Layer B/C deferred post-run so rate limits slow reporting, not trials (R5)
- [ ] P-acc crash-mid-chain policy: discard session, log to `state/.../incidents.jsonl` (R8)

---

## 8. Tag gate

Once §§1–7 all checked:

```bash
git tag -a exec-mode-prerun -m "Pre-registration: 10-fixture × 4-mode × 30-seed campaign (v3-max.1 spec)"
git push origin exec-mode-prerun
```

Spec is **locked** at this tag (spec §R10 drift mitigation). Any post-tag change to fixtures, graders, run-orders, or metrics requires explicit orchestrator-approved `changes_log` entry in the analysis plan.

---

## Session ownership recap

- **Session A** (harness): `bin/exec-mode-experiment.sh`, `bin/lib/exec-mode-lib.sh`
- **Session B** (grader + lint test): `bin/exec-mode-grader.py`, `tests/exec-mode/test_fixture_lint.py`, per-fixture scorer registry
- **Session C** (analyzer): `bin/exec-mode-analyze.py`, run-order CSV generator
- **Session D** (fixtures — this session): `fixtures/exec-mode-experiment/F{2..10,a}/*` + this checklist

Do not cross session boundaries. Per-file edits must be owned by the designated session. Fixture edits post-tag require explicit orchestrator approval.
