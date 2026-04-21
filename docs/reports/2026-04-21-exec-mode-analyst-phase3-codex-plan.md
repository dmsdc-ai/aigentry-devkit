# Phase 3 Analysis Plan — Codex Independent Cross-Check

**Session**: `C-exec-mode-analyst-phase3-codex-v2`
**Date**: 2026-04-21
**Mission**: independent numerical cross-check of P3 Pilot data with own loader, own bootstrap, sensitivity analysis, and reproducibility script.

## 1. Independence gates

- Forbidden analyst files were not read:
  - `docs/reports/2026-04-21-exec-mode-analyst-phase3.md`
  - `docs/reports/2026-04-21-exec-mode-analyst-phase3-plan.md`
  - `docs/reports/2026-04-21-exec-mode-analyst-phase3-codex-plan.SUPERSEDED.md`
  - `docs/reports/2026-04-20-exec-mode-analyst-phase2.md`
  - `docs/reports/2026-04-20-exec-mode-analyst-phase2-plan.md`
- Raw metrics will be loaded directly from `state/exec-mode-experiment/full-pilot-fix2/1/*/*/seed*/metrics.json`.
- Bootstrap implementation will be written from scratch in the Codex reproduction script and will not import from `exec-mode-analyze.py`.
- Allowed operational/spec sources reviewed:
  - prereg analysis plan
  - v3-max.1 experiment spec
  - grader primaries review
  - runner reports for `D`, `Pfresh`, `Pacc`, `S`
  - F6 RCA note

## 2. Pre-flight verification

### 2.1 Archive gate

- Archive path: `docs/data/raw/2026-04-21-full-pilot-fix2.tar.gz`
- Expected SHA-256: `e7390a411399b6e77dceb31bb8af3f607c683858535e8fbcc314069049b93a19`
- Observed SHA-256: `e7390a411399b6e77dceb31bb8af3f607c683858535e8fbcc314069049b93a19`
- Verdict: match

### 2.2 Dataset load gate

Independent Python loader over raw `metrics.json` established:

- `399` readable metrics files total
- mode counts: `D=100`, `Pfresh=100`, `S=100`, `Pacc=99`
- `status == "ok"` for all `399`
- `compact.detected == false` for all `399`
- uniform top-level schema across all records:
  - `cli_versions`
  - `compact`
  - `cost`
  - `dry_run`
  - `fixture_id`
  - `incidents`
  - `loss`
  - `mode`
  - `paths`
  - `pollution`
  - `position_in_chain`
  - `quality`
  - `run_idx`
  - `schema_version`
  - `seed_idx`
  - `session_idx`
  - `status`
  - `timestamps`
  - `trial_id`
- no nulls in planned primary extraction fields:
  - `quality.primary`
  - `cost.marginal_usd`
  - `cost.amort_usd.n_1`
  - `cost.amort_usd.n_10`
  - `cost.amort_usd.n_30`
  - `pollution.self_rate`
  - `loss.rate`

### 2.3 Confirmed dataset caveats

- One cell is missing: `Pacc / F9 / seed_idx=5`
  - operational trace from allowed runner report identifies it as `sess=5`, `pos=6`, timeout
  - effective `Pacc` sample size is `99`, not `100`
  - effective position-6 sample size is `9`, all other positions are `10`
- `pollution.chain_rate` is `null` in all `399` records
  - primary pollution analysis will therefore use `pollution.self_rate`
  - chain-rate will be reported as unavailable for this pilot rather than imputed
- `Pacc` directory names are not canonical `seed00..seed09`
  - actual path suffixes are of form `seed01_pos4_sess1`
  - `seed_idx` field inside JSON is the source of truth for seed/session indexing

## 3. Metric extraction map

The analysis will use the following direct JSON mappings:

| HELM axis | JSON field | Notes |
| --- | --- | --- |
| cost | `cost.marginal_usd` | primary cost |
| cost horizon M | `cost.amort_usd.n_1`, `.n_10`, `.n_30` | preregistered amortization horizons |
| quality | `quality.primary` | primary grader score only |
| pollution | `pollution.self_rate` | chain-rate unavailable in raw pilot |
| loss | `loss.rate` | `1 - recall@10` already serialized |

Derived analysis fields:

- `mode`: `mode`
- `fixture`: `fixture_id`
- `seed_idx`: `seed_idx`
- `position`: `position_in_chain`
- `session_idx`: inferred from `session_idx` if present, otherwise parsed from `trial_id` or path only for `Pacc` diagnostics

## 4. Bootstrap methodology

### 4.1 Core method

- CI family: percentile bootstrap 95% CI
- Unit of resampling:
  - fixture-mode cells: trial records within cell
  - mode aggregates: trial records within mode
  - `Pacc` position summaries: trial records within position
- No p-values, no NHST
- All reported means will include raw `n`

### 4.2 Own implementation rules

- Implement bootstrap locally in `tools/analyst-phase3-codex-reproduce.py`
- No imports from the existing analyzer
- Deterministic RNG support via explicit seed

### 4.3 CI convergence cross-check

For every reported CI family:

1. run bootstrap with RNG seed `42`
2. run bootstrap with RNG seed `1337`
3. compare lower and upper endpoints
4. if both endpoint deltas are `<= 0.02`, accept the CI as converged
5. if not, increase resample count and re-run until the threshold is met or the instability is explicitly reported in the discrepancy list

Planned starting resample counts:

- default: `10,000`
- escalation ladder: `20,000`, then `50,000` only if needed

## 5. Section-by-section execution plan

### 5.1 Dataset verification

- Re-state SHA match, file count, schema uniformity, and the exact missing `Pacc/F9/seed_idx=5` cell
- Include the `pollution.chain_rate` unavailability note

### 5.2 Independent HELM table

- Build a `4 mode × 10 fixture × 4 metric` table:
  - cost
  - quality
  - pollution self-rate
  - loss
- Each cell will report:
  - mean
  - 95% bootstrap CI
  - `n`
- `Pacc/F9` will be labeled `n=9`; all other fixture-mode cells `n=10`

### 5.3 CI methodology cross-check

- Summarize seed-42 vs seed-1337 CI agreement
- Flag any cells requiring resample escalation
- Include a short reproducibility note on percentile bootstrap and the convergence threshold

### 5.4 Per-mode means

- Report overall per-mode means + CI for:
  - cost marginal
  - quality primary
  - pollution self-rate
  - loss rate
- Sample sizes:
  - `D=100`
  - `Pfresh=100`
  - `S=100`
  - `Pacc=99`

### 5.5 Pacc accumulation decay

- Analyze `Pacc` by `position_in_chain`
- Report mean + CI by position for:
  - quality
  - pollution self-rate
  - loss
  - cost marginal
- Treat position `6` as `n=9`
- Compute a simple slope summary for quality decay across positions using an explicit descriptive fit
- Note the position-10 rebound separately instead of smoothing it away

### 5.6 F10 zero verification

- Verify whether `F10` is actually universal-zero or only mode-specific/seed-specific
- Report per-mode:
  - zero-count
  - non-zero count
  - mean quality
  - CI
- Expected based on allowed operational reports: strong collapse, but not literal all-zero across every mode

### 5.7 Decision-tree sensitivity

- Reconstruct fixture-level mode recommendations under a grid of:
  - margin = `5%`, `10%`, `15%`, `20%`
  - quality floor = `0.3`, `0.5`, `0.7`
- Use the four orthogonal metrics and Pareto/margin framing from preregistration
- Output:
  - recommended mode set per fixture
  - mode changes across threshold grid
  - stability classification: robust vs fragile

### 5.8 Cost structure analysis

- Report `$ / quality-point` at amortization horizons `M=1`, `5`, `10`, `30`
- For `M=5`, interpolate as:
  - `cost_per_trial_M5 = marginal_cost + warmup_component / 5`
  - where `warmup_component = amort_n1 - marginal_cost`
- Guardrails:
  - if quality mean is `0`, report ratio as undefined/infinite rather than forcing a number
  - keep horizon math explicit in the report

### 5.9 Reproducibility note

- Deliver standalone Python reproduction script
- Script responsibilities:
  - load all raw metrics
  - rebuild analysis tables
  - run bootstrap with configurable seeds/resample counts
  - emit the final markdown tables or a machine-readable summary used to fill them

### 5.10 Discrepancies-to-watch

Planned watch list candidates:

- missing `Pacc/F9/seed_idx=5` cell
- `pollution.chain_rate` absent throughout the pilot
- `Pacc` directory naming differs from nominal seed pattern
- F10 collapse may be fixture-structural rather than mode-universal
- position-10 rebound in `Pacc`
- F6 needs careful interpretation because prior RCA found grader brittleness in earlier pilot work

## 6. Report-writing rules

- Final report will stay descriptive and numerical
- No causal claims beyond what the pilot design supports
- No contamination from forbidden analyst writeups
- Any mismatch versus allowed runner reports will be labeled as an independent discrepancy, not silently harmonized

## 7. Execution order after approval

1. implement the standalone reproduction script
2. generate independent summary tables from raw JSON
3. run bootstrap with seeds `42` and `1337`
4. resolve or document any CI convergence failures
5. write final report to `docs/reports/2026-04-21-exec-mode-analyst-phase3-codex.md`
6. send final telepty inject with headline results and commit

## 8. Current status

- Step 1 complete
- Step 2 complete with this file
- Independence status: clean
- Contamination events: none
