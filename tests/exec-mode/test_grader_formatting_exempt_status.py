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


def test_helper_returns_all_five_fields_with_implemented():
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
        "formatting_exempt_rule_adr",
    }
    assert out["formatting_exempt_status"] == "implemented"
    assert out["formatting_exempt_canonicalizer"] == "_canonicalize_demo"
    assert out["formatting_exempt_variants"] == ["raw", "fenced"]
    assert out["formatting_exempt_tests"] == ["test_demo_raw", "test_demo_fenced"]
    assert out["formatting_exempt_rule_adr"] == ADR_ID


def test_helper_not_applicable_requires_null_canonicalizer_empty_lists():
    out = g._emit_formatting_exempt_status("not_applicable")
    assert out["formatting_exempt_status"] == "not_applicable"
    assert out["formatting_exempt_canonicalizer"] is None
    assert out["formatting_exempt_variants"] == []
    assert out["formatting_exempt_tests"] == []
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
