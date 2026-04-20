"""TDD for bin/exec-mode-analyze.py (T15).

Spec references:
- §5.6 Reporting: bootstrap 95% CI, HELM orthogonal table.
- Analysis plan §2.1: min-n rule (n < 5 → raw only, no CI).
- Analysis plan §2.7: Krippendorff α target ≥ 0.8.
- Build spec §3.1/§7 T15: interface signatures.
- metrics.v1.json: source trial format.

Session C owns analyzer + order generator. Every statistic must have a seeded
test — no "looks right" (Rule 22 가설 금지).
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO = Path(__file__).resolve().parents[2]
ANALYZER = REPO / "bin" / "exec-mode-analyze.py"


@pytest.fixture
def analyzer():
    spec = importlib.util.spec_from_file_location("exec_mode_analyze", ANALYZER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FIXTURES = ["F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "Fa"]
MODES = ["D", "Pfresh", "Pacc", "S"]


def _minimal_metric(
    *,
    run_idx: int,
    mode: str,
    fixture_id: str,
    seed_idx: int,
    status: str = "ok",
    cost_marginal: float = 0.10,
    cost_amort_30: float = 0.12,
    quality: float = 0.75,
    pollution_self_rate: float = 0.2,
    pollution_chain_rate: float | None = None,
    loss_rate: float = 0.1,
    compact_detected: bool = False,
    session_idx: int | None = None,
    position_in_chain: int | None = None,
    dry_run: bool = False,
) -> dict:
    """Build a schema-compliant metric dict for test fixtures."""
    suffix = f"_pos{position_in_chain}_sess{session_idx}" if mode == "Pacc" else ""
    trial_id = f"{run_idx}/{mode}/{fixture_id}/seed{seed_idx:02d}{suffix}"
    return {
        "schema_version": "1",
        "trial_id": trial_id,
        "fixture_id": fixture_id,
        "mode": mode,
        "seed_idx": seed_idx,
        "run_idx": run_idx,
        "session_idx": session_idx if mode == "Pacc" else None,
        "position_in_chain": position_in_chain if mode == "Pacc" else None,
        "status": status,
        "dry_run": dry_run,
        "timestamps": {
            "stage1_start": "2026-04-20T00:00:00Z",
            "stage1_end":   "2026-04-20T00:05:00Z",
            "stage2_start": "2026-04-20T00:06:00Z",
            "stage2_end":   "2026-04-20T00:07:00Z",
        },
        "cli_versions": {"claude": "x", "codex": "x", "gemini": "x", "telepty": "x"},
        "cost": {
            "marginal_usd": cost_marginal,
            "amort_usd": {"n_1": cost_marginal + 0.5, "n_10": cost_marginal + 0.05, "n_30": cost_amort_30},
            "warmup_cost_usd": 0.0,
            "subagent_cost_usd": 0.0,
            "usage_buckets": {
                "input_tokens": 100,
                "cache_write_5m_tokens": 0,
                "cache_write_1h_tokens": 0,
                "cache_read_tokens": 0,
                "output_tokens": 50,
            },
        },
        "compact": {"detected": compact_detected, "reason": None,
                    "cache_read_drop_ratio": None, "next_input_spike_ratio": None},
        "quality": {"primary": quality if status == "ok" else None,
                    "length_capped": False},
        "pollution": {
            "self_rate": pollution_self_rate if status == "ok" else None,
            "self_leaks_layer_a": [False] * 10,
            "chain_rate": pollution_chain_rate if mode == "Pacc" else None,
            "chain_leaks_layer_a": [] if mode == "Pacc" else None,
        },
        "loss": {
            "rate": loss_rate if status == "ok" else None,
            "probe_order_seed": seed_idx,
            "probes": [
                {"probe_idx": i, "layer_a_hit": False, "layer_b_hit": False,
                 "layer_c_pending": False, "recall": True}
                for i in range(10)
            ],
        },
        "paths": {
            "stage1_output": "stage1_output.md",
            "stage1_jsonl": "stage1.jsonl",
            "stage2_transcript": "stage2.md",
            "stage2_answers": "stage2_answers.json",
        },
    }


def _write_metric(root: Path, metric: dict) -> Path:
    trial_id = metric["trial_id"]
    trial_dir = root / trial_id
    trial_dir.mkdir(parents=True, exist_ok=True)
    path = trial_dir / "metrics.json"
    path.write_text(json.dumps(metric))
    return path


def _seed_state_tree(root: Path, *, n_per_cell: int = 5) -> None:
    """Populate a state tree with n_per_cell trials per (fixture, mode)."""
    for fixture in FIXTURES:
        for mode in MODES:
            for k in range(n_per_cell):
                session_idx = (k % 30) + 1 if mode == "Pacc" else None
                position = (k % 10) + 1 if mode == "Pacc" else None
                _write_metric(
                    root,
                    _minimal_metric(
                        run_idx=1, mode=mode, fixture_id=fixture, seed_idx=k,
                        cost_marginal=0.1 + 0.01 * k,
                        quality=0.7 + 0.02 * k,
                        pollution_self_rate=0.1 + 0.01 * k,
                        pollution_chain_rate=(0.05 + 0.005 * k) if mode == "Pacc" else None,
                        loss_rate=0.1 + 0.005 * k,
                        compact_detected=(mode == "Pacc" and k == 0),
                        session_idx=session_idx,
                        position_in_chain=position,
                    ),
                )


# ================ load_metrics ================


def test_load_metrics_walks_state_tree(tmp_path, analyzer):
    _seed_state_tree(tmp_path, n_per_cell=3)
    df = analyzer.load_metrics(tmp_path)
    assert len(df) == len(FIXTURES) * len(MODES) * 3


def test_load_metrics_has_required_columns(tmp_path, analyzer):
    _seed_state_tree(tmp_path, n_per_cell=2)
    df = analyzer.load_metrics(tmp_path)
    required = {
        "trial_id", "fixture_id", "mode", "seed_idx", "run_idx", "status",
        "cost_marginal_usd", "cost_amort_30_usd",
        "quality_primary",
        "pollution_self_rate", "pollution_chain_rate",
        "loss_rate",
        "compact_detected",
        "session_idx", "position_in_chain",
    }
    assert required <= set(df.columns)


def test_load_metrics_skips_dry_run(tmp_path, analyzer):
    """Schema: dry_run=true → excluded from primary analysis."""
    _write_metric(tmp_path, _minimal_metric(run_idx=1, mode="D", fixture_id="F2", seed_idx=0))
    _write_metric(tmp_path, _minimal_metric(run_idx=1, mode="D", fixture_id="F2", seed_idx=1, dry_run=True))
    df = analyzer.load_metrics(tmp_path)
    assert len(df) == 1
    assert df.iloc[0]["seed_idx"] == 0


def test_load_metrics_failed_status_has_nan_metrics(tmp_path, analyzer):
    """status != 'ok' → primary metric values are NaN so bootstrap skips them."""
    _write_metric(tmp_path, _minimal_metric(run_idx=1, mode="D", fixture_id="F2", seed_idx=0, status="failed"))
    df = analyzer.load_metrics(tmp_path)
    row = df.iloc[0]
    assert row["status"] == "failed"
    assert pd.isna(row["quality_primary"])
    assert pd.isna(row["loss_rate"])
    assert pd.isna(row["pollution_self_rate"])


def test_load_metrics_pacc_row_has_session_and_position(tmp_path, analyzer):
    _write_metric(tmp_path, _minimal_metric(
        run_idx=1, mode="Pacc", fixture_id="F2", seed_idx=3,
        session_idx=3, position_in_chain=7,
        pollution_chain_rate=0.12,
    ))
    df = analyzer.load_metrics(tmp_path)
    row = df.iloc[0]
    assert row["session_idx"] == 3
    assert row["position_in_chain"] == 7
    assert row["pollution_chain_rate"] == pytest.approx(0.12)


# ================ bootstrap_ci ================


def test_bootstrap_ci_returns_mean_and_bounds(analyzer):
    values = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
    mean, lo, hi = analyzer.bootstrap_ci(values, seed=42)
    assert mean == pytest.approx(0.55, abs=1e-9)
    assert lo <= mean <= hi
    assert lo > 0.0 and hi < 1.0


def test_bootstrap_ci_seeded_reproducible(analyzer):
    values = np.array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0])
    a = analyzer.bootstrap_ci(values, seed=42)
    b = analyzer.bootstrap_ci(values, seed=42)
    assert a == b


def test_bootstrap_ci_seed_actually_affects_output(analyzer):
    """The seed parameter must steer the resample. Use noisy n=30 so the 2.5th/97.5th
    percentiles aren't snapping to the same sample boundaries across seeds."""
    values = np.random.default_rng(99).uniform(0, 1, size=30)
    results = {analyzer.bootstrap_ci(values, seed=s)[1:] for s in range(10)}
    assert len(results) >= 2, "seed parameter has no observable effect"


def test_bootstrap_ci_min_n_rule(analyzer):
    """Analysis plan §2.1: n < 5 → no CI (return NaN bounds)."""
    values = np.array([0.3, 0.4, 0.5, 0.6])  # n=4
    mean, lo, hi = analyzer.bootstrap_ci(values, seed=42)
    assert mean == pytest.approx(0.45)
    assert np.isnan(lo) and np.isnan(hi)


def test_bootstrap_ci_all_equal_values(analyzer):
    """Degenerate input: constant array → CI collapses to the constant."""
    values = np.array([0.5] * 10)
    mean, lo, hi = analyzer.bootstrap_ci(values, seed=42)
    assert mean == pytest.approx(0.5)
    assert lo == pytest.approx(0.5)
    assert hi == pytest.approx(0.5)


def test_bootstrap_ci_ignores_nans(analyzer):
    """Failed-status trials enter as NaN; bootstrap must drop them."""
    values = np.array([0.1, 0.2, 0.3, 0.4, 0.5, np.nan, np.nan])
    mean, lo, hi = analyzer.bootstrap_ci(values, seed=42)
    assert mean == pytest.approx(0.3)
    assert not np.isnan(lo) and not np.isnan(hi)


# ================ helm_table ================


def test_helm_table_one_row_per_fixture_mode_cell(tmp_path, analyzer):
    _seed_state_tree(tmp_path, n_per_cell=5)
    df = analyzer.load_metrics(tmp_path)
    table = analyzer.helm_table(df, seed=42)
    assert len(table) == len(FIXTURES) * len(MODES)
    keys = list(zip(table["fixture_id"], table["mode"]))
    assert sorted(keys) == sorted((f, m) for f in FIXTURES for m in MODES)


def test_helm_table_columns_orthogonal(tmp_path, analyzer):
    _seed_state_tree(tmp_path, n_per_cell=5)
    df = analyzer.load_metrics(tmp_path)
    table = analyzer.helm_table(df, seed=42)
    required = {
        "fixture_id", "mode", "n_valid", "n_compact_stratum",
        "cost_marginal_mean", "cost_marginal_lo", "cost_marginal_hi",
        "cost_amort_30_mean", "cost_amort_30_lo", "cost_amort_30_hi",
        "quality_mean", "quality_lo", "quality_hi",
        "pollution_self_mean", "pollution_self_lo", "pollution_self_hi",
        "pollution_chain_mean", "pollution_chain_lo", "pollution_chain_hi",
        "loss_mean", "loss_lo", "loss_hi",
        "compact_rate",
    }
    assert required <= set(table.columns)


def test_helm_table_pollution_chain_nan_for_non_pacc(tmp_path, analyzer):
    _seed_state_tree(tmp_path, n_per_cell=5)
    df = analyzer.load_metrics(tmp_path)
    table = analyzer.helm_table(df, seed=42)
    non_pacc = table[table["mode"] != "Pacc"]
    assert non_pacc["pollution_chain_mean"].isna().all()


def test_helm_table_n_valid_excludes_failed_trials(tmp_path, analyzer):
    for k in range(5):
        _write_metric(tmp_path, _minimal_metric(run_idx=1, mode="D", fixture_id="F2", seed_idx=k))
    for k in range(3):
        _write_metric(tmp_path, _minimal_metric(run_idx=1, mode="D", fixture_id="F2",
                                                seed_idx=10 + k, status="failed"))
    df = analyzer.load_metrics(tmp_path)
    table = analyzer.helm_table(df, seed=42)
    d_f2 = table[(table["fixture_id"] == "F2") & (table["mode"] == "D")].iloc[0]
    assert d_f2["n_valid"] == 5


def test_helm_table_compact_rate(tmp_path, analyzer):
    for k in range(10):
        _write_metric(tmp_path, _minimal_metric(
            run_idx=1, mode="Pacc", fixture_id="F2", seed_idx=k,
            session_idx=k + 1, position_in_chain=1,
            compact_detected=(k < 3),  # 3/10 = 0.3
        ))
    df = analyzer.load_metrics(tmp_path)
    table = analyzer.helm_table(df, seed=42)
    pacc_f2 = table[(table["fixture_id"] == "F2") & (table["mode"] == "Pacc")].iloc[0]
    assert pacc_f2["compact_rate"] == pytest.approx(0.3)


def test_format_helm_md_renders_table(tmp_path, analyzer):
    _seed_state_tree(tmp_path, n_per_cell=5)
    df = analyzer.load_metrics(tmp_path)
    table = analyzer.helm_table(df, seed=42)
    md = analyzer.format_helm_md(table)
    assert "| fixture" in md
    assert "F2" in md and "D" in md
    assert "[" in md and "]" in md  # CI brackets per spec §5.6 format


# ================ heatmap ================


@pytest.mark.parametrize(
    "metric",
    ["cost_marginal", "cost_amort_30", "quality", "pollution_self", "loss"],
)
def test_heatmap_generates_png(tmp_path, analyzer, metric):
    _seed_state_tree(tmp_path, n_per_cell=5)
    df = analyzer.load_metrics(tmp_path)
    table = analyzer.helm_table(df, seed=42)
    out = tmp_path / f"{metric}.png"
    analyzer.heatmap(table, metric, out)
    assert out.is_file()
    assert out.stat().st_size > 0
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_heatmap_pollution_chain_pacc_only(tmp_path, analyzer):
    """pollution_chain heatmap shows only Pacc cells (single column)."""
    _seed_state_tree(tmp_path, n_per_cell=5)
    df = analyzer.load_metrics(tmp_path)
    table = analyzer.helm_table(df, seed=42)
    out = tmp_path / "pollution_chain_pacc.png"
    analyzer.heatmap(table, "pollution_chain", out)
    assert out.is_file()
    assert out.stat().st_size > 0


def test_heatmap_unknown_metric_rejected(tmp_path, analyzer):
    _seed_state_tree(tmp_path, n_per_cell=5)
    df = analyzer.load_metrics(tmp_path)
    table = analyzer.helm_table(df, seed=42)
    with pytest.raises(ValueError):
        analyzer.heatmap(table, "not_a_metric", tmp_path / "bad.png")


# ================ compact_rate_table ================


def test_compact_rate_table_per_mode(tmp_path, analyzer):
    """Analysis plan §2.5: compact_rate per mode — P-acc expected highest."""
    for k in range(10):
        _write_metric(tmp_path, _minimal_metric(run_idx=1, mode="D", fixture_id="F2", seed_idx=k))
    for k in range(10):
        _write_metric(tmp_path, _minimal_metric(
            run_idx=1, mode="Pacc", fixture_id="F2", seed_idx=k,
            session_idx=k + 1, position_in_chain=1,
            compact_detected=(k < 5),  # 5/10 = 0.5
        ))
    df = analyzer.load_metrics(tmp_path)
    t = analyzer.compact_rate_table(df)
    row_d = t[t["mode"] == "D"].iloc[0]
    row_pacc = t[t["mode"] == "Pacc"].iloc[0]
    assert row_d["compact_rate"] == pytest.approx(0.0)
    assert row_pacc["compact_rate"] == pytest.approx(0.5)


# ================ krippendorff_alpha ================


def test_krippendorff_perfect_agreement(analyzer):
    """All judges identical on all units → α = 1.0."""
    ratings = np.array([
        [0.0, 0.5, 1.0, 0.25],
        [0.0, 0.5, 1.0, 0.25],
        [0.0, 0.5, 1.0, 0.25],
    ])
    assert analyzer.krippendorff_alpha(ratings) == pytest.approx(1.0)


def test_krippendorff_total_disagreement_near_zero(analyzer):
    """Structured mirror disagreement → α ≤ 0."""
    ratings = np.array([
        [0.0, 1.0, 0.0, 1.0],
        [1.0, 0.0, 1.0, 0.0],
    ])
    alpha = analyzer.krippendorff_alpha(ratings)
    assert alpha <= 0.0 + 1e-9


def test_krippendorff_single_unit_undefined(analyzer):
    """One unit → α undefined (NaN). Krippendorff formula divides by (n-1)."""
    ratings = np.array([[0.5], [0.6]])
    assert np.isnan(analyzer.krippendorff_alpha(ratings))


def test_krippendorff_handles_nan_missing(analyzer):
    """Missing ratings (NaN) are dropped from computation, not propagated."""
    ratings = np.array([
        [0.5, 0.7, np.nan, 0.3],
        [0.5, 0.7, 0.4, np.nan],
        [0.5, 0.7, 0.4, 0.3],
    ])
    alpha = analyzer.krippendorff_alpha(ratings)
    assert not np.isnan(alpha)
    assert 0.0 <= alpha <= 1.0


# ================ position_effect_plot (Pacc only) ================


def test_position_effect_plot_generates_png(tmp_path, analyzer):
    for session in range(1, 11):
        for pos in range(1, 11):
            _write_metric(tmp_path, _minimal_metric(
                run_idx=1, mode="Pacc", fixture_id="F2",
                seed_idx=(session - 1) * 10 + (pos - 1),
                session_idx=session, position_in_chain=pos,
                pollution_chain_rate=0.05 * pos,
                loss_rate=0.02 * pos,
            ))
    df = analyzer.load_metrics(tmp_path)
    out = tmp_path / "position_effect_F2.png"
    analyzer.position_effect_plot(df, "F2", out)
    assert out.is_file()
    assert out.stat().st_size > 0


# ================ write_report (end-to-end) ================


def test_write_report_generates_markdown(tmp_path, analyzer):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    report_dir = tmp_path / "report"
    _seed_state_tree(state_dir, n_per_cell=5)
    df = analyzer.load_metrics(state_dir)
    analyzer.write_report(df, report_dir, replication_tag="rep1", seed=42)
    md = report_dir / "v3-max-results-rep1.md"
    assert md.is_file()
    text = md.read_text()
    assert "HELM" in text or "orthogonal" in text.lower() or "| fixture" in text
    assert "Krippendorff" in text or "α" in text
    assert (report_dir / "data.csv").is_file()
    assert (report_dir / "heatmaps").is_dir()
    # At least the four primary-metric heatmaps
    assert (report_dir / "heatmaps" / "cost_marginal.png").is_file()
    assert (report_dir / "heatmaps" / "quality.png").is_file()
    assert (report_dir / "heatmaps" / "pollution_self.png").is_file()
    assert (report_dir / "heatmaps" / "loss.png").is_file()


# ================ CLI entry point ================


def test_main_cli_end_to_end(tmp_path):
    state_dir = tmp_path / "state"
    report_dir = tmp_path / "report"
    state_dir.mkdir()
    for fixture in FIXTURES[:3]:  # smoke subset
        for mode in MODES:
            for k in range(5):
                session = (k % 30) + 1 if mode == "Pacc" else None
                pos = (k % 10) + 1 if mode == "Pacc" else None
                m = _minimal_metric(
                    run_idx=1, mode=mode, fixture_id=fixture, seed_idx=k,
                    session_idx=session, position_in_chain=pos,
                    pollution_chain_rate=0.1 if mode == "Pacc" else None,
                )
                _write_metric(state_dir, m)
    result = subprocess.run(
        [sys.executable, str(ANALYZER),
         "--state-dir", str(state_dir),
         "--report-dir", str(report_dir),
         "--replication-tag", "rep1",
         "--seed", "42"],
        check=True, capture_output=True, text=True,
    )
    assert (report_dir / "v3-max-results-rep1.md").is_file()
    assert (report_dir / "data.csv").is_file()
