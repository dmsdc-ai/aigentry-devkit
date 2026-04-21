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
  - `## (a) ...`           markdown h1-h6 header prefix (H8 deep-fix;
                           F10 agents empirically emit this form —
                           analyst phase 3 §8)
  - `### **(a)** ...`      header + bold parens combined
  - `## a. ...`            header + letter-punct combined
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


# ─── H8 deep-fix: markdown header prefixes (## (a), ### **(a)**, ## a.) ────


def test_extract_labeled_section_h2_paren_label():
    """F10 agents overwhelmingly emit `## (a) Status summary` — verify
    the h2 header prefix is accepted (analyst phase 3 §8 RCA: 21/32 F10
    zero trials were this grader-gap)."""
    body = (
        "## (a) Status summary\n"
        "Root cause text.\n"
        "\n"
        "## (b) Next actions\n"
        "Evidence text.\n"
        "\n"
        "## (c) Stale items rejected\n"
        "Diff text.\n"
    )
    extracted = g._extract_labeled_section(body, "a", ("b", "c"))
    assert "Root cause text." in extracted
    assert "Evidence text." not in extracted


def test_extract_labeled_section_h2_paren_label_b_and_c():
    body = (
        "## (a) Status summary\n"
        "Root cause text.\n"
        "## (b) Next actions\n"
        "Next action body.\n"
        "## (c) Stale items rejected\n"
        "Stale body.\n"
    )
    assert "Next action body." in g._extract_labeled_section(body, "b", ("c",))
    assert "Stale body." in g._extract_labeled_section(body, "c", ())


def test_extract_labeled_section_h3_bold_paren():
    """Header + bold + parens combined."""
    body = "### **(a)** Root cause text.\n### **(b)** Evidence text."
    extracted = g._extract_labeled_section(body, "a", ("b",))
    assert "Root cause text." in extracted
    assert "Evidence text." not in extracted


def test_extract_labeled_section_h2_letter_period():
    """Header + letter + trailing punctuation."""
    body = "## a. Root cause text.\n## b. Evidence text.\n## c. Diff."
    extracted = g._extract_labeled_section(body, "a", ("b", "c"))
    assert "Root cause text." in extracted
    assert "Evidence text." not in extracted


def test_extract_labeled_section_h1_paren():
    """Single `#` (h1) still accepted per 1-6 hash range."""
    body = "# (a) Root cause text.\n# (b) Evidence text."
    extracted = g._extract_labeled_section(body, "a", ("b",))
    assert "Root cause text." in extracted
    assert "Evidence text." not in extracted


def test_extract_labeled_section_h6_paren():
    """h6 (6 hashes) is the upper bound; 7 hashes must NOT match as a
    valid markdown header (prevents runaway prefix match)."""
    body = "###### (a) Six hashes, ok.\n###### (b) Next."
    extracted = g._extract_labeled_section(body, "a", ("b",))
    assert "Six hashes, ok." in extracted


def test_extract_labeled_section_h2_keeps_prose_label_guard():
    """Header prefix doesn't weaken the trailing-punctuation guard: a
    prose line starting with `## a ` (no punctuation, no parens) is
    still not a label."""
    body = (
        "## a sentence that begins with a letter.\n"
        "## (a) Real label text.\n"
        "## (b) Next.\n"
    )
    extracted = g._extract_labeled_section(body, "a", ("b",))
    assert "Real label text." in extracted
    assert "sentence that begins" not in extracted


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
