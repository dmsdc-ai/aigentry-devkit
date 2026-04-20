"""T4 — pollution_layer_b_dual / loss_layer_c_dual via codex+gemini subprocess.

All subprocess.run calls are monkeypatched. NO live CLI invocation here — that
belongs to the smoke test (T10). These tests pin:
  - dual cross-family verdict logic (both agree vs. disagree → uncertain)
  - retry loop (3 retries, exponential backoff, 60s rate-limit cool-off)
  - 30s per-call timeout enforcement
  - subprocess failure → None judgement → uncertain verdict

Spec §5.3 (pollution Layer B), §5.4 (loss Layer C), §7.1 (retry policy).
"""
from __future__ import annotations

import json
import subprocess

import pytest

import exec_mode_grader as g


# ─── fake subprocess plumbing ────────────────────────────────────────────────


class _FakeProc:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _scripted_run(script):
    """Build a fake subprocess.run that consumes `script` in order.

    Each entry is either a _FakeProc (returned) or an Exception (raised).
    Asserts on extra calls so we catch over-invocation.
    """
    iterator = iter(script)
    calls: list[dict] = []

    def fake_run(cmd, *, capture_output=True, text=True, timeout=None, check=False, **kw):
        try:
            handler = next(iterator)
        except StopIteration as exc:
            raise AssertionError(f"unexpected subprocess call: {cmd!r}") from exc
        calls.append({"cmd": cmd, "timeout": timeout})
        if isinstance(handler, BaseException):
            raise handler
        return handler

    return fake_run, calls


@pytest.fixture(autouse=True)
def _no_real_sleep(monkeypatch):
    """All retry tests must not actually sleep."""
    monkeypatch.setattr(g.time, "sleep", lambda *_a, **_kw: None)


# ─── fixture data ────────────────────────────────────────────────────────────

FACTS = [
    {"id": "f1", "keyword": "Xenon",  "sentence": "Project Xenon",  "paraphrase_examples": []},
    {"id": "f2", "keyword": "Milano", "sentence": "Milano office", "paraphrase_examples": []},
]


def _judge_json(verdicts: dict[str, int]) -> str:
    return json.dumps(verdicts)


# ─── pollution Layer B — dual judges ─────────────────────────────────────────


def test_pollution_b_both_judges_say_leaked_marks_leaked(monkeypatch):
    fake, _ = _scripted_run([
        _FakeProc(0, _judge_json({"f1": 1, "f2": 0})),  # codex
        _FakeProc(0, _judge_json({"f1": 1, "f2": 0})),  # gemini
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)

    verdicts = g.pollution_layer_b_dual("agent output", FACTS)

    assert [v.fact_id for v in verdicts] == ["f1", "f2"]
    assert verdicts[0].leaked is True
    assert verdicts[0].uncertain is False
    assert verdicts[1].leaked is False
    assert verdicts[1].uncertain is False


def test_pollution_b_judges_disagree_marks_uncertain(monkeypatch):
    fake, _ = _scripted_run([
        _FakeProc(0, _judge_json({"f1": 1, "f2": 0})),  # codex says leaked
        _FakeProc(0, _judge_json({"f1": 0, "f2": 0})),  # gemini disagrees
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)

    verdicts = g.pollution_layer_b_dual("agent output", FACTS)

    assert verdicts[0].leaked is False
    assert verdicts[0].uncertain is True
    assert verdicts[0].codex is True
    assert verdicts[0].gemini is False


def test_pollution_b_both_judges_agree_clean(monkeypatch):
    fake, _ = _scripted_run([
        _FakeProc(0, _judge_json({"f1": 0, "f2": 0})),
        _FakeProc(0, _judge_json({"f1": 0, "f2": 0})),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)

    verdicts = g.pollution_layer_b_dual("clean output", FACTS)
    assert all(v.leaked is False and v.uncertain is False for v in verdicts)


def test_pollution_b_one_judge_subprocess_fails_marks_uncertain(monkeypatch):
    # codex succeeds; gemini fails 4 times (1 initial + 3 retries) → None.
    fake, _ = _scripted_run([
        _FakeProc(0, _judge_json({"f1": 1, "f2": 0})),
        _FakeProc(1, "", "boom"),
        _FakeProc(1, "", "boom"),
        _FakeProc(1, "", "boom"),
        _FakeProc(1, "", "boom"),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)

    verdicts = g.pollution_layer_b_dual("agent output", FACTS)

    assert verdicts[0].codex is True
    assert verdicts[0].gemini is None
    assert verdicts[0].uncertain is True
    assert verdicts[0].leaked is False


def test_pollution_b_judge_returns_garbage_marks_uncertain(monkeypatch):
    """rc=0 + unparseable stdout is NOT a CLI failure (no retry); parse → None."""
    fake, _ = _scripted_run([
        _FakeProc(0, "not a json"),               # codex
        _FakeProc(0, _judge_json({"f1": 0, "f2": 0})),  # gemini parses cleanly
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)

    verdicts = g.pollution_layer_b_dual("output", FACTS)

    assert verdicts[0].codex is None       # garbage → None
    assert verdicts[0].gemini is False     # parsed 0
    assert verdicts[0].uncertain is True   # one None → uncertain
    assert verdicts[0].leaked is False


def test_pollution_b_returns_one_verdict_per_fact(monkeypatch):
    fake, _ = _scripted_run([
        _FakeProc(0, _judge_json({"f1": 0, "f2": 0})),
        _FakeProc(0, _judge_json({"f1": 0, "f2": 0})),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)
    verdicts = g.pollution_layer_b_dual("x", FACTS)
    assert len(verdicts) == len(FACTS)


# ─── loss Layer C — dual judges ──────────────────────────────────────────────


def test_loss_c_both_judges_say_correct(monkeypatch):
    fake, _ = _scripted_run([
        _FakeProc(0, "1"),
        _FakeProc(0, "1"),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)

    verdict = g.loss_layer_c_dual("Q?", "Project Xenon", "the xenon effort")
    assert verdict.recall == 1
    assert verdict.uncertain is False
    assert verdict.codex_correct is True
    assert verdict.gemini_correct is True


def test_loss_c_both_judges_say_wrong(monkeypatch):
    fake, _ = _scripted_run([
        _FakeProc(0, "0"),
        _FakeProc(0, "0"),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)
    verdict = g.loss_layer_c_dual("Q?", "Xenon", "completely unrelated")
    assert verdict.recall == 0
    assert verdict.uncertain is False


def test_loss_c_disagree_marks_uncertain_recall_zero(monkeypatch):
    fake, _ = _scripted_run([
        _FakeProc(0, "1"),
        _FakeProc(0, "0"),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)
    verdict = g.loss_layer_c_dual("Q?", "Xenon", "the xenon effort")
    assert verdict.recall == 0
    assert verdict.uncertain is True


def test_loss_c_one_judge_fails_marks_uncertain(monkeypatch):
    fake, _ = _scripted_run([
        _FakeProc(0, "1"),
        _FakeProc(1, "", "boom"),
        _FakeProc(1, "", "boom"),
        _FakeProc(1, "", "boom"),
        _FakeProc(1, "", "boom"),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)
    verdict = g.loss_layer_c_dual("Q?", "Xenon", "xenon")
    assert verdict.codex_correct is True
    assert verdict.gemini_correct is None
    assert verdict.uncertain is True
    assert verdict.recall == 0


def test_loss_c_judge_response_normalised(monkeypatch):
    """Judge may answer '1' or '1\\n' or 'Answer: 1' — accept clean digit only at start."""
    fake, _ = _scripted_run([
        _FakeProc(0, "1\n"),
        _FakeProc(0, "  1  "),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)
    verdict = g.loss_layer_c_dual("Q?", "x", "x")
    assert verdict.recall == 1


# ─── retry / backoff / timeout ───────────────────────────────────────────────


def test_judge_cli_retries_on_transient_failure(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(g.time, "sleep", lambda s: sleeps.append(s))
    fake, _ = _scripted_run([
        _FakeProc(1, "", "transient"),
        _FakeProc(0, "ok"),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)

    out = g._judge_cli("codex", "prompt")
    assert out == "ok"
    assert len(sleeps) == 1  # one back-off between attempt 0 and 1


def test_judge_cli_uses_60s_cooloff_on_rate_limit(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(g.time, "sleep", lambda s: sleeps.append(s))
    fake, _ = _scripted_run([
        _FakeProc(1, "", "Error: HTTP 429 rate_limit exceeded"),
        _FakeProc(0, "ok"),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)
    out = g._judge_cli("gemini", "prompt")
    assert out == "ok"
    assert sleeps == [60]


def test_judge_cli_returns_none_after_max_retries(monkeypatch):
    fake, _ = _scripted_run([
        _FakeProc(1, "", "fail"),
        _FakeProc(1, "", "fail"),
        _FakeProc(1, "", "fail"),
        _FakeProc(1, "", "fail"),  # 1 initial + 3 retries = 4 total
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)
    assert g._judge_cli("codex", "prompt") is None


def test_judge_cli_treats_timeout_as_retryable(monkeypatch):
    fake, _ = _scripted_run([
        subprocess.TimeoutExpired(cmd=["codex"], timeout=30),
        _FakeProc(0, "ok"),
    ])
    monkeypatch.setattr(g.subprocess, "run", fake)
    assert g._judge_cli("codex", "prompt") == "ok"


def test_judge_cli_passes_30s_timeout_to_subprocess(monkeypatch):
    fake, calls = _scripted_run([_FakeProc(0, "ok")])
    monkeypatch.setattr(g.subprocess, "run", fake)
    g._judge_cli("codex", "prompt")
    assert calls[0]["timeout"] == 30


def test_judge_cli_handles_missing_binary(monkeypatch):
    """If the CLI binary isn't on PATH, _judge_cli must not raise — return None."""
    fake, _ = _scripted_run([FileNotFoundError("codex")] * 4)
    monkeypatch.setattr(g.subprocess, "run", fake)
    assert g._judge_cli("codex", "prompt") is None


def test_judge_cli_unknown_family_raises(monkeypatch):
    with pytest.raises(ValueError):
        g._judge_cli("anthropic", "prompt")
