# Phase 3 Codex Analysis Plan — Independent Cross-Check

**Date**: 2026-04-21  
**Analyst**: Codex (`C-exec-mode-analyst-phase3-codex`)  
**Independence note**: I did **not** open the forbidden reports directly, but after writing this plan I accidentally exposed short `rg` match snippets from `docs/reports/2026-04-21-exec-mode-analyst-phase3-plan.md` and `docs/reports/2026-04-20-exec-mode-analyst-phase2.md` while searching for `quality floor`. The numerical analysis below still proceeds from raw data with an independent implementation, and this contamination will be declared again in the final report.

## 1. Dataset anchor

- Archive fingerprint target: `e7390a411399b6e77dceb31bb8af3f607c683858535e8fbcc314069049b93a19`
- Verified archive SHA-256 matches exactly
- Raw metrics parsed from `state/exec-mode-experiment/full-pilot-fix2/1`
- Observed counts: `D=100`, `Pfresh=100`, `Pacc=99`, `S=100`, total `399`
- Initial anomaly to carry into final report: one missing `Pacc` trial consistent with `seed_idx=5`, `position_in_chain=6`, fixture `F9`

## 2. Methods lock

- Descriptive statistics only, no hypothesis tests or p-values
- Independent implementation in Python; no imports from `bin/exec-mode-analyze.py`
- Bootstrap method: percentile 95% CI, `n_resamples=10000`, RNG seeds `42` and `1337`
- Min-n rule from spec: compute CI only when `n >= 5`

## 3. Loader and validation

- Build a standalone loader for all `metrics.json` files
- Validate JSON parse, required fields, mode/fixture consistency, and duplicate trial IDs
- Record missing/corrupt files, schema drift, and status anomalies
- Preserve `position_in_chain` for all `Pacc` rows

## 4. HELM table production

- Compute fixture x mode means for `quality.primary`, `cost.marginal_usd`, `pollution.self_rate`, and `loss.rate`
- Compute bootstrap 95% CI per cell
- Compute mode-level aggregates over all available rows
- Report `n_valid` per cell to make the single missing `Pacc` trial explicit

## 5. Bootstrap cross-check

- Re-run every CI with seeds `42` and `1337`
- Compare interval endpoints and widths
- Flag cells where seed-to-seed CI movement exceeds `0.02` or where width instability suggests weak convergence

## 6. Pacc position analysis

- Aggregate `Pacc` rows by `position_in_chain`
- Compute quality mean and bootstrap CI for positions `1..10`
- Check whether `pos=1` vs `pos=8` are non-overlapping
- Test whether the apparent `pos=10` rebound overlaps with `pos=8` and `pos=9`

## 7. F10 zero check

- Isolate fixture `F10` across all 4 modes
- Report the full distribution of quality scores, not only means
- Distinguish exact all-zero behavior from low-but-nonzero behavior

## 8. Decision-tree sensitivity and cost model

- Reproduce the pre-registered Pareto + margin rule per fixture
- Sensitivity grid:
  - Margin = `5%`, `10%`, `15%`, `20%`
  - Quality floor = `0.3`, `0.5`, `0.7`
- Report stability as fixture winner-set flips relative to the `10%` baseline
- Compute `$ / quality-point` for `M in {1, 5, 10, 30}` using marginal plus warmup amortization arithmetic

## 9. Reproducibility outputs

- Script path: `tools/analyst-phase3-codex-reproduce.py`
- Final report path: `docs/reports/2026-04-21-exec-mode-analyst-phase3-codex.md`
- Script will emit deterministic tables used by the report and be runnable from repo root

## 10. Completion criteria

- Report contains dataset verification, HELM table, CI stability, mode aggregates, Pacc decay, F10 RCA, decision-tree sensitivity, cost structure, and discrepancy watchlist
- Only allowed write targets: this plan file, the final codex report, and the reproducibility script
