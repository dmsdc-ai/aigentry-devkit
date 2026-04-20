from __future__ import annotations

import exec_mode_grader as g


TRUTH = {
    "fixture": "F6",
    "stage1_fix_3_checks": {
        "diff_format_regex": r"^---\s*a/aigentry_config/loader\.py\s*\n\+\+\+\s*b/aigentry_config/loader\.py\s*\n@@",
        "fix_content_regex_any_of": [r"cfg\.get\(\s*'timeout',\s*30\s*\)"],
        "must_not_contain_regex": [r"default\s*="],
        "next_step_prediction_regex": r"next error|green",
    },
    "secondary_signals": {
        "one_patch_per_turn": {"violation_regex": r"(\+\+\+\s*b/[^\s]+\s*\n){2,}"}
    },
    "primary_metric": {"optimal_remaining_turns": 2, "max_turns": 10, "pass_threshold": 0.70},
}


GOOD_OUTPUT = """--- a/aigentry_config/loader.py
+++ b/aigentry_config/loader.py
@@
-    return cfg.get('timeout', default=30)
+    return cfg.get('timeout', 30)

The next error should be the remaining type-normalization failure, not this keyword-argument TypeError.
"""


FENCED_OUTPUT = """```diff
--- a/aigentry_config/loader.py
+++ b/aigentry_config/loader.py
@@ -9,2 +9,2 @@
-    return cfg.get('timeout', default=30)
+    return cfg.get('timeout', 30)
```

The next error should be the remaining type-normalization failure.
"""


BAD_OUTPUT = """--- a/aigentry_config/loader.py
+++ b/aigentry_config/loader.py
@@
-    return cfg.get('timeout', default=30)
+    return cfg.get('timeout', default=30)
"""


def test_score_f6_known_good_scores_high():
    score = g.score_f6_build_turns(GOOD_OUTPUT, TRUTH)
    assert score["diff_format_ok"] is True
    assert score["prediction_ok"] is True
    assert score["turns_to_success"] == 2
    assert score["primary_score"] == 1.0


def test_score_f6_wrong_fix_scores_zero():
    score = g.score_f6_build_turns(BAD_OUTPUT, TRUTH)
    assert score["anti_pattern_hits"]
    assert score["build_pass_binary"] == 0.0
    assert score["primary_score"] == 0.0


def test_score_f6_empty_output_degrades_gracefully():
    score = g.score_f6_build_turns("", TRUTH)
    assert score["diff_format_ok"] is False
    assert score["primary_score"] == 0.0


def test_score_f6_fenced_diff_matches_format_regex():
    """G8/R1: diff wrapped in ```diff fence (as task_prompt.md demonstrates) must match.

    Regression for F6 RCA — ^ anchor without re.MULTILINE caused semantically
    correct agent outputs to score 0.0 when wrapped in the fence the fixture
    itself uses.
    """
    score = g.score_f6_build_turns(FENCED_OUTPUT, TRUTH)
    assert score["diff_format_ok"] is True
    assert score["build_pass_binary"] == 1.0
    assert score["primary_score"] >= 0.9
