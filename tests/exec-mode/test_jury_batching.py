"""T16 — 5-judge jury batching in deferred mode.

Per spec §5.2 v3-max.1:
  J1-J3: claude --print CLI, 3 different system prompts (anchored vs strict vs
         lenient) + randomized criteria order swap
  J4   : codex CLI
  J5   : gemini CLI (Gemini 2.5 Pro)
  Rubric: 5 criteria × 0..5 (correctness / completeness / efficiency / edge_case
          / style) — score = mean across criteria, normalised to 0..1
  Order swap: each judge prompt sent in two criterion orders → mean per judge
  Output length cap: agent_output > 2048 tokens → truncated + length_capped=True
  Disagreement: |primary - jury_mean| > 0.5 → human_review=True
Per build spec §7 T16:
  Deferred batch mode walks the state tree, writes metrics.jury.json next to
  each metrics.json. Skip trials with status != ok or pre-existing jury file.

All subprocess.run calls monkeypatched.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import exec_mode_grader as g


# ─── fake subprocess plumbing (same shape as test_grader_subprocess) ────────


class _FakeProc:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _scripted_run(script):
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
    monkeypatch.setattr(g.time, "sleep", lambda *_a, **_kw: None)


def _scores(c=4, comp=4, eff=4, ec=4, st=4) -> str:
    """Standard JSON judge response."""
    return json.dumps({
        "correctness": c, "completeness": comp, "efficiency": eff,
        "edge_case": ec, "style": st,
    })


def _ten_uniform(score=4):
    """10 identical CLI responses (5 judges × 2 orders)."""
    return [_FakeProc(0, _scores(score, score, score, score, score)) for _ in range(10)]


# ─── jury_score: judge fan-out + aggregation ────────────────────────────────


def test_jury_score_invokes_five_judges_in_two_orders(monkeypatch):
    fake, calls = _scripted_run(_ten_uniform(4))
    monkeypatch.setattr(g.subprocess, "run", fake)

    g.jury_score(transcript="t", agent_output="out")
    # 5 judges × 2 orders = 10 CLI invocations
    assert len(calls) == 10


def test_jury_score_uses_three_distinct_cli_families(monkeypatch):
    fake, calls = _scripted_run(_ten_uniform(4))
    monkeypatch.setattr(g.subprocess, "run", fake)

    g.jury_score(transcript="t", agent_output="out")
    families = {c["cmd"][0] for c in calls}
    assert families == {"claude", "codex", "gemini"}


def test_jury_score_aggregates_to_judge_mean_then_jury_mean(monkeypatch):
    # All 10 returns are uniform 4/5 = 0.8 → jury_mean = 0.8
    fake, _ = _scripted_run(_ten_uniform(4))
    monkeypatch.setattr(g.subprocess, "run", fake)

    result = g.jury_score(transcript="t", agent_output="out")
    assert len(result["judges"]) == 5
    for judge in result["judges"]:
        assert judge["mean_score"] == pytest.approx(0.8, abs=1e-9)
    assert result["jury_mean"] == pytest.approx(0.8, abs=1e-9)


def test_jury_score_each_judge_evaluates_in_two_orders(monkeypatch):
    fake, _ = _scripted_run(_ten_uniform(4))
    monkeypatch.setattr(g.subprocess, "run", fake)

    result = g.jury_score(transcript="t", agent_output="out")
    for judge in result["judges"]:
        orders = [e["order"] for e in judge["evaluations"]]
        assert sorted(orders) == ["forward", "reverse"]


def test_jury_score_handles_judge_failure_gracefully(monkeypatch):
    # J1 forward fails 4 times (1 + 3 retries), then everything succeeds.
    script = (
        [_FakeProc(1, "", "boom")] * 4   # J1 forward — exhausts retries
        + [_FakeProc(0, _scores())] * 9  # J1 reverse, J2..J5 × 2 orders
    )
    fake, _ = _scripted_run(script)
    monkeypatch.setattr(g.subprocess, "run", fake)

    result = g.jury_score(transcript="t", agent_output="out")
    j1 = next(j for j in result["judges"] if j["judge_id"] == "J1")
    # one of two evaluations should be parse_ok=False
    parse_ok_values = [e["parse_ok"] for e in j1["evaluations"]]
    assert parse_ok_values.count(False) == 1
    assert parse_ok_values.count(True) == 1
    # J1 mean uses only the successful evaluation; jury_mean still computed
    assert result["jury_mean"] is not None


def test_jury_score_truncates_long_agent_output(monkeypatch):
    fake, calls = _scripted_run(_ten_uniform(4))
    monkeypatch.setattr(g.subprocess, "run", fake)

    long_output = "word " * 5000  # 5000 whitespace tokens, well over 2048
    result = g.jury_score(transcript="t", agent_output=long_output, length_cap_tokens=2048)

    assert result["length_capped"] is True
    # the prompt sent to each judge must reflect truncation
    for c in calls:
        # codex/gemini commands have prompt as their last argument
        sent = c["cmd"][-1]
        assert "[truncated to" in sent or "[TRUNCATED]" in sent


def test_jury_score_does_not_truncate_when_under_cap(monkeypatch):
    fake, _ = _scripted_run(_ten_uniform(4))
    monkeypatch.setattr(g.subprocess, "run", fake)
    result = g.jury_score(transcript="t", agent_output="short output", length_cap_tokens=2048)
    assert result["length_capped"] is False


def test_jury_score_human_review_flag_when_disagreement_high(monkeypatch):
    # All judges return uniform 5/5 = 1.0 → jury_mean=1.0, primary=0.0
    # |1.0 - 0.0| = 1.0 > 0.5 → human_review=True
    fake, _ = _scripted_run(_ten_uniform(5))
    monkeypatch.setattr(g.subprocess, "run", fake)
    result = g.jury_score(transcript="t", agent_output="out", primary_score=0.0)
    assert result["human_review"] is True


def test_jury_score_human_review_false_when_agreement(monkeypatch):
    fake, _ = _scripted_run(_ten_uniform(4))  # 0.8
    monkeypatch.setattr(g.subprocess, "run", fake)
    result = g.jury_score(transcript="t", agent_output="out", primary_score=0.7)
    assert result["human_review"] is False


def test_jury_score_normalises_judge_response_with_prose(monkeypatch):
    response = (
        "Here is my evaluation:\n"
        + _scores(3, 4, 5, 2, 3)
        + "\n(scoring rationale omitted)"
    )
    fake, _ = _scripted_run([_FakeProc(0, response)] * 10)
    monkeypatch.setattr(g.subprocess, "run", fake)

    result = g.jury_score(transcript="t", agent_output="out")
    # mean of (3,4,5,2,3) = 17/5 / 5 = 0.68
    assert result["jury_mean"] == pytest.approx(0.68, abs=1e-9)


# ─── deferred batch walker ──────────────────────────────────────────────────


def _make_trial(state_root: Path, mode: str = "D", fixture: str = "Fa", seed: int = 0,
                status: str = "ok", agent_output: str = "x") -> Path:
    """Create a minimal trial dir with metrics.json + stage1_output."""
    seed_dir = state_root / "1" / mode / fixture / f"seed{seed:02d}"
    seed_dir.mkdir(parents=True, exist_ok=True)
    out_path = seed_dir / "stage1_output.txt"
    out_path.write_text(agent_output, encoding="utf-8")
    metrics = {
        "schema_version": "1",
        "trial_id": f"1/{mode}/{fixture}/seed{seed:02d}",
        "fixture_id": fixture,
        "mode": mode,
        "seed_idx": seed,
        "run_idx": 1,
        "status": status,
        "quality": {"primary": 0.7, "length_capped": False},
        "paths": {"stage1_output": "stage1_output.txt", "stage1_jsonl": "trial.jsonl"},
    }
    (seed_dir / "metrics.json").write_text(json.dumps(metrics), encoding="utf-8")
    return seed_dir


def test_run_deferred_walks_state_tree_and_writes_jury_files(monkeypatch, tmp_path):
    fake, _ = _scripted_run(_ten_uniform(4) * 2)  # 2 trials
    monkeypatch.setattr(g.subprocess, "run", fake)

    _make_trial(tmp_path, seed=0)
    _make_trial(tmp_path, seed=1)

    n = g.run_deferred(tmp_path)
    assert n == 2
    for seed in (0, 1):
        jury_path = tmp_path / "1" / "D" / "Fa" / f"seed{seed:02d}" / "metrics.jury.json"
        assert jury_path.exists()
        body = json.loads(jury_path.read_text(encoding="utf-8"))
        assert body["jury_mean"] == pytest.approx(0.8, abs=1e-9)
        assert body["trial_id"] == f"1/D/Fa/seed{seed:02d}"


def test_run_deferred_skips_trial_with_existing_jury_file(monkeypatch, tmp_path):
    seed_dir = _make_trial(tmp_path, seed=0)
    (seed_dir / "metrics.jury.json").write_text('{"trial_id":"existing","jury_mean":0.5}', encoding="utf-8")

    # No subprocess calls expected — if jury_score were called, _scripted_run([])
    # would AssertionError on the first invocation.
    fake, calls = _scripted_run([])
    monkeypatch.setattr(g.subprocess, "run", fake)

    n = g.run_deferred(tmp_path)
    assert n == 0
    assert calls == []


def test_run_deferred_skips_trial_with_status_not_ok(monkeypatch, tmp_path):
    _make_trial(tmp_path, seed=0, status="failed")
    fake, calls = _scripted_run([])
    monkeypatch.setattr(g.subprocess, "run", fake)

    n = g.run_deferred(tmp_path)
    assert n == 0


def test_run_deferred_writes_atomically(monkeypatch, tmp_path):
    """jury file must not appear half-written under any error."""
    fake, _ = _scripted_run(_ten_uniform(4))
    monkeypatch.setattr(g.subprocess, "run", fake)
    seed_dir = _make_trial(tmp_path, seed=0)

    g.run_deferred(tmp_path)

    jury_path = seed_dir / "metrics.jury.json"
    assert jury_path.exists()
    # must parse cleanly — atomic rename, no partial writes
    json.loads(jury_path.read_text(encoding="utf-8"))
    # tmp file must be gone
    assert not list(seed_dir.glob("metrics.jury.json.tmp*"))


# ─── CLI subcommand ─────────────────────────────────────────────────────────


def test_deferred_cli_subcommand(tmp_path):
    """End-to-end CLI: stub real CLI judges via EXEC_MODE_JURY_STUB=1.

    Doesn't monkeypatch subprocess because g.subprocess IS the global subprocess
    singleton — patching it would intercept the grader-launching subprocess.run
    call too. The env-var stub keeps the grader from invoking real claude/codex/
    gemini CLIs in the child interpreter.
    """
    _make_trial(tmp_path, seed=0)
    grader_path = Path(__file__).resolve().parents[2] / "bin" / "exec-mode-grader.py"
    env = {**__import__("os").environ, "EXEC_MODE_JURY_STUB": "1"}
    proc = subprocess.run(
        [sys.executable, str(grader_path), "deferred", "--state-root", str(tmp_path)],
        capture_output=True, text=True, timeout=10, check=False, env=env,
    )
    assert proc.returncode == 0, proc.stderr
    body = json.loads((tmp_path / "1" / "D" / "Fa" / "seed00" / "metrics.jury.json").read_text())
    assert "jury_mean" in body
    assert body["jury_mean"] == pytest.approx(0.8, abs=1e-9)  # stub returns 4/5
