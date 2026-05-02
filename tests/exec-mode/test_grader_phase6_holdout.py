"""Phase 6 holdout-fixture grader unit tests (H11–H14, Q3 ADR §2.4 r2).

Each grader has at minimum: happy path, edge case, output-style adversarial.
The adversarial cases pin the canonicalization invariance — the same content
emitted under different output-style wrappers (JSON / markdown / bullet /
fenced code block) must produce the same primary_score.

Refs: Phase 6 spec `2026-05-02-phase6-design.md` §6.2 + §6.3 (output-style
guard); Q3 ADR `2026-05-02-output-style-fixture-design-rule.md` §2.1
(equivalence taxonomy) + §2.4.2 (status enum).
"""
from __future__ import annotations

import json

import exec_mode_grader as g

ADR_ID = "2026-05-02-output-style-fixture-design-rule"


# ─── H11 — structured-data-extraction ───────────────────────────────────────

H11_FULL_MARKDOWN = """| Component | Root Cause |
|-----------|------------|
| CheckoutService | PaymentGateway timeout was too short |
| OrderQueue | OOM (Out of Memory) |
| NotificationWorker | malformed API key configuration |
"""

H11_FULL_JSON = json.dumps([
    {"component": "CheckoutService", "root_cause": "PaymentGateway timeout was too short"},
    {"component": "OrderQueue", "root_cause": "OOM / Out of Memory"},
    {"component": "NotificationWorker", "root_cause": "malformed API key configuration"},
])

H11_FULL_BULLETS = """- CheckoutService — PaymentGateway timeout was too short.
- OrderQueue: OOM (Out of Memory) crash.
- NotificationWorker: malformed API key configuration dropped messages.
"""

H11_PARTIAL_TWO = """- CheckoutService had a PaymentGateway timeout that was too short.
- OrderQueue went OOM under backlog pressure.
"""


def test_h11_canonicalizer_detects_variants():
    _, src_md = g._canonicalize_h11_pairs_text(H11_FULL_MARKDOWN)
    _, src_json = g._canonicalize_h11_pairs_text(H11_FULL_JSON)
    _, src_bullets = g._canonicalize_h11_pairs_text(H11_FULL_BULLETS)
    _, src_fenced = g._canonicalize_h11_pairs_text("```\n" + H11_FULL_BULLETS + "```")
    assert src_md == "markdown_table"
    assert src_json == "json_array"
    assert src_bullets == "bullet_or_numbered_list"
    assert src_fenced == "fenced_code_block"


def test_h11_grader_full_credit_on_three_pairs():
    s = g.score_h11_structured_data_extraction(H11_FULL_MARKDOWN, {})
    assert s["pairs_matched"] == 3
    assert s["primary_score"] == 1.0
    assert s["primary_pass"] is True
    assert s["formatting_exempt_status"] == "implemented"
    assert s["formatting_exempt_canonicalizer"] == "_canonicalize_h11_pairs_text"
    assert s["formatting_exempt_rule_adr"] == ADR_ID


def test_h11_grader_partial_credit_on_two_pairs():
    s = g.score_h11_structured_data_extraction(H11_PARTIAL_TWO, {})
    assert s["pairs_matched"] == 2
    assert s["primary_score"] == round(2 / 3, 4)
    # Default 0.66 threshold: 2/3 = 0.6667 ≥ 0.66 → primary_pass True at boundary
    assert set(s["matched_pair_ids"]) == {"P1", "P2"}


def test_h11_grader_format_invariant_json_vs_markdown():
    md_score = g.score_h11_structured_data_extraction(H11_FULL_MARKDOWN, {})
    js_score = g.score_h11_structured_data_extraction(H11_FULL_JSON, {})
    bl_score = g.score_h11_structured_data_extraction(H11_FULL_BULLETS, {})
    assert md_score["primary_score"] == js_score["primary_score"] == bl_score["primary_score"]
    assert md_score["matched_pair_ids"] == js_score["matched_pair_ids"] == bl_score["matched_pair_ids"]


def test_h11_grader_negative_unrelated_prose_scores_zero():
    s = g.score_h11_structured_data_extraction(
        "I think there were some issues but I can't recall the components.",
        {},
    )
    assert s["pairs_matched"] == 0
    assert s["primary_score"] == 0.0
    assert s["primary_pass"] is False


# ─── H12 — multilingual-summarization ────────────────────────────────────────

H12_FULL_NUMBERED = """1. Redis is hitting max memory evictions and causing latency spikes.
2. TTL will be reduced to 6 hours as the first mitigation.
3. If DB load increases, the Redis cluster will be scaled up.
"""

H12_FULL_BULLETS = """* Redis 메모리 evict가 빈번해 latency 지연이 생긴다.
* TTL을 6시간으로 줄여보기로 했다.
* DB load가 너무 커지면 Redis 클러스터를 확장한다.
"""

H12_FULL_PROSE = (
    "The team agreed Redis was hitting max memory evictions, causing latency. "
    "They decided to reduce TTL to 6 hours first, and to scale up the Redis "
    "cluster if DB load grows."
)

H12_PARTIAL_TWO = """1. Redis memory eviction is the symptom.
2. We will lower the TTL to 6 hours.
"""


def test_h12_canonicalizer_detects_variants():
    _, src_num = g._canonicalize_h12_summary_text(H12_FULL_NUMBERED)
    _, src_bul = g._canonicalize_h12_summary_text(H12_FULL_BULLETS)
    _, src_prose = g._canonicalize_h12_summary_text(H12_FULL_PROSE)
    _, src_fenced = g._canonicalize_h12_summary_text("```\n" + H12_FULL_NUMBERED + "```")
    assert src_num == "numbered_list"
    assert src_bul == "bullet_list"
    assert src_prose == "paragraph_prose"
    assert src_fenced == "fenced_code_block"


def test_h12_grader_full_credit_three_takeaways():
    s = g.score_h12_multilingual_summarization(H12_FULL_NUMBERED, {})
    assert s["takeaways_matched"] == 3
    assert s["primary_score"] == 1.0
    assert s["formatting_exempt_status"] == "implemented"


def test_h12_grader_partial_credit_two_takeaways():
    s = g.score_h12_multilingual_summarization(H12_PARTIAL_TWO, {})
    assert s["takeaways_matched"] == 2
    assert s["primary_score"] == round(2 / 3, 4)


def test_h12_grader_korean_english_mixed_input():
    s = g.score_h12_multilingual_summarization(H12_FULL_BULLETS, {})
    assert s["takeaways_matched"] == 3
    assert s["primary_score"] == 1.0


def test_h12_grader_format_invariant_numbered_vs_bullets_vs_prose():
    a = g.score_h12_multilingual_summarization(H12_FULL_NUMBERED, {})
    b = g.score_h12_multilingual_summarization(H12_FULL_BULLETS, {})
    c = g.score_h12_multilingual_summarization(H12_FULL_PROSE, {})
    assert a["primary_score"] == b["primary_score"] == c["primary_score"] == 1.0


# ─── H13 — schema-strict-output (JSON ≡ YAML) ───────────────────────────────

H13_FULL_JSON = """{
  "routes": [
    {"path": "/api/v1", "backend": "api-svc"},
    {"path": "/assets", "backend": "cdn-svc"}
  ]
}
"""

H13_FULL_FENCED_JSON = "```json\n" + H13_FULL_JSON + "```"

H13_FULL_YAML = """routes:
  - path: /api/v1
    backend: api-svc
  - path: /assets
    backend: cdn-svc
"""

H13_FULL_FENCED_YAML = "```yaml\n" + H13_FULL_YAML + "```"

H13_PARTIAL_ONE = """{
  "routes": [
    {"path": "/api/v1", "backend": "api-svc"}
  ]
}
"""

H13_WRONG_BACKEND = """{
  "routes": [
    {"path": "/api/v1", "backend": "wrong-svc"},
    {"path": "/assets", "backend": "cdn-svc"}
  ]
}
"""


def test_h13_canonicalizer_json_and_yaml_variants():
    routes_json, src_j = g._canonicalize_h13_routes(H13_FULL_JSON)
    routes_fjson, src_fj = g._canonicalize_h13_routes(H13_FULL_FENCED_JSON)
    routes_yaml, src_y = g._canonicalize_h13_routes(H13_FULL_YAML)
    routes_fyaml, src_fy = g._canonicalize_h13_routes(H13_FULL_FENCED_YAML)
    assert src_j == "raw_json"
    assert src_fj == "fenced_json"
    assert src_y == "raw_yaml"
    assert src_fy == "fenced_yaml"
    assert all(len(r) == 2 for r in (routes_json, routes_fjson, routes_yaml, routes_fyaml))


def test_h13_grader_full_credit_both_routes():
    s = g.score_h13_schema_strict_routes(H13_FULL_JSON, {})
    assert s["routes_matched"] == 2
    assert s["primary_score"] == 1.0
    assert s["primary_pass"] is True
    assert s["formatting_exempt_status"] == "implemented"
    assert s["formatting_exempt_canonicalizer"] == "_canonicalize_h13_routes"


def test_h13_grader_partial_credit_one_route():
    s = g.score_h13_schema_strict_routes(H13_PARTIAL_ONE, {})
    assert s["routes_matched"] == 1
    assert s["primary_score"] == 0.5


def test_h13_grader_yaml_equivalent_to_json():
    js = g.score_h13_schema_strict_routes(H13_FULL_JSON, {})
    yml = g.score_h13_schema_strict_routes(H13_FULL_YAML, {})
    fjs = g.score_h13_schema_strict_routes(H13_FULL_FENCED_JSON, {})
    fyml = g.score_h13_schema_strict_routes(H13_FULL_FENCED_YAML, {})
    assert js["primary_score"] == yml["primary_score"] == fjs["primary_score"] == fyml["primary_score"] == 1.0


def test_h13_grader_wrong_backend_does_not_credit():
    s = g.score_h13_schema_strict_routes(H13_WRONG_BACKEND, {})
    assert s["routes_matched"] == 1
    assert s["primary_score"] == 0.5


def test_h13_grader_invalid_input_yields_zero():
    s = g.score_h13_schema_strict_routes("Sorry I can't help with that.", {})
    assert s["routes_matched"] == 0
    assert s["primary_pass"] is False


# ─── H14 — agentic-multi-step-tool-use (4-tool ordered sequence) ────────────

H14_CORRECT_NUMBERED = """1. grep_logs
2. read_metrics
3. list_threads
4. restart_process
"""

H14_CORRECT_CSV = "grep_logs, read_metrics, list_threads, restart_process"

H14_CORRECT_BACKTICK = """First I'll `grep_logs` to inspect errors, then
`read_metrics` for current load, then `list_threads` for hotspots, and
finally `restart_process` to mitigate."""

H14_CORRECT_JSON = json.dumps([
    "grep_logs", "read_metrics", "list_threads", "restart_process"
])

H14_CORRECT_FENCED = "```\ngrep_logs\nread_metrics\nlist_threads\nrestart_process\n```"

H14_OUT_OF_ORDER = """1. read_metrics
2. grep_logs
3. list_threads
4. restart_process
"""

H14_THREE_OF_FOUR = "grep_logs, read_metrics, restart_process"


def test_h14_canonicalizer_extracts_across_wrappers():
    seq_num, src_num = g._canonicalize_h14_tool_sequence(H14_CORRECT_NUMBERED)
    seq_csv, src_csv = g._canonicalize_h14_tool_sequence(H14_CORRECT_CSV)
    seq_bt,  src_bt  = g._canonicalize_h14_tool_sequence(H14_CORRECT_BACKTICK)
    seq_json,src_json= g._canonicalize_h14_tool_sequence(H14_CORRECT_JSON)
    seq_fnc, src_fnc = g._canonicalize_h14_tool_sequence(H14_CORRECT_FENCED)
    correct = ["grep_logs", "read_metrics", "list_threads", "restart_process"]
    assert seq_num == correct
    assert seq_csv == correct
    assert seq_bt == correct
    assert seq_json == correct
    assert seq_fnc == correct
    assert src_num == "numbered_list"
    assert src_csv == "comma_separated"
    assert src_bt == "backtick_wrapped"
    assert src_json == "json_array"
    assert src_fnc == "fenced_code_block"


def test_h14_grader_full_credit_correct_order():
    s = g.score_h14_agentic_tool_sequence(H14_CORRECT_NUMBERED, {})
    assert s["palette_recall"] == 1.0
    assert s["order_score"] == 1.0
    assert s["primary_score"] == 1.0
    assert s["primary_pass"] is True
    assert s["formatting_exempt_status"] == "implemented"


def test_h14_grader_partial_credit_unordered():
    """All 4 tools present but order wrong: palette=1.0, order=0.25 (first
    tool grep_logs not at position 0). primary = 0.5*1.0 + 0.5*0.25 = 0.625.
    Below default threshold 0.75 → primary_pass False."""
    s = g.score_h14_agentic_tool_sequence(H14_OUT_OF_ORDER, {})
    assert s["palette_recall"] == 1.0
    # H14_OUT_OF_ORDER has read_metrics first → no prefix match → order_score 0.0
    assert s["order_score"] == 0.0
    assert s["primary_score"] == 0.5
    assert s["primary_pass"] is False


def test_h14_grader_three_of_four_tools():
    """3/4 palette, partial-order prefix matches grep_logs+read_metrics (2/4)."""
    s = g.score_h14_agentic_tool_sequence(H14_THREE_OF_FOUR, {})
    assert s["palette_recall"] == 0.75
    assert s["order_prefix_match"] == 2
    assert s["order_score"] == 0.5
    assert s["primary_score"] == round(0.5 * 0.75 + 0.5 * 0.5, 4)


def test_h14_grader_format_invariant_json_vs_text():
    text = g.score_h14_agentic_tool_sequence(H14_CORRECT_NUMBERED, {})
    js = g.score_h14_agentic_tool_sequence(H14_CORRECT_JSON, {})
    csv = g.score_h14_agentic_tool_sequence(H14_CORRECT_CSV, {})
    fnc = g.score_h14_agentic_tool_sequence(H14_CORRECT_FENCED, {})
    bt = g.score_h14_agentic_tool_sequence(H14_CORRECT_BACKTICK, {})
    assert text["primary_score"] == js["primary_score"] == csv["primary_score"] \
        == fnc["primary_score"] == bt["primary_score"] == 1.0


def test_h14_grader_unrelated_text_yields_zero():
    s = g.score_h14_agentic_tool_sequence("I'm not sure what tools to use.", {})
    assert s["palette_recall"] == 0.0
    assert s["primary_score"] == 0.0
    assert s["primary_pass"] is False


# ─── PRIMARY_GRADERS dispatch coverage ──────────────────────────────────────

def test_primary_graders_registers_h11_through_h14():
    assert "H11" in g.PRIMARY_GRADERS
    assert "H12" in g.PRIMARY_GRADERS
    assert "H13" in g.PRIMARY_GRADERS
    assert "H14" in g.PRIMARY_GRADERS
    # Dispatcher round-trip: score_primary -> the same fn
    s = g.score_primary("H11", H11_FULL_MARKDOWN, {})
    assert s["primary_score"] == 1.0


def test_all_phase6_holdout_graders_emit_implemented_status():
    """Lint check 1 (§2.4.3) requires every H11–H14 trial's metrics.json to
    carry formatting_exempt_status ∈ {implemented, not_applicable}. Pin the
    invariant at unit-test layer."""
    cases = [
        ("H11", H11_FULL_MARKDOWN),
        ("H12", H12_FULL_NUMBERED),
        ("H13", H13_FULL_JSON),
        ("H14", H14_CORRECT_NUMBERED),
    ]
    for fixture_id, payload in cases:
        s = g.score_primary(fixture_id, payload, {})
        assert s["formatting_exempt_status"] == "implemented", fixture_id
        assert s["formatting_exempt_rule_adr"] == ADR_ID, fixture_id
        assert s["formatting_exempt_canonicalizer"], fixture_id
        assert s["formatting_exempt_variants"], fixture_id
        assert s["formatting_exempt_tests"], fixture_id
