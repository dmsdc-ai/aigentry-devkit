"""T3 — pollution_layer_a() regex substring detection (spec §5.3)."""
from __future__ import annotations

import exec_mode_grader as g


def _facts():
    return [
        {"id": "f1", "keyword": "Xenon", "sentence": "Project Xenon deadline 2026-05-15",
         "paraphrase_examples": ["the Xenon effort", "our Xenon work"]},
        {"id": "f2", "keyword": "42-series", "sentence": "42-series rollout locked",
         "paraphrase_examples": []},
        {"id": "f3", "keyword": "Milano", "sentence": "Milano office migration",
         "paraphrase_examples": ["migrating Milano"]},
    ]


def test_pollution_keyword_hit():
    output = "I suggest we continue Project Xenon next sprint."
    leaks = g.pollution_layer_a(output, _facts())
    assert leaks == [True, False, False]


def test_pollution_paraphrase_hit():
    output = "Let's align our Xenon work with migrating Milano next quarter."
    leaks = g.pollution_layer_a(output, _facts())
    assert leaks == [True, False, True]


def test_pollution_no_hit_when_fact_not_mentioned():
    output = "All good, nothing to report."
    leaks = g.pollution_layer_a(output, _facts())
    assert leaks == [False, False, False]


def test_pollution_is_case_insensitive():
    output = "xenon status check"
    leaks = g.pollution_layer_a(output, _facts())
    assert leaks[0] is True


def test_pollution_keyword_with_regex_special_chars():
    """Keywords like '42-series' contain regex-special chars; must be escaped."""
    output = "rolling out the 42-series hardware today"
    leaks = g.pollution_layer_a(output, _facts())
    assert leaks[1] is True


def test_pollution_api_returns_one_bool_per_fact():
    """Helper accepts any N; caller enforces N=10 (spec §5.3, schema.v1)."""
    leaks = g.pollution_layer_a("nothing", _facts())
    assert len(leaks) == len(_facts())
