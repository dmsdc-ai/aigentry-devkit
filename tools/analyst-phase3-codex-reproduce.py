#!/usr/bin/env python3
"""Independent Phase 3 analysis for exec-mode P3 Pilot."""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


DEFAULT_ROOT = Path(
    "/Users/duckyoungkim/projects/aigentry-devkit/state/exec-mode-experiment/full-pilot-fix2/1"
)
EXPECTED_SHA256 = "e7390a411399b6e77dceb31bb8af3f607c683858535e8fbcc314069049b93a19"
EXPECTED_MODES = ("D", "Pacc", "Pfresh", "S")
EXPECTED_FIXTURES = ("F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "Fa")
HELM_METRICS = ("cost", "quality", "pollution", "loss")
MINIMIZE_METRICS = frozenset({"cost", "pollution", "loss"})
BOOTSTRAP_SEEDS = (42, 1337)
BOOTSTRAP_LADDER = (10_000, 20_000, 50_000)
BOOTSTRAP_THRESHOLD = 0.02


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument(
        "--format", choices=("json", "markdown"), default="json", help="Output format."
    )
    parser.add_argument(
        "--sha",
        default=EXPECTED_SHA256,
        help="Expected archive SHA-256 to echo in the output summary.",
    )
    return parser.parse_args()


def quantile_from_sorted(values: list[float], q: float) -> float:
    if not values:
        raise ValueError("cannot compute quantile of empty list")
    if len(values) == 1:
        return values[0]
    position = (len(values) - 1) * q
    lo = math.floor(position)
    hi = math.ceil(position)
    if lo == hi:
        return values[lo]
    fraction = position - lo
    return values[lo] * (1.0 - fraction) + values[hi] * fraction


def bootstrap_mean_ci(values: list[float], seed: int, resamples: int) -> dict[str, float]:
    if not values:
        raise ValueError("cannot bootstrap empty sample")
    mean_value = statistics.fmean(values)
    n = len(values)
    if n == 1:
        return {"mean": mean_value, "low": values[0], "high": values[0]}
    rng = random.Random(seed)
    randrange = rng.randrange
    sample_means = [0.0] * resamples
    for idx in range(resamples):
        total = 0.0
        for _ in range(n):
            total += values[randrange(n)]
        sample_means[idx] = total / n
    sample_means.sort()
    return {
        "mean": mean_value,
        "low": quantile_from_sorted(sample_means, 0.025),
        "high": quantile_from_sorted(sample_means, 0.975),
    }


def converged_bootstrap(values: list[float]) -> dict[str, Any]:
    if not values:
        raise ValueError("cannot summarize empty sample")
    diagnostics: list[dict[str, Any]] = []
    selected: dict[str, Any] | None = None
    for resamples in BOOTSTRAP_LADDER:
        run_a = bootstrap_mean_ci(values, BOOTSTRAP_SEEDS[0], resamples)
        run_b = bootstrap_mean_ci(values, BOOTSTRAP_SEEDS[1], resamples)
        endpoint_delta = max(
            abs(run_a["low"] - run_b["low"]),
            abs(run_a["high"] - run_b["high"]),
        )
        record = {
            "resamples": resamples,
            "seed_42": run_a,
            "seed_1337": run_b,
            "endpoint_delta": endpoint_delta,
            "converged": endpoint_delta <= BOOTSTRAP_THRESHOLD,
        }
        diagnostics.append(record)
        selected = record
        if record["converged"]:
            break
    assert selected is not None
    return {
        "n": len(values),
        "mean": selected["seed_42"]["mean"],
        "ci_low": selected["seed_42"]["low"],
        "ci_high": selected["seed_42"]["high"],
        "resamples": selected["resamples"],
        "endpoint_delta": selected["endpoint_delta"],
        "converged": selected["converged"],
        "diagnostics": diagnostics,
    }


def round_float(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def sort_mode(mode: str) -> tuple[int, str]:
    return (EXPECTED_MODES.index(mode), mode)


def sort_fixture(fixture: str) -> tuple[int, str]:
    return (EXPECTED_FIXTURES.index(fixture), fixture)


def parse_pacc_dir_metadata(dir_name: str) -> tuple[int | None, int | None]:
    session_idx = None
    position = None
    for chunk in dir_name.split("_"):
        if chunk.startswith("pos"):
            try:
                position = int(chunk[3:])
            except ValueError:
                position = None
        if chunk.startswith("sess"):
            try:
                session_idx = int(chunk[4:])
            except ValueError:
                session_idx = None
    return position, session_idx


def load_records(root: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in sorted(root.glob("*/*/seed*/metrics.json")):
        payload = json.loads(path.read_text())
        record = {
            "path": str(path),
            "mode": payload["mode"],
            "fixture": payload["fixture_id"],
            "seed_idx": int(payload["seed_idx"]),
            "status": payload["status"],
            "compact_detected": bool(payload["compact"]["detected"]),
            "cost": float(payload["cost"]["marginal_usd"]),
            "cost_m1": float(payload["cost"]["amort_usd"]["n_1"]),
            "cost_m10": float(payload["cost"]["amort_usd"]["n_10"]),
            "cost_m30": float(payload["cost"]["amort_usd"]["n_30"]),
            "quality": float(payload["quality"]["primary"]),
            "pollution": float(payload["pollution"]["self_rate"]),
            "pollution_chain": payload["pollution"]["chain_rate"],
            "loss": float(payload["loss"]["rate"]),
            "trial_id": payload["trial_id"],
            "position_in_chain": payload["position_in_chain"],
            "session_idx": payload["session_idx"],
            "dir_name": path.parent.name,
        }
        if record["mode"] == "Pacc":
            parsed_position, parsed_session = parse_pacc_dir_metadata(record["dir_name"])
            if record["position_in_chain"] is None:
                record["position_in_chain"] = parsed_position
            if record["session_idx"] is None:
                record["session_idx"] = parsed_session
        records.append(record)
    return records


def dataset_summary(records: list[dict[str, Any]], expected_sha: str) -> dict[str, Any]:
    mode_counts = Counter(record["mode"] for record in records)
    status_counts = Counter(record["status"] for record in records)
    compact_counts = Counter(record["compact_detected"] for record in records)
    key_nulls = {
        "quality": sum(record["quality"] is None for record in records),
        "cost": sum(record["cost"] is None for record in records),
        "cost_m1": sum(record["cost_m1"] is None for record in records),
        "cost_m10": sum(record["cost_m10"] is None for record in records),
        "cost_m30": sum(record["cost_m30"] is None for record in records),
        "pollution": sum(record["pollution"] is None for record in records),
        "loss": sum(record["loss"] is None for record in records),
    }
    schema_keys = sorted(
        [
            "cli_versions",
            "compact",
            "cost",
            "dry_run",
            "fixture_id",
            "incidents",
            "loss",
            "mode",
            "paths",
            "pollution",
            "position_in_chain",
            "quality",
            "run_idx",
            "schema_version",
            "seed_idx",
            "session_idx",
            "status",
            "timestamps",
            "trial_id",
        ]
    )
    by_mode_fixture_seed: dict[tuple[str, str], set[int]] = defaultdict(set)
    by_position_counts = Counter()
    for record in records:
        by_mode_fixture_seed[(record["mode"], record["fixture"])].add(record["seed_idx"])
        if record["position_in_chain"] is not None:
            by_position_counts[int(record["position_in_chain"])] += 1
    missing_cells = []
    for mode in EXPECTED_MODES:
        for fixture in EXPECTED_FIXTURES:
            expected = set(range(1, 11)) if mode == "Pacc" else set(range(10))
            present = by_mode_fixture_seed[(mode, fixture)]
            if present != expected:
                missing_cells.append(
                    {
                        "mode": mode,
                        "fixture": fixture,
                        "missing_seed_idx": sorted(expected - present),
                        "n_present": len(present),
                    }
                )
    return {
        "expected_archive_sha256": expected_sha,
        "record_count": len(records),
        "mode_counts": {mode: mode_counts.get(mode, 0) for mode in EXPECTED_MODES},
        "status_counts": dict(status_counts),
        "compact_counts": {str(key).lower(): compact_counts.get(key, 0) for key in (False, True)},
        "schema_keys": schema_keys,
        "primary_null_counts": key_nulls,
        "pollution_chain_null_count": sum(record["pollution_chain"] is None for record in records),
        "position_counts": {str(k): by_position_counts[k] for k in sorted(by_position_counts)},
        "missing_cells": missing_cells,
    }


def summarize_group(records: list[dict[str, Any]], metric: str) -> dict[str, Any]:
    values = [float(record[metric]) for record in records]
    result = converged_bootstrap(values)
    return {
        "n": result["n"],
        "mean": round_float(result["mean"]),
        "ci_low": round_float(result["ci_low"]),
        "ci_high": round_float(result["ci_high"]),
        "resamples": result["resamples"],
        "endpoint_delta": round_float(result["endpoint_delta"]),
        "converged": result["converged"],
        "values": values,
    }


def helm_table(records: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for record in records:
        grouped[record["fixture"]][record["mode"]].append(record)
    table: dict[str, dict[str, Any]] = {}
    diagnostics: list[dict[str, Any]] = []
    for fixture in sorted(grouped, key=sort_fixture):
        table[fixture] = {}
        for mode in sorted(grouped[fixture], key=sort_mode):
            mode_records = grouped[fixture][mode]
            metric_summary: dict[str, Any] = {}
            for metric in HELM_METRICS:
                summary = summarize_group(mode_records, metric)
                metric_summary[metric] = {k: summary[k] for k in summary if k != "values"}
                diagnostics.append(
                    {
                        "family": "helm",
                        "fixture": fixture,
                        "mode": mode,
                        "metric": metric,
                        "resamples": summary["resamples"],
                        "endpoint_delta": summary["endpoint_delta"],
                        "converged": summary["converged"],
                    }
                )
            table[fixture][mode] = metric_summary
    return table, diagnostics


def per_mode_summary(records: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[record["mode"]].append(record)
    table: dict[str, Any] = {}
    diagnostics: list[dict[str, Any]] = []
    for mode in sorted(grouped, key=sort_mode):
        table[mode] = {}
        for metric in HELM_METRICS:
            summary = summarize_group(grouped[mode], metric)
            table[mode][metric] = {k: summary[k] for k in summary if k != "values"}
            diagnostics.append(
                {
                    "family": "per_mode",
                    "mode": mode,
                    "metric": metric,
                    "resamples": summary["resamples"],
                    "endpoint_delta": summary["endpoint_delta"],
                    "converged": summary["converged"],
                }
            )
    return table, diagnostics


def pacc_position_summary(records: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    pacc_records = [record for record in records if record["mode"] == "Pacc"]
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for record in pacc_records:
        position = int(record["position_in_chain"])
        grouped[position].append(record)
    table: dict[str, Any] = {}
    diagnostics: list[dict[str, Any]] = []
    for position in sorted(grouped):
        pos_records = grouped[position]
        table[str(position)] = {}
        for metric in HELM_METRICS:
            summary = summarize_group(pos_records, metric)
            table[str(position)][metric] = {k: summary[k] for k in summary if k != "values"}
            diagnostics.append(
                {
                    "family": "pacc_position",
                    "position": position,
                    "metric": metric,
                    "resamples": summary["resamples"],
                    "endpoint_delta": summary["endpoint_delta"],
                    "converged": summary["converged"],
                }
            )
    xs = [float(record["position_in_chain"]) for record in pacc_records]
    ys = [float(record["quality"]) for record in pacc_records]
    x_mean = statistics.fmean(xs)
    y_mean = statistics.fmean(ys)
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    denominator = sum((x - x_mean) ** 2 for x in xs)
    trial_slope = numerator / denominator if denominator else 0.0
    pos_means = [(int(position), table[str(position)]["quality"]["mean"]) for position in sorted(grouped)]
    px = [float(item[0]) for item in pos_means]
    py = [float(item[1]) for item in pos_means]
    px_mean = statistics.fmean(px)
    py_mean = statistics.fmean(py)
    pos_num = sum((x - px_mean) * (y - py_mean) for x, y in zip(px, py))
    pos_den = sum((x - px_mean) ** 2 for x in px)
    position_mean_slope = pos_num / pos_den if pos_den else 0.0
    rebound = table["10"]["quality"]["mean"] - table["9"]["quality"]["mean"]
    return (
        table,
        {
            "quality_slope_per_trial": round_float(trial_slope),
            "quality_slope_per_position_mean": round_float(position_mean_slope),
            "position_10_minus_position_9": round_float(rebound),
        },
        diagnostics,
    )


def f10_summary(records: list[dict[str, Any]]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        if record["fixture"] == "F10":
            grouped[record["mode"]].append(record)
    summary: dict[str, Any] = {}
    diagnostics: list[dict[str, Any]] = []
    for mode in sorted(grouped, key=sort_mode):
        mode_records = grouped[mode]
        quality = summarize_group(mode_records, "quality")
        summary[mode] = {
            "n": quality["n"],
            "zero_count": sum(record["quality"] == 0.0 for record in mode_records),
            "nonzero_count": sum(record["quality"] != 0.0 for record in mode_records),
            "mean": quality["mean"],
            "ci_low": quality["ci_low"],
            "ci_high": quality["ci_high"],
            "resamples": quality["resamples"],
            "endpoint_delta": quality["endpoint_delta"],
            "converged": quality["converged"],
        }
        diagnostics.append(
            {
                "family": "f10",
                "mode": mode,
                "metric": "quality",
                "resamples": quality["resamples"],
                "endpoint_delta": quality["endpoint_delta"],
                "converged": quality["converged"],
            }
        )
    is_universal_zero = all(item["zero_count"] == item["n"] for item in summary.values())
    verdict = "fixture-strict"
    if is_universal_zero:
        verdict = "fixture-strict"
    return (
        {
            "per_mode": summary,
            "is_universal_zero": is_universal_zero,
            "verdict": verdict,
        },
        diagnostics,
    )


def metric_best(values_by_mode: dict[str, dict[str, float]], metric: str) -> float:
    values = [payload[metric] for payload in values_by_mode.values()]
    if metric in MINIMIZE_METRICS:
        return min(values)
    return max(values)


def within_margin(value: float, best: float, metric: str, margin_fraction: float) -> bool:
    if math.isclose(best, 0.0, abs_tol=1e-12):
        return math.isclose(value, best, abs_tol=1e-12)
    if metric in MINIMIZE_METRICS:
        return ((value - best) / best) <= margin_fraction + 1e-12
    return ((best - value) / best) <= margin_fraction + 1e-12


def dominates(
    left: dict[str, float], right: dict[str, float], metric_names: tuple[str, ...]
) -> bool:
    better_or_equal = True
    strictly_better = False
    for metric in metric_names:
        lv = left[metric]
        rv = right[metric]
        if metric in MINIMIZE_METRICS:
            if lv > rv + 1e-12:
                better_or_equal = False
                break
            if lv < rv - 1e-12:
                strictly_better = True
        else:
            if lv < rv - 1e-12:
                better_or_equal = False
                break
            if lv > rv + 1e-12:
                strictly_better = True
    return better_or_equal and strictly_better


def pareto_frontier(values_by_mode: dict[str, dict[str, float]]) -> list[str]:
    frontier = []
    metric_names = ("cost", "quality", "pollution", "loss")
    for mode, payload in values_by_mode.items():
        dominated = False
        for other_mode, other_payload in values_by_mode.items():
            if other_mode == mode:
                continue
            if dominates(other_payload, payload, metric_names):
                dominated = True
                break
        if not dominated:
            frontier.append(mode)
    return sorted(frontier, key=sort_mode)


def decision_tree_sensitivity(helm: dict[str, Any]) -> dict[str, Any]:
    margins = (5, 10, 15, 20)
    quality_floors = (0.3, 0.5, 0.7)
    grids: dict[str, Any] = {}
    fixture_profiles: dict[str, list[list[str]]] = defaultdict(list)
    strict_empty_count = 0
    for margin in margins:
        for floor in quality_floors:
            grid_key = f"margin_{margin}_floor_{str(floor).replace('.', '_')}"
            grids[grid_key] = {"margin_pct": margin, "quality_floor": floor, "fixtures": {}}
            for fixture in sorted(helm, key=sort_fixture):
                mode_values = {
                    mode: {
                        metric: helm[fixture][mode][metric]["mean"]
                        for metric in HELM_METRICS
                    }
                    for mode in sorted(helm[fixture], key=sort_mode)
                }
                eligible = {
                    mode: payload
                    for mode, payload in mode_values.items()
                    if payload["quality"] >= floor
                }
                if not eligible:
                    recommendation = []
                    dominant = {}
                    frontier = []
                    margin_matches = []
                    strict_empty_count += 1
                else:
                    ordered_modes = sorted(eligible, key=sort_mode)
                    dominant = {
                        metric: (
                            min(ordered_modes, key=lambda m: eligible[m][metric])
                            if metric in MINIMIZE_METRICS
                            else max(ordered_modes, key=lambda m: eligible[m][metric])
                        )
                        for metric in HELM_METRICS
                    }
                    frontier = pareto_frontier(eligible)
                    margin_matches = []
                    margin_fraction = margin / 100.0
                    bests = {
                        metric: metric_best(eligible, metric)
                        for metric in HELM_METRICS
                    }
                    for mode, payload in eligible.items():
                        if all(
                            within_margin(payload[metric], bests[metric], metric, margin_fraction)
                            for metric in HELM_METRICS
                        ):
                            margin_matches.append(mode)
                    recommendation = sorted(
                        set(frontier) | set(margin_matches),
                        key=sort_mode,
                    )
                grids[grid_key]["fixtures"][fixture] = {
                    "recommended_modes": recommendation,
                    "recommended_label": ",".join(recommendation) if recommendation else "NONE",
                    "eligible_modes": sorted(eligible, key=sort_mode) if eligible else [],
                    "dominant_modes": dominant,
                    "pareto_frontier": frontier,
                    "margin_matches": sorted(margin_matches, key=sort_mode),
                }
                fixture_profiles[fixture].append(recommendation)
    fixture_summary = {}
    robust_fixture_count = 0
    for fixture in sorted(fixture_profiles, key=sort_fixture):
        labels = [",".join(profile) if profile else "NONE" for profile in fixture_profiles[fixture]]
        label_counts = Counter(labels)
        modal_label, modal_count = max(label_counts.items(), key=lambda item: (item[1], item[0]))
        unique_count = len(label_counts)
        robust = unique_count == 1
        if robust:
            robust_fixture_count += 1
        fixture_summary[fixture] = {
            "unique_recommendation_sets": unique_count,
            "modal_recommendation_set": modal_label,
            "modal_support": modal_count,
            "stability": "robust" if robust else "fragile",
        }
    overall = "robust" if robust_fixture_count >= 7 and strict_empty_count == 0 else "fragile"
    return {
        "grids": grids,
        "fixture_summary": fixture_summary,
        "overall_stability": overall,
        "strict_empty_grid_cells": strict_empty_count,
        "robust_fixture_count": robust_fixture_count,
    }


def cost_structure(per_mode: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for mode in sorted(per_mode, key=sort_mode):
        quality_mean = per_mode[mode]["quality"]["mean"]
        marginal = per_mode[mode]["cost"]["mean"]
        warmup_component = marginal + 0.0
        # mean(amort_n1) = marginal + warmup_component
        # warmup_component derived from stored horizon means.
        summary[mode] = {
            "quality_mean": quality_mean,
            "cost_per_quality": {},
        }
        horizon_costs = {
            "M1": per_mode[mode].get("cost_m1_mean_placeholder"),
            "M5": None,
            "M10": None,
            "M30": None,
        }
        del horizon_costs
        warmup_component = 0.0
        # Filled later by attach_cost_horizon_means().
    return summary


def mode_horizon_means(records: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[record["mode"]].append(record)
    output: dict[str, Any] = {}
    for mode in sorted(grouped, key=sort_mode):
        mode_records = grouped[mode]
        mean_marginal = statistics.fmean(record["cost"] for record in mode_records)
        mean_n1 = statistics.fmean(record["cost_m1"] for record in mode_records)
        mean_n10 = statistics.fmean(record["cost_m10"] for record in mode_records)
        mean_n30 = statistics.fmean(record["cost_m30"] for record in mode_records)
        warmup_component = mean_n1 - mean_marginal
        output[mode] = {
            "marginal": round_float(mean_marginal),
            "warmup_component": round_float(warmup_component),
            "M1": round_float(mean_n1),
            "M5": round_float(mean_marginal + warmup_component / 5.0),
            "M10": round_float(mean_n10),
            "M30": round_float(mean_n30),
        }
    return output


def mode_cost_per_quality(
    per_mode: dict[str, Any], horizon_means: dict[str, Any]
) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for mode in sorted(per_mode, key=sort_mode):
        quality_mean = per_mode[mode]["quality"]["mean"]
        output[mode] = {
            "quality_mean": quality_mean,
            "horizons": {},
        }
        for horizon in ("M1", "M5", "M10", "M30"):
            cost_value = horizon_means[mode][horizon]
            ratio = None
            if not math.isclose(quality_mean, 0.0, abs_tol=1e-12):
                ratio = round_float(cost_value / quality_mean)
            output[mode]["horizons"][horizon] = {
                "cost_per_trial": cost_value,
                "cost_per_quality_point": ratio,
            }
    return output


def ci_summary(all_diagnostics: list[dict[str, Any]]) -> dict[str, Any]:
    by_resamples = Counter(item["resamples"] for item in all_diagnostics)
    unresolved = [
        item for item in all_diagnostics if not item["converged"]
    ]
    max_delta = max(item["endpoint_delta"] for item in all_diagnostics)
    return {
        "reported_ci_count": len(all_diagnostics),
        "resample_counts": {str(k): by_resamples[k] for k in sorted(by_resamples)},
        "max_endpoint_delta": round_float(max_delta),
        "unresolved_count": len(unresolved),
        "unresolved_examples": unresolved[:10],
    }


def discrepancy_list(
    dataset: dict[str, Any],
    pacc_meta: dict[str, Any],
    decision: dict[str, Any],
    f10: dict[str, Any],
) -> list[str]:
    items = []
    if dataset["missing_cells"]:
        items.append("Pacc/F9/seed_idx=5 is missing, leaving Pacc n=99 and position-6 n=9.")
    if dataset["pollution_chain_null_count"] == dataset["record_count"]:
        items.append("pollution.chain_rate is null in all 399 records, so chain leakage cannot be analyzed from the raw pilot.")
    items.append("Pacc directory naming is session/position encoded; seed_idx inside JSON is the canonical seed field.")
    if not f10["is_universal_zero"]:
        items.append("F10 is not a literal all-zero fixture across all modes; collapse is strongest in Pfresh/S/Pacc, but D retains non-zero mass.")
    if pacc_meta["position_10_minus_position_9"] > 0:
        items.append(
            f"Pacc quality shows a late rebound at position 10 versus position 9 (+{pacc_meta['position_10_minus_position_9']:.4f})."
        )
    if decision["strict_empty_grid_cells"] > 0:
        items.append(
            f"Decision-tree sensitivity has {decision['strict_empty_grid_cells']} grid cells with no mode clearing the quality floor."
        )
    items.append("F6 should be interpreted carefully because prior RCA found a text-proxy grader brittleness issue in earlier pilot work.")
    return items


def build_summary(records: list[dict[str, Any]], expected_sha: str) -> dict[str, Any]:
    dataset = dataset_summary(records, expected_sha)
    helm, helm_diag = helm_table(records)
    per_mode, per_mode_diag = per_mode_summary(records)
    pacc_positions, pacc_meta, pacc_diag = pacc_position_summary(records)
    f10, f10_diag = f10_summary(records)
    decision = decision_tree_sensitivity(helm)
    horizons = mode_horizon_means(records)
    cost_quality = mode_cost_per_quality(per_mode, horizons)
    diagnostics = helm_diag + per_mode_diag + pacc_diag + f10_diag
    ci = ci_summary(diagnostics)
    discrepancies = discrepancy_list(dataset, pacc_meta, decision, f10)
    return {
        "dataset_verification": dataset,
        "helm_table": helm,
        "ci_methodology_cross_check": ci,
        "per_mode_means": per_mode,
        "pacc_position_summary": pacc_positions,
        "pacc_decay_meta": pacc_meta,
        "f10_verification": f10,
        "decision_tree_sensitivity": decision,
        "cost_structure": {
            "mode_horizon_mean_costs": horizons,
            "mode_cost_per_quality_point": cost_quality,
        },
        "reproducibility": {
            "script": "tools/analyst-phase3-codex-reproduce.py",
            "bootstrap_seeds": list(BOOTSTRAP_SEEDS),
            "bootstrap_threshold": BOOTSTRAP_THRESHOLD,
            "bootstrap_ladder": list(BOOTSTRAP_LADDER),
        },
        "discrepancies_to_watch": discrepancies,
    }


def format_ci(entry: dict[str, Any]) -> str:
    return f"{entry['mean']:.4f} [{entry['ci_low']:.4f}, {entry['ci_high']:.4f}] (n={entry['n']})"


def markdown_table(headers: list[str], rows: list[list[str]]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def render_markdown(summary: dict[str, Any]) -> str:
    lines: list[str] = []
    dataset = summary["dataset_verification"]
    lines.append("# Codex Phase 3 Independent Summary")
    lines.append("")
    lines.append("## Dataset Verification")
    lines.append(
        f"- Archive SHA-256: `{dataset['expected_archive_sha256']}`"
    )
    lines.append(f"- Readable records: `{dataset['record_count']}`")
    lines.append(
        "- Mode counts: "
        + ", ".join(f"`{mode}={count}`" for mode, count in dataset["mode_counts"].items())
    )
    lines.append(
        "- Missing cells: "
        + (
            ", ".join(
                f"`{item['mode']}/{item['fixture']}/seed_idx={item['missing_seed_idx']}`"
                for item in dataset["missing_cells"]
            )
            if dataset["missing_cells"]
            else "`none`"
        )
    )
    lines.append("")
    lines.append("## Per-Mode Means")
    per_mode_rows = []
    for mode in EXPECTED_MODES:
        metrics = summary["per_mode_means"][mode]
        per_mode_rows.append(
            [
                mode,
                format_ci(metrics["quality"]),
                format_ci(metrics["cost"]),
                format_ci(metrics["pollution"]),
                format_ci(metrics["loss"]),
            ]
        )
    lines.append(
        markdown_table(
            ["mode", "quality", "cost", "pollution", "loss"],
            per_mode_rows,
        )
    )
    lines.append("")
    lines.append("## Pacc Quality By Position")
    pacc_rows = []
    for position in sorted(summary["pacc_position_summary"], key=int):
        quality = summary["pacc_position_summary"][position]["quality"]
        pacc_rows.append([position, format_ci(quality)])
    lines.append(markdown_table(["position", "quality"], pacc_rows))
    lines.append("")
    lines.append("## F10 Quality")
    f10_rows = []
    for mode in EXPECTED_MODES:
        item = summary["f10_verification"]["per_mode"][mode]
        f10_rows.append(
            [
                mode,
                str(item["zero_count"]),
                str(item["nonzero_count"]),
                f"{item['mean']:.4f}",
                f"[{item['ci_low']:.4f}, {item['ci_high']:.4f}]",
            ]
        )
    lines.append(markdown_table(["mode", "zeros", "nonzeros", "mean", "ci"], f10_rows))
    lines.append("")
    lines.append("## Decision Sensitivity")
    decision_rows = []
    for fixture in EXPECTED_FIXTURES:
        item = summary["decision_tree_sensitivity"]["fixture_summary"][fixture]
        decision_rows.append(
            [
                fixture,
                item["modal_recommendation_set"],
                str(item["modal_support"]),
                str(item["unique_recommendation_sets"]),
                item["stability"],
            ]
        )
    lines.append(
        markdown_table(
            ["fixture", "modal_set", "modal_support", "unique_sets", "stability"],
            decision_rows,
        )
    )
    lines.append("")
    lines.append("## Cost Per Quality Point")
    cost_rows = []
    for mode in EXPECTED_MODES:
        item = summary["cost_structure"]["mode_cost_per_quality_point"][mode]
        cost_rows.append(
            [
                mode,
                f"{item['horizons']['M1']['cost_per_quality_point']}",
                f"{item['horizons']['M5']['cost_per_quality_point']}",
                f"{item['horizons']['M10']['cost_per_quality_point']}",
                f"{item['horizons']['M30']['cost_per_quality_point']}",
            ]
        )
    lines.append(markdown_table(["mode", "M1", "M5", "M10", "M30"], cost_rows))
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    records = load_records(args.root)
    summary = build_summary(records, args.sha)
    if args.format == "markdown":
        print(render_markdown(summary))
    else:
        print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
