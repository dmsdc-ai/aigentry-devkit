"""T3 — unit tests for parse_cost() in bin/exec-mode-grader.py.

Golden fixture `sample_session.jsonl` has two assistant turns:
  Turn 1: input=100, output=200, cache_create_5m=5000, cache_create_1h=0, cache_read=0
  Turn 2: input=50,  output=150, cache_create_5m=1000, cache_create_1h=2000, cache_read=5000

Expected totals:
  I=150, O=350, CW5=6000, CW1h=2000, CR=5000
Expected cost (Sonnet 4.6 pricing, per 1M):
  (3.0*150 + 15.0*350 + 3.75*6000 + 6.0*2000 + 0.30*5000) / 1e6
  = 41700 / 1e6 = 0.0417
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import exec_mode_grader as g


def test_parse_cost_totals(fixture_dir):
    buckets = g.parse_cost(fixture_dir / "sample_session.jsonl")
    assert buckets.input_tokens == 150
    assert buckets.output_tokens == 350
    assert buckets.cache_write_5m == 6000
    assert buckets.cache_write_1h == 2000
    assert buckets.cache_read == 5000


def test_parse_cost_marginal_usd(fixture_dir):
    buckets = g.parse_cost(fixture_dir / "sample_session.jsonl")
    expected = (3.0 * 150 + 15.0 * 350 + 3.75 * 6000 + 6.0 * 2000 + 0.30 * 5000) / 1_000_000
    assert buckets.marginal_usd == pytest.approx(expected, rel=1e-9)
    assert buckets.marginal_usd == pytest.approx(0.0417, rel=1e-6)


def test_parse_cost_empty_jsonl(tmp_path: Path):
    empty = tmp_path / "empty.jsonl"
    empty.write_text("")
    buckets = g.parse_cost(empty)
    assert buckets.input_tokens == 0
    assert buckets.output_tokens == 0
    assert buckets.marginal_usd == 0.0


def test_parse_cost_ignores_non_assistant_turns(tmp_path: Path):
    f = tmp_path / "mixed.jsonl"
    f.write_text(
        "\n".join(
            [
                json.dumps({"type": "user", "message": {"role": "user", "usage": {"input_tokens": 9999}}}),
                "",
                "not-json-at-all",
                json.dumps(
                    {
                        "type": "assistant",
                        "message": {
                            "role": "assistant",
                            "usage": {"input_tokens": 10, "output_tokens": 20, "cache_read_input_tokens": 0},
                        },
                    }
                ),
            ]
        )
    )
    buckets = g.parse_cost(f)
    assert buckets.input_tokens == 10
    assert buckets.output_tokens == 20


def test_parse_cost_fallback_cache_creation_field(tmp_path: Path):
    """Older CLI schema: single cache_creation_input_tokens (5m bucket)."""
    f = tmp_path / "old_schema.jsonl"
    f.write_text(
        json.dumps(
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "usage": {
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "cache_creation_input_tokens": 3000,
                        "cache_read_input_tokens": 0,
                    },
                },
            }
        )
        + "\n"
    )
    buckets = g.parse_cost(f)
    assert buckets.cache_write_5m == 3000
    assert buckets.cache_write_1h == 0


def test_parse_cost_recurses_into_subagent_jsonls(tmp_path: Path):
    """Nested subagents/agent-*.jsonl contribute when include_subagents=True."""
    parent = tmp_path / "project"
    parent.mkdir()
    main = parent / "session.jsonl"
    main.write_text(
        json.dumps(
            {
                "type": "assistant",
                "message": {"role": "assistant", "usage": {"input_tokens": 10, "output_tokens": 20}},
            }
        )
        + "\n"
    )
    subs = parent / "subagents"
    subs.mkdir()
    (subs / "agent-1.jsonl").write_text(
        json.dumps(
            {
                "type": "assistant",
                "message": {"role": "assistant", "usage": {"input_tokens": 5, "output_tokens": 7}},
            }
        )
        + "\n"
    )
    nested = subs / "nested"
    nested.mkdir()
    (nested / "agent-2.jsonl").write_text(
        json.dumps(
            {
                "type": "assistant",
                "message": {"role": "assistant", "usage": {"input_tokens": 3, "output_tokens": 4}},
            }
        )
        + "\n"
    )

    with_subs = g.parse_cost(main, include_subagents=True)
    assert with_subs.input_tokens == 10 + 5 + 3
    assert with_subs.output_tokens == 20 + 7 + 4

    without = g.parse_cost(main, include_subagents=False)
    assert without.input_tokens == 10
    assert without.output_tokens == 20
