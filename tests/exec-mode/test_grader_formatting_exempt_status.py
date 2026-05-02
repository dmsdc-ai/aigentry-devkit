"""Q3 ADR §2.4.2 r2 — `_emit_formatting_exempt_status` helper contract tests.

Per ADR `2026-05-02-output-style-fixture-design-rule.md` §2.4.2, every primary
grader's return dict (which lands at `metrics.json::quality.primary_components`)
MUST carry the five `formatting_exempt_*` fields. This file pins the helper's
status enum + companion-field-consistency contract that lint check 2 (§2.4.3)
later cross-checks against grader source.
"""
from __future__ import annotations

import pytest

import exec_mode_grader as g

ADR_ID = "2026-05-02-output-style-fixture-design-rule"


def test_helper_returns_all_six_fields_with_implemented():
    """Codex r2 §6 N3 / r3 condition 4: helper now emits six fields. The new
    `formatting_exempt_test_matrix` defaults to `{}` when no test_matrix is
    supplied, preserving backwards compatibility for graders that have not
    yet declared per-variant matrices."""
    out = g._emit_formatting_exempt_status(
        "implemented",
        canonicalizer="_canonicalize_demo",
        variants=["raw", "fenced"],
        tests=["test_demo_raw", "test_demo_fenced"],
    )
    assert set(out.keys()) == {
        "formatting_exempt_status",
        "formatting_exempt_canonicalizer",
        "formatting_exempt_variants",
        "formatting_exempt_tests",
        "formatting_exempt_test_matrix",
        "formatting_exempt_rule_adr",
    }
    assert out["formatting_exempt_status"] == "implemented"
    assert out["formatting_exempt_canonicalizer"] == "_canonicalize_demo"
    assert out["formatting_exempt_variants"] == ["raw", "fenced"]
    assert out["formatting_exempt_tests"] == ["test_demo_raw", "test_demo_fenced"]
    assert out["formatting_exempt_test_matrix"] == {}
    assert out["formatting_exempt_rule_adr"] == ADR_ID


def test_helper_not_applicable_requires_null_canonicalizer_empty_lists():
    out = g._emit_formatting_exempt_status("not_applicable")
    assert out["formatting_exempt_status"] == "not_applicable"
    assert out["formatting_exempt_canonicalizer"] is None
    assert out["formatting_exempt_variants"] == []
    assert out["formatting_exempt_tests"] == []
    assert out["formatting_exempt_test_matrix"] == {}
    assert out["formatting_exempt_rule_adr"] == ADR_ID


def test_helper_grandfathered_companion_fields_match_not_applicable_shape():
    out = g._emit_formatting_exempt_status("grandfathered")
    assert out["formatting_exempt_status"] == "grandfathered"
    assert out["formatting_exempt_canonicalizer"] is None
    assert out["formatting_exempt_variants"] == []
    assert out["formatting_exempt_tests"] == []


def test_helper_rejects_unknown_status_value():
    with pytest.raises(ValueError, match="formatting_exempt_status"):
        g._emit_formatting_exempt_status("true")


def test_helper_rejects_implemented_without_canonicalizer():
    with pytest.raises(ValueError, match="canonicalizer"):
        g._emit_formatting_exempt_status(
            "implemented", canonicalizer=None, variants=["x"], tests=["t"]
        )


def test_helper_rejects_implemented_with_empty_variants():
    with pytest.raises(ValueError, match="variants"):
        g._emit_formatting_exempt_status(
            "implemented", canonicalizer="_c", variants=[], tests=["t"]
        )


def test_helper_rejects_implemented_with_empty_tests():
    with pytest.raises(ValueError, match="tests"):
        g._emit_formatting_exempt_status(
            "implemented", canonicalizer="_c", variants=["x"], tests=[]
        )


def test_helper_rejects_not_applicable_with_canonicalizer():
    with pytest.raises(ValueError, match="canonicalizer=None"):
        g._emit_formatting_exempt_status(
            "not_applicable", canonicalizer="_c"
        )


def test_helper_rejects_grandfathered_with_variants():
    with pytest.raises(ValueError, match="empty"):
        g._emit_formatting_exempt_status(
            "grandfathered", variants=["x"]
        )


def test_helper_status_enum_values_match_adr_section_2_4_2():
    """ADR §2.4.2 hard rule: NEW fixtures MUST emit 'implemented' or
    'not_applicable'; 'grandfathered' is registry-gated. Pin the enum domain
    so any drift is caught here before lint check 1 fails downstream."""
    assert set(g._FORMATTING_EXEMPT_STATUS_VALUES) == {
        "implemented",
        "not_applicable",
        "grandfathered",
    }
    assert g.FORMATTING_EXEMPT_RULE_ADR == ADR_ID


# ─── codex r2 §6 N3 + condition 4 — test_matrix per-variant validation ──────


def test_helper_test_matrix_round_trips_when_provided():
    """When `test_matrix` is supplied, the helper emits an equivalent
    `formatting_exempt_test_matrix` dict (lists are copied, not aliased)."""
    out = g._emit_formatting_exempt_status(
        "implemented",
        canonicalizer="_c",
        variants=["raw", "fenced"],
        tests=["t_raw_pos", "t_raw_neg", "t_fenced_pos", "t_fenced_neg"],
        test_matrix={
            "raw": {"positive": ["t_raw_pos"], "negative": ["t_raw_neg"]},
            "fenced": {"positive": ["t_fenced_pos"], "negative": ["t_fenced_neg"]},
        },
    )
    matrix = out["formatting_exempt_test_matrix"]
    assert set(matrix) == {"raw", "fenced"}
    assert matrix["raw"] == {"positive": ["t_raw_pos"], "negative": ["t_raw_neg"]}
    assert matrix["fenced"] == {"positive": ["t_fenced_pos"], "negative": ["t_fenced_neg"]}


def test_helper_rejects_test_matrix_missing_variant_entry():
    """Each declared variant MUST appear in the matrix when it is provided."""
    with pytest.raises(ValueError, match="missing entry for declared variant"):
        g._emit_formatting_exempt_status(
            "implemented",
            canonicalizer="_c",
            variants=["raw", "fenced"],
            tests=["t_raw_pos", "t_raw_neg"],
            test_matrix={
                "raw": {"positive": ["t_raw_pos"], "negative": ["t_raw_neg"]},
            },
        )


def test_helper_rejects_test_matrix_with_empty_positive_or_negative():
    with pytest.raises(ValueError, match="must list ≥1 test"):
        g._emit_formatting_exempt_status(
            "implemented",
            canonicalizer="_c",
            variants=["raw"],
            tests=["t_raw_neg"],
            test_matrix={"raw": {"positive": [], "negative": ["t_raw_neg"]}},
        )


def test_helper_rejects_test_matrix_referencing_unknown_test_name():
    with pytest.raises(ValueError, match="not in `tests`"):
        g._emit_formatting_exempt_status(
            "implemented",
            canonicalizer="_c",
            variants=["raw"],
            tests=["t_raw_pos", "t_raw_neg"],
            test_matrix={
                "raw": {
                    "positive": ["t_raw_pos"],
                    "negative": ["t_typo_does_not_exist_in_flat_tests"],
                },
            },
        )


# ─── codex r2 §6 N3 + condition 4 — Phase 6 graders coverage walker ─────────


def _phase6_grader_results():
    """Trigger every Phase 6 grader on a benign payload so the emitted
    formatting_exempt_* metadata can be walked. Each grader is independent
    of fixture state for this metadata path, so a one-line stub is enough."""
    return {
        "H1":  g.score_h1_long_form_code_review("| col | val |\n", {}),
        "H11": g.score_h11_structured_data_extraction("placeholder", {}),
        "H12": g.score_h12_multilingual_summarization("placeholder", {}),
        "H13": g.score_h13_schema_strict_routes("{}", {}),
        "H14": g.score_h14_agentic_tool_sequence("placeholder", {}),
    }


def test_all_phase6_graders_declare_test_matrix_with_positive_and_negative():
    """Codex r2 §3 condition 4 + §6 N3: prove ≥1 positive AND ≥1 negative
    test per declared variant for every Phase 6 grader. The lint companion
    check counts test names but does not group them by variant; this walker
    closes that gap at unit-test layer (preserving Article 17 stdlib-only
    by inspecting the grader return dict directly, not parsing source)."""
    for fixture_id, result in _phase6_grader_results().items():
        assert result["formatting_exempt_status"] == "implemented", fixture_id
        declared = result["formatting_exempt_variants"]
        matrix = result["formatting_exempt_test_matrix"]
        assert declared, fixture_id
        assert matrix, f"{fixture_id} missing formatting_exempt_test_matrix"
        for variant in declared:
            entry = matrix.get(variant)
            assert entry is not None, (fixture_id, variant)
            positives = entry.get("positive") or []
            negatives = entry.get("negative") or []
            assert positives, (fixture_id, variant, "no positive test")
            assert negatives, (fixture_id, variant, "no negative test")


def test_phase6_test_matrix_names_are_subset_of_flat_tests():
    """Every name listed under any variant must already appear in the flat
    `formatting_exempt_tests` list — otherwise the AST companion-check (lint
    check 2) cannot transitively cover the matrix entries."""
    for fixture_id, result in _phase6_grader_results().items():
        flat_tests = set(result["formatting_exempt_tests"])
        for variant, entry in result["formatting_exempt_test_matrix"].items():
            for kind in ("positive", "negative"):
                missing = [t for t in entry[kind] if t not in flat_tests]
                assert not missing, (fixture_id, variant, kind, missing)
