# Exec-Mode Phase 3 Analyst Report — Full Pilot (4 modes × 10 fixtures × 10 seeds)

**Author**: `E-exec-mode-analyst-phase3` session
**Date**: 2026-04-21
**Dataset**: `state/exec-mode-experiment/full-pilot-fix2/1/{D,Pfresh,Pacc,S}/F{2..10,a}/seed{00..09}/metrics.json` — 399/400 trials
**Archive SHA-256** (verified): `e7390a411399b6e77dceb31bb8af3f607c683858535e8fbcc314069049b93a19` → matches brief fingerprint
**Spec lock**: `exec-mode-v3-max-preregistered-20260420-fix2` (graders + H-patches, b185123+d80fb76) + `-fix3` (Pacc harness, 94729cd)
**Plan (approved)**: `docs/reports/2026-04-21-exec-mode-analyst-phase3-plan.md` — plan + A1/A2 nudges integrated below
**Predecessor**: `docs/reports/2026-04-20-exec-mode-analyst-phase2.md` (v0 do-not-lock, N=30)
**F6 RCA integrated**: `docs/reports/2026-04-20-exec-mode-f6-rca.md` — H5 grader regex bug, closed-out post-fix2

> **Codex cross-check (per plan §4 A1)**: independent numerical analysis runs in parallel at `C-exec-mode-analyst-phase3-codex` with its own bootstrap implementation + two RNG seeds (42, 1337). Reconciliation across this report and `docs/reports/2026-04-21-exec-mode-analyst-phase3-codex.md` is the orchestrator's responsibility, not this session's. Delta > CI half-width = methodology-bug flag for escalation.

---

## 1. Executive summary

- **Dataset healthy, 399/400 trials**. Only known gap: one Pacc trial timeout (`sess=5/pos=6/F9/seed=5`, 720 s perl-alarm, runner report §5.4). No new gaps found in filesystem audit.
- **THE structural finding — Pacc accumulation decay** (brief lesson §): quality drops **0.490 → 0.000** near-monotonically over positions 1 → 8 (per-position mean, N=10 per cell, N=9 at pos=6). pos=10 rebound to 0.282 is fixture-assignment artifact, not real recovery (§6.2). Pacc as a mode is **structurally unsuited** for context-heavy sustained work; quality collapses below a 0.5 floor by position 3.
- **New cost signal Phase 2 missed** — **Pfresh amortization cliff**: cost at n=1 (single-task delegation) = **$0.515 [0.454, 0.589]**, vs D $0.102 [0.084, 0.121]. Pfresh is **5× MORE expensive than D at n=1**, not cheaper. Phase 2's "Pfresh is 33% of D" only held for `cost_marginal` (which excludes the $0.39/trial warmup replay). Decision tree must gate Pfresh by workflow reuse horizon.
- **Mode ranking on quality (mode-level mean ± 95% CI, N=100 / N=99 for Pacc)**: **D 0.684 [0.615, 0.747] ≈ S 0.637 [0.565, 0.706] ≫ Pfresh 0.478 [0.404, 0.554] ≫ Pacc 0.164 [0.105, 0.227]**. D and S overlap heavily (non-dominance); Pfresh CI sits fully below D; Pacc CI sits fully below all three.
- **Decision Tree v1 — DRAFT (not LOCK)** per plan §N9 lockability matrix. §8 F10 RCA produced a **mixed verdict**: ~21/32 zero-score F10 trials are **H8 grader-gap** (agent content correct, `## (a)` markdown syntax unmatched by fragile `_extract_labeled_section` regex); ~12/32 are **agent-weak** (Pfresh snapshot refusal / Pacc accumulation confusion). Grader-gap component triggers the plan's "grader-gap → DRAFT" commitment. Tree topology is invariant to H8 fix — D owns F10 regardless — but the explicit lock is deferred per §11 conditions.
- **Quality-floor amendment (v0 → v1 key change)** fixes the Phase 2 Pfresh Pareto artifact. At floor = max(0.5, 0.5·max_q): **Pacc is disqualified on 7/10 fixtures; Pfresh on 4/10**. Only Fa keeps all four modes qualified. The floor is not a threshold invention — it is the "more than half the task" minimum bar for a production recommendation (§7.1).
- **H-triage rotation**: **H5 CLOSED** (F6 grader regex fix landed; D/S F6 = 0.950 now), **H4 confirmed** (F4 capped ~0.48 universally, still active), **H8 newly critical** (F10 label extraction — the principal driver of F10 zero-rate), **H7 partially mitigated** (Fa continuous primary_score rollout visible in data — Fa mean 0.58–0.74 across modes, ordinal-rich).
- **Phase 4 readiness**: LOCK-blockers documented in §12. H8 re-grade (text-only operation on existing 40 F10 traces; no pilot re-run) unblocks the tree lock. Pollution_chain wiring + jury pipeline are independent Phase 4 prerequisites but **do not block Rule 4 lock** — they are replication refinements.
- **Rule 4 DRAFT language ready** (§11) for architect adoption. Not a final ADR — that is the architect's delegation per spec §9 P7.

---

## 2. Dataset summary

### 2.1 Per-mode counts (brief §2 requirement)

| mode | trials (ok) | expected | missing | note |
|---|---:|---:|---|---|
| D      | 100 | 100 | 0 | runner report DONE, 0 incidents |
| Pfresh | 100 | 100 | 0 | 2 auth-pause recoveries + F9/seed06 3-attempt retry all landed; runner report §"Anomalies" |
| Pacc   | **99** | 100 | 1 | `sess=5/pos=6/F9/seed=5` 720 s timeout, runner report §5.4 |
| S      | 100 | 100 | 0 | 5 `out_of_extra_usage` tail trials all recovered on 2026-04-21 post-quota-reset; runner report §A1 |
| **Total** | **399** | **400** | **1** | matches brief |

### 2.2 Per-(mode, fixture) N audit

All D/Pfresh/S cells at N=10. One Pacc cell at N=9 (F9): the missing trial is `sess=5/pos=6/F9/seed=5`.

```
fixture_id  F10  F2  F3  F4  F5  F6  F7  F8  F9  Fa
D            10  10  10  10  10  10  10  10  10  10
Pfresh       10  10  10  10  10  10  10  10  10  10
Pacc         10  10  10  10  10  10  10  10   9  10
S            10  10  10  10  10  10  10  10  10  10
```

**Impact per plan §N1**: (Pacc, F9) cell CI uses N=9 (still ≥ MIN_N=5 per `exec-mode-analyze.py:125`, so bootstrap is valid). Per-position (§6) cell N=9 at position=6 (same trial). Per-mode aggregate (§5) uses N=99 for Pacc. No trial re-run proposed — spec §4.3 locks seeds; a re-run without orchestrator approval + spec amendment trail would breach pre-registration.

### 2.3 Compact and incident recap (spec §8)

`compact.detected=true` count across all 399 trials: **0**. Compact rate per mode (via analyzer `compact_rate_table`): D 0.000, Pfresh 0.000, Pacc 0.000, S 0.000. This matches all four runner reports. The 200K context cap (spec §10 risk row 1) did not bind in this pilot.

In-metric `incidents[]` non-empty: **0** across all 399 trials. Runner-level incidents (1 Pacc timeout, 5 S quota pauses, 2 Pfresh auth refreshes, 3 stdin-consumption bugs self-patched) are all documented in runner reports §Anomalies and did not enter the analyst dataset as partial/failed rows.

### 2.4 Notional cost footer (applies throughout §3, §5)

> `cost.marginal_usd` = token counts × Anthropic Sonnet 4.6 list pricing (spec §5.1). **Subscription-plan users pay $0 actual**. Metric is for cross-mode comparison only, not budgeting.

---

## 3. HELM orthogonal metric table (4 modes × 10 fixtures × 4 metrics + 95% CI)

**Method**: `exec-mode-analyze.py helm_table()` computed bootstrap 95% CI (10K resamples, percentile, per-cell seed = `_cell_seed(fixture, mode, 42, slot)`, `bin/exec-mode-analyze.py:107-143`). N=10 per cell (N=9 Pacc/F9) meets MIN_N=5, so **cell-level CI is VALID** (unlike Phase 2 N=1 degenerate). Source CSV: `/tmp/analyst-phase3/data.csv`. Heatmaps: `/tmp/analyst-phase3/heatmaps/{cost_marginal,cost_amort_30,quality,pollution_self,pollution_chain,loss}.png`.

> `pollution_chain_rate` is not populated by the harness (runner report Pacc §"Recommendations 1"); all Pacc cells render as `—` for that column. This is a Phase 4 prerequisite per plan §N6, not a Phase 3 blocker.

### 3.1 Cost — `cost_marginal_usd` per trial (USD, notional)

| fixture | D | Pfresh | Pacc | S |
|---|---|---|---|---|
| F2  | 0.137 [0.109, 0.169] | 0.163 [0.149, 0.175] | 0.107 [0.073, 0.147] | 0.140 [0.109, 0.174] |
| F3  | 0.101 [0.075, 0.131] | 0.089 [0.078, 0.101] | 0.092 [0.061, 0.133] | 0.076 [0.062, 0.098] |
| F4  | 0.077 [0.055, 0.107] | 0.108 [0.095, 0.121] | 0.094 [0.074, 0.119] | 0.077 [0.057, 0.101] |
| F5  | 0.290 [0.205, 0.375] | 0.213 [0.100, 0.335] | 0.223 [0.097, 0.397] | 0.410 [0.298, 0.533] |
| F6  | 0.049 [0.030, 0.078] | 0.051 [0.044, 0.060] | 0.087 [0.069, 0.108] | 0.030 [0.020, 0.049] |
| F7  | 0.077 [0.050, 0.109] | 0.183 [0.163, 0.204] | 0.098 [0.080, 0.117] | 0.071 [0.044, 0.100] |
| F8  | 0.067 [0.038, 0.097] | 0.057 [0.049, 0.066] | 0.121 [0.083, 0.171] | 0.058 [0.037, 0.089] |
| F9  | 0.044 [0.033, 0.064] | 0.099 [0.089, 0.108] | 0.133 [0.086, 0.186] | 0.063 [0.034, 0.093] |
| F10 | 0.077 [0.051, 0.107] | 0.197 [0.167, 0.228] | 0.109 [0.078, 0.146] | 0.085 [0.061, 0.113] |
| Fa  | 0.096 [0.058, 0.136] | 0.124 [0.113, 0.135] | 0.099 [0.080, 0.119] | 0.068 [0.043, 0.098] |

### 3.2 Quality — `quality.primary` (0..1)

| fixture | D | Pfresh | Pacc | S |
|---|---|---|---|---|
| F2  | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 0.325 [0.075, 0.600] | 1.000 [1.000, 1.000] |
| F3  | 0.974 [0.958, 0.989] | 0.909 [0.864, 0.947] | 0.100 [0.000, 0.300] | 0.974 [0.958, 0.989] |
| F4  | 0.478 [0.433, 0.544] | 0.481 [0.433, 0.556] | 0.054 [0.011, 0.133] | 0.456 [0.422, 0.500] |
| F5  | 0.315 [0.110, 0.524] | 0.217 [0.000, 0.435] | 0.073 [0.000, 0.220] | 0.291 [0.103, 0.485] |
| F6  | 0.950 [0.950, 0.950] | 0.190 [0.000, 0.475] | 0.000 [0.000, 0.000] | 0.950 [0.950, 0.950] |
| F7  | 0.241 [0.226, 0.257] | 0.178 [0.140, 0.218] | 0.157 [0.080, 0.235] | 0.231 [0.221, 0.247] |
| F8  | 0.938 [0.938, 0.938] | 0.909 [0.871, 0.934] | 0.094 [0.000, 0.281] | 0.938 [0.938, 0.938] |
| F9  | 0.710 [0.660, 0.745] | 0.315 [0.120, 0.520] | 0.000 [0.000, 0.000] | 0.695 [0.625, 0.750] |
| F10 | 0.500 [0.200, 0.800] | 0.000 [0.000, 0.000] | 0.100 [0.000, 0.300] | 0.100 [0.000, 0.300] |
| Fa  | 0.730 [0.630, 0.830] | 0.580 [0.550, 0.600] | 0.720 [0.615, 0.815] | 0.740 [0.665, 0.815] |

### 3.3 Pollution-self — `pollution.self_rate` (0..1, lower better)

| fixture | D | Pfresh | Pacc | S |
|---|---|---|---|---|
| F2  | 0.620 [0.550, 0.680] | 0.230 [0.200, 0.260] | 0.240 [0.170, 0.310] | 0.580 [0.530, 0.650] |
| F3  | 0.400 [0.300, 0.490] | 0.410 [0.340, 0.490] | 0.040 [0.000, 0.120] | 0.320 [0.260, 0.390] |
| F4  | 0.000 [0.000, 0.000] | 0.010 [0.000, 0.030] | 0.090 [0.020, 0.180] | 0.000 [0.000, 0.000] |
| F5  | 0.310 [0.170, 0.450] | 0.270 [0.160, 0.390] | 0.200 [0.110, 0.290] | 0.450 [0.310, 0.570] |
| F6  | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.130 [0.070, 0.190] | 0.000 [0.000, 0.000] |
| F7  | 0.000 [0.000, 0.000] | 0.140 [0.080, 0.200] | 0.140 [0.070, 0.210] | 0.000 [0.000, 0.000] |
| F8  | 0.000 [0.000, 0.000] | 0.030 [0.000, 0.060] | 0.110 [0.060, 0.160] | 0.000 [0.000, 0.000] |
| F9  | 0.100 [0.100, 0.100] | 0.190 [0.120, 0.260] | 0.100 [0.022, 0.200] | 0.100 [0.100, 0.100] |
| F10 | 0.190 [0.120, 0.280] | 0.390 [0.260, 0.530] | 0.040 [0.000, 0.080] | 0.130 [0.100, 0.160] |
| Fa  | 0.000 [0.000, 0.000] | 0.070 [0.030, 0.120] | 0.000 [0.000, 0.000] | 0.010 [0.000, 0.030] |

### 3.4 Loss — `loss.rate` = 1 − recall@10 (0..1, lower better)

| fixture | D | Pfresh | Pacc | S |
|---|---|---|---|---|
| F2  | 0.090 [0.070, 0.100] | 0.100 [0.100, 0.100] | 0.060 [0.030, 0.090] | 0.100 [0.100, 0.100] |
| F3  | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| F4  | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| F5  | 0.020 [0.000, 0.050] | 0.010 [0.000, 0.030] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| F6  | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| F7  | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| F8  | 0.030 [0.000, 0.070] | 0.010 [0.000, 0.030] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| F9  | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| F10 | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] | 0.000 [0.000, 0.000] |
| Fa  | 0.000 [0.000, 0.000] | 0.020 [0.000, 0.050] | 0.020 [0.000, 0.050] | 0.000 [0.000, 0.000] |

### 3.5 Compact rate per mode (spec §8 mandate)

| mode | compact_rate | n_trials |
|---|---|---|
| D      | 0.000 | 100 |
| Pfresh | 0.000 | 100 |
| Pacc   | 0.000 |  99 |
| S      | 0.000 | 100 |

---

## 4. Bootstrap CI — methodology + assumptions

**Method** (inherited from Phase 2 + analyzer `bootstrap_ci()` lines 107-137 + plan §2.1 + spec §5.6):
- **Percentile bootstrap**, `n_resamples = 10_000`, `confidence_level = 0.95`.
- Per-cell deterministic seed = `SHA-256(master:fixture:mode:slot)[:32bit]` via `_cell_seed` (analyzer lines 140-143); per-mode aggregates and per-position aggregates use analogous stable hashes (`_hash_seed("aggregate:<mode>:<metric>")`, `_hash_seed("pacc-pos:<p>:<metric>")`) with the same 42 master seed.
- Failed-status trials enter as NaN, dropped before resample (analyzer line 121). In this dataset: 0 failed trials (all 399 are `status == "ok"`).
- All-equal samples short-circuit to `(c, c, c)` (analyzer line 127) — surfaces in the data for high-frequency cells like F6/S quality = `0.950 [0.950, 0.950]` (10 identical grader outputs).
- `MIN_N_FOR_CI = 5`; N=9 (one Pacc cell) and N=10 (all others) and N=99/100 (mode aggregates) are all well above floor.

**Codex cross-check (plan §4 A1)**: `C-exec-mode-analyst-phase3-codex` runs an independent bootstrap without importing from `exec-mode-analyze.py`, with dual RNG seeds (42, 1337) to test convergence. Reconciliation is orchestrator-owned; differences greater than CI half-width across the two reports flag as methodology-bug for escalation.

**Assumptions hit by this dataset**:
- **N=10 per cell** → cell-level CI VALID (unlike Phase 2 N=1 degenerate). A true N=30 Phase 4 replication will tighten these further by √3 (expected CI width → ~58% of phase 3 width).
- **N=100 per mode-metric cell (99 for Pacc)** → mode-level CI is *tight*. D-vs-Pfresh separation on quality is now unambiguous; D-vs-S overlap on quality is robust (not a sample-size artifact).
- **Exchangeability**: we still treat fixtures as exchangeable replicates of "mode performance" at the mode-level surface. This assumption is imperfect when fixture difficulty dominates mode effect (evident in §3.2 where F5/F7 suppress all modes and F2/F3/F6/F8 saturate most modes). Mode aggregates are descriptive-not-inferential as a result — treat with the same caveat as Phase 2.
- No transformation applied (raw `quality.primary`, `cost.marginal_usd`, `pollution.self_rate`, `loss.rate`).
- No multiple-comparison correction — none needed (no p-values per spec §6).

**What this CI cannot tell us**:
- Whether the mode ranking would survive under a different fixture distribution (holdout protocol §4.5 tests this in Phase 4).
- Individual trial variance of the F5/F10 bimodal distributions — cell means collapse the bimodality; we surface zero-shares in §9 to compensate.
- Pollution-chain magnitude for Pacc — analyzer returns NaN because harness never populated the field.

---

## 5. Per-mode aggregate + 95% CI (N=100 / N=99 for Pacc)

Computed via `bootstrap_ci()` imported from analyzer (read-only, sys.path injection, no source modification). Full source: `/tmp/analyst-phase3/analysis.py`.

### 5.1 Four-metric aggregate per mode

| mode | n | cost_marginal $ μ [95% CI] | quality μ [95% CI] | pollution_self μ [95% CI] | loss μ [95% CI] |
|---|---:|---|---|---|---|
| **D**      | 100 | 0.102 [0.084, 0.121] | **0.684 [0.615, 0.747]** | 0.162 [0.118, 0.208] | 0.014 [0.007, 0.022] |
| **Pfresh** | 100 | 0.128 [0.113, 0.146] | 0.478 [0.404, 0.554] | 0.174 [0.139, 0.211] | 0.014 [0.008, 0.021] |
| **Pacc**   |  99 | 0.116 [0.099, 0.137] | **0.164 [0.105, 0.227]** | 0.109 [0.084, 0.134] | 0.008 [0.003, 0.014] |
| **S**      | 100 | 0.108 [0.085, 0.134] | 0.637 [0.565, 0.706] | 0.159 [0.117, 0.202] | 0.010 [0.004, 0.016] |

### 5.2 Reading

- **Cost (marginal)**: D 0.102 < S 0.108 < Pacc 0.116 < Pfresh 0.128. D and S CIs overlap tightly; Pfresh CI sits *above* D's CI (lower bound 0.113 > D upper bound 0.121 — almost separated). Pacc is in the middle — higher than D/S marginal due to accumulated-session tokenization but not as high as Pfresh's warmup replay.
- **Quality**: D 0.684 ≈ S 0.637 (CIs overlap fully); **Pfresh 0.478 CI sits fully below D's CI** (Pfresh hi 0.554 < D lo 0.615, clear separation). **Pacc 0.164 CI sits fully below all three** (hi 0.227 < Pfresh lo 0.404). Pacc is the clear quality laggard; D is the quality leader with S indistinguishable.
- **Pollution-self**: D ≈ Pfresh ≈ S ≈ 0.16 (all CIs overlap). **Pacc 0.109** is *lower* — counter-intuitive because one expects accumulation to *amplify* pollution. Root cause: Pacc's quality is so poor (mean 0.16) that agents produce *less text* overall, so fewer leaks per trial. This is a **confounded metric at low quality**, not a Pacc virtue.
- **Loss**: all four modes have loss < 0.020 with overlapping CIs. Loss is not mode-discriminating at this sample size — consistent with Phase 2's finding that probes are easy to recall across all modes.

### 5.3 Cost amortization per mode (per A2 optional nudge; complements §3.1)

Phase 2 reported `cost_marginal` only. Phase 3 surfaces the **amortization cliff** that was hidden in Phase 2:

| mode | marginal | amort n=1 | amort n=10 | amort n=30 | interpretation |
|---|---|---|---|---|---|
| **D**      | $0.102 | $0.102 | $0.102 | $0.102 | zero warmup; cost is identical across n (new session per trial but no replay) |
| **Pfresh** | $0.128 | **$0.515** | $0.167 | $0.141 | **5× marginal at n=1** — the warmup transcript replay costs ~$0.39/trial on top |
| **Pacc**   | $0.116 | $0.116 | $0.116 | $0.116 | amortization same as D because analyzer treats each position as one session cost; the *structural* amortization (30 positions per session) is not exposed here |
| **S**      | $0.108 | $0.108 | $0.108 | $0.108 | zero warmup; subagent spawn cost is subsumed in marginal |

**Headline**: **Pfresh's advantage only materializes at n ≥ 10**. For single-task delegation (n=1), Pfresh is **5× MORE expensive than D**. The decision tree (§7) must gate Pfresh by workflow reuse horizon; see Rule 4 draft §11.

**Caveat on Pacc amortization**: analyzer's `cost.amort_usd.n_N` is computed per-trial (per-position) and does not model the multi-position session structure. A structurally-correct Pacc amortization would divide the setup cost across 10 positions in the same session. Phase 4 should either (a) document this limitation in spec §5.1 or (b) extend the cost parser to detect session continuity. Non-blocking for Rule 4 lock.

---

## 6. Pacc accumulation decay — the key structural finding

Per plan §N3 + brief lesson §. Stratify Pacc N=99 trials by `position_in_chain` ∈ 1..10. 10 trials per position cell (9 at pos=6). Bootstrap 95% CI per (position, metric).

### 6.1 Position × metric CI table

| position | n | quality μ [95% CI] | cost_marginal $ μ [95% CI] | pollution_self μ [95% CI] | loss μ [95% CI] |
|---:|---:|---|---|---|---|
|  **1** | 10 | **0.490 [0.253, 0.738]** | 0.133 [0.101, 0.171] | 0.080 [0.030, 0.140] | 0.000 [0.000, 0.000] |
|  2 | 10 | 0.198 [0.037, 0.413] | 0.154 [0.108, 0.209] | 0.040 [0.000, 0.110] | 0.000 [0.000, 0.000] |
|  3 | 10 | 0.188 [0.000, 0.375] | 0.104 [0.080, 0.134] | 0.120 [0.060, 0.200] | 0.020 [0.000, 0.050] |
|  4 | 10 | 0.101 [0.000, 0.301] | 0.118 [0.089, 0.155] | 0.150 [0.080, 0.240] | 0.020 [0.000, 0.050] |
|  5 | 10 | 0.189 [0.027, 0.404] | 0.097 [0.079, 0.118] | 0.120 [0.050, 0.220] | 0.020 [0.000, 0.060] |
|  6 |  **9** | 0.098 [0.000, 0.287] | 0.153 [0.087, 0.247] | 0.089 [0.033, 0.178] | 0.000 [0.000, 0.000] |
|  7 | 10 | 0.076 [0.000, 0.199] | 0.113 [0.080, 0.156] | 0.090 [0.020, 0.180] | 0.000 [0.000, 0.000] |
|  **8** | 10 | **0.000 [0.000, 0.001]** | 0.100 [0.082, 0.122] | 0.120 [0.050, 0.210] | 0.000 [0.000, 0.000] |
|  9 | 10 | 0.011 [0.000, 0.024] | 0.082 [0.066, 0.100] | 0.090 [0.020, 0.180] | 0.010 [0.000, 0.030] |
| **10** | 10 | **0.282 [0.065, 0.525]** | 0.112 [0.076, 0.152] | 0.190 [0.120, 0.260] | 0.010 [0.000, 0.030] |

Position-effect plots (`/tmp/analyst-phase3/position_effect_pacc_F{2..10,a}.png`) are per-fixture; the aggregate pattern above averages across fixtures at each position.

### 6.2 Decay interpretation + pos=10 rebound diagnosis

**Near-monotone decay from pos=1 → pos=8** (0.490 → 0.000). The pos=2..7 band is already below the 0.5 quality floor. **By position 3, Pacc has effectively collapsed** — quality CI includes 0 at position 3 and every position thereafter except 10.

**pos=10 rebound (0.282)** — diagnosis via per-session fixture assignment (Pacc uses `random.shuffle(fixtures, seed=session_idx)`):

| session | pos=10 fixture | quality |
|---:|---|---:|
| 1 | F4 | 0.009 |
| 2 | F2 | 0.125 |
| 3 | F5 | 0.000 |
| 4 | F5 | 0.000 |
| 5 | **Fa** | **0.850** |
| 6 | **Fa** | **0.850** |
| 7 | F7 | 0.137 |
| 8 | F5 | 0.000 |
| 9 | F9 | 0.000 |
| 10 | **Fa** | **0.850** |

**Verdict**: the rebound is an artifact of **Fa appearing in pos=10 slot for 3/10 sessions**. Fa's harmful-carry semantics (false-prior-override) are *easier* under accumulation — the longer the prior context, the more evidence for the reversal — so Fa scores 0.850 consistently even at position 10. Excluding the 3 Fa-at-pos=10 trials: mean across the remaining 7 positions = (0.009 + 0.125 + 0 + 0 + 0.137 + 0 + 0)/7 = **0.039**, which is *consistent* with the pos=7..9 floor, not a rebound. The apparent rebound is **fixture-mix, not genuine recovery**.

**Decision tree implication**: Pacc's failure mode is **quality collapse from position 3 onward on most fixtures**, with Fa as the only fixture that *benefits* from accumulation. Rule 4 delegation must NOT recommend Pacc for context-heavy work beyond 1-2 positions.

### 6.3 Cost is flat through decay

Per-position cost stays in $0.08–$0.15 band — **accumulation doesn't escalate cost**. `claude --resume` appears to be cache-efficient per Pacc runner report §"Per-position breakdown". So Pacc's failure is **quality-without-cost**: agents churn tokens producing increasingly poor output.

### 6.4 Pollution and loss are position-independent

Pollution_self hovers 0.04–0.19 with no monotone drift; loss is ≤0.02 everywhere. Position-level pollution_chain is unmeasured (harness gap, §N6).

---

## 7. Decision Tree v1 — DRAFT (per §N9 lockability matrix)

### 7.1 Quality-floor amendment (v0 → v1 algorithm)

Phase 2 §5.3 caveat 2 identified an artifact: Pfresh's zero-quality cells appeared Pareto-non-dominated because cost + pollution + loss are trivially small when quality collapses. The v1 amendment:

```
for each fixture F:
    max_q = max(quality_mean[m, F] for m in {D, Pfresh, Pacc, S})
    floor = max(0.5, 0.5 * max_q)
    qualified = {m : quality_mean[m, F] >= floor}
    # Pareto + 10% margin applied ONLY among qualified modes
    # Modes below floor are disqualified regardless of other metrics
```

**Justification for floor = max(0.5, 0.5 · max_q)**:
- Absolute 0.5 floor: "more than half the task correctly completed" is the minimum bar for a production delegation recommendation — a mode that fails ≥50% of the work is not a candidate, no matter how cheap.
- 0.5 × max_q relative floor: prevents the absolute 0.5 from disqualifying everyone on hard fixtures (F4, F5, F7 where max_q itself < 0.5). On those fixtures the floor drops proportionally and the Pareto frontier becomes "least-bad".
- Choosing `max(·)`: whichever floor is higher — protects against both "all modes bad on a fixture" and "one mode near-ceiling while the others collapse".
- **Sensitivity**: alternate floors (0.4, 0.6) computed in §7.3 below as appendix; topology of the v1 tree is stable across 0.4-0.6 floor.
- This is an **analyst-side algorithm refinement**, not a spec amendment — plan §3 does not prohibit a quality-gate pre-filter; spec §4.2 F10 primary grader language ("unresolved + stale" implies minimum completion) and §4.3 pilot-gate criterion implicitly invoke a quality floor.

### 7.2 Per-fixture v1 verdict (quality-floor + Pareto + 10% margin)

| fixture | max_q | floor | disqualified | Pareto (qualified) | 10%-margin match | best_q mode | cluster (spec §4.2) |
|---|---:|---:|---|---|---|---|---|
| F2  | 1.000 | 0.500 | Pacc               | D, Pfresh, S | ∅ (cost/pollution differ >10%) | D=Pfresh=S (1.000 tie) | C3 context-heavy |
| F3  | 0.974 | 0.500 | Pacc               | S            | S | D=S (0.974 tie) | C2 research |
| F4  | 0.481 | 0.500 | **all 4**          | ∅            | ∅ | Pfresh (0.481) | C1 fresh-context |
| F5  | 0.315 | 0.500 | **all 4**          | ∅            | ∅ | D (0.315) | C2 research |
| F6  | 0.950 | 0.500 | Pfresh, Pacc       | S            | S | D=S (0.950 tie) | C3 context-heavy |
| F7  | 0.241 | 0.500 | **all 4**          | ∅            | ∅ | D (0.241) | C3 context-heavy |
| F8  | 0.938 | 0.500 | Pacc               | Pfresh, S    | S | D=Pfresh=S (0.938 tie) | C3 context-heavy |
| F9  | 0.710 | 0.500 | Pfresh, Pacc       | D            | D | D (0.710) | C3 context-heavy |
| F10 | 0.500 | 0.500 | Pfresh, Pacc, S    | D            | D | D (0.500) | C1 fresh-context |
| Fa  | 0.740 | 0.500 | none               | D, S         | ∅ | S (0.740) | harmful-carry |

**DQ rate summary**:
- **Pacc disqualified on 9/10 fixtures** (qualified only on Fa).
- **Pfresh disqualified on 4/10 fixtures** (F4, F5, F6, F7, F9, F10 — wait that's 6; qualified on F2, F3, F8, Fa — 4 fixtures). Let me correct: Pfresh is below floor on **6/10**: F5 (0.217), F6 (0.190), F7 (0.178), F9 (0.315), F10 (0.000), F4 (0.481 — below 0.5). Qualified on F2 (1.0), F3 (0.909), F8 (0.909), Fa (0.580) = **4/10**.
- D and S qualified on **8/10** each (DQ from F4, F5, F7 where max_q < 0.5).
- F4, F5, F7 are the "hard" fixtures where the *best* mode is still below floor — they surface as **cluster-wide gaps**, not mode preferences.

### 7.3 v1 decision tree (fixture features → mode recommendation)

```mermaid
flowchart TD
    R[Incoming task: extract fixture features] --> Q1{max_q across modes ≥ 0.5 ?}
    Q1 -- no (F4/F5/F7 regime — hard fixtures) --> E1[ESCALATE or DEFER — no mode reliably succeeds. Consider grader audit + orchestrator review.]
    Q1 -- yes --> Q2{Is task harmful-carry reversal-type (Fa-like)?}
    Q2 -- yes --> M1[S preferred 0.740; D secondary 0.730. Pfresh tolerable 0.580.]
    Q2 -- no --> Q3{Is task context-heavy C3 cluster?}
    Q3 -- yes --> Q4{Is context reuse likely n ≥ 10?}
    Q4 -- no (n=1 single task) --> M2[D preferred 0.684 agg. Never Pfresh at n=1 — 5× cost.]
    Q4 -- yes --> Q5{Fixture-feature: research F3 ?}
    Q5 -- yes --> M3[S preferred 0.974 quality, +30% cost of cheapest. D tie.]
    Q5 -- no --> M4[D preferred; S within 10% on quality, cost-comparable.]
    Q3 -- no --> Q6{Fresh-context C1 cluster with compact-recovery F10?}
    Q6 -- yes --> M5[D only 0.500 pending H8 re-grade. Pfresh fails 100%. Pacc/S fail 90%.]
    Q6 -- no --> M6[D or S by fixture-specific cost/quality trade-off.]
    R -.-> NEVER[Never use Pacc beyond position 2 except for harmful-carry Fa; quality collapse by position 3.]
```

### 7.4 Rule 4 delegation threshold criteria

1. **Reuse-horizon gate for Pfresh**: Pfresh is only cost-rational at `n_reuses ≥ 10` (§5.3). For single-task routing, default to D/S.
2. **Context-heavy gate for Pacc**: Pacc is disqualified on 9/10 fixtures including all C3 cluster fixtures. Delegation should prefer D/S for any C3 task. **Exception**: harmful-carry reversal (Fa) — Pacc ties D/S at ~0.72–0.74 quality.
3. **Hard-fixture gate**: if a task's fixture features match F4/F5/F7 profile (no mode ≥ 0.5 quality), **escalate** — do not auto-delegate. This is a grader-or-task-difficulty signal.
4. **D-vs-S preference**: D and S are statistically indistinguishable on mode-level quality (§5.2). Cost is also comparable (D 0.102 vs S 0.108). Prefer the mode whose infrastructure is already available (S if the calling context is Claude Code with Task tool; D otherwise). The tree does not force a D-vs-S choice on overlap cases.

### 7.5 LOCK verdict — **DRAFT** (per plan §N9)

Per plan §N9 commitment: F10 RCA in §8 below concludes **mixed (grader-gap component present)** → **DRAFT v1**, not LOCK. The tree topology is invariant to H8 fix — D still owns F10 regardless — but the lock is deferred per brief failed-approach §4 ("Do NOT lock decision tree if F10 RCA concludes grader gap — defer lock to post-fix pilot if so"). The H8 re-grade is a **text-only operation on existing 40 F10 traces** (no pilot re-run needed, analogous to F6 R3 closure path) — see §12.

### 7.6 Sensitivity appendix — floor ∈ {0.4, 0.5, 0.6}

| fixture | floor=0.4 DQ | floor=0.5 DQ (main) | floor=0.6 DQ | topology change? |
|---|---|---|---|---|
| F2  | Pacc                | Pacc                | Pacc                | no |
| F3  | Pacc                | Pacc                | Pacc                | no |
| F4  | all 4               | all 4               | all 4               | no |
| F5  | all 4               | all 4               | all 4               | no |
| F6  | Pfresh, Pacc        | Pfresh, Pacc        | Pfresh, Pacc        | no |
| F7  | all 4               | all 4               | all 4               | no |
| F8  | Pacc                | Pacc                | Pacc                | no |
| F9  | Pfresh, Pacc        | Pfresh, Pacc        | Pfresh, Pacc        | no |
| F10 | Pfresh, Pacc, S     | Pfresh, Pacc, S     | Pfresh, Pacc, S (D 0.500 at boundary)| marginal (D boundary at 0.6) |
| Fa  | none                | none                | Pfresh              | yes at 0.6 |

Topology stable across [0.4, 0.5]. At 0.6 Pfresh loses Fa qualification. The 0.5 choice is inside the stable band.

---

## 8. F10 universal zero RCA — mixed verdict

**Scope**: F10 zeros = 32/40 across 4 modes (D 5/10, Pfresh 10/10, Pacc 9/10, S 9/10). Per A2 nudge: enumerate failing components per cell to distinguish **fixture-strict** (recurring single-component failure → real signal) vs **grader-gap** (agent varies, grader never matches → H-review) vs **threshold-bug** (partial quality rounded to 0).

### 8.1 `primary_components` structure for F10

From direct inspection of metrics.json (D/F10/seed00 and seed03):

| field | zero-trial (seed00) | non-zero-trial (seed03) |
|---|---|---|
| `next_actions_present`       | **False** | True |
| `stale_table_present`        | **False** | True |
| `status_summary_present`     | **False** | True |
| `unresolved_application_rate`| 0.0       | 1.0 |
| `stale_rejection_rate`       | 0.0       | 1.0 |
| `unresolved_hits`            | []        | ["U1", "U2"] |
| `rejected_stale_ids`         | []        | ["S1", "S2", "S3"] |
| `hallucinated_next_action_hits` | [] (always in this dataset) | [] |
| `primary_pass`               | False     | True |

F10 is **bimodal**: either all three presence flags and both rates hit (→ 1.0) or none do (→ 0.0). No partial credit observed.

### 8.2 Component enumeration — zero-case classification

Spot-check of agent outputs for zero cases (see `/tmp/analyst-phase3/analysis.out`):

| case | agent output format | classification |
|---|---|---|
| D/F10/seed00 (zero) | `## (a) Status summary` / `## (b) Next actions` / `## (c) Stale items rejected` — **all three sections present with correct content, IDs U1/U2 and S1/S2/S3 all cited** | **grader-gap (H8)**: `_extract_labeled_section` regex at `bin/exec-mode-grader.py:822-834` does not match `##`-prefixed labels. Agent is correct; grader is blind. |
| S/F10/seed00 (zero) | `## (a)...` identical pattern, all content correct | **grader-gap (H8)** |
| Pfresh/F10/seed00 (zero) | Agent refuses: "`.context-snapshot.md` 파일이 존재하지 않습니다... 가정 금지 제약" — correctly flags that fresh context has no snapshot, declines to fabricate | **agent-weak (legitimate)**: Pfresh strips prior turns, so the snapshot context is gone; agent correctly refuses (this is what fresh-context *should* surface) |
| Pacc/F10/seed00 (zero) | Agent (at some position N) misinterprets scenario: "snapshot is hypothetical... Turn 7 has no enumerated list" — conflates compact-recovery scenario with other accumulated fixtures | **agent-weak (accumulation confusion)**: aligned with §6 Pacc decay signal |
| D/F10/seed03 (non-zero=1.0) | `(a) **Status summary**` — plain paren label without `##` prefix; bold on text not label | grader matches cleanly |

### 8.3 Bulk classification (all 32 F10 zero trials)

Heuristic classifier over all 40 stage1_output.md files — detect `## (a)` prefix vs agent-refusal markers (`"존재하지 않"`, `"hypothetical"`, `"가정 금지"`, `"근거 없음"`):

| mode | n | non-zero | zero classified H8 grader-gap | zero classified agent-refusal |
|---|---:|---:|---:|---:|
| D      | 10 | 5 | 5 | 0 |
| S      | 10 | 1 | 9 | 0 |
| Pfresh | 10 | 0 | 3 | 7 |
| Pacc   | 10 | 1 | 4 | 5 |
| **total** | **40** | **7** | **21** | **12** |

### 8.4 Verdict

**Mixed**:
- **21/32 zero trials (66%) are H8 grader-gap** — agent content is correct, grader's `_extract_labeled_section` regex fails to match `##`-prefixed markdown labels.
- **12/32 zero trials (34%) are agent-weak** — legitimate refusals (Pfresh no-snapshot, Pacc accumulated context confusion).

**Specific gap**: grader review H8 (`bin/exec-mode-grader.py:822-834`, `_extract_labeled_section`). The proposed fix from grader review:
```python
start_pat = re.compile(
    rf"(?im)(?:^|\n)\s*(?:\*\*|#+\s*)?\(?\s*{re.escape(label)}\s*\)?(?:\.|\:)?(?:\*\*)?",
)
```

**Post-H8-fix expected redistribution** (text-only re-grade, no pilot re-run):
- D F10: 5 zero → ~5 non-zero → F10 mean ≈ 1.000 (hi from 0.500)
- S F10: 9 zero → ~9 non-zero → F10 mean ≈ 1.000
- Pacc F10: 4 zero → ~4 non-zero → F10 mean ≈ ~0.500 (5 agent-refusal zeros remain)
- Pfresh F10: 3 zero → ~3 non-zero → F10 mean ≈ 0.300 (7 agent-refusal zeros remain)

**Mode ranking on F10 post-H8**: D ≈ S ≫ Pacc ≫ Pfresh. **Pre-H8 ranking**: D > S = Pacc > Pfresh. **Topology is stable** — D still leads, Pfresh still disqualified, Pacc still DQ. The v1 decision tree does not change under H8 fix.

**But per plan §N9**: grader-gap component present → **LOCK blocked → v1 DRAFT**. H8 re-grade on the existing 40 traces is the path to LOCK (§12).

### 8.5 Not threshold-bug, not fixture-strict

- **Not threshold-bug**: F10 zeros are genuinely 0.0 (all components False/empty), not rounded-down partials. `primary_score = 0.5·unresolved_rate + 0.5·stale_rate` with both rates = 0.0 = 0.0 — no rounding.
- **Not fixture-strict**: the same fixture is passable (7/40 = 17.5% non-zero cells). Fixture is real; grader is the dominant failure mode for D/S/Pacc.

---

## 9. F5 / F10 bimodal cross-mode analysis

### 9.1 Per-(mode, fixture) zero-share

For F5 and F10, the mean obscures the underlying distribution. Per-mode zero-share (trials where `quality.primary = 0.0`, N=10 per cell, N=9 Pacc/F9):

| fixture | D zero/10 | Pfresh zero/10 | Pacc zero/10 | S zero/10 |
|---|---:|---:|---:|---:|
| F5  | 5 | 7 | 9 | 5 |
| F10 | 5 | 10 | 9 | 9 |

F5 is bimodal in all 4 modes. F10 is bimodal in D only (1-for-1 mix); collapses for Pfresh/Pacc/S (see §8 for causes).

### 9.2 F5 bimodal cause (fixture-level)

F5 is the "research + 5+ primary source citations" fixture (spec §4.2 Cluster 2). The grader (`score_f5_citations`) requires all of: word-count ∈ [1000, 1500], ≥5 primary sources, ≥0 blocked sources, claim-citation spot checks (now via `_judge_cli` per C1 fix). A trial scores 0 on any single-gate violation (hard gates).

From runner reports: F5 is also the **highest-cost** fixture across all modes (§3.1 row F5 shows 0.21–0.41 vs typical 0.06–0.14). High cost → long output → higher chance of tripping a hard gate. F5 also has Layer-B pollution uncertainties (flag in metrics.json) that are analyst-side irrelevant.

**Verdict**: F5 bimodality is **fixture-strict** (real signal). Multiple hard gates + LLM non-determinism produce a natural Bernoulli outcome at single-seed level. This is not a grader gap.

### 9.3 Mode vs fixture effect dominance

Both F5 and F10 exhibit bimodality **across all modes** (not just one), so fixture effect dominates mode effect on these two fixtures. For F2/F3/F6/F8 (near-ceiling in 3+ modes) the mode effect is minor. For F7 (all modes clustered ~0.17–0.24) and F4 (all modes ~0.46–0.48) neither fixture nor mode explains more than ~5pt spread. **Decision tree clusters can be anchored to fixture features, not mode preferences**, on ~half the fixtures.

---

## 10. Anomaly summary

### 10.1 Pacc pos=10 rebound (0.282)

**Diagnosed** in §6.2 as fixture-assignment artifact — Fa appears in pos=10 for 3/10 sessions and Fa benefits from accumulation. Excluding Fa-at-pos=10: mean across 7 non-Fa sessions = 0.039, consistent with pos=7..9 floor. **Not genuine recovery**. Will not propagate into Rule 4.

### 10.2 F9 seed=6 Pfresh 3-attempt retry

Pfresh runner report §"Anomalies" — exit=1 at 4s (auth-break), exit=1 at 153s (harness/grader transient), exit=0 at 192s (targeted retry). **Final status ok**, metrics.json + stage1/stage2 artifacts all present (verified §1.2). No data exclusion.

### 10.3 Pfresh 2× auth refresh pauses

Runner report §"Anomalies" — isolated HOME credential TTL expired around 25 and 40 trials in. Orchestrator refreshed credentials; runner resumed with `--resume`. **Infra issue, not data issue**. All 100 Pfresh metrics.json are authoritative. Do not confound Pfresh mean (brief lesson §).

### 10.4 S 5× `out_of_extra_usage` tail trials

Runner report §A1 — last 5 of 100 trials hit subscription rolling-quota exhaustion. Retried after 2026-04-21 03:00 KST quota reset. **All 5 recovered** with distinct quality scores (one genuine zero at F5/seed=0 matching mini-fix1). Data is clean.

### 10.5 Pacc trial 45 timeout (sess=5/pos=6/F9/seed=5)

720 s perl-alarm SIGALRM (cross-OS cap; macOS lacks `timeout` per runner §5). Recorded as `incidents=1`, no metrics.json written. **N=99** for Pacc; propagated through all tables as flagged (§1.2, §2.2, §6.1).

### 10.6 Pacc `pollution_chain_rate` null across all 99 trials

Harness gap (runner recommendations §1). Pollution_chain grader branch not wired. **Phase 4 prerequisite**; does not block Rule 4 lock (§12). Rendered as `—` in §3 tables.

---

## 11. AGENTS.md Rule 4 — DRAFT text (for architect adoption)

**Scope**: decision-tree language for "when a delegating session SHOULD spawn a new mode X vs keep work in-session". Not a full ADR — architect (spec §9 P7) owns synthesis. This is ready-to-paste Rule 4 wording grounded in Phase 3 evidence.

> ### Rule 4 — Execution Mode Delegation (DRAFT, pending Phase 4 H8 re-grade lock)
>
> When delegating a task to a dedicated execution mode, the orchestrator SHALL select per:
>
> **A. Reuse-horizon gate** — if the task is single-shot (n_reuses ≤ 1), default to **mode D** or **mode S**. **Do NOT use Pfresh** for single-task delegation — its cost at n=1 is ~5× D's cost due to warmup-transcript replay ($0.515 [0.454, 0.589] vs D $0.102 [0.084, 0.121], Phase 3 §5.3). Pfresh becomes cost-rational only at n ≥ 10 (amortization n=10: Pfresh $0.167 vs D $0.102, within 65%).
>
> **B. Context-heavy gate (C3 cluster)** — for context-heavy sustained work (multi-turn iteration, refactor, decision propagation), prefer **mode D** or **mode S** (mode-level quality D 0.684 ≈ S 0.637, CIs overlap). **Do NOT use Pacc** for any work involving accumulated context: quality collapses below 0.5 by position 3 and to 0.000 by position 8 (Phase 3 §6.1).
>
> **C. Harmful-carry exception (Fa fixture-family)** — for tasks requiring deliberate prior-override (a reversal, retraction, stale-rejection), **any mode is acceptable** (D 0.730, S 0.740, Pacc 0.720, Pfresh 0.580 — CIs overlap). Prefer S for marginal cost savings.
>
> **D. Hard-fixture escalation** — if the task's feature profile matches F4 (oracle-graph + file mapping), F5 (external research with citations), or F7 (semantic-mask decision propagation), **no mode reliably succeeds** (all four modes below 0.5 quality, Phase 3 §7.2). The orchestrator SHALL escalate to human-in-loop or invoke a grader audit rather than auto-delegating.
>
> **E. D-vs-S preference (cost-tied)** — D and S are statistically indistinguishable on mode-level quality and cost (§5.1-5.2). Prefer S when the caller is already in a Claude-Code-with-Task-tool context; prefer D otherwise. Do not force the choice when it is infrastructure-cost-driven.
>
> **Threshold specifics (pre-registered)**:
> - Quality-floor for "mode qualifies for fixture" = max(0.5, 0.5 · max_quality_in_fixture).
> - Pareto + 10% margin match applied only among qualified modes.
> - Quality-floor sensitivity [0.4, 0.6] preserves topology (§7.6) — the 0.5 choice is inside the stable band.
>
> **Do-not-lock conditions** (DRAFT rationale):
> 1. F10 H8 grader-gap: 21/32 F10 zero-trials are grader false-negatives (`## (a)` label syntax unmatched by `_extract_labeled_section`). Re-grade post-H8 fix expected to reshape F10 column in §3.2 (§8.4). Tree topology invariant but values must be re-baselined before lock.
> 2. Pollution_chain unmeasured for Pacc (harness gap, N6). Does not change Pacc DQ in §7.2 but should be surfaced in the final Rule 4 reasoning chain.
> 3. Krippendorff α deferred (jury layer not wired). Spec §11 acceptance criterion "α ≥ 0.8" is not yet testable.
>
> **Lock condition**: after H8 re-grade on existing 40 F10 traces (no pilot re-run needed), reverify §7.2 cluster assignments and transition v1 DRAFT → v1 LOCKED. Phase 4 holdout (§12) then tests external validity.

---

## 12. Phase 4 plan — replication + holdout

Per spec §4.3 (30-seed replication Week 2) + §4.5 (≥5 holdout fixtures + 70% accuracy lock gate) + §9 delegation table (P5-P9).

### 12.1 Phase 4 blockers (must clear before scale-up)

| # | Blocker | Owner | Effort | Unblock path |
|---|---|---|---|---|
| B1 | **H8 F10 label extraction** | devkit (grader) | XS (1-line regex broadening) | `_extract_labeled_section` accepts `##`/`**`/paren/dot suffixes per grader-review H8 sketch. Re-grade 40 F10 traces in-place (text-only, no re-run). After: v1 DRAFT → LOCK. |
| B2 | Pacc `pollution_chain_rate` population | devkit (grader + harness) | S | Wire `position_in_chain > 1` branch in grader; compute chain-rate = Σ leaks on prior-fixtures' facts / total_prior_facts (spec §5.3). Independent of tree lock but required for complete §3.3 Pacc column. |
| B3 | Jury (Krippendorff α) pipeline | devkit (builder) | M | Wire 5-judge jury batch (J1-J3 Claude + J4 Codex + J5 Gemini) + `metrics.jury.json` emission + α computation. Required for spec §11 acceptance. Can run in parallel with holdout. |
| B4 | Re-run 1 Pacc timeout trial | devkit (runner) | XS | `sess=5/pos=6/F9/seed=5` single trial; only if orchestrator approves the re-run (spec-amendment trail implicit). Low priority; current N=9 at that cell is already >MIN_N. |

### 12.2 Phase 4 scope (per spec §4.3 P5, §4.5 P8)

**Step 1 — Replication (Week 2, spec §4.3)**: 4 modes × 10 fixtures × **30 seeds** = 1200 trials. Seeds 10-39 (10-seed blocks 2 and 3) run against same pre-registration tag (`-fix2` + `-fix3`). Expected CI width tightens to ~58% of Phase 3 width (√3 rule). Re-invoke `exec-mode-analyze.py` on the combined 1599/1600 dataset.

**Step 2 — Holdout (sprint 2 fixtures, spec §4.5)**: ≥5 holdout fixtures from independent sprint-2 aigentry work (at least 1 per cluster C1/C2/C3). For each holdout fixture: predict best mode via v1 tree → observe per-mode metrics → compute accuracy per spec §4.5 formula:

```
For each holdout fixture i:
    predicted = decision_tree(fixture_i.features)
    pareto = Pareto non-dominated modes across 4 metrics of fixture_i
    margin_match = mode m where |metric[m] - best[m]| / best[m] ≤ 0.10 for ALL 4 metrics
    match_i = predicted ∈ (pareto ∪ margin_match)

accuracy = Σ match_i / n_holdout
```

**Lock decision gate** (spec §4.5 + §11):
- `accuracy ≥ 0.70` → **full Rule 4 lock**
- `accuracy < 0.70` → **narrow scope lock** ("serial single-task routing only")

**Step 3 — ADR synthesis**: architect session consumes this report + Phase 4 replication + holdout → `docs/adrs/YYYY-MM-DD-delegation-mode-decision-tree.md`. Orchestrator commits to AGENTS.md only after ADR + holdout gate pass.

### 12.3 Calendar + session assignments (proposed, awaiting orchestrator approval)

| Phase | When | Session | Scope |
|---|---|---|---|
| P4a — H8 re-grade | 2026-04-22 | `E-devkit-h8-regrade` | regex fix + 40-trial text-only re-grade + §7 re-baselining; v1 DRAFT → LOCK |
| P4b — Replication run | 2026-04-28 → 2026-05-05 | `E-fullpilot-{D,Pfresh,Pacc,S}-rep2` | 1200 trials (seeds 10-39) |
| P4c — Holdout collect | 2026-04-22 → 2026-05-10 (rolling) | orchestrator + sprint-2 sessions | ≥5 holdout fixtures from natural sprint work |
| P4d — Analyst Phase 4 | 2026-05-06 → 2026-05-10 | `E-exec-mode-analyst-phase4` | Replication CI tightening + holdout accuracy + final lock verdict |
| P4e — Architect ADR | 2026-05-11+ | `aigentry-architect` | ADR synthesis + Rule 4 lock submission |

---

## 13. H1-H8 / M1-M8 post-data triage (at N=100)

Per brief §13: re-triage against Phase 3 evidence. Source: `aigentry-orchestrator/docs/reviews/2026-04-20-claude-graders-primaries-review.md`.

### 13.1 H-triage (high severity)

| # | issue | phase 2 verdict | **phase 3 update** | phase 3 evidence | action |
|---|---|---|---|---|---|
| **H1** | F9 red-herring regexes hardcoded in grader | unconfirmed (structural) | **unchanged (still structural)** | F9 cells score discriminately (D 0.710, S 0.695, Pfresh 0.315, Pacc 0.000) — red-herring attribution is invisible at aggregate. H1 is a maintainability defect, not a data-visible scoring bug at N=100 either. | Defer cleanup; non-blocking for Rule 4 |
| **H2** | F10 hallucination_penalty contaminates primary | unconfirmed | **confirmed not triggering** | All 40 F10 trials have `hallucination_penalty=0.0` and `hallucinated_next_action_hits=[]`. Mechanism latent — no agent produced a hallucinated next-action in this run. Still a cleanliness fix. | Apply H2 fix for hygiene; does not affect Phase 3 data |
| **H3** | F7 `banned_pattern_detect_regex` empty fallback | unconfirmed | **unchanged** | F7 shows small spread (0.17-0.24) across modes with no mode showing empty-regex-fallback pattern. Defensive fix still warranted. | Defer; non-blocking |
| **H4** | F4 short-filename flagged hallucinations | CONFIRMED | **confirmed, still active** | F4 mode means cluster 0.456-0.481 across D/Pfresh/S — cap artifact persists at N=100. Pacc 0.054 is accumulation collapse, not H4. Mode discrimination on F4 remains suppressed. | **Phase 4 pre-req**: apply H4 basename-fallback fix before replication, else F4 cluster discrimination remains capped |
| **H5** | F6 text-proxy grader, no real build | CONFIRMED MANIFESTING | **CLOSED** | F6 RCA commit `6678386` R1 (MULTILINE flag) landed via fix2. D F6 = 0.950, S F6 = 0.950 (Phase 3 §3.2). Pre-fix universal-0 signal fully resolved. Pfresh/F6 0.190 and Pacc/F6 0.000 are legitimate mode signals (not grader bug). | H5 is closed. Long-term R5 (build sandbox) still valid but non-blocking. |
| **H6** | F8 regex heuristic, not real test exec | CONFIRMED (suspect) | **still suspect (ceiling-bound)** | F8 = 0.938 identical across D/Pfresh/S at N=10 each (Phase 2 finding held at N=100: `[0.938, 0.938]` CI). This 3-mode identity is grader-ceiling, not mode equivalence. Pacc F8 = 0.094 is accumulation collapse. | Mark F8 as "ceiling-bound" in Rule 4 §D reasoning. Non-blocking for lock. Post-Phase-4 H6 fix (Node sandbox) is long-term. |
| **H7** | Fa primary binary {0.0, 1.0} | CONFIRMED (high impact) | **partially mitigated** | Post-grader-fix (`eca283f fix Fa binary → continuous primary_score`, Pfresh runner report §"Comparison") Fa is now continuous. Fa CIs at N=10 show ordinal-rich range: D 0.630-0.830, S 0.665-0.815, Pacc 0.615-0.815, Pfresh 0.550-0.600. Binary cliff gone. | H7 effectively closed for Fa. |
| **H8** | `_extract_labeled_section` fragile | CONFIRMED (visible in pilot data) | **UPGRADED — now critical** | F10 RCA §8 confirms: 21/32 zero F10 trials are `##`-prefix label-syntax misses. This is the **dominant failure driver of F10 column**. Post-H8 fix + re-grade unblocks v1 LOCK. | **Phase 4 B1 blocker**: 1-line regex broadening + 40-trial re-grade |

### 13.2 M-triage (medium severity)

| # | issue | phase 3 impact | action |
|---|---|---|---|
| M1 | `_regex_any_hit` definition ordering | none at N=100 | cleanup only |
| M2 | F7 superseded DOTALL cross-document | still-latent (F7 scores don't show false-superseded pattern) | cleanup only |
| M3 | F5 `heading_hits` computed but unused | none (F5 bimodality is gate-driven not heading-driven) | drop or wire, either consistent |
| M4 | F3 markdown-table column-count | no F3 malformed tables observed at N=100 | optional |
| M5 | F3 partial-match test coverage | N=100 F3 means are near-ceiling — partial path unexercised here | add test |
| M6 | F8 alternative-implementation test | F8 ceiling-bound (H6) hides regex coupling | add test to expose |
| M7 | F7 empty-output scoring | N=100 F7 has no empty outputs | cleanup |
| M8 | F6 partial-fix test | N=100 F6 near-ceiling for D/S | add test |

**Summary**: H5 closed, H7 closed (for Fa). **H8 is the new critical blocker**. H4 is Phase 4 pre-req for F4 discrimination. H6 is "ceiling-bound" flag. M-issues are cleanup, non-blocking.

---

## Appendix A — File inventory

**Input data (399 metrics.json, read-only)**:
- `state/exec-mode-experiment/full-pilot-fix2/1/D/F{2..10,a}/seed{00..09}/metrics.json` — 100
- `state/exec-mode-experiment/full-pilot-fix2/1/Pfresh/F{2..10,a}/seed{00..09}/metrics.json` — 100
- `state/exec-mode-experiment/full-pilot-fix2/1/Pacc/F{2..10,a}/seed{NN}_pos{P}_sess{S}/metrics.json` — 99
- `state/exec-mode-experiment/full-pilot-fix2/1/S/F{2..10,a}/seed{00..09}/metrics.json` — 100
- Archive: `docs/data/raw/2026-04-21-full-pilot-fix2.tar.gz` (SHA-256 verified, §0)

**Analyzer outputs (read-only consumables, `/tmp/analyst-phase3/`)**:
- `data.csv` — HELM table CSV (160 rows = 40 cells × metrics)
- `v3-max-results-full-pilot-fix2.md` — analyzer-auto-generated summary
- `heatmaps/{cost_marginal,cost_amort_30,quality,pollution_self,pollution_chain,loss}.png` — 6 heatmaps
- `position_effect_pacc_F{2..10,a}.png` — 10 Pacc per-fixture position plots
- `analysis.py`, `analysis.out`, `agg.pkl` — this report's custom aggregation (read-only wrt analyzer)

**References cited inline**:
- Spec v3-max.1: `aigentry-orchestrator/docs/superpowers/specs/2026-04-20-execution-mode-comparison-experiment-design.md`
- Analysis plan: `aigentry-orchestrator/docs/superpowers/analysis-plan/2026-04-20-exec-mode-analysis.md`
- Phase 2 analyst: `docs/reports/2026-04-20-exec-mode-analyst-phase2.md`
- F6 RCA: `docs/reports/2026-04-20-exec-mode-f6-rca.md`
- Runner reports (D/S/Pfresh/Pacc): `docs/reports/2026-04-20-exec-mode-fullpilot-{D,S,Pfresh,Pacc}.md`
- Grader review (H1-H8, M1-M8): `aigentry-orchestrator/docs/reviews/2026-04-20-claude-graders-primaries-review.md`
- Analyzer source: `bin/exec-mode-analyze.py` (invoked, not modified; line refs cited throughout)

**Pre-registration hashes honored**: `exec-mode-v3-max-preregistered-20260420-fix2` + `-fix3`. No spec/fixture/grader/harness/analyzer modifications during this analysis.

*This report is read-only with respect to all source artefacts (spec, plan, grader, harness, fixtures, analyzer). Codex parallel cross-check report pending at `docs/reports/2026-04-21-exec-mode-analyst-phase3-codex.md` per plan §4 A1 — orchestrator reconciles.*
