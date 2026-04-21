# Raw Data Archive — Exec Mode P3 Pilot

Preserved raw metrics from Phase 3 P3 Pilot (400 trials, 4 modes × 10 fixtures × 10 seeds) for reproducibility.

## 2026-04-21-full-pilot-fix2.tar.gz

- **SHA-256**: `e7390a411399b6e77dceb31bb8af3f607c683858535e8fbcc314069049b93a19`
- **Size**: 5.8 MB (compressed from 24 MB state dir)
- **Contents**: `full-pilot-fix2/` (all 399 trial metrics.json + run_orders + chain_state)
- **Pre-registration tag**: `exec-mode-v3-max-preregistered-20260420-fix2` (graders) + `exec-mode-v3-max-preregistered-20260420-fix3` (Pacc chain_state harness)
- **Pilot date**: 2026-04-20 ~ 2026-04-21 (P3 Pilot execution)

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
tar xzf ../../docs/data/raw/2026-04-21-full-pilot-fix2.tar.gz
```

## Use for analyst / replication

- Analyst Phase 3 report references this archive for raw metric access
- Use `bin/exec-mode-analyze.py --state-dir state/exec-mode-experiment/full-pilot-fix2` after restore
- Do NOT re-run pilot — use this archive for deterministic re-analysis

Per `.gitignore`, the `state/` dir is not tracked. This archive is the canonical snapshot.
