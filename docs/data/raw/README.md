# Raw Data Archive — Exec Mode P3 Pilot

Preserved raw metrics from Phase 3 P3 Pilot (400 trials, 4 modes × 10 fixtures × 10 seeds) for reproducibility.

## Snapshot summary

| Archive | Grader state | F10 quality | Audit role |
|---|---|---|---|
| `2026-04-21-full-pilot-fix2.tar.gz` | pre-H8-deep-fix (fix2 graders + fix3 Pacc harness) | all 40 × F10 trials = 0.0 (grader false-negative) | pre-registered raw snapshot (immutable) |
| `2026-04-21-full-pilot-fix4.tar.gz` | post-H8-deep-fix (F10 label regex corrected) | 40 × F10 trials re-graded; `quality.regraded_from_fix3=true` flag on each patched cell | canonical post-H8 snapshot used by analyst report |

Both archives are kept; fix2 remains authoritative for the pre-registered raw-grader baseline, fix4 is authoritative for the corrected-grader HELM tables / user summary.

## 2026-04-21-full-pilot-fix2.tar.gz

- **SHA-256**: `e7390a411399b6e77dceb31bb8af3f607c683858535e8fbcc314069049b93a19`
- **Size**: 5.8 MB (compressed from 24 MB state dir)
- **Contents**: `full-pilot-fix2/` (all 399 trial metrics.json + run_orders + chain_state)
- **Pre-registration tag**: `exec-mode-v3-max-preregistered-20260420-fix2` (graders) + `exec-mode-v3-max-preregistered-20260420-fix3` (Pacc chain_state harness)
- **Pilot date**: 2026-04-20 ~ 2026-04-21 (P3 Pilot execution)
- **Status**: pre-H8-deep-fix — F10 primary_score = 0.0 for all 40 trials due to grader label-regex false-negative (see commit `f5fdd3d`)

## 2026-04-21-full-pilot-fix4.tar.gz

- **SHA-256**: `98d733b52a3f11c81bcefb253fe369d4ab0b7f17d20d17cd9618df88d69e5e17`
- **Size**: 5.8 MB (compressed from 24 MB state dir)
- **Contents**: `full-pilot-fix4/` — copy of fix2 with H8 re-grade applied to 40 × F10 cells only
- **Pre-registration tag**: `exec-mode-v3-max-preregistered-20260420-fix4`
- **Derivation**: `cp -r full-pilot-fix2 full-pilot-fix4` → `tools/apply-h8-regrade.py` (applies `tools/h8-f10-regrade-output.csv`)
- **Audit flag**: each patched `metrics.json` carries `quality.regraded_from_fix3: true`
- **Non-F10 cells**: untouched — cost / pollution / loss / incidents / timestamps identical to fix2
- **Status**: post-H8-deep-fix — F10 primary_score reflects corrected grader; used by `docs/data/analyzer-output-fix4/` HELM table and the 2026-04-21 user summary

## Per-mode trial counts

| Mode | Trials | Commit |
|---|---:|---|
| D | 100/100 | `3dec3d0` |
| S | 100/100 | `ce0882f` |
| Pfresh | 100/100 | `19b5aec` |
| Pacc | 99/100 (1 × 720s timeout sess=5/pos=6/F9/seed=5) | `6254eb6` |

## How to restore

```bash
cd ~/projects/aigentry-devkit/state/exec-mode-experiment

# pre-H8 baseline
tar xzf ../../docs/data/raw/2026-04-21-full-pilot-fix2.tar.gz

# post-H8 canonical
tar xzf ../../docs/data/raw/2026-04-21-full-pilot-fix4.tar.gz
```

## Use for analyst / replication

- Analyst Phase 3 report references both archives for raw metric access
- Replay pre-H8 view: `bin/exec-mode-analyze.py --state-dir state/exec-mode-experiment/full-pilot-fix2`
- Replay post-H8 canonical: `bin/exec-mode-analyze.py --state-dir state/exec-mode-experiment/full-pilot-fix4`
- Do NOT re-run pilot — use these archives for deterministic re-analysis
- To reproduce the fix2 → fix4 transform: run `tools/apply-h8-regrade.py` after restoring fix2 into `full-pilot-fix4/`

Per `.gitignore`, the `state/` dir is not tracked. These archives are the canonical snapshots.
