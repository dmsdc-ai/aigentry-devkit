# Phase 3 Analysis — Codex Independent Cross-Check

**Session**: `C-exec-mode-analyst-phase3-codex-v2`  
**Date**: 2026-04-21  
**Independence status**: clean  
**Forbidden analyst files read**: none  
**Primary result**: overall quality ranks `D > S > Pfresh > Pacc`, but decision-tree stability is **fragile** because quality floors create `32` empty fixture-grid cells and four fixtures change recommendation sets across the sensitivity grid.

## 1. Dataset verification

- Archive SHA-256 matched exactly: `e7390a411399b6e77dceb31bb8af3f607c683858535e8fbcc314069049b93a19`.
- Independent raw loader found `399` readable `metrics.json` records:
  - `D=100`
  - `Pacc=99`
  - `Pfresh=100`
  - `S=100`
- All `399` records had `status == "ok"`.
- All `399` records had `compact.detected == false`.
- The schema was uniform across all records and the core extracted fields had no unexpected nulls:
  - `cost.marginal_usd`
  - `cost.amort_usd.n_1`
  - `cost.amort_usd.n_10`
  - `cost.amort_usd.n_30`
  - `quality.primary`
  - `pollution.self_rate`
  - `loss.rate`
- Confirmed caveats:
  - `Pacc/F9/seed_idx=5` is missing, leaving `Pacc n=99` and `position 6 n=9`.
  - `pollution.chain_rate` is null in all `399` records, so chain leakage cannot be analyzed from this raw pilot.
  - `Pacc` directory naming is session/position encoded; the canonical seed field is `seed_idx` inside the JSON.

## 2. Independent HELM table

| fixture | mode | n | cost | quality | pollution | loss |
| --- | --- | ---: | --- | --- | --- | --- |
| F2 | D | 10 | 0.1374 [0.1096, 0.1697] | 1.0000 [1.0000, 1.0000] | 0.6200 [0.5500, 0.6800] | 0.0900 [0.0700, 0.1000] |
| F2 | Pacc | 10 | 0.1071 [0.0723, 0.1461] | 0.3250 [0.0750, 0.6000] | 0.2400 [0.1700, 0.3100] | 0.0600 [0.0300, 0.0900] |
| F2 | Pfresh | 10 | 0.1627 [0.1487, 0.1748] | 1.0000 [1.0000, 1.0000] | 0.2300 [0.2000, 0.2600] | 0.1000 [0.1000, 0.1000] |
| F2 | S | 10 | 0.1400 [0.1082, 0.1752] | 1.0000 [1.0000, 1.0000] | 0.5800 [0.5200, 0.6400] | 0.1000 [0.1000, 0.1000] |
| F3 | D | 10 | 0.1010 [0.0746, 0.1310] | 0.9737 [0.9579, 0.9895] | 0.4000 [0.3000, 0.4900] | 0.0000 [0.0000, 0.0000] |
| F3 | Pacc | 10 | 0.0916 [0.0609, 0.1320] | 0.1000 [0.0000, 0.3000] | 0.0400 [0.0000, 0.1200] | 0.0000 [0.0000, 0.0000] |
| F3 | Pfresh | 10 | 0.0891 [0.0780, 0.1008] | 0.9094 [0.8649, 0.9474] | 0.4100 [0.3400, 0.4900] | 0.0000 [0.0000, 0.0000] |
| F3 | S | 10 | 0.0756 [0.0620, 0.0982] | 0.9737 [0.9579, 0.9895] | 0.3200 [0.2600, 0.3900] | 0.0000 [0.0000, 0.0000] |
| F4 | D | 10 | 0.0771 [0.0546, 0.1057] | 0.4778 [0.4333, 0.5444] | 0.0000 [0.0000, 0.0000] | 0.0000 [0.0000, 0.0000] |
| F4 | Pacc | 10 | 0.0941 [0.0742, 0.1193] | 0.0544 [0.0112, 0.1333] | 0.0900 [0.0200, 0.1800] | 0.0000 [0.0000, 0.0000] |
| F4 | Pfresh | 10 | 0.1078 [0.0944, 0.1216] | 0.4814 [0.4329, 0.5556] | 0.0100 [0.0000, 0.0300] | 0.0000 [0.0000, 0.0000] |
| F4 | S | 10 | 0.0766 [0.0572, 0.1018] | 0.4556 [0.4222, 0.5000] | 0.0000 [0.0000, 0.0000] | 0.0000 [0.0000, 0.0000] |
| F5 | D | 10 | 0.2897 [0.2022, 0.3747] | 0.3150 [0.1183, 0.5320] | 0.3100 [0.1700, 0.4500] | 0.0200 [0.0000, 0.0500] |
| F5 | Pacc | 10 | 0.2231 [0.0973, 0.3938] | 0.0733 [0.0000, 0.2200] | 0.2000 [0.1100, 0.2900] | 0.0000 [0.0000, 0.0000] |
| F5 | Pfresh | 10 | 0.2127 [0.1080, 0.3396] | 0.2173 [0.0000, 0.4373] | 0.2700 [0.1700, 0.3900] | 0.0100 [0.0000, 0.0300] |
| F5 | S | 10 | 0.4102 [0.2952, 0.5339] | 0.2907 [0.1080, 0.4853] | 0.4500 [0.3100, 0.5700] | 0.0000 [0.0000, 0.0000] |
| F6 | D | 10 | 0.0492 [0.0208, 0.0778] | 0.9500 [0.9500, 0.9500] | 0.0000 [0.0000, 0.0000] | 0.0000 [0.0000, 0.0000] |
| F6 | Pacc | 10 | 0.0875 [0.0684, 0.1077] | 0.0000 [0.0000, 0.0000] | 0.1300 [0.0700, 0.1900] | 0.0000 [0.0000, 0.0000] |
| F6 | Pfresh | 10 | 0.0515 [0.0442, 0.0603] | 0.1900 [0.0000, 0.4750] | 0.0000 [0.0000, 0.0000] | 0.0000 [0.0000, 0.0000] |
| F6 | S | 10 | 0.0301 [0.0202, 0.0493] | 0.9500 [0.9500, 0.9500] | 0.0000 [0.0000, 0.0000] | 0.0000 [0.0000, 0.0000] |
| F7 | D | 10 | 0.0774 [0.0498, 0.1092] | 0.2415 [0.2257, 0.2573] | 0.0000 [0.0000, 0.0000] | 0.0000 [0.0000, 0.0000] |
| F7 | Pacc | 10 | 0.0976 [0.0801, 0.1164] | 0.1568 [0.0819, 0.2358] | 0.1400 [0.0700, 0.2100] | 0.0000 [0.0000, 0.0000] |
| F7 | Pfresh | 10 | 0.1830 [0.1633, 0.2037] | 0.1784 [0.1397, 0.2165] | 0.1400 [0.0800, 0.1900] | 0.0000 [0.0000, 0.0000] |
| F7 | S | 10 | 0.0705 [0.0430, 0.1001] | 0.2310 [0.2205, 0.2468] | 0.0000 [0.0000, 0.0000] | 0.0000 [0.0000, 0.0000] |
| F8 | D | 10 | 0.0672 [0.0379, 0.0975] | 0.9375 [0.9375, 0.9375] | 0.0000 [0.0000, 0.0000] | 0.0300 [0.0000, 0.0800] |
| F8 | Pacc | 10 | 0.1210 [0.0825, 0.1696] | 0.0938 [0.0000, 0.2812] | 0.1100 [0.0600, 0.1600] | 0.0000 [0.0000, 0.0000] |
| F8 | Pfresh | 10 | 0.0567 [0.0492, 0.0659] | 0.9088 [0.8713, 0.9342] | 0.0300 [0.0000, 0.0600] | 0.0100 [0.0000, 0.0300] |
| F8 | S | 10 | 0.0579 [0.0367, 0.0887] | 0.9375 [0.9375, 0.9375] | 0.0000 [0.0000, 0.0000] | 0.0000 [0.0000, 0.0000] |
| F9 | D | 10 | 0.0436 [0.0331, 0.0636] | 0.7100 [0.6600, 0.7450] | 0.1000 [0.1000, 0.1000] | 0.0000 [0.0000, 0.0000] |
| F9 | Pacc | 9 | 0.1327 [0.0861, 0.1862] | 0.0000 [0.0000, 0.0000] | 0.1000 [0.0222, 0.2000] | 0.0000 [0.0000, 0.0000] |
| F9 | Pfresh | 10 | 0.0990 [0.0889, 0.1084] | 0.3150 [0.1200, 0.5150] | 0.1900 [0.1200, 0.2600] | 0.0000 [0.0000, 0.0000] |
| F9 | S | 10 | 0.0630 [0.0338, 0.0928] | 0.6950 [0.6250, 0.7500] | 0.1000 [0.1000, 0.1000] | 0.0000 [0.0000, 0.0000] |
| F10 | D | 10 | 0.0773 [0.0504, 0.1069] | 0.5000 [0.2000, 0.8000] | 0.1900 [0.1300, 0.2800] | 0.0000 [0.0000, 0.0000] |
| F10 | Pacc | 10 | 0.1089 [0.0780, 0.1449] | 0.1000 [0.0000, 0.3000] | 0.0400 [0.0100, 0.0800] | 0.0000 [0.0000, 0.0000] |
| F10 | Pfresh | 10 | 0.1965 [0.1677, 0.2281] | 0.0000 [0.0000, 0.0000] | 0.3900 [0.2600, 0.5300] | 0.0000 [0.0000, 0.0000] |
| F10 | S | 10 | 0.0854 [0.0615, 0.1134] | 0.1000 [0.0000, 0.3000] | 0.1300 [0.1000, 0.1600] | 0.0000 [0.0000, 0.0000] |
| Fa | D | 10 | 0.0961 [0.0594, 0.1385] | 0.7300 [0.6300, 0.8300] | 0.0000 [0.0000, 0.0000] | 0.0000 [0.0000, 0.0000] |
| Fa | Pacc | 10 | 0.0987 [0.0795, 0.1191] | 0.7200 [0.6150, 0.8150] | 0.0000 [0.0000, 0.0000] | 0.0200 [0.0000, 0.0500] |
| Fa | Pfresh | 10 | 0.1237 [0.1131, 0.1349] | 0.5800 [0.5500, 0.6000] | 0.0700 [0.0200, 0.1200] | 0.0200 [0.0000, 0.0500] |
| Fa | S | 10 | 0.0684 [0.0440, 0.0974] | 0.7400 [0.6650, 0.8150] | 0.0100 [0.0000, 0.0300] | 0.0000 [0.0000, 0.0000] |

## 3. CI methodology cross-check

- CI family: percentile bootstrap 95% CI.
- RNG seeds used for convergence cross-check: `42` and `1337`.
- Convergence threshold: both endpoint deltas `<= 0.02`.
- Resample ladder: `10,000`, `20,000`, `50,000`.
- Result:
  - reported CI count: `220`
  - `220/220` converged at `10,000` resamples
  - resample escalations needed: `0`
  - unresolved CI families: `0`
  - maximum observed seed-to-seed endpoint delta: `0.0125`
- The worst observed endpoint delta stayed below the preregistered threshold, so the seed-42 interval was retained for reporting without escalation.

## 4. Per-mode means + CI

| mode | n | cost | quality | pollution | loss |
| --- | ---: | --- | --- | --- | --- |
| D | 100 | 0.1016 [0.0844, 0.1207] | 0.6835 [0.6157, 0.7478] | 0.1620 [0.1180, 0.2090] | 0.0140 [0.0070, 0.0220] |
| Pacc | 99 | 0.1161 [0.0988, 0.1371] | 0.1640 [0.1060, 0.2258] | 0.1091 [0.0838, 0.1354] | 0.0081 [0.0030, 0.0141] |
| Pfresh | 100 | 0.1283 [0.1126, 0.1460] | 0.4780 [0.4029, 0.5543] | 0.1740 [0.1390, 0.2110] | 0.0140 [0.0080, 0.0210] |
| S | 100 | 0.1078 [0.0845, 0.1340] | 0.6373 [0.5672, 0.7076] | 0.1590 [0.1170, 0.2040] | 0.0100 [0.0050, 0.0160] |

Mode-level interpretation:

- **Quality**: `D` is highest, `S` is second, `Pfresh` is third, `Pacc` is far lower.
- **Cost**: `D` is cheapest overall, then `S`, then `Pacc`, then `Pfresh`.
- **Pollution**: `Pacc` has the lowest self-pollution mean, while `Pfresh` is highest.
- **Loss**: `Pacc` has the lowest loss mean, `S` next, while `D` and `Pfresh` are tied higher.

## 5. Pacc accumulation decay

| position | n | cost | quality | pollution | loss |
| ---: | ---: | --- | --- | --- | --- |
| 1 | 10 | 0.1326 [0.1089, 0.1512] | 0.4902 [0.2514, 0.7351] | 0.0800 [0.0100, 0.1700] | 0.0000 [0.0000, 0.0000] |
| 2 | 10 | 0.1544 [0.0699, 0.2950] | 0.1982 [0.0086, 0.4154] | 0.0400 [0.0000, 0.1000] | 0.0000 [0.0000, 0.0000] |
| 3 | 10 | 0.1037 [0.0733, 0.1417] | 0.1875 [0.0000, 0.3750] | 0.1200 [0.0300, 0.2200] | 0.0200 [0.0000, 0.0500] |
| 4 | 10 | 0.1181 [0.0701, 0.1739] | 0.1014 [0.0000, 0.3014] | 0.1500 [0.0700, 0.2400] | 0.0200 [0.0000, 0.0500] |
| 5 | 10 | 0.0968 [0.0714, 0.1258] | 0.1890 [0.0265, 0.4125] | 0.1200 [0.0400, 0.2100] | 0.0200 [0.0000, 0.0500] |
| 6 | 9 | 0.1525 [0.0743, 0.2904] | 0.0976 [0.0000, 0.2865] | 0.0889 [0.0222, 0.1667] | 0.0000 [0.0000, 0.0000] |
| 7 | 10 | 0.1125 [0.0783, 0.1635] | 0.0758 [0.0000, 0.2050] | 0.0900 [0.0300, 0.1600] | 0.0000 [0.0000, 0.0000] |
| 8 | 10 | 0.0995 [0.0726, 0.1328] | 0.0003 [0.0000, 0.0009] | 0.1200 [0.0600, 0.1900] | 0.0000 [0.0000, 0.0000] |
| 9 | 10 | 0.0818 [0.0685, 0.0966] | 0.0111 [0.0000, 0.0233] | 0.0900 [0.0300, 0.1600] | 0.0100 [0.0000, 0.0300] |
| 10 | 10 | 0.1123 [0.0960, 0.1293] | 0.2820 [0.0648, 0.5245] | 0.1900 [0.0900, 0.2900] | 0.0100 [0.0000, 0.0300] |

Decay interpretation:

- Descriptive quality slope by position mean: `-0.0260` quality points per position.
- Descriptive quality slope by raw trial data: `-0.0260`.
- Quality falls sharply from position `1` (`0.4902`) to position `8` (`0.0003`), then rebounds at position `10` (`0.2820`).
- The late rebound is real in the raw pilot and should be treated as a discrepancy-to-watch, not smoothed away.
- Cost does not show a matching upward trend, so the dominant accumulated-mode penalty here is quality collapse rather than cost escalation.

## 6. F10 universal zero verification

| mode | n | zero_count | nonzero_count | quality |
| --- | ---: | ---: | ---: | --- |
| D | 10 | 5 | 5 | 0.5000 [0.2000, 0.8000] |
| Pacc | 10 | 9 | 1 | 0.1000 [0.0000, 0.3000] |
| Pfresh | 10 | 10 | 0 | 0.0000 [0.0000, 0.0000] |
| S | 10 | 9 | 1 | 0.1000 [0.0000, 0.3000] |

Verdict:

- `F10` is **not** universal-zero across all modes.
- `D` retains substantial non-zero mass (`5/10` non-zero, mean `0.5000`).
- `Pfresh` is strict zero across all ten trials.
- `Pacc` and `S` are near-zero with only one non-zero trial each.
- Final label: **fixture-strict**, not grader-gap.

## 7. Decision tree sensitivity

Sensitivity grid:

- margin: `5%`, `10%`, `15%`, `20%`
- quality floor: `0.3`, `0.5`, `0.7`

| fixture | modal recommendation set | support / 12 | unique sets | stability |
| --- | --- | ---: | ---: | --- |
| F2 | D,Pfresh,S | 8 | 2 | fragile |
| F3 | S | 12 | 1 | robust |
| F4 | NONE | 8 | 2 | fragile |
| F5 | NONE | 8 | 2 | fragile |
| F6 | S | 12 | 1 | robust |
| F7 | NONE | 12 | 1 | robust |
| F8 | Pfresh,S | 12 | 1 | robust |
| F9 | D | 12 | 1 | robust |
| F10 | D | 8 | 2 | fragile |
| Fa | D,S | 12 | 1 | robust |

Sensitivity interpretation:

- Overall stability: **fragile**.
- Robust fixtures: `F3`, `F6`, `F7`, `F8`, `F9`, `Fa`.
- Fragile fixtures: `F2`, `F4`, `F5`, `F10`.
- Empty recommendation cells: `32` fixture-grid combinations have no mode clearing the active quality floor.
- Floor sensitivity details:
  - `F2`: `Pacc` is present only at floor `0.3`; at floors `0.5` and `0.7` the modal set becomes `D,Pfresh,S`.
  - `F4`: `D,Pfresh,S` at floor `0.3`, but `NONE` at floors `0.5` and `0.7`.
  - `F5`: `D` at floor `0.3`, but `NONE` at floors `0.5` and `0.7`.
  - `F10`: `D` at floors `0.3` and `0.5`, but `NONE` at floor `0.7`.

The main implication is that a hard quality floor makes the decision tree unstable for low-ceiling fixtures; the most stable fixture-level recommendations are `S` for `F3/F6`, `D` for `F9`, `Pfresh,S` for `F8`, and `D,S` for `Fa`.

## 8. Cost structure analysis

| mode | quality mean | M1 cost | M1 $/quality | M5 cost | M5 $/quality | M10 cost | M10 $/quality | M30 cost | M30 $/quality |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| D | 0.6835 | 0.1016 | 0.1486 | 0.1016 | 0.1486 | 0.1016 | 0.1486 | 0.1016 | 0.1486 |
| Pacc | 0.1640 | 0.1161 | 0.7079 | 0.1161 | 0.7079 | 0.1161 | 0.7079 | 0.1161 | 0.7079 |
| Pfresh | 0.4780 | 0.5149 | 1.0772 | 0.2056 | 0.4301 | 0.1669 | 0.3492 | 0.1412 | 0.2954 |
| S | 0.6373 | 0.1078 | 0.1692 | 0.1078 | 0.1692 | 0.1078 | 0.1692 | 0.1078 | 0.1692 |

Cost interpretation:

- `D` is the best $/quality mode at every horizon in this pilot.
- `S` is consistently second.
- `Pfresh` is extremely expensive at `M=1` because the warmup component is large (`0.3866`), but it improves materially by `M=30`.
- `Pacc` remains poor on $/quality because its low quality overwhelms its moderate cost.
- Horizon sensitivity matters only for `Pfresh`; `D`, `S`, and `Pacc` are effectively flat across `M=1/5/10/30` because their mean warmup component is zero in the raw pilot.

## 9. Reproducibility note

- Reproduction script: `tools/analyst-phase3-codex-reproduce.py`
- The script:
  - loads raw metrics directly from `state/exec-mode-experiment/full-pilot-fix2/1`
  - implements its own percentile bootstrap
  - cross-checks CIs with RNG seeds `42` and `1337`
  - applies the `<= 0.02` convergence rule with a `10,000 -> 20,000 -> 50,000` ladder
  - rebuilds the HELM table, per-mode aggregates, Pacc position summaries, F10 verification, decision sensitivity grid, and cost-structure summaries
- No imports from `bin/exec-mode-analyze.py`
- No p-values or NHST used

## 10. Discrepancies-to-watch

- `Pacc/F9/seed_idx=5` is missing, leaving `Pacc n=99` and `position-6 n=9`.
- `pollution.chain_rate` is null in all `399` records, so chain leakage cannot be analyzed from the raw pilot.
- `Pacc` directory naming is session/position encoded; `seed_idx` inside the JSON is the canonical seed field.
- `F10` is not a literal all-zero fixture across all modes; collapse is strongest in `Pfresh/S/Pacc`, but `D` retains non-zero mass.
- `Pacc` quality shows a late rebound at position `10` versus position `9` (`+0.2709`).
- Decision-tree sensitivity has `32` grid cells with no mode clearing the quality floor.
- `F6` should be interpreted carefully because prior RCA found a text-proxy grader brittleness issue in earlier pilot work.
