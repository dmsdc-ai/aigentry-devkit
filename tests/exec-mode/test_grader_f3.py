from __future__ import annotations

import exec_mode_grader as g


TRUTH = {
    "fixture": "F3",
    "ground_truth_issues": [
        {
            "id": "A1",
            "severity": "Critical",
            "must_cite_line": 5,
            "match_regex_any_of": ["sql injection", "parameterized"],
        },
        {
            "id": "A2",
            "severity": "Medium",
            "must_cite_line": 7,
            "match_regex_any_of": ["off-by-one", "slice"],
        },
    ],
    "distractors_must_not_flag": [
        {
            "id": "D1",
            "line": 3,
            "fp_regex_any_of": ["strict equality", "== null"],
        }
    ],
    "severity_weights": {"Critical": 4.0, "Medium": 1.0},
    "primary_metric": {"pass_threshold": 0.70},
    "secondary_signals": {
        "table_format": {"regex_any_of": [r"\|\s*ID\s*\|\s*Severity\s*\|"]},
        "verdict_paragraph": {"regex_any_of": ["block", "merge", "approve"]},
    },
}


GOOD_OUTPUT = """
| ID | Severity | File:Line | Issue | Recommendation |
| A1 | Critical | auth-middleware.ts:5 | SQL injection via template string query | Restore a parameterized query |
| A2 | Medium | auth-middleware.ts:7 | off-by-one slice drops the last key | Fix the slice bounds |

Block merge until the line 5 injection and the line 7 boundary bug are fixed.
"""


BAD_OUTPUT = """
| ID | Severity | File:Line | Issue | Recommendation |
| X1 | Medium | auth-middleware.ts:3 | `== null` should use strict equality | Replace with `=== null` |

Approve after this small cleanup.
"""


def test_score_f3_known_good_hits_full_weighted_f1():
    score = g.score_f3_severity_f1(GOOD_OUTPUT, TRUTH)
    assert score["matched_issue_ids"] == ["A1", "A2"]
    assert score["flagged_distractors"] == []
    assert score["primary_score"] == 1.0
    assert score["primary_pass"] is True


def test_score_f3_distractor_penalty_drives_score_down():
    score = g.score_f3_severity_f1(BAD_OUTPUT, TRUTH)
    assert score["matched_issue_ids"] == []
    assert score["flagged_distractors"] == ["D1"]
    assert score["primary_score"] == 0.0
    assert score["primary_pass"] is False


def test_score_f3_empty_output_returns_zero():
    score = g.score_f3_severity_f1("", TRUTH)
    assert score["precision"] == 0.0
    assert score["recall"] == 0.0
    assert score["primary_score"] == 0.0
