from __future__ import annotations

import os

import pytest

import exec_mode_grader as g


class _FakeProc:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


TRUTH = {
    "fixture": "F5",
    "word_count_bounds": {"min": 1000, "max": 1500},
    "section_requirements": {
        "required_heading_regex_any_of": [
            [r"executive\s*summary"],
            [r"release\s*timeline"],
            [r"PEP"],
            [r"breaking\s*change"],
            [r"ecosystem"],
            [r"recommend"],
        ]
    },
    "primary_source_allowlist": {
        "domains": [
            "python.org",
            "peps.python.org",
            "github.com/python/cpython",
        ],
        "blocklist_hint": ["medium.com"],
    },
    "citation_quota": {"min_primary_citations": 5},
    "sources_section_requirement": {
        "heading_regex": r"^##\s*Sources",
        "min_urls_in_section": 5,
    },
    "primary_metric": {"pass_threshold": 0.70},
}


GOOD_QUOTES = {
    "https://python.org/3.14": "Python 3.14 remains on the published release cadence.",
    "https://peps.python.org/pep-1000": "The release manager tracks beta and release candidate milestones.",
    "https://github.com/python/cpython/releases": "CPython release notes enumerate user-visible changes.",
    "https://python.org/downloads": "The downloads page lists active branch availability.",
    "https://peps.python.org/pep-2000": "Accepted PEPs define interpreter-facing compatibility changes.",
}


def _fake_curl_factory(quotes: dict[str, str], *, dead: set[str] | None = None):
    dead = dead or set()

    def fake_run(cmd, *, capture_output=True, text=True, timeout=None, check=False, **_kw):
        url = cmd[-1]
        if "-I" in cmd:
            code = 404 if url in dead else 200
            return _FakeProc(0, f"HTTP/2 {code}\n", "")
        body = quotes.get(url, "")
        rc = 0 if body else 1
        return _FakeProc(rc, body, "")

    return fake_run


GOOD_OUTPUT = f"""
## Executive Summary
Summary sentence.
{"analysis " * 160}

> "{GOOD_QUOTES["https://python.org/3.14"]}" - [Python Status](https://python.org/3.14)

## Release Timeline
Summary sentence.
{"timeline " * 160}

> "{GOOD_QUOTES["https://peps.python.org/pep-1000"]}" - [PEP 1000](https://peps.python.org/pep-1000)

## PEP Highlights
Summary sentence.
{"pep " * 160}

> "{GOOD_QUOTES["https://github.com/python/cpython/releases"]}" - [CPython Releases](https://github.com/python/cpython/releases)

## Breaking Change Review
Summary sentence.
{"compat " * 160}

> "{GOOD_QUOTES["https://python.org/downloads"]}" - [Downloads](https://python.org/downloads)

## Ecosystem Support
Summary sentence.
{"ecosystem " * 160}

> "{GOOD_QUOTES["https://peps.python.org/pep-2000"]}" - [PEP 2000](https://peps.python.org/pep-2000)

## Recommendation
Summary sentence.
{"recommend " * 160}

## Sources
- https://python.org/3.14
- https://peps.python.org/pep-1000
- https://github.com/python/cpython/releases
- https://python.org/downloads
- https://peps.python.org/pep-2000
"""


BAD_OUTPUT = """
## Executive Summary
Too short.

> "A short blog post." - [Medium Post](https://medium.com/example-post)

## Sources
- https://medium.com/example-post
"""


def test_score_f5_known_good_is_high(monkeypatch):
    monkeypatch.setattr(g.subprocess, "run", _fake_curl_factory(GOOD_QUOTES))
    score = g.score_f5_citations(GOOD_OUTPUT, TRUTH)
    assert score["word_count_within_bounds"] is True
    assert score["primary_citation_count"] == 5
    assert score["liveness_rate"] == 1.0
    assert score["spot_check_rate"] == 1.0
    assert score["primary_score"] == 1.0


def test_score_f5_blocklist_and_dead_links_score_low(monkeypatch):
    monkeypatch.setattr(
        g.subprocess,
        "run",
        _fake_curl_factory({"https://medium.com/example-post": "mismatch"}, dead={"https://medium.com/example-post"}),
    )
    score = g.score_f5_citations(BAD_OUTPUT, TRUTH)
    assert score["blocklist_hits"] == ["https://medium.com/example-post"]
    assert score["word_count_within_bounds"] is False
    assert score["liveness_rate"] == 0.0
    assert score["primary_score"] < 0.2


def test_score_f5_empty_output_returns_zero(monkeypatch):
    monkeypatch.setattr(g.subprocess, "run", _fake_curl_factory({}))
    score = g.score_f5_citations("", TRUTH)
    assert score["citation_count"] == 0
    assert score["primary_citation_count"] == 0
    assert score["primary_score"] == 0.0


@pytest.mark.skipif(os.environ.get("EXEC_MODE_LIVE_NETWORK") != "1", reason="live network disabled")
def test_score_f5_live_network_smoke():
    output = """
## Executive Summary
Summary sentence.
analysis analysis analysis analysis analysis analysis analysis analysis analysis analysis

> "Python is a programming language." - [About Python](https://www.python.org/doc/essays/blurb/)

## Release Timeline
Summary sentence.
timeline timeline timeline timeline timeline timeline timeline timeline timeline timeline

## PEP Highlights
Summary sentence.
pep pep pep pep pep pep pep pep pep pep

## Breaking Change Review
Summary sentence.
compat compat compat compat compat compat compat compat compat compat

## Ecosystem Support
Summary sentence.
ecosystem ecosystem ecosystem ecosystem ecosystem ecosystem ecosystem ecosystem ecosystem ecosystem

## Recommendation
Summary sentence.
recommend recommend recommend recommend recommend recommend recommend recommend recommend recommend

## Sources
- https://www.python.org/doc/essays/blurb/
"""
    score = g.score_f5_citations(output, TRUTH)
    assert 0.0 <= score["primary_score"] <= 1.0
