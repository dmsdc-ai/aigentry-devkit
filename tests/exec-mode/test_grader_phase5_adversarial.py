"""Adversarial regression tests for Phase 5 H-grader rubric fixes (cascade-13c).

Each test reproduces one of the 8 blockers (B1-B8) raised in cascade-13b
review (Codex 4 blockers + Gemini 2 blockers + 1 condition + 1 calibration).
Each test asserts the corrected verdict — the same input would have produced
the WRONG verdict against the pre-fix grader (commit 2302d98).

Track: #329 Track E27 Phase 5 — α-step-13c (cascade-13c).
"""
from __future__ import annotations

import json
from pathlib import Path

import exec_mode_grader as g

REPO_ROOT = Path(__file__).resolve().parents[2]
HOLDOUT = REPO_ROOT / "state" / "fixtures" / "phase5-holdout"


def _load_truth(fixture: str) -> dict:
    return json.loads((HOLDOUT / fixture / "ground_truth.json").read_text(encoding="utf-8"))


# ─── B1 — H10 thousands_comma must skip 4-digit years ───────────────────────

def test_h10_b1_year_2026_not_flagged_as_thousands_violation():
    """4-digit year tokens (2026, 1985) are date-context not metric counts."""
    truth = _load_truth("H10")
    text = (
        "## 무슨 일이 있었나\n"
        "2026 회고로 정리한다. 1985 패턴과 비슷하다. "
        "결제 흐름은 1,247 건이었다.\n"
        "회고 작성자 사인오프: ops-on-call."
    )
    score = g.score_h10_strict_instruction_following(text, truth)
    c5 = next(c for c in score["constraint_results"] if c["id"] == "C5")
    assert c5["passed"] is True, f"C5 wrongly flagged year-shaped tokens: {c5}"
    assert c5["violations"] == []


def test_h10_b1_thousands_violation_still_caught_for_non_year_metrics():
    """Regression: non-year 4-digit metrics (1247, 9999) still flagged."""
    truth = _load_truth("H10")
    text = (
        "## 무슨 일이 있었나\n"
        "결제 흐름 1247 건과 응답 9999 회를 기록했다.\n"
        "회고 작성자 사인오프: ops-on-call."
    )
    score = g.score_h10_strict_instruction_following(text, truth)
    c5 = next(c for c in score["constraint_results"] if c["id"] == "C5")
    assert c5["passed"] is False
    assert "1247" in c5["violations"], c5
    assert "9999" in c5["violations"], c5


# ─── B2 — H10 strict pass: any single violation auto-rejects ────────────────

def test_h10_b2_strict_pass_requires_all_constraints_passed():
    """Per H10 task prompt: 'one violation auto-rejects'. Score >= threshold
    but n_pass < n_total must NOT pass primary."""
    fake_truth = {
        "fixture": "H10",
        "constraints": [
            {"id": "X1", "type": "regex_must_not_match", "regex": "FORBIDDEN"},
            {"id": "X2", "type": "regex_must_not_match", "regex": "ALSO_BANNED"},
            {"id": "X3", "type": "regex_must_not_match", "regex": "BLOCKED"},
        ],
        "primary_metric": {"pass_threshold": 0.5},
    }
    # 2 of 3 pass: a single FORBIDDEN violation but no others.
    text = "valid memo content with the FORBIDDEN keyword once but no others."
    score = g.score_h10_strict_instruction_following(text, fake_truth)
    assert score["constraints_passed"] == 2
    assert score["constraints_total"] == 3
    assert score["primary_score"] >= 0.5  # 2/3 = 0.6667 crosses 0.5 threshold
    assert score["primary_pass"] is False, (
        "Strict pass: any single violation must auto-reject regardless of threshold."
    )
    assert "X1" in score["failed_constraint_ids"]


# ─── B3 — H10 empty/whitespace output rejected pre-rubric ───────────────────

def test_h10_b3_empty_output_returns_zero_with_rejection_flag():
    """Empty output must short-circuit to score 0 (not 0.5 from vacuous negatives)."""
    truth = _load_truth("H10")
    score = g.score_h10_strict_instruction_following("", truth)
    assert score["primary_score"] == 0.0
    assert score["primary_pass"] is False
    assert score.get("empty_output_rejection") is True


def test_h10_b3_whitespace_only_output_rejected():
    truth = _load_truth("H10")
    score = g.score_h10_strict_instruction_following("   \n\t  \n", truth)
    assert score["primary_score"] == 0.0
    assert score["primary_pass"] is False
    assert score.get("empty_output_rejection") is True


# ─── B4 — H5 phantom regex must allowlist citation candidates ───────────────

H5_PLAN_WITH_CITATIONS = """## Plan

1. run_tests(target="tests/test_refund.py::test_partial_refund_within_24h") — reproduce.
2. read_file(path="tests/test_refund.py") — read the failing test (line 42).
3. grep_search(pattern="def apply_refund") — locate `apply_refund()` and `is_within_24h()`.
4. read_file(path="payments-svc/refund.py") — read body.
5. read_file(path="payments-svc/time_utils.py") — confirm `is_within_24h()` boundary.
6. edit_file(path="payments-svc/time_utils.py", old_text="<x>", new_text="<y>") — fix.
7. run_tests(target="tests/test_refund.py::test_partial_refund_within_24h") — verify.
"""


def test_h5_b4_citation_functions_not_phantom():
    """Backticked candidate-function citations (e.g. `apply_refund()`) must NOT
    be flagged as phantom tool calls — they are required by the prompt."""
    truth = _load_truth("H5")
    score = g.score_h5_agentic_tool_use(H5_PLAN_WITH_CITATIONS, truth)
    assert "apply_refund" not in score["phantom_tool_calls"], score["phantom_tool_calls"]
    assert "is_within_24h" not in score["phantom_tool_calls"], score["phantom_tool_calls"]
    assert set(score["citation_allowlist"]) >= {
        "apply_refund", "is_within_24h", "compute_refund_amount",
    }


def test_h5_b4_unknown_tool_still_phantom_after_allowlist():
    """Regression: tools not in palette and not in citation list still phantom."""
    truth = _load_truth("H5")
    plan = H5_PLAN_WITH_CITATIONS + "\n8. analyze_diff(path=\"x\") — phantom.\n"
    score = g.score_h5_agentic_tool_use(plan, truth)
    assert "analyze_diff" in score["phantom_tool_calls"]


# ─── B5 — H5 conjunctive pass gate (steps + no-phantom) ─────────────────────

def test_h5_b5_zero_numbered_steps_fails_pass_gate():
    """Paragraph plan with tools in correct order but no numbered list must
    fail primary_pass even if score reaches 1.0 (citation bonus could
    otherwise mask the format failure: 1.0 + 0.10 - 0.10 = 1.0)."""
    truth = _load_truth("H5")
    plan = (
        "Plan: first run_tests(target=\"tests/test_refund.py::test_partial_refund_within_24h\") "
        "to reproduce, then read_file(path=\"tests/test_refund.py\") to read the test, then "
        "grep_search(pattern=\"def apply_refund\") to locate, then read_file(path=\"refund.py\") "
        "for body, then edit_file(path=\"time_utils.py\", old_text=\"x\", new_text=\"y\") to "
        "fix is_within_24h, then run_tests(target=\"tests/test_refund.py\") to verify."
    )
    score = g.score_h5_agentic_tool_use(plan, truth)
    assert score["step_count"] == 0
    assert score["step_in_range"] is False
    assert score["primary_pass"] is False, (
        f"plan with no numbered steps must fail primary_pass; score={score['primary_score']}"
    )


def test_h5_b5_phantom_tool_blocks_pass_even_at_high_score():
    """A phantom tool present must fail primary_pass even when the citation
    bonus numerically cancels the phantom penalty."""
    truth = _load_truth("H5")
    plan = """## Plan

1. analyze_diff(path="refund.py") — phantom tool; not in palette.
2. run_tests(target="tests/test_refund.py::test_partial_refund_within_24h") — reproduce.
3. read_file(path="tests/test_refund.py") — read test.
4. grep_search(pattern="def apply_refund") — locate `apply_refund()`.
5. read_file(path="refund.py") — read body.
6. edit_file(path="time_utils.py", old_text="x", new_text="y") — fix `is_within_24h()`.
7. run_tests(target="tests/test_refund.py") — verify.
"""
    score = g.score_h5_agentic_tool_use(plan, truth)
    assert "analyze_diff" in score["phantom_tool_calls"]
    assert score["primary_pass"] is False


# ─── B6 — H2 reasoning gate + ground-truth-leak rejection ────────────────────

def test_h2_b6_answer_only_output_fails_reasoning_gate():
    """3/3 correct answers with 0/4 reasoning steps must fail primary_pass."""
    truth = _load_truth("H2")
    out = (
        "## 답\n"
        "- (Q-A) 답: Carol 이 Python 사용.\n"
        "- (Q-B) 답: Rust 사용자의 모니터는 27\".\n"
        "- (Q-C) 답: 43\" 모니터는 데스크 1번."
    )
    score = g.score_h2_multi_hop_reasoning(out, truth)
    assert score["sub_question_correct_count"] == 3
    assert score["step_rate"] < 0.75, score
    assert score["primary_pass"] is False, (
        f"answer-only output must fail reasoning gate; score={score['primary_score']}"
    )


def test_h2_b6_ground_truth_json_dump_rejected_as_leak():
    """Verbatim ground_truth.json content must not pass — leak markers reject."""
    truth = _load_truth("H2")
    leak_text = json.dumps(truth, ensure_ascii=False)
    score = g.score_h2_multi_hop_reasoning(leak_text, truth)
    assert score["ground_truth_leak"] is True
    assert score["primary_pass"] is False, (
        f"verbatim ground_truth must be rejected; score={score['primary_score']}"
    )


# ─── B7 — H3 structure gate (all components required for pass) ───────────────

def test_h3_b7_entities_terms_without_structure_fails_pass_gate():
    """Output rich in entities/terms but lacking H2/H3/table/bullet structure
    must NOT pass — structure is mandatory by the prompt."""
    truth = _load_truth("H3")
    out = (
        "Park Seoyeon (PM, Korea office) and Kim Dohyeon worked with Carla Rivera. "
        "Nova 3 launched with Payment Service Provider (PSP) integration on v3.7.2. "
        "p99 < 80ms at 4,200 RPS on /v1/orders. Date: 2026-06-15. Beta latency 118ms. "
        "Hotfix v3.7.3 planned. PSP partners doubled."
    )
    score = g.score_h3_multilingual_recall_ko_en(out, truth)
    assert score["entity_rate"] >= 0.8
    assert score["structure_ok"] is False
    assert score["primary_pass"] is False, (
        f"no-structure output must fail; score={score['primary_score']} "
        f"components={score['structure_components']}"
    )


# ─── B8 — H1 min-match floor (cascade-13b condition) ─────────────────────────

def test_h1_b8_partial_match_below_floor_fails_pass_gate():
    """Matching only Critical+1 High (2 of 6) yields F1≈0.59 ≥ 0.55 threshold,
    but the min-match floor (⌈6/2⌉=3) requires more — primary_pass must be False."""
    truth = _load_truth("H1")
    out = """| ID | Line | Severity | Issue | Fix |
|----|------|----------|-------|-----|
| X1 | 50 | Critical | requests.post inside db_session() transaction holds the DB lock during external HTTP I/O — exactly OPS-4192 forbids. | Move HTTP outside tx. |
| X2 | 9  | High | SLACK_WEBHOOK_URL loaded directly from os.environ at module import — violates vault lazy-load. | Lazy-load from vault. |
"""
    score = g.score_h1_long_form_code_review(out, truth)
    assert len(score["matched_issue_ids"]) == 2, score
    assert score["primary_score"] >= 0.55  # F1 still crosses the score threshold
    assert score["matches_floor_ok"] is False
    assert score["min_matches_for_pass"] >= 3
    assert score["primary_pass"] is False, (
        f"partial 2/6 match must fail min floor; score={score['primary_score']}"
    )


# ─── NB1 — H10 year-skip too broad (over-correction in cascade-13c B1) ───────
# Round-2 codex caught: B1 fix skipped ALL 1900-2099 tokens, masking metric
# counts that happen to fall in year-shape (e.g., "2026 건" = 2026 items).

def test_h10_nb1_year_shape_with_korean_counter_must_flag():
    """4-digit year-shaped tokens immediately followed by a Korean counter
    (건/명/개/번/호) signal metric-count usage, not a date — must be flagged
    as missing thousands comma."""
    truth = _load_truth("H10")
    text = (
        "## 무슨 일이 있었나\n"
        "결제 흐름은 2026 건이었고, 응답 큐에 1985 명이 대기했다.\n"
        "회고 작성자 사인오프: ops-on-call."
    )
    score = g.score_h10_strict_instruction_following(text, truth)
    c5 = next(c for c in score["constraint_results"] if c["id"] == "C5")
    assert c5["passed"] is False, (
        f"C5 must flag year-shaped count (NB1): {c5}"
    )
    assert "2026" in c5["violations"], c5
    assert "1985" in c5["violations"], c5


def test_h10_nb1_year_shape_with_english_counter_must_flag():
    """English count nouns (errors/requests/items) after year-shape tokens
    likewise mark metric-count usage."""
    truth = _load_truth("H10")
    text = (
        "## 무슨 일이 있었나\n"
        "We saw 2026 errors and 1985 requests in the dead-letter queue.\n"
        "회고 작성자 사인오프: ops-on-call."
    )
    score = g.score_h10_strict_instruction_following(text, truth)
    c5 = next(c for c in score["constraint_results"] if c["id"] == "C5")
    assert c5["passed"] is False, c5
    assert "2026" in c5["violations"], c5
    assert "1985" in c5["violations"], c5


def test_h10_nb1_year_shape_in_date_context_still_passes():
    """Regression: B1 — year-shaped tokens in genuine date/year context
    (followed by 회고/패턴 etc., or preceded by 'in') must still pass.
    The NB1 fix must not over-revert to flagging genuine years."""
    truth = _load_truth("H10")
    text = (
        "## 무슨 일이 있었나\n"
        "2026 회고로 정리한다. 1985 패턴과 비슷하다. "
        "결제 흐름은 1,247 건이었다.\n"
        "회고 작성자 사인오프: ops-on-call."
    )
    score = g.score_h10_strict_instruction_following(text, truth)
    c5 = next(c for c in score["constraint_results"] if c["id"] == "C5")
    assert c5["passed"] is True, (
        f"C5 wrongly flagged date-context year-shape (NB1 over-revert): {c5}"
    )
    assert c5["violations"] == []


# ─── NB2 — H5 citation allowlist too broad (over-correction in B4) ───────────
# Round-2 codex caught: identifier-wide allowlist masks ALL occurrences of an
# allowlisted name, including actual phantom invocations in numbered steps.

def test_h5_nb2_numbered_step_invocation_still_phantom_after_citation():
    """A numbered-step invocation `apply_refund(123)` of a non-palette name
    must remain phantom even when the same name appears as a backticked
    citation elsewhere in the plan. The allowlist is citation-context-only;
    it must not exempt actual call-context invocations."""
    truth = _load_truth("H5")
    plan = """## Plan

1. run_tests(target="tests/test_refund.py::test_partial_refund_within_24h") — reproduce.
2. apply_refund(amount=123, txn_id="t1") — wrongly invoke candidate function as a tool.
3. grep_search(pattern="def apply_refund") — locate `apply_refund()` and `is_within_24h()`.
4. read_file(path="payments-svc/refund.py") — read body.
5. edit_file(path="payments-svc/time_utils.py", old_text="x", new_text="y") — fix `is_within_24h()`.
6. run_tests(target="tests/test_refund.py") — verify.
"""
    score = g.score_h5_agentic_tool_use(plan, truth)
    assert "apply_refund" in score["phantom_tool_calls"], (
        f"NB2: apply_refund invocation in numbered step must be phantom even "
        f"if cited elsewhere; phantom_tool_calls={score['phantom_tool_calls']}"
    )
    assert score["primary_pass"] is False


def test_h5_nb2_pure_backtick_citation_no_invocation_still_passes():
    """Regression: B4 — pure backticked citation `apply_refund()` with no
    line-start/numbered-step invocation must still NOT be flagged as phantom.
    The NB2 fix must not over-revert by re-flagging backtick citations."""
    truth = _load_truth("H5")
    score = g.score_h5_agentic_tool_use(H5_PLAN_WITH_CITATIONS, truth)
    assert "apply_refund" not in score["phantom_tool_calls"], (
        f"NB2 over-revert: backtick citations wrongly re-flagged: "
        f"{score['phantom_tool_calls']}"
    )
    assert "is_within_24h" not in score["phantom_tool_calls"]


def test_h5_nb2_bare_identifier_without_parens_never_phantom():
    """Bare identifier citations without `()` (e.g., 'process_data' as prose)
    do not match the call-context regex at all — they are never phantom
    regardless of allowlist behavior. Documents the expected boundary."""
    truth = _load_truth("H5")
    plan = """## Plan

1. run_tests(target="tests/test_refund.py::test_partial_refund_within_24h") — reproduce.
2. read_file(path="tests/test_refund.py") — read the failing test; mentions process_data.
3. grep_search(pattern="def apply_refund") — locate `apply_refund()`.
4. read_file(path="payments-svc/refund.py") — read body.
5. edit_file(path="payments-svc/time_utils.py", old_text="x", new_text="y") — fix.
6. run_tests(target="tests/test_refund.py") — verify.
"""
    score = g.score_h5_agentic_tool_use(plan, truth)
    assert "process_data" not in score["phantom_tool_calls"], score["phantom_tool_calls"]
