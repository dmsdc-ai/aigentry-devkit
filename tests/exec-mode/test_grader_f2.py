from __future__ import annotations

import exec_mode_grader as g


TRUTH = {
    "fixture": "F2",
    "invariants_checklist": {
        "case_insensitive": True,
        "invariants": [
            {"id": "INV-1", "label": "CVE ref", "regex_any_of": ["CVE-2025-1234"]},
            {"id": "INV-2", "label": "Commits", "regex_any_of": ["Conventional Commits"]},
            {"id": "INV-3", "label": "ADR", "regex_any_of": [r"\bADR\b"]},
            {"id": "INV-4", "label": "WCAG", "regex_any_of": ["WCAG 2.1 AA"]},
        ],
    },
    "output_structure_checks": {
        "must_contain_all": ["old", "new", "mapping"],
        "must_contain_any_of": [r"\|\s*Old section\s*\|", r"Old\s*→\s*New"],
    },
    "secondary_signals": {
        "past_failure_acknowledgment": {
            "regex_any_of": ["audit", "inline"],
            "min_hits": 1,
        }
    },
    "primary_metric": {"pass_threshold": 0.75},
}


GOOD_OUTPUT = """
(a) Slim draft keeps the CVE-2025-1234 note, Conventional Commits, ADR flow, and WCAG 2.1 AA.

(b) old to new mapping
| Old section | Action | New section / location |
| Security | keep inline | Risks |

(c) checklist
- CVE-2025-1234 stays inline because the audit rejected link-only handling.
- Conventional Commits remains in the contribution rules.
- ADR remains in the decision record section.
- WCAG 2.1 AA remains in the accessibility requirements.
"""


BAD_OUTPUT = """
(a) Proposal
- Keep the document short.

(b) Notes
- old topics become new topics.
"""


def test_score_f2_known_good_is_high():
    score = g.score_f2_invariants(GOOD_OUTPUT, TRUTH)
    assert score["invariant_rate"] == 1.0
    assert score["output_structure"]["mapping_table_present"] is True
    assert score["primary_pass"] is True
    assert score["primary_score"] == 1.0


def test_score_f2_missing_invariants_scores_low():
    score = g.score_f2_invariants(BAD_OUTPUT, TRUTH)
    assert score["invariant_rate"] < 0.5
    assert score["primary_pass"] is False
    assert score["missing_invariants"]


def test_score_f2_empty_output_gracefully_degrades():
    score = g.score_f2_invariants("", TRUTH)
    assert score["invariant_rate"] == 0.0
    assert score["primary_score"] == 0.0
    assert score["primary_pass"] is False
