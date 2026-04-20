from __future__ import annotations

import exec_mode_grader as g


TRUTH = {
    "fixture": "F9",
    "true_root_cause": {
        "match_regex_any_of": [r"CircuitOpenError.*catch", r"missing.*CircuitOpenError"],
        "must_reference_turn_any_of": [5],
    },
    "canonical_fix": {
        "diff_file_target_regex": r"a/net/client\.ts",
        "fix_regex_any_of_in_diff": [
            r"\+.*CircuitOpenError.*from.*errors",
            r"instanceof\s+CircuitOpenError",
        ],
        "min_regex_matches": 2,
    },
    "wrong_root_cause_penalty": {
        "detect_regex_any_of": [r"root cause.*off[-\s]?by[-\s]?one", r"root cause.*overflow"]
    },
    "primary_metric": {"pass_threshold": 0.70},
}


GOOD_OUTPUT = """
(a) Root cause: Turn 5 introduced CircuitOpenError, but the catch path still omits CircuitOpenError and retries only NetworkError/TimeoutError.

(b) Evidence: the off-by-one loop bound is not the cause, and the overflow theory is not the cause either; retries fail specifically when the circuit opens.

(c)
```diff
--- a/net/client.ts
+++ b/net/client.ts
@@
-import { NetworkError, TimeoutError } from './errors';
+import { NetworkError, TimeoutError, CircuitOpenError } from './errors';
@@
-    if (e instanceof NetworkError || e instanceof TimeoutError) {
+    if (e instanceof NetworkError || e instanceof TimeoutError || e instanceof CircuitOpenError) {
```
"""


BAD_OUTPUT = """
(a) Root cause: the off-by-one loop bound skips the last retry.

(b) Evidence: attempts < cfg.max looks suspicious.

(c)
```diff
--- a/net/client.ts
+++ b/net/client.ts
@@
-const x = 1
+const x = 2
```
"""


def test_score_f9_known_good_scores_high():
    score = g.score_f9_root_cause(GOOD_OUTPUT, TRUTH)
    assert score["root_cause_score"] == 1.0
    assert score["fix_score"] == 1.0
    assert score["evidence_score"] == 1.0
    assert score["primary_score"] == 1.0


def test_score_f9_wrong_root_cause_zeroes_primary_score():
    score = g.score_f9_root_cause(BAD_OUTPUT, TRUTH)
    assert score["wrong_root_cause_hits"]
    assert score["primary_score"] == 0.0
    assert score["primary_pass"] is False


def test_score_f9_empty_output_returns_zero():
    score = g.score_f9_root_cause("", TRUTH)
    assert score["root_cause_score"] == 0.0
    assert score["fix_score"] == 0.0
    assert score["primary_score"] == 0.0
