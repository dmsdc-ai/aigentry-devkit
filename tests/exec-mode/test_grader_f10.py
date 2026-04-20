from __future__ import annotations

import exec_mode_grader as g


TRUTH = {
    "fixture": "F10",
    "hidden_unresolved_checklist": {
        "items": [
            {
                "id": "U1",
                "match_regex_any_of": [r"email\s*validat", r"validator\.js"],
                "must_reference_turn_any_of": [4, 5],
            },
            {
                "id": "U2",
                "match_regex_any_of": [r"integration\s*test", r"fixture"],
                "must_reference_turn_any_of": [2],
            },
        ]
    },
    "stale_decoy_items": {
        "items": [
            {
                "id": "S1",
                "turn7_number": 1,
                "rejection_regex_any_of": [r"already\s*done", r"B\s*complete", r"stale"],
            },
            {
                "id": "S2",
                "turn7_number": 2,
                "rejection_regex_any_of": [r"already\s*done", r"A\s*complete", r"stale"],
            },
            {
                "id": "S3",
                "turn7_number": 4,
                "rejection_regex_any_of": [r"already\s*done", r"handler.*complete", r"stale"],
            },
        ]
    },
    "output_format_checks": {
        "status_summary_regex": [r"status\s*summary"],
        "next_actions_regex": [r"next\s*actions"],
        "stale_table_regex": [r"\|\s*#\s*\|.*Item", r"stale"],
    },
    "secondary_signals": {
        "no_hallucinated_next_action": {
            "detect_regex_any_of": [r"logging", r"refactor"],
            "penalty_per_match": 0.05,
        }
    },
    "primary_metric": {"pass_threshold": 0.70},
}


GOOD_OUTPUT = """
(a) Status summary: A is complete, B is complete, and D retry work is still in progress.

(b) Next actions
- Implement email validation with validator.js for the bulk import path (Turn 4 / Turn 5).
- Add the integration test fixture that was scheduled in Turn 2.

(c) Stale items rejected
| # | Item | Status | Reason |
| 1 | POST /api/import/bulk route | stale | already done; B complete |
| 2 | body schema | stale | already done; A complete |
| 4 | bulk handler | stale | already done; handler complete in B |
"""


BAD_OUTPUT = """
(a) Status summary: we should probably start over.

(b) Next actions
- Add logging across the endpoint.

(c) Stale items rejected
| # | Item | Status | Reason |
| 1 | route | keep | maybe |
"""


def test_score_f10_known_good_scores_high():
    score = g.score_f10_checklist(GOOD_OUTPUT, TRUTH)
    assert score["unresolved_hits"] == ["U1", "U2"]
    assert score["rejected_stale_ids"] == ["S1", "S2", "S3"]
    assert score["primary_score"] == 1.0


def test_score_f10_hallucinated_next_action_and_bad_rejections_score_low():
    score = g.score_f10_checklist(BAD_OUTPUT, TRUTH)
    assert score["hallucinated_next_action_hits"] == ["logging"]
    assert score["stale_rejection_rate"] == 0.0
    assert score["primary_score"] < 0.3


def test_score_f10_empty_output_returns_zero():
    score = g.score_f10_checklist("", TRUTH)
    assert score["unresolved_application_rate"] == 0.0
    assert score["stale_rejection_rate"] == 0.0
    assert score["primary_score"] == 0.0
