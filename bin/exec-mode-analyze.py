#!/usr/bin/env python3
"""Analyze exec-mode experiment metrics → HELM table + heatmaps + report (T15).

Reads metrics.json files under --state-dir (recursive walk), computes
per-(fixture, mode) bootstrap 95% CIs (10k resamples, percentile method per
analysis-plan §2.1), and emits:

  report/v3-max-results-{tag}.md   HELM-style orthogonal table + compact rate
  report/data.csv                  raw HELM table for downstream tools
  report/heatmaps/*.png            6 heatmaps: cost_marginal, cost_amort_30,
                                   quality, pollution_self, pollution_chain, loss
  report/position_effect_pacc_F{X}.png   Pacc-only position effect per fixture

Determinism: every bootstrap derives its RNG seed from a stable hash of
(fixture, mode, master_seed) so parallel cells are independent yet the entire
report is reproducible from one --seed argument.

CLI:
  exec-mode-analyze.py --state-dir <dir> --report-dir <dir>
                       [--replication-tag rep1] [--seed 42]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless — analyzer runs in CI / batch

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import scipy.stats  # noqa: E402

FIXTURES: tuple[str, ...] = ("F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "Fa")
MODES: tuple[str, ...] = ("D", "Pfresh", "Pacc", "S")

MIN_N_FOR_CI = 5  # analysis plan §2.1
DEFAULT_RESAMPLES = 10_000
DEFAULT_CI = 0.95

HEATMAP_VALID_METRICS: frozenset[str] = frozenset({
    "cost_marginal", "cost_amort_30", "quality",
    "pollution_self", "pollution_chain", "loss",
})

_METRIC_TO_COLUMN: dict[str, str] = {
    "cost_marginal":   "cost_marginal_usd",
    "cost_amort_30":   "cost_amort_30_usd",
    "quality":         "quality_primary",
    "pollution_self":  "pollution_self_rate",
    "pollution_chain": "pollution_chain_rate",
    "loss":            "loss_rate",
}


# ============================================================ load_metrics ====


def _flatten(m: dict) -> dict:
    cost = m["cost"]
    return {
        "trial_id":           m["trial_id"],
        "fixture_id":         m["fixture_id"],
        "mode":               m["mode"],
        "seed_idx":           m["seed_idx"],
        "run_idx":            m["run_idx"],
        "session_idx":        m.get("session_idx"),
        "position_in_chain":  m.get("position_in_chain"),
        "status":             m["status"],
        "cost_marginal_usd":  cost["marginal_usd"],
        "cost_amort_1_usd":   cost["amort_usd"]["n_1"],
        "cost_amort_10_usd":  cost["amort_usd"]["n_10"],
        "cost_amort_30_usd":  cost["amort_usd"]["n_30"],
        "warmup_cost_usd":    cost["warmup_cost_usd"],
        "subagent_cost_usd":  cost["subagent_cost_usd"],
        "compact_detected":   m["compact"]["detected"],
        "quality_primary":    m["quality"]["primary"],
        "pollution_self_rate":  m["pollution"]["self_rate"],
        "pollution_chain_rate": m["pollution"]["chain_rate"],
        "loss_rate":          m["loss"]["rate"],
    }


def load_metrics(state_root: Path) -> pd.DataFrame:
    rows: list[dict] = []
    for path in sorted(Path(state_root).rglob("metrics.json")):
        with path.open() as f:
            m = json.load(f)
        if m.get("dry_run"):
            continue
        rows.append(_flatten(m))
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


# ============================================================ bootstrap_ci ====


def bootstrap_ci(
    values,
    *,
    n_resamples: int = DEFAULT_RESAMPLES,
    confidence_level: float = DEFAULT_CI,
    seed: int = 42,
) -> tuple[float, float, float]:
    """Percentile bootstrap 95% CI. Returns (mean, lo, hi).

    NaN values are dropped first (failed-status trials enter as NaN).
    n < MIN_N_FOR_CI → (mean, NaN, NaN) per analysis-plan §2.1.
    All-equal samples → (c, c, c) (degenerate, skip resampling).
    """
    arr = np.asarray(list(values), dtype=float).ravel()
    arr = arr[~np.isnan(arr)]
    if arr.size == 0:
        return (math.nan, math.nan, math.nan)
    mean = float(arr.mean())
    if arr.size < MIN_N_FOR_CI:
        return (mean, math.nan, math.nan)
    if np.all(arr == arr[0]):
        return (mean, mean, mean)
    rng = np.random.default_rng(seed)
    res = scipy.stats.bootstrap(
        (arr,), np.mean,
        n_resamples=n_resamples,
        confidence_level=confidence_level,
        method="percentile",
        random_state=rng,
    )
    return (mean, float(res.confidence_interval.low), float(res.confidence_interval.high))


def _cell_seed(fixture: str, mode: str, master_seed: int, slot: int) -> int:
    """Stable, mode/fixture-independent sub-seed for one bootstrap call."""
    h = hashlib.sha256(f"{master_seed}:{fixture}:{mode}:{slot}".encode()).digest()
    return int.from_bytes(h[:4], "big")


# ============================================================ helm_table ====


def helm_table(df: pd.DataFrame, *, seed: int = 42) -> pd.DataFrame:
    rows: list[dict] = []
    for fixture in FIXTURES:
        for mode in MODES:
            sub = df[(df["fixture_id"] == fixture) & (df["mode"] == mode)]
            if sub.empty:
                continue
            ok = sub[sub["status"] == "ok"]
            n_valid = int(len(ok))
            n_compact_stratum = int(ok["compact_detected"].sum()) if n_valid else 0
            compact_rate = float(sub["compact_detected"].mean()) if len(sub) else math.nan
            cm = bootstrap_ci(ok["cost_marginal_usd"],   seed=_cell_seed(fixture, mode, seed, 0))
            ca = bootstrap_ci(ok["cost_amort_30_usd"],   seed=_cell_seed(fixture, mode, seed, 1))
            q  = bootstrap_ci(ok["quality_primary"],     seed=_cell_seed(fixture, mode, seed, 2))
            ps = bootstrap_ci(ok["pollution_self_rate"], seed=_cell_seed(fixture, mode, seed, 3))
            if mode == "Pacc":
                pc = bootstrap_ci(ok["pollution_chain_rate"], seed=_cell_seed(fixture, mode, seed, 4))
            else:
                pc = (math.nan, math.nan, math.nan)
            ls = bootstrap_ci(ok["loss_rate"], seed=_cell_seed(fixture, mode, seed, 5))
            rows.append({
                "fixture_id": fixture, "mode": mode,
                "n_valid": n_valid, "n_compact_stratum": n_compact_stratum,
                "cost_marginal_mean":  cm[0], "cost_marginal_lo":  cm[1], "cost_marginal_hi":  cm[2],
                "cost_amort_30_mean":  ca[0], "cost_amort_30_lo":  ca[1], "cost_amort_30_hi":  ca[2],
                "quality_mean":        q[0],  "quality_lo":        q[1],  "quality_hi":        q[2],
                "pollution_self_mean": ps[0], "pollution_self_lo": ps[1], "pollution_self_hi": ps[2],
                "pollution_chain_mean": pc[0], "pollution_chain_lo": pc[1], "pollution_chain_hi": pc[2],
                "loss_mean":           ls[0], "loss_lo":           ls[1], "loss_hi":           ls[2],
                "compact_rate":        compact_rate,
            })
    return pd.DataFrame(rows)


def _fmt_ci(mean: float, lo: float, hi: float) -> str:
    if math.isnan(mean):
        return "—"
    if math.isnan(lo) or math.isnan(hi):
        return f"{mean:.3f}"
    return f"{mean:.3f} [{lo:.3f}, {hi:.3f}]"


def format_helm_md(table: pd.DataFrame) -> str:
    """Markdown rendering matching spec §5.6 reporting template."""
    header = (
        "| fixture | mode | n_valid | cost_marginal $ | cost_amort_30 $ "
        "| quality | pollution_self | pollution_chain | loss | compact_rate |\n"
        "|---|---|---|---|---|---|---|---|---|---|"
    )
    lines = [header]
    for _, r in table.iterrows():
        lines.append(
            f"| {r['fixture_id']} | {r['mode']} | {int(r['n_valid'])} "
            f"| {_fmt_ci(r['cost_marginal_mean'], r['cost_marginal_lo'], r['cost_marginal_hi'])} "
            f"| {_fmt_ci(r['cost_amort_30_mean'], r['cost_amort_30_lo'], r['cost_amort_30_hi'])} "
            f"| {_fmt_ci(r['quality_mean'], r['quality_lo'], r['quality_hi'])} "
            f"| {_fmt_ci(r['pollution_self_mean'], r['pollution_self_lo'], r['pollution_self_hi'])} "
            f"| {_fmt_ci(r['pollution_chain_mean'], r['pollution_chain_lo'], r['pollution_chain_hi'])} "
            f"| {_fmt_ci(r['loss_mean'], r['loss_lo'], r['loss_hi'])} "
            f"| {r['compact_rate']:.3f} |"
        )
    return "\n".join(lines) + "\n"


# ============================================================ heatmap ====


def heatmap(table: pd.DataFrame, metric: str, out_png: Path) -> None:
    if metric not in HEATMAP_VALID_METRICS:
        raise ValueError(
            f"unknown metric {metric!r}; valid: {sorted(HEATMAP_VALID_METRICS)}"
        )
    col = f"{metric}_mean"
    pivot = (
        table.pivot(index="fixture_id", columns="mode", values=col)
        .reindex(index=list(FIXTURES))
        .reindex(columns=list(MODES))
    )
    fig, ax = plt.subplots(figsize=(6, 6))
    data = pivot.to_numpy(dtype=float)
    im = ax.imshow(data, aspect="auto", cmap="viridis")
    ax.set_xticks(range(len(MODES)))
    ax.set_xticklabels(list(MODES))
    ax.set_yticks(range(len(FIXTURES)))
    ax.set_yticklabels(list(FIXTURES))
    ax.set_title(f"{metric} (mean)")
    fig.colorbar(im, ax=ax)
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=80)
    plt.close(fig)


# ============================================================ compact_rate ====


def compact_rate_table(df: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict] = []
    for mode in MODES:
        sub = df[df["mode"] == mode]
        rate = float(sub["compact_detected"].mean()) if len(sub) else math.nan
        rows.append({"mode": mode, "compact_rate": rate, "n_trials": int(len(sub))})
    return pd.DataFrame(rows)


def _format_compact_md(crt: pd.DataFrame) -> str:
    lines = ["| mode | compact_rate | n_trials |", "|---|---|---|"]
    for _, r in crt.iterrows():
        rate = "—" if math.isnan(r["compact_rate"]) else f"{r['compact_rate']:.3f}"
        lines.append(f"| {r['mode']} | {rate} | {int(r['n_trials'])} |")
    return "\n".join(lines) + "\n"


# ============================================================ krippendorff ====


def krippendorff_alpha(ratings) -> float:
    """Krippendorff α for interval data (numpy-only — no proprietary package).

    ratings: 2-D array, raters × units. NaN = missing rating.
    Returns NaN when fewer than two units have ≥2 ratings (formula undefined).
    """
    arr = np.asarray(ratings, dtype=float)
    if arr.ndim != 2:
        raise ValueError("ratings must be 2D (raters × units)")
    n_units = arr.shape[1]
    if n_units < 2:
        return float("nan")

    Do_num = 0.0
    Do_den = 0
    pooled: list[float] = []
    for u in range(n_units):
        col = arr[:, u]
        col = col[~np.isnan(col)]
        m = col.size
        if m < 2:
            continue
        # Σ_{i≠j} (c_i − c_j)^2  divided by (m − 1)  — interval δ²
        diff = col[:, None] - col[None, :]
        Do_num += float(np.sum(diff * diff)) / (m - 1)
        Do_den += m
        pooled.extend(col.tolist())
    if Do_den == 0:
        return float("nan")
    Do = Do_num / Do_den

    pooled_arr = np.asarray(pooled, dtype=float)
    n = pooled_arr.size
    if n < 2:
        return float("nan")
    diff_pool = pooled_arr[:, None] - pooled_arr[None, :]
    De = float(np.sum(diff_pool * diff_pool)) / (n * (n - 1))
    if De == 0.0:
        return 1.0  # perfect agreement
    return 1.0 - Do / De


# ============================================================ position plot ====


def position_effect_plot(df: pd.DataFrame, fixture_id: str, out_png: Path) -> None:
    pacc = df[
        (df["mode"] == "Pacc")
        & (df["fixture_id"] == fixture_id)
        & (df["status"] == "ok")
    ]
    fig, ax = plt.subplots(figsize=(8, 5))
    if not pacc.empty:
        for col, label, color in [
            ("quality_primary",       "quality",         "tab:green"),
            ("pollution_chain_rate",  "pollution_chain", "tab:red"),
            ("loss_rate",             "loss",            "tab:blue"),
        ]:
            grouped = pacc.groupby("position_in_chain")[col].mean()
            ax.plot(grouped.index, grouped.values, marker="o", label=label, color=color)
    ax.set_xlabel("position_in_chain")
    ax.set_ylabel("mean metric")
    ax.set_title(f"Position effect — {fixture_id} (Pacc)")
    ax.legend(loc="best")
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=80)
    plt.close(fig)


# ============================================================ write_report ====


def write_report(
    df: pd.DataFrame,
    report_dir: Path,
    *,
    replication_tag: str = "rep1",
    seed: int = 42,
) -> Path:
    report_dir = Path(report_dir)
    heatmap_dir = report_dir / "heatmaps"
    heatmap_dir.mkdir(parents=True, exist_ok=True)

    table = helm_table(df, seed=seed)
    table.to_csv(report_dir / "data.csv", index=False)

    for metric in sorted(HEATMAP_VALID_METRICS):
        heatmap(table, metric, heatmap_dir / f"{metric}.png")

    for fixture in df["fixture_id"].unique():
        if ((df["mode"] == "Pacc") & (df["fixture_id"] == fixture)).any():
            position_effect_plot(
                df, fixture,
                report_dir / f"position_effect_pacc_{fixture}.png",
            )

    crt = compact_rate_table(df)
    md_path = report_dir / f"v3-max-results-{replication_tag}.md"
    parts = [
        f"# Exec-mode results — {replication_tag}\n",
        "## HELM-style orthogonal table\n",
        format_helm_md(table),
        "## Compact rate per mode\n",
        _format_compact_md(crt),
        "## Judge reliability\n",
        "Krippendorff α: deferred (jury batch produces ratings post-run; "
        "see metrics.jury.json files alongside each metrics.json).\n",
    ]
    md_path.write_text("\n".join(parts))
    return md_path


# ============================================================ CLI ====


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--state-dir", required=True, type=Path)
    p.add_argument("--report-dir", required=True, type=Path)
    p.add_argument("--replication-tag", default="rep1")
    p.add_argument("--seed", type=int, default=42)
    args = p.parse_args(argv)
    df = load_metrics(args.state_dir)
    if df.empty:
        print("[exec-mode-analyze] no metrics.json found under "
              f"{args.state_dir}", file=sys.stderr)
        return 1
    write_report(df, args.report_dir,
                 replication_tag=args.replication_tag, seed=args.seed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
