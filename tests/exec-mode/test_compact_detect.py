"""T3 — detect_compact() 2-signal rule (spec §5.1, §8).

Rule: at turn i>=1, cache_read drop from turn i-1 > drop_ratio (default 0.5)
AND input_tokens at turn i > spike_mult * mean(input_tokens[:i]) (default 2.0)
→ compact_detected=True.
"""
from __future__ import annotations

from pathlib import Path

import exec_mode_grader as g


def test_detect_compact_positive(fixture_dir):
    flag = g.detect_compact(fixture_dir / "sample_compact.jsonl")
    assert flag.detected is True
    assert flag.reason is not None
    assert flag.cache_read_drop_ratio is not None
    assert flag.cache_read_drop_ratio > 0.5
    assert flag.next_input_spike_ratio is not None
    assert flag.next_input_spike_ratio > 2.0


def test_detect_compact_negative(fixture_dir):
    flag = g.detect_compact(fixture_dir / "sample_no_compact.jsonl")
    assert flag.detected is False
    assert flag.reason is None


def test_detect_compact_too_few_turns(tmp_path: Path):
    """Fewer than 2 assistant turns → cannot detect."""
    f = tmp_path / "short.jsonl"
    f.write_text(
        '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":100,"cache_read_input_tokens":5000}}}\n'
    )
    flag = g.detect_compact(f)
    assert flag.detected is False


def test_detect_compact_drop_alone_insufficient(tmp_path: Path):
    """cache_read drops >50% but input doesn't spike → not compact."""
    f = tmp_path / "drop_only.jsonl"
    f.write_text(
        "\n".join(
            [
                '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":100,"cache_read_input_tokens":10000}}}',
                '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":100,"cache_read_input_tokens":10000}}}',
                '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":110,"cache_read_input_tokens":1000}}}',
            ]
        )
    )
    flag = g.detect_compact(f)
    assert flag.detected is False


def test_detect_compact_spike_alone_insufficient(tmp_path: Path):
    """Input spikes but cache_read doesn't drop → not compact."""
    f = tmp_path / "spike_only.jsonl"
    f.write_text(
        "\n".join(
            [
                '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":100,"cache_read_input_tokens":10000}}}',
                '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":100,"cache_read_input_tokens":10000}}}',
                '{"type":"assistant","message":{"role":"assistant","usage":{"input_tokens":10000,"cache_read_input_tokens":10500}}}',
            ]
        )
    )
    flag = g.detect_compact(f)
    assert flag.detected is False


def test_detect_compact_custom_thresholds(fixture_dir):
    """Tighter thresholds can reject an otherwise-positive case."""
    flag = g.detect_compact(fixture_dir / "sample_compact.jsonl", drop_ratio=0.95, spike_mult=2.0)
    assert flag.detected is False
