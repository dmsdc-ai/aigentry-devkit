r"""H8 regression — _extract_labeled_section robustness across label formats.

Review §H8 flagged the original `(?is)\(\s*{label}\s*\)` pattern as too
strict: an agent writing `**(a)** Root cause:` happens to work (parens
present), but `a.`, `a:`, `a)`, or `**a**.` formats break the extractor
→ F7/F9/F10 primary_score collapses to 0 on legitimate output.

These tests pin the accepted label surface:
  - `(a) ...`              plain parens               (pre-H8 baseline)
  - `**(a)** ...`          bold-wrapped parens        (pre-H8 baseline)
  - `a. ...`               letter + period
  - `a: ...`               letter + colon
  - `a) ...`               half paren
  - `**a.** ...`           bold-wrapped letter+punct
And preserves false-positive guards on bare prose lines.
"""
from __future__ import annotations

import exec_mode_grader as g


# ─── accepted label surface (must parse) ────────────────────────────────────


def test_extract_labeled_section_plain_parens():
    body = "(a) Root cause text.\n(b) Evidence text.\n(c) Diff here."
    assert g._extract_labeled_section(body, "a", ("b", "c")) == "Root cause text."


def test_extract_labeled_section_bold_parens():
    body = "**(a)** Root cause text.\n**(b)** Evidence text.\n**(c)** Diff."
    extracted = g._extract_labeled_section(body, "a", ("b", "c"))
    assert "Root cause text." in extracted
    assert "Evidence text." not in extracted


def test_extract_labeled_section_letter_period():
    body = "a. Root cause text.\nb. Evidence text.\nc. Diff."
    extracted = g._extract_labeled_section(body, "a", ("b", "c"))
    assert "Root cause text." in extracted
    assert "Evidence text." not in extracted


def test_extract_labeled_section_letter_colon():
    body = "a: Root cause text.\nb: Evidence text.\nc: Diff."
    extracted = g._extract_labeled_section(body, "a", ("b", "c"))
    assert "Root cause text." in extracted
    assert "Evidence text." not in extracted


def test_extract_labeled_section_half_paren():
    body = "a) Root cause text.\nb) Evidence text.\nc) Diff."
    extracted = g._extract_labeled_section(body, "a", ("b", "c"))
    assert "Root cause text." in extracted
    assert "Evidence text." not in extracted


def test_extract_labeled_section_bold_letter_period():
    body = "**a.** Root cause text.\n**b.** Evidence text.\n**c.** Diff."
    extracted = g._extract_labeled_section(body, "a", ("b", "c"))
    assert "Root cause text." in extracted
    assert "Evidence text." not in extracted


# ─── false-positive guards (must NOT parse bare prose) ─────────────────────


def test_extract_labeled_section_does_not_match_bare_prose_line():
    """A sentence starting with the letter `a` but no label marker must not
    be treated as a section header."""
    body = (
        "a boat floated by the quay last Tuesday.\n"
        "(a) Root cause text.\n"
        "(b) Evidence text."
    )
    extracted = g._extract_labeled_section(body, "a", ("b",))
    # The `a boat...` line is prose; the real label is `(a)` — extraction
    # must skip to the paren form.
    assert "Root cause text." in extracted
    assert "boat" not in extracted


def test_extract_labeled_section_missing_returns_empty():
    body = "No labels here.\nJust prose."
    assert g._extract_labeled_section(body, "a", ("b", "c")) == ""
