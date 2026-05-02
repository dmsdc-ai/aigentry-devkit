"""Tests for bin/lint-formatting-exemption.py (ADR 2026-05-02 §2.4.3).

Each test constructs a minimal synthetic grader file + registry + smoke input
in tmp_path, then invokes the lint script as a subprocess. This exercises the
script end-to-end (AST + smoke + JSON inspection) without depending on the
real grader being patched.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
LINT_PATH = REPO_ROOT / "bin" / "lint-formatting-exemption.py"


def _load_lint_module():
    spec = importlib.util.spec_from_file_location("lint_formatting_exemption", LINT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["lint_formatting_exemption"] = module
    spec.loader.exec_module(module)
    return module


lint = _load_lint_module()


# ─── helpers ─────────────────────────────────────────────────────────────────

def _make_grader_file(
    tmp_path: Path,
    *,
    status: str = "implemented",
    canonicalizer: str | None = "_canonicalize_tool_call",
    variants: list[str] | None = None,
    tests: list[str] | None = None,
    define_canonicalizer: bool = True,
) -> Path:
    """Build a tiny synthetic grader file with PRIMARY_GRADERS dict for fixture X."""
    if status == "implemented":
        if variants is None:
            variants = ["wrapped", "unwrapped"]
        if tests is None:
            tests = ["test_canonicalize_tool_call"]
    else:
        if variants is None:
            variants = []
        if tests is None:
            tests = []

    if canonicalizer and define_canonicalizer:
        canon_def = f"def {canonicalizer}(text):\n    return text\n"
    else:
        canon_def = ""

    src = f'''import argparse
import json
import sys
from pathlib import Path


{canon_def}
def score_fixture_x(agent_output, ground_truth):
    return {{
        "primary_pass": True,
        "primary_score": 1.0,
        "formatting_exempt_status": {status!r},
        "formatting_exempt_canonicalizer": {canonicalizer!r},
        "formatting_exempt_variants": {variants!r},
        "formatting_exempt_tests": {tests!r},
        "formatting_exempt_rule_adr": "2026-05-02-output-style-fixture-design-rule",
    }}


PRIMARY_GRADERS: dict[str, "callable"] = {{
    "X": score_fixture_x,
}}


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd")
    sf = sub.add_parser("score-fixture")
    sf.add_argument("--fixture", required=True)
    sf.add_argument("--output", required=True)
    sf.add_argument("--ground-truth", required=True)
    args = p.parse_args()
    if args.cmd == "score-fixture":
        out = Path(args.output).read_text()
        gt = json.loads(Path(args.ground_truth).read_text())
        print(json.dumps(PRIMARY_GRADERS[args.fixture](out, gt)))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
'''
    grader = tmp_path / "fake-grader.py"
    grader.write_text(src)
    return grader


def _make_grader_no_field(tmp_path: Path) -> Path:
    """Grader that emits no formatting_exempt_status field at all."""
    src = '''import argparse
import json
import sys
from pathlib import Path


def score_fixture_x(o, g):
    return {"primary_pass": True, "primary_score": 1.0}


PRIMARY_GRADERS = {"X": score_fixture_x}


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd")
    sf = sub.add_parser("score-fixture")
    sf.add_argument("--fixture", required=True)
    sf.add_argument("--output", required=True)
    sf.add_argument("--ground-truth", required=True)
    args = p.parse_args()
    if args.cmd == "score-fixture":
        print(json.dumps(PRIMARY_GRADERS[args.fixture](None, None)))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
'''
    grader = tmp_path / "fake-grader.py"
    grader.write_text(src)
    return grader


def _make_registry(tmp_path: Path, entries: list[dict]) -> Path:
    reg = tmp_path / "registry.json"
    reg.write_text(json.dumps({
        "schema_version": "1",
        "rule_adr": "2026-05-02-output-style-fixture-design-rule",
        "entries": entries,
    }))
    return reg


def _make_smoke(tmp_path: Path, fixture_id: str = "X", payload: dict | None = None) -> Path:
    smoke_dir = tmp_path / "lint-smoke"
    smoke_dir.mkdir(exist_ok=True)
    (smoke_dir / f"{fixture_id}.json").write_text(json.dumps(payload or {
        "agent_output": "hello",
        "ground_truth": {},
    }))
    return smoke_dir


def _make_tests_dir(tmp_path: Path, test_names: list[str]) -> Path:
    td = tmp_path / "tests"
    td.mkdir(exist_ok=True)
    if test_names:
        body = "\n".join(f"def {n}():\n    pass" for n in test_names)
    else:
        body = "# no tests\n"
    (td / "test_synthetic.py").write_text(body)
    return td


def _grandfathered_entry(fixture_id: str = "X", *,
                         status: str = "grandfathered",
                         expiry: str = "2026-08-01",
                         lint_allow: bool = True) -> dict:
    return {
        "fixture_id": fixture_id,
        "fixture_slug": "demo-fixture",
        "status": status,
        "grader_path": "bin/exec-mode-grader.py",
        "pre_patch_grader_sha": None,
        "rationale": "synthetic test entry",
        "expiry": expiry,
        "tracking_ticket": "task-#test",
        "approving_session": "test",
        "migration_commit": None,
        "lint_allow_status_grandfathered": lint_allow,
    }


def _run_lint(grader: Path, registry: Path, smoke_dir: Path, test_dir: Path,
              today: str = "2026-05-02", extra: list[str] | None = None) -> tuple[int, dict]:
    cmd = [
        sys.executable, str(LINT_PATH),
        "--grader-file", str(grader),
        "--registry", str(registry),
        "--smoke-dir", str(smoke_dir),
        "--test-dir", str(test_dir),
        "--today", today,
        "--json",
    ]
    if extra:
        cmd.extend(extra)
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError:
        payload = {"_raw_stdout": proc.stdout, "_stderr": proc.stderr}
    return proc.returncode, payload


def _fails_for(payload: dict, check: str) -> list[dict]:
    return [r for r in payload.get("results", [])
            if r["check"] == check and not r["passed"]]


# ─── unit tests for pure helpers ─────────────────────────────────────────────

def test_discover_primary_graders_handles_annotated_assign(tmp_path):
    grader = _make_grader_file(tmp_path)
    out = lint.discover_primary_graders(grader)
    assert out == {"X": "score_fixture_x"}


def test_collect_test_names_walks_subdirs(tmp_path):
    td = tmp_path / "tests"
    sub = td / "exec-mode"
    sub.mkdir(parents=True)
    (sub / "test_a.py").write_text("def test_alpha():\n    pass\n")
    (td / "test_b.py").write_text("def test_beta():\n    pass\ndef helper():\n    pass\n")
    names = lint.collect_test_names(td)
    assert "test_alpha" in names
    assert "test_beta" in names
    assert "helper" not in names


def test_load_registry_missing_file_is_empty(tmp_path):
    out, err = lint.load_registry(tmp_path / "nope.json")
    assert out == {}
    assert err is None


def test_load_registry_malformed_returns_error(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{not json")
    out, err = lint.load_registry(p)
    assert out == {}
    assert err is not None and "not valid JSON" in err


def test_parse_iso_date_rejects_garbage():
    assert lint.parse_iso_date("2026-13-99") is None
    assert lint.parse_iso_date(None) is None
    assert lint.parse_iso_date("not-a-date") is None
    assert lint.parse_iso_date("2026-05-02").isoformat() == "2026-05-02"


# ─── end-to-end: each of the 4 checks ────────────────────────────────────────

def test_happy_path_implemented(tmp_path):
    grader = _make_grader_file(tmp_path)
    registry = _make_registry(tmp_path, [])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, ["test_canonicalize_tool_call"])
    rc, payload = _run_lint(grader, registry, smoke, tests)
    assert rc == 0, payload
    assert payload["all_passed"] is True
    assert payload["n_failed"] == 0


def test_check1_field_missing(tmp_path):
    grader = _make_grader_no_field(tmp_path)
    registry = _make_registry(tmp_path, [])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, [])
    rc, payload = _run_lint(grader, registry, smoke, tests)
    assert rc == 1
    assert _fails_for(payload, "field_emission")


def test_check1_invalid_enum(tmp_path):
    grader = _make_grader_file(tmp_path, status="bogus")
    registry = _make_registry(tmp_path, [])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, ["test_canonicalize_tool_call"])
    rc, payload = _run_lint(grader, registry, smoke, tests)
    assert rc == 1
    fails = _fails_for(payload, "field_emission")
    assert fails and "bogus" in fails[0]["message"]


def test_check2_canonicalizer_function_missing(tmp_path):
    # Emit an implemented status with a canonicalizer name that isn't defined
    grader = _make_grader_file(
        tmp_path,
        canonicalizer="_does_not_exist",
        define_canonicalizer=False,
    )
    registry = _make_registry(tmp_path, [])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, ["test_canonicalize_tool_call"])
    rc, payload = _run_lint(grader, registry, smoke, tests)
    assert rc == 1
    fails = _fails_for(payload, "companion_consistency")
    assert fails and "_does_not_exist" in fails[0]["message"]


def test_check2_named_test_missing(tmp_path):
    grader = _make_grader_file(tmp_path, tests=["test_no_such_thing"])
    registry = _make_registry(tmp_path, [])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, [])  # no matching tests
    rc, payload = _run_lint(grader, registry, smoke, tests)
    assert rc == 1
    fails = _fails_for(payload, "companion_consistency")
    assert fails and "test_no_such_thing" in fails[0]["message"]


def test_check2_implemented_with_empty_variants_fails(tmp_path):
    grader = _make_grader_file(tmp_path, variants=[])
    registry = _make_registry(tmp_path, [])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, ["test_canonicalize_tool_call"])
    rc, payload = _run_lint(grader, registry, smoke, tests)
    assert rc == 1
    fails = _fails_for(payload, "companion_consistency")
    assert fails and "variants" in fails[0]["message"]


def test_check3_grandfathered_with_active_registry_passes(tmp_path):
    grader = _make_grader_file(
        tmp_path, status="grandfathered",
        canonicalizer=None, variants=[], tests=[],
        define_canonicalizer=False,
    )
    registry = _make_registry(tmp_path, [_grandfathered_entry()])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, [])
    rc, payload = _run_lint(grader, registry, smoke, tests, today="2026-05-02")
    assert rc == 0, payload


def test_check3_grandfathered_expired_fails(tmp_path):
    grader = _make_grader_file(
        tmp_path, status="grandfathered",
        canonicalizer=None, variants=[], tests=[],
        define_canonicalizer=False,
    )
    registry = _make_registry(tmp_path, [_grandfathered_entry(expiry="2026-04-01")])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, [])
    rc, payload = _run_lint(grader, registry, smoke, tests, today="2026-05-02")
    assert rc == 1
    fails = _fails_for(payload, "registry_grandfathered")
    assert fails and "past" in fails[0]["message"]


def test_check3_grandfathered_lint_allow_false_fails(tmp_path):
    grader = _make_grader_file(
        tmp_path, status="grandfathered",
        canonicalizer=None, variants=[], tests=[],
        define_canonicalizer=False,
    )
    registry = _make_registry(tmp_path, [
        _grandfathered_entry(status="pending-migration", lint_allow=False),
    ])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, [])
    rc, payload = _run_lint(grader, registry, smoke, tests)
    assert rc == 1
    assert _fails_for(payload, "registry_grandfathered")


def test_check4_new_fixture_grandfathered_blocked(tmp_path):
    grader = _make_grader_file(
        tmp_path, status="grandfathered",
        canonicalizer=None, variants=[], tests=[],
        define_canonicalizer=False,
    )
    registry = _make_registry(tmp_path, [])  # no entry for X → NEW
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, [])
    rc, payload = _run_lint(grader, registry, smoke, tests)
    assert rc == 1
    assert _fails_for(payload, "new_fixture_hard_block")


def test_not_applicable_passes(tmp_path):
    grader = _make_grader_file(
        tmp_path, status="not_applicable",
        canonicalizer=None, variants=[], tests=[],
        define_canonicalizer=False,
    )
    registry = _make_registry(tmp_path, [])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, [])
    rc, payload = _run_lint(grader, registry, smoke, tests)
    assert rc == 0, payload


def test_smoke_input_missing_fails_closed(tmp_path):
    grader = _make_grader_file(tmp_path)
    registry = _make_registry(tmp_path, [])
    smoke_dir = tmp_path / "lint-smoke"
    smoke_dir.mkdir()  # exists but empty — no X.json
    tests = _make_tests_dir(tmp_path, ["test_canonicalize_tool_call"])
    rc, payload = _run_lint(grader, registry, smoke_dir, tests)
    assert rc == 1
    fails = _fails_for(payload, "field_emission")
    assert fails and "smoke input missing" in fails[0]["message"]


def test_meta_failure_when_grader_file_missing(tmp_path):
    registry = _make_registry(tmp_path, [])
    smoke = _make_smoke(tmp_path)
    tests = _make_tests_dir(tmp_path, [])
    rc, payload = _run_lint(tmp_path / "nonexistent.py", registry, smoke, tests)
    assert rc == 1
    assert any(r["fixture_id"] == "(meta)" and not r["passed"]
               for r in payload.get("results", []))
