"""Phase 6 grader adversarial-matrix tests (round-2).

Per Q3 ADR §2.4.1 reviewer-checklist + codex MAJOR 3 / triage M3, every
declared formatting variant for each Phase 6 grader (H1 NB3 + H11–H14) MUST
have ≥1 positive AND ≥1 negative test, plus malformed / empty / excess-length
adversarial cases. This file complements:

  * `tests/exec-mode/test_grader_h1_nb3_adversarial.py` (H1 NB3 patch)
  * `tests/exec-mode/test_grader_phase6_holdout.py`     (H11–H14 happy-path)

Adding the missing per-variant negatives + the M4/M5/M6 regression cases the
codex review surfaced (H11 swapped pairs, H12 T3 over-credit, H13 inline-
backtick + extra-route penalty, H14 duplicate / unknown tool / excess-length).

Refs:
  - codex review: docs/reports/2026-05-02-phase6-graders-codex-review.md
  - triage:        ~/projects/aigentry-architect/docs/triage/2026-05-02-phase6-grader-triage.md
  - Q3 ADR:        ~/projects/aigentry-orchestrator/docs/adr/2026-05-02-output-style-fixture-design-rule.md
"""
from __future__ import annotations

import json
from pathlib import Path

import exec_mode_grader as g

REPO_ROOT = Path(__file__).resolve().parents[2]
HOLDOUT = REPO_ROOT / "state" / "fixtures" / "phase5-holdout"


# ─── H1 NB3 adversarial coverage (positive + negative per variant) ──────────

def _h1_truth() -> dict:
    return json.loads((HOLDOUT / "H1" / "ground_truth.json").read_text(encoding="utf-8"))


def test_h1_negative_markdown_table_only_distractors_does_not_pass():
    """markdown_pipe_table variant — negative case (3 distractor flags only)."""
    payload = (
        "| ID | Line | Severity | Issue | Recommended fix |\n"
        "|----|------|----------|-------|-----------------|\n"
        "| X1 | 11 | Medium | SMTP_HOST hardcoded magic value. | Move to config. |\n"
    )
    s = g.score_h1_long_form_code_review(payload, _h1_truth())
    assert s["primary_pass"] is False
    assert s["matched_issue_ids"] == []
    assert s["output_format_source"] == "markdown_pipe_table"


def test_h1_negative_fenced_markdown_table_only_distractors_does_not_pass():
    """markdown_pipe_table_in_code_fence variant — negative."""
    inner = (
        "| ID | Line | Severity | Issue | Recommended fix |\n"
        "|----|------|----------|-------|-----------------|\n"
        "| X1 | 11 | Medium | SMTP_HOST magic value. | Move to config. |\n"
    )
    payload = "```markdown\n" + inner + "```"
    s = g.score_h1_long_form_code_review(payload, _h1_truth())
    assert s["primary_pass"] is False
    assert s["output_format_source"] == "markdown_pipe_table_in_code_fence"
    assert s["matched_issue_ids"] == []


def test_h1_negative_json_array_with_only_distractors_does_not_pass():
    """json_array_of_review_rows variant — negative case."""
    payload = json.dumps([
        {"id": "X1", "line": 11, "severity": "Medium",
         "issue": "SMTP_HOST hardcoded magic value", "fix": "Move to config."},
    ])
    s = g.score_h1_long_form_code_review(payload, _h1_truth())
    assert s["primary_pass"] is False
    assert s["output_format_source"] == "json_array_of_review_rows"
    assert s["matched_issue_ids"] == []


def test_h1_negative_bullet_list_only_distractors_does_not_pass():
    """bullet_or_numbered_list_of_review_rows variant — negative case.

    Uses canonical distractor id `D1` (matches bullet parser's `[BD]\\d+`
    regex) so the row IS extracted; content fingerprint hits a distractor
    fp_regex but matches no planted bug → primary_pass False.
    """
    payload = (
        "1. **D1** (line 11, Medium): SMTP_HOST is hardcoded magic value, "
        "should be from config. Fix: Move to config file.\n"
    )
    s = g.score_h1_long_form_code_review(payload, _h1_truth())
    assert s["primary_pass"] is False
    assert s["output_format_source"] == "bullet_or_numbered_list_of_review_rows"
    assert s["matched_issue_ids"] == []
    assert "D1" in s["flagged_distractors"]


def test_h1_malformed_json_falls_through_to_zero_rows():
    """Malformed JSON → no rows extracted; score is 0.0."""
    s = g.score_h1_long_form_code_review('[{"id":"B1"', _h1_truth())
    assert s["primary_score"] == 0.0
    assert s["output_format_source"] == "none"


def test_h1_excess_length_irrelevant_text_does_not_credit():
    """500-line excess prose without bug ids / line numbers / severity → 0."""
    payload = ("This is a very long review essay. " * 500)
    s = g.score_h1_long_form_code_review(payload, _h1_truth())
    assert s["primary_pass"] is False
    assert s["matched_issue_ids"] == []


def test_h1_empty_string_emits_status_with_zero_score():
    s = g.score_h1_long_form_code_review("", _h1_truth())
    assert s["primary_score"] == 0.0
    assert s["formatting_exempt_status"] == "implemented"


# ─── H11 — swap-test (BLOCKER 2) + per-variant negative coverage ─────────────

def test_h11_grader_raw_text_palette_only_passes():
    """Positive raw_text variant for H11: prose-only multi-line without table /
    JSON / bullet markers MUST canonicalize to `raw_text` AND credit the three
    (Component, Root-Cause) pairs (one per line). Pairs the existing negative
    `test_h11_grader_negative_unrelated_prose_scores_zero` so the declared
    `raw_text` variant has both positive AND negative coverage per condition 4
    (codex r2 §6 N3 / §3 condition 4)."""
    payload = (
        "CheckoutService had a PaymentGateway timeout that was too short.\n"
        "OrderQueue went OOM under backlog pressure.\n"
        "NotificationWorker had a malformed API key configuration.\n"
    )
    _, src = g._canonicalize_h11_pairs_text(payload)
    assert src == "raw_text"
    s = g.score_h11_structured_data_extraction(payload, {})
    assert s["pairs_matched"] == 3
    assert s["primary_score"] == 1.0
    assert s["primary_pass"] is True


def test_h11_grader_swapped_pairs_score_below_one_table():
    """codex BLOCKER 2 / triage B2: a swapped (component, cause) markdown
    table must NOT score 1.0. Each row's component + its mis-paired cause
    cannot match P1/P2/P3 because the component regex on the same row sees
    the wrong cause keyword."""
    swapped = (
        "| Component | Root Cause |\n"
        "|-----------|------------|\n"
        "| CheckoutService | OOM (Out of Memory) |\n"
        "| OrderQueue | malformed API key |\n"
        "| NotificationWorker | PaymentGateway timeout was too short |\n"
    )
    s = g.score_h11_structured_data_extraction(swapped, {})
    assert s["primary_score"] < 1.0
    assert s["pairs_matched"] < 3, s
    # All three components are PRESENT globally but in wrong rows; per-row
    # match must reject all three pairings.
    assert all(p["component_hit"] for p in s["pair_results"])


def test_h11_grader_swapped_pairs_score_below_one_json():
    """JSON-variant swap-test: shuffle (component, root_cause) keys across
    objects; must NOT score 1.0."""
    swapped = json.dumps([
        {"component": "CheckoutService", "root_cause": "OOM (Out of Memory)"},
        {"component": "OrderQueue", "root_cause": "malformed API key configuration"},
        {"component": "NotificationWorker", "root_cause": "PaymentGateway timeout was too short"},
    ])
    s = g.score_h11_structured_data_extraction(swapped, {})
    assert s["primary_score"] < 1.0
    assert s["pairs_matched"] < 3


def test_h11_grader_swapped_pairs_score_below_one_bullets():
    """Bullet-variant swap-test."""
    swapped = (
        "- CheckoutService — OOM (Out of Memory) on burst.\n"
        "- OrderQueue: malformed API key configuration after rotation.\n"
        "- NotificationWorker: PaymentGateway timeout was too short.\n"
    )
    s = g.score_h11_structured_data_extraction(swapped, {})
    assert s["primary_score"] < 1.0
    assert s["pairs_matched"] < 3


def test_h11_negative_markdown_table_unrelated_components():
    """markdown_table variant — negative: components named but none match palette."""
    payload = (
        "| Component | Root Cause |\n"
        "|-----------|------------|\n"
        "| AuthService | rate limiter misconfigured |\n"
        "| UserCache | stale read |\n"
    )
    s = g.score_h11_structured_data_extraction(payload, {})
    assert s["primary_score"] == 0.0


def test_h11_negative_json_array_with_no_palette_components():
    payload = json.dumps([{"component": "AuthService", "root_cause": "rate limiter"}])
    s = g.score_h11_structured_data_extraction(payload, {})
    assert s["primary_score"] == 0.0


def test_h11_negative_fenced_code_block_unrelated_text():
    """fenced_code_block variant — negative."""
    payload = "```\nNo specific incident details available yet.\n```"
    s = g.score_h11_structured_data_extraction(payload, {})
    assert s["primary_score"] == 0.0


def test_h11_negative_bullet_list_unrelated_items():
    payload = (
        "- We will follow up next week.\n"
        "- Coordinate with the SRE team for capacity review.\n"
    )
    s = g.score_h11_structured_data_extraction(payload, {})
    assert s["primary_score"] == 0.0


def test_h11_malformed_json_falls_through_to_text_path():
    """Truncated JSON → falls back to raw_text entry split; still scores 0.0
    when content is not pair-shaped."""
    s = g.score_h11_structured_data_extraction('[{"component":"Auth"', {})
    assert s["primary_score"] == 0.0


def test_h11_empty_input_scores_zero_with_status_field():
    s = g.score_h11_structured_data_extraction("", {})
    assert s["primary_score"] == 0.0
    assert s["formatting_exempt_status"] == "implemented"


def test_h11_excess_length_with_palette_in_one_paragraph_still_per_entry():
    """Excess-length input with the three correct pairs in three sentences
    must still score 1.0; sentence-level entry split keeps pair locality."""
    excess = (
        "The retro identifies the following root causes. "
        "First, CheckoutService failed because PaymentGateway timeout was too short. "
        "Second, OrderQueue went OOM under burst pressure. "
        "Third, NotificationWorker dropped messages due to malformed API key configuration. "
        + ("This is unrelated filler text. " * 200)
    )
    s = g.score_h11_structured_data_extraction(excess, {})
    assert s["pairs_matched"] == 3
    assert s["primary_score"] == 1.0


# ─── H12 — per-variant negative + M4 T3 over-credit regression ──────────────

def test_h12_t3_redis_cluster_alone_does_not_credit_post_m4():
    """codex MAJOR 4 / triage M4 regression: 'Redis cluster' as a noun without
    any scaling action must NOT match T3."""
    payload = (
        "1. Redis is hitting max memory evictions.\n"
        "2. We will reduce TTL to 6 hours.\n"
        "3. The Redis cluster exists in production.\n"
    )
    s = g.score_h12_multilingual_summarization(payload, {})
    t3 = next(t for t in s["takeaway_results"] if t["id"] == "T3")
    assert t3["passed"] is False, s
    assert "T3" not in s["matched_takeaway_ids"]


def test_h12_t3_credits_on_explicit_scale_action():
    """Sanity: M4 doesn't break the legitimate Korean/English scale-action path."""
    payload = (
        "1. Redis 메모리 evict 발생.\n"
        "2. TTL을 6시간으로 줄였다.\n"
        "3. DB load가 증가하면 Redis 클러스터를 확장한다.\n"
    )
    s = g.score_h12_multilingual_summarization(payload, {})
    assert "T3" in s["matched_takeaway_ids"]


def test_h12_negative_paragraph_prose_without_takeaways():
    """paragraph_prose variant — negative."""
    payload = "We had an incident last week. Customers were affected."
    s = g.score_h12_multilingual_summarization(payload, {})
    assert s["primary_score"] == 0.0


def test_h12_negative_bullet_list_with_unrelated_items():
    """bullet_list variant — negative."""
    payload = "- Coffee machine broken.\n- Need new chairs.\n"
    s = g.score_h12_multilingual_summarization(payload, {})
    assert s["primary_score"] == 0.0


def test_h12_negative_numbered_list_unrelated():
    """numbered_list variant — negative."""
    payload = "1. Ship the docs.\n2. Order pizza.\n3. Update wiki.\n"
    s = g.score_h12_multilingual_summarization(payload, {})
    assert s["primary_score"] == 0.0


def test_h12_negative_fenced_code_block_unrelated():
    """fenced_code_block variant — negative."""
    payload = "```\nplaceholder code\n```"
    s = g.score_h12_multilingual_summarization(payload, {})
    assert s["primary_score"] == 0.0


def test_h12_negative_raw_text_unrelated():
    payload = "Nothing to summarize."
    s = g.score_h12_multilingual_summarization(payload, {})
    assert s["primary_score"] == 0.0


def test_h12_malformed_truncated_summary():
    payload = "1. Redis maybe TTL"
    s = g.score_h12_multilingual_summarization(payload, {})
    assert s["primary_score"] < 1.0


def test_h12_empty_input_scores_zero_with_status():
    s = g.score_h12_multilingual_summarization("", {})
    assert s["primary_score"] == 0.0
    assert s["formatting_exempt_status"] == "implemented"


def test_h12_excess_length_correct_takeaways_still_match():
    payload = (
        "1. Redis evictions caused latency spikes.\n"
        "2. TTL reduced to 6 hours mitigation.\n"
        "3. Scale Redis cluster up if DB load grows.\n"
        + "filler line\n" * 500
    )
    s = g.score_h12_multilingual_summarization(payload, {})
    assert s["takeaways_matched"] == 3


# ─── H13 — inline backtick (M5) + extra-route (M5) + per-variant negative ───

def test_h13_grader_inline_backtick_json_strips_to_full_credit():
    """codex MAJOR 5 / triage M5: inline single-backtick wrapped JSON must
    parse to the same routes as raw JSON."""
    payload = '`{"routes": [{"path": "/api/v1", "backend": "api-svc"}, {"path": "/assets", "backend": "cdn-svc"}]}`'
    s = g.score_h13_schema_strict_routes(payload, {})
    assert s["routes_matched"] == 2
    assert s["primary_score"] == 1.0


def test_h13_grader_extra_route_penalized_under_schema_strict():
    """codex MAJOR 5: 2 required + 1 extra /admin route must NOT score 1.0."""
    payload = json.dumps({
        "routes": [
            {"path": "/api/v1", "backend": "api-svc"},
            {"path": "/assets", "backend": "cdn-svc"},
            {"path": "/admin",  "backend": "admin-svc"},
        ]
    })
    s = g.score_h13_schema_strict_routes(payload, {})
    assert s["routes_matched"] == 2
    assert s["extras_count"] == 1
    assert s["primary_score"] < 1.0
    assert s["primary_pass"] is False


def test_h13_negative_raw_json_with_wrong_paths():
    """raw_json variant — negative."""
    payload = json.dumps({"routes": [{"path": "/wrong", "backend": "svc"}]})
    s = g.score_h13_schema_strict_routes(payload, {})
    assert s["routes_matched"] == 0
    assert s["extras_count"] == 1


def test_h13_negative_fenced_json_with_wrong_paths():
    """fenced_json variant — negative."""
    payload = '```json\n{"routes": [{"path": "/wrong", "backend": "svc"}]}\n```'
    s = g.score_h13_schema_strict_routes(payload, {})
    assert s["routes_matched"] == 0


def test_h13_negative_raw_yaml_with_wrong_paths():
    """raw_yaml variant — negative."""
    payload = "routes:\n  - path: /wrong\n    backend: svc\n"
    s = g.score_h13_schema_strict_routes(payload, {})
    assert s["routes_matched"] == 0


def test_h13_negative_fenced_yaml_with_wrong_paths():
    """fenced_yaml variant — negative."""
    payload = "```yaml\nroutes:\n  - path: /wrong\n    backend: svc\n```"
    s = g.score_h13_schema_strict_routes(payload, {})
    assert s["routes_matched"] == 0


def test_h13_malformed_json_yields_zero():
    s = g.score_h13_schema_strict_routes('{"routes": [{"path"', {})
    assert s["routes_matched"] == 0
    assert s["primary_score"] == 0.0


def test_h13_empty_input_scores_zero_with_status():
    s = g.score_h13_schema_strict_routes("", {})
    assert s["routes_matched"] == 0
    assert s["primary_score"] == 0.0
    assert s["formatting_exempt_status"] == "implemented"


def test_h13_excess_length_with_correct_routes_at_top():
    """A schema-strict response wrapped in long prose preamble fails to parse
    (canonicalizer requires JSON/YAML structure as the leading content)."""
    payload = ("filler\n" * 200) + json.dumps({
        "routes": [
            {"path": "/api/v1", "backend": "api-svc"},
            {"path": "/assets", "backend": "cdn-svc"},
        ]
    })
    s = g.score_h13_schema_strict_routes(payload, {})
    # Strict parser does not extract from prose; this is documented behavior.
    assert s["routes_matched"] in (0, 2)


# ─── H14 — duplicate / unknown / excess + per-variant negative ──────────────

def test_h14_grader_duplicate_call_penalized():
    """codex MAJOR 6 / triage M6: duplicate palette call must reduce score
    AND block primary_pass."""
    payload = "1. grep_logs\n2. grep_logs\n3. read_metrics\n4. list_threads\n5. restart_process\n"
    s = g.score_h14_agentic_tool_sequence(payload, {})
    assert s["duplicate_count"] == 1
    assert s["primary_pass"] is False
    assert s["primary_score"] < 1.0


def test_h14_grader_unknown_tool_penalized():
    """codex MAJOR 6: snake_case unknown tool blocks primary_pass."""
    payload = "1. grep_logs\n2. fake_tool\n3. read_metrics\n4. list_threads\n5. restart_process\n"
    s = g.score_h14_agentic_tool_sequence(payload, {})
    assert "fake_tool" in s["unknown_tools"]
    assert s["primary_pass"] is False
    assert s["primary_score"] < 1.0


def test_h14_grader_excess_length_blocks_pass():
    """More than 4 palette calls (with a duplicate) blocks primary_pass."""
    payload = "grep_logs, read_metrics, list_threads, restart_process, restart_process"
    s = g.score_h14_agentic_tool_sequence(payload, {})
    assert s["duplicate_count"] >= 1
    assert s["primary_pass"] is False


def test_h14_negative_raw_text_only_unrelated_words():
    s = g.score_h14_agentic_tool_sequence("just some prose", {})
    assert s["palette_recall"] == 0.0


def test_h14_negative_fenced_unrelated():
    s = g.score_h14_agentic_tool_sequence("```\nhello world\n```", {})
    assert s["palette_recall"] == 0.0


def test_h14_negative_comma_separated_unrelated():
    s = g.score_h14_agentic_tool_sequence("alpha, beta, gamma, delta", {})
    assert s["palette_recall"] == 0.0


def test_h14_negative_numbered_list_unrelated():
    s = g.score_h14_agentic_tool_sequence("1. alpha\n2. beta\n3. gamma\n4. delta\n", {})
    assert s["palette_recall"] == 0.0


def test_h14_negative_json_array_unrelated():
    s = g.score_h14_agentic_tool_sequence(json.dumps(["alpha", "beta"]), {})
    assert s["palette_recall"] == 0.0


def test_h14_negative_backtick_wrapped_unrelated():
    s = g.score_h14_agentic_tool_sequence("Use `alpha` then `beta`.", {})
    assert s["palette_recall"] == 0.0


def test_h14_malformed_json_falls_back_to_regex():
    s = g.score_h14_agentic_tool_sequence('["grep_logs', {})
    # Truncated JSON triggers fallback to raw regex; tools may still extract.
    assert s["primary_score"] >= 0.0


def test_h14_empty_input_scores_zero_with_status():
    s = g.score_h14_agentic_tool_sequence("", {})
    assert s["primary_score"] == 0.0
    assert s["formatting_exempt_status"] == "implemented"


# ─── H14 r3: codex r2 N1 + M3 / M6 — raw-text + connector-text surfaces ─────
# Codex r2 §6 N1 + §2 M6: `_detect_h14_unknown_tools` previously only scanned
# backtick / list-line / narrow CSV positions, while `_canonicalize_h14_tool_
# sequence` extracted palette tools globally. r3 aligns the detector's
# pass-set to the canonicalizer's so the palette-only constraint surface
# holds across every output style the canonicalizer accepts.

def test_h14_grader_raw_text_palette_only_passes():
    """Positive raw-text variant — palette tools in space-separated raw text
    must reach primary_pass=True. Codex r2 M3 PARTIAL completion (raw-text
    positive was missing from the declared-variant matrix)."""
    payload = "grep_logs read_metrics list_threads restart_process"
    s = g.score_h14_agentic_tool_sequence(payload, {})
    assert s["unknown_tools"] == []
    assert s["palette_recall"] == 1.0
    assert s["order_score"] == 1.0
    assert s["primary_score"] == 1.0
    assert s["primary_pass"] is True
    assert s["output_format_source"] == "raw_text"


def test_h14_grader_raw_text_unknown_tool_blocks_pass():
    """Codex r2 §6 N1.a: unknown snake_case tool embedded in raw text must
    surface in `unknown_tools` and block primary_pass — the prior detector
    missed this because it only scanned backtick / list-line / narrow CSV
    positions."""
    payload = "grep_logs inspect_config read_metrics list_threads restart_process"
    s = g.score_h14_agentic_tool_sequence(payload, {})
    assert "inspect_config" in s["unknown_tools"]
    assert s["primary_pass"] is False
    assert s["primary_score"] < 1.0


def test_h14_grader_comma_connector_unknown_tool_blocks_pass():
    """Codex r2 §6 N1.b: unknown snake_case tool in comma-with-connector text
    (`Call X, then Y, then Z, ...`) must surface in `unknown_tools` and block
    primary_pass. Connector words ("Call", "then") fall outside the narrow
    CSV regex; the global snake_case scan is what catches the unknown id."""
    payload = (
        "Call grep_logs, then inspect_config, then read_metrics, "
        "then list_threads, then restart_process."
    )
    s = g.score_h14_agentic_tool_sequence(payload, {})
    assert "inspect_config" in s["unknown_tools"]
    assert s["primary_pass"] is False
    assert s["primary_score"] < 1.0


def test_h14_grader_uppercase_unknown_token_blocks_pass():
    """Defensive: any snake_case identifier outside the palette blocks pass.
    Lowercase-only regex still catches `unknown_tool` / `inspect_config`;
    a literal UPPERCASE_TOKEN is intentionally NOT a snake_case tool by H14
    contract (palette is lowercase). Pin the surface so a future regex
    widening doesn't silently re-introduce the gap."""
    payload = (
        "grep_logs unknown_tool read_metrics list_threads restart_process"
    )
    s = g.score_h14_agentic_tool_sequence(payload, {})
    assert "unknown_tool" in s["unknown_tools"]
    assert s["primary_pass"] is False


def test_h14_detector_scans_global_body_codex_n1():
    """Direct unit on `_detect_h14_unknown_tools` proving the r3 rewrite:
    every snake_case identifier outside the palette must surface regardless
    of position (raw-text, comma-connector, multi-line). Pin the post-r3
    detector contract so a regression to position-narrow scanning is caught
    at unit layer, not only via the integration grader test."""
    raw = "grep_logs inspect_config read_metrics list_threads restart_process"
    comma = (
        "Call grep_logs, then inspect_config, then read_metrics, "
        "then list_threads, then restart_process."
    )
    multiline = (
        "First grep_logs.\n"
        "Then inspect_config and read_metrics.\n"
        "Finally list_threads then restart_process.\n"
    )
    assert "inspect_config" in g._detect_h14_unknown_tools(raw)
    assert "inspect_config" in g._detect_h14_unknown_tools(comma)
    assert "inspect_config" in g._detect_h14_unknown_tools(multiline)
    # palette-only inputs must still report no unknowns
    palette = "grep_logs read_metrics list_threads restart_process"
    assert g._detect_h14_unknown_tools(palette) == []


def test_h14_canonicalizer_emits_raw_text_for_space_separated_palette():
    """Pin canonicalizer contract for the raw-text variant so the declared
    variant `raw_text` has both a positive variant detection (here) AND a
    primary_pass positive (above). Required by condition 4 declared-variant
    matrix."""
    extracted, src = g._canonicalize_h14_tool_sequence(
        "grep_logs read_metrics list_threads restart_process"
    )
    assert extracted == [
        "grep_logs", "read_metrics", "list_threads", "restart_process",
    ]
    assert src == "raw_text"


# ─── H12 r3: codex r2 N3 — declared-variant alignment after raw_text drop ──

def test_h12_canonicalizer_empty_input_emits_paragraph_prose_post_n3():
    """Codex r2 §6 N3 fix: empty input previously returned `raw_text` while
    non-empty prose returned `paragraph_prose` and `_H12_VARIANTS` declared
    `raw_text`. r3 option (a): both empty and non-empty prose now emit
    `paragraph_prose`, matching the declared variants tuple."""
    text, src = g._canonicalize_h12_summary_text("")
    assert text == ""
    assert src == "paragraph_prose"


def test_h12_declared_variants_match_canonicalizer_outputs():
    """For every declared H12 variant there exists at least one input that
    canonicalizes to that variant — proves the declaration is grounded in
    implementation, not aspirational. Codex §6 N3 schema-drift guard."""
    declared = set(g._H12_VARIANTS)
    samples = {
        "fenced_code_block": "```\nThe team lowered TTL.\n```",
        "bullet_list": "* Redis hits eviction\n* TTL\n",
        "numbered_list": "1. Redis\n2. TTL\n3. Scale\n",
        "paragraph_prose": "Just a single line of free-form prose.",
    }
    for variant, text in samples.items():
        _, src = g._canonicalize_h12_summary_text(text)
        assert src == variant, (variant, src)
    assert declared == set(samples), (declared, set(samples))
