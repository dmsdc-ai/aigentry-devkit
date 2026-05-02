"""H1 NB3 patch — output-style formatting-exemption regression tests.

Per Q3 ADR `2026-05-02-output-style-fixture-design-rule.md` §2.4.2 + §8.6
milestone, the H1 grader's row-extraction step must canonicalize structurally-
equivalent variants of a code review (markdown pipe table, fenced table, JSON
array, bullet/numbered list) so the per-issue scoring is invariant to the
output-style wrapper. Pre-patch the grader only matched the markdown-pipe-table
variant; the same review content emitted as JSON or bullets received 0.0.

These tests pin:
  * the canonicalizer's variant detection (`output_format_source` field),
  * the equivalence guarantee (a structurally-equivalent JSON/bullet output
    grades identically to its markdown-table twin), and
  * the conservative-extraction property (prose paragraphs without
    id+line+severity tokens do NOT generate phantom rows — the bias direction
    NB3 r3 (codex) flagged on H5 is avoided here).

Cascade-13c/d pattern: each test reproduces an output an honest agent could
emit; the corrected verdict matches the pre-patch markdown-table verdict.
"""
from __future__ import annotations

import json
from pathlib import Path

import exec_mode_grader as g

REPO_ROOT = Path(__file__).resolve().parents[2]
HOLDOUT = REPO_ROOT / "state" / "fixtures" / "phase5-holdout"


def _load_truth() -> dict:
    return json.loads((HOLDOUT / "H1" / "ground_truth.json").read_text(encoding="utf-8"))


# Canonical 6-issue review content used as the scoring-equivalent baseline.
_ISSUES = [
    {
        "id": "B1", "line": 50, "severity": "Critical",
        "issue": "requests.post inside db_session() transaction holds the DB lock during external HTTP I/O — exactly the pattern OPS-4192 forbids.",
        "fix": "Move the dispatch outside the transaction; commit user lookup, then issue HTTP, then write NotificationLog in a second short transaction.",
    },
    {
        "id": "B2", "line": 9, "severity": "High",
        "issue": "SLACK_WEBHOOK_URL is read from os.environ at module import — violates the vault lazy-load policy for secrets.",
        "fix": "Lazy-load the webhook from vault inside _post_slack on first use; cache after first fetch.",
    },
    {
        "id": "B3", "line": 18, "severity": "High",
        "issue": "_post_slack retries with no Idempotency-Key header — duplicate posts on transient 5xx.",
        "fix": "Compute a stable idempotency-key from (user_id, message hash) and add it to the request payload.",
    },
    {
        "id": "B4", "line": 27, "severity": "High",
        "issue": "_post_sms logs the recipient phone and message body unmasked — PII leak forbidden by team policy; mask_pii helper not applied.",
        "fix": "Apply mask_pii(to) and mask_pii(body[:30]) before log.info; same fix for line 61's NotificationLog body.",
    },
    {
        "id": "B5", "line": 18, "severity": "High",
        "issue": "requests.post in _post_slack has no timeout — call can hang indefinitely.",
        "fix": "Pass timeout=5 (or the team default) and convert exceptions to retry-eligible errors.",
    },
    {
        "id": "B6", "line": 45, "severity": "Medium",
        "issue": "Line numbering jumps backward (44 → 35) inside _post_email — broken diff, the file as-shipped will not be parseable; gap suggests a copy-paste error.",
        "fix": "Renumber lines 35-46 sequentially after 44; ensure the diff was generated from a clean tree.",
    },
]


def _markdown_table(issues=_ISSUES) -> str:
    head = "| ID | Line | Severity | Issue | Recommended fix |\n|----|------|----------|-------|-----------------|\n"
    body = "".join(
        f"| {i['id']} | {i['line']} | {i['severity']} | {i['issue']} | {i['fix']} |\n"
        for i in issues
    )
    return head + body


def _fenced_markdown_table(issues=_ISSUES) -> str:
    return "```markdown\n" + _markdown_table(issues) + "```"


def _json_array(issues=_ISSUES) -> str:
    return json.dumps(issues, ensure_ascii=False)


def _fenced_json_array(issues=_ISSUES) -> str:
    return "```json\n" + _json_array(issues) + "\n```"


def _bullet_list(issues=_ISSUES) -> str:
    parts = []
    for idx, i in enumerate(issues, start=1):
        parts.append(
            f"{idx}. **{i['id']}** (line {i['line']}, {i['severity']}): "
            f"{i['issue']} Fix: {i['fix']}"
        )
    return "\n".join(parts)


# ─── Canonicalizer-level tests ──────────────────────────────────────────────

def test_h1_canonicalizer_markdown_pipe_table_baseline():
    rows, source = g._canonicalize_h1_review_rows(_markdown_table())
    assert source == "markdown_pipe_table"
    assert len(rows) == 6
    assert [r["id"] for r in rows] == ["B1", "B2", "B3", "B4", "B5", "B6"]


def test_h1_canonicalizer_fenced_markdown_table_equivalent():
    rows, source = g._canonicalize_h1_review_rows(_fenced_markdown_table())
    assert source == "markdown_pipe_table_in_code_fence"
    assert [r["id"] for r in rows] == ["B1", "B2", "B3", "B4", "B5", "B6"]


def test_h1_canonicalizer_json_array_equivalent():
    rows, source = g._canonicalize_h1_review_rows(_json_array())
    assert source == "json_array_of_review_rows"
    assert [r["id"] for r in rows] == ["B1", "B2", "B3", "B4", "B5", "B6"]
    assert rows[0]["severity"] == "Critical"
    assert rows[0]["line"] == "50"


def test_h1_canonicalizer_fenced_json_array_equivalent():
    rows, source = g._canonicalize_h1_review_rows(_fenced_json_array())
    assert source == "json_array_of_review_rows"
    assert len(rows) == 6


def test_h1_canonicalizer_json_object_with_issues_key():
    payload = json.dumps({"issues": _ISSUES})
    rows, source = g._canonicalize_h1_review_rows(payload)
    assert source == "json_array_of_review_rows"
    assert len(rows) == 6


def test_h1_canonicalizer_bullet_list_equivalent():
    rows, source = g._canonicalize_h1_review_rows(_bullet_list())
    assert source == "bullet_or_numbered_list_of_review_rows"
    assert {r["id"] for r in rows} == {"B1", "B2", "B3", "B4", "B5", "B6"}


def test_h1_canonicalizer_negative_prose_does_not_yield_rows():
    """Conservative extraction: prose without id+line+severity in the same item
    must NOT generate phantom rows. NB3 r3 (codex) over-correction warning."""
    prose = (
        "I reviewed the dispatcher and noticed several concerns. "
        "Critical issues exist around transaction handling, and the High "
        "severity ones include logging behaviour. I'd recommend a follow-up."
    )
    rows, source = g._canonicalize_h1_review_rows(prose)
    assert rows == []
    assert source == "none"


def test_h1_canonicalizer_negative_json_array_with_distractors():
    """JSON array carrying ONLY distractor flags must NOT report rows that
    name planted bugs by id; the canonicalizer is content-faithful, not
    content-promoting."""
    distractors_only = json.dumps([
        {"id": "X1", "line": 11, "severity": "Medium",
         "issue": "SMTP_HOST is hardcoded magic value",
         "fix": "Move to config file."},
    ])
    rows, source = g._canonicalize_h1_review_rows(distractors_only)
    assert source == "json_array_of_review_rows"
    assert [r["id"] for r in rows] == ["X1"]


def test_h1_canonicalizer_empty_text_returns_none():
    rows, source = g._canonicalize_h1_review_rows("")
    assert rows == []
    assert source == "none"


# ─── Full-grader equivalence tests (the NB3 fix's binding contract) ─────────

def _score(text):
    return g.score_h1_long_form_code_review(text, _load_truth())


def test_h1_grader_markdown_table_baseline_pass():
    s = _score(_markdown_table())
    assert s["matched_issue_ids"] == ["B1", "B2", "B3", "B4", "B5", "B6"]
    assert s["primary_pass"] is True
    assert s["output_format_source"] == "markdown_pipe_table"
    assert s["formatting_exempt_status"] == "implemented"
    assert s["formatting_exempt_canonicalizer"] == "_canonicalize_h1_review_rows"
    assert s["formatting_exempt_rule_adr"] == "2026-05-02-output-style-fixture-design-rule"


def test_h1_grader_fenced_markdown_table_grades_identically():
    """Pre-patch: same content as markdown table; fenced wrapper still parses
    because pipe lines remain pipe-prefixed. Patch makes the variant tag
    visible in metrics for downstream lint check 1 audit."""
    baseline = _score(_markdown_table())
    fenced = _score(_fenced_markdown_table())
    assert baseline["matched_issue_ids"] == fenced["matched_issue_ids"]
    assert baseline["primary_score"] == fenced["primary_score"]
    assert fenced["output_format_source"] == "markdown_pipe_table_in_code_fence"


def test_h1_grader_json_array_grades_equivalently_to_markdown_table():
    """Pre-patch: the JSON array path returned 0 rows → primary_score=0.0.
    Post-patch: same six issues recovered, same primary_pass = True."""
    baseline = _score(_markdown_table())
    js = _score(_json_array())
    assert js["output_format_source"] == "json_array_of_review_rows"
    assert js["matched_issue_ids"] == baseline["matched_issue_ids"]
    assert js["primary_score"] == baseline["primary_score"]
    assert js["primary_pass"] is True
    assert js["structure_ok"] is True


def test_h1_grader_fenced_json_array_grades_equivalently():
    baseline = _score(_markdown_table())
    fjs = _score(_fenced_json_array())
    assert fjs["output_format_source"] == "json_array_of_review_rows"
    assert fjs["primary_score"] == baseline["primary_score"]
    assert fjs["primary_pass"] is True


def test_h1_grader_bullet_list_grades_equivalently():
    baseline = _score(_markdown_table())
    bl = _score(_bullet_list())
    assert bl["output_format_source"] == "bullet_or_numbered_list_of_review_rows"
    # Bullet-list issue/fix are joined into the same field, so the regex match
    # still finds id+line+severity+content per row. F1 must recover the same
    # six issues; numeric score may match exactly or differ by ≤ 0.05 depending
    # on bullet-text concatenation noise.
    assert set(bl["matched_issue_ids"]) == set(baseline["matched_issue_ids"])
    assert bl["primary_pass"] is True
    assert abs(bl["primary_score"] - baseline["primary_score"]) <= 0.05


def test_h1_grader_distractor_only_output_does_not_pass():
    """Negative path: an output that flags only distractors gets primary_pass
    False regardless of whether it's emitted as table or JSON. The NB3 fix
    must not over-credit format-equivalent distractor content."""
    distractors_md = """| ID | Line | Severity | Issue | Recommended fix |
|----|------|----------|-------|-----------------|
| X1 | 11 | Medium | SMTP_HOST is hardcoded magic value, should be from config. | Move to config file. |
| X2 | 52 | High | user not found returns False silently. | Raise NotFoundError instead. |
| X3 | 22 | Low | log.warning should be log.error on failure. | Change level to error. |
"""
    distractors_json = json.dumps([
        {"id": "X1", "line": 11, "severity": "Medium",
         "issue": "SMTP_HOST is hardcoded magic value, should be from config.",
         "fix": "Move to config file."},
        {"id": "X2", "line": 52, "severity": "High",
         "issue": "user not found returns False silently.",
         "fix": "Raise NotFoundError instead."},
        {"id": "X3", "line": 22, "severity": "Low",
         "issue": "log.warning should be log.error on failure.",
         "fix": "Change level to error."},
    ])
    md_score = _score(distractors_md)
    js_score = _score(distractors_json)
    assert md_score["primary_pass"] is False
    assert js_score["primary_pass"] is False
    assert md_score["matched_issue_ids"] == []
    assert js_score["matched_issue_ids"] == []
    assert set(md_score["flagged_distractors"]) == {"D1", "D2", "D3"}
    assert set(js_score["flagged_distractors"]) == {"D1", "D2", "D3"}


def test_h1_grader_emits_full_formatting_exempt_dict():
    """Lint check 1 (§2.4.3) parses these five keys out of metrics.json. Pin
    the exact field names + value shapes here so any drift breaks fast."""
    s = _score(_markdown_table())
    assert s["formatting_exempt_status"] == "implemented"
    assert s["formatting_exempt_canonicalizer"] == "_canonicalize_h1_review_rows"
    assert "markdown_pipe_table" in s["formatting_exempt_variants"]
    assert "json_array_of_review_rows" in s["formatting_exempt_variants"]
    assert "bullet_or_numbered_list_of_review_rows" in s["formatting_exempt_variants"]
    assert len(s["formatting_exempt_tests"]) >= 3
    assert s["formatting_exempt_rule_adr"] == "2026-05-02-output-style-fixture-design-rule"


def test_h1_grader_empty_output_returns_zero_with_status_field():
    s = _score("")
    assert s["primary_score"] == 0.0
    assert s["primary_pass"] is False
    assert s["output_format_source"] == "none"
    assert s["formatting_exempt_status"] == "implemented"
