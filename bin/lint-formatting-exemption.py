#!/usr/bin/env python3
"""Pre-tag lint for output-style fixture-design rule.

Implements ADR 2026-05-02-output-style-fixture-design-rule §2.4.3 four checks:

  1. Field emission       — smoke `score-fixture` run; result must contain
                            `formatting_exempt_status` ∈ {implemented,
                            not_applicable, grandfathered}.
  2. Companion consistency — for `implemented`: canonicalizer + variants +
                            tests non-empty AND canonicalizer function exists
                            in grader source (AST) AND named tests exist
                            (AST walk on test_*.py).
  3. Registry consistency — for `grandfathered`: trial fixture_id has an
                            active (non-expired) entry in the JSON registry
                            with status ∈ {grandfathered, pending-migration}
                            AND lint_allow_status_grandfathered is true.
  4. NEW-fixture hard block — fixture has NO registry entry → status
                            MUST be `implemented` or `not_applicable`;
                            `grandfathered` is forbidden.

Exit 0 = all pass; non-zero = at least one violation. Fail-closed.

Article 17 무의존: Python stdlib only (ast, json, pathlib, subprocess,
argparse). Registry is JSON, not YAML — no PyYAML dependency.
"""
from __future__ import annotations

import argparse
import ast
import json
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any


VALID_STATUSES = {"implemented", "not_applicable", "grandfathered"}
REGISTRY_OK_FOR_GRANDFATHERED = {"grandfathered", "pending-migration"}
RULE_ADR_ID = "2026-05-02-output-style-fixture-design-rule"

REPO_ROOT = Path(__file__).resolve().parents[1]


# ─── data ────────────────────────────────────────────────────────────────────

@dataclass
class CheckResult:
    fixture_id: str
    check: str
    passed: bool
    message: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "fixture_id": self.fixture_id,
            "check": self.check,
            "passed": self.passed,
            "message": self.message,
        }


@dataclass
class LintReport:
    results: list[CheckResult] = field(default_factory=list)

    def add(self, fixture_id: str, check: str, passed: bool, message: str) -> None:
        self.results.append(CheckResult(fixture_id, check, passed, message))

    @property
    def all_passed(self) -> bool:
        return bool(self.results) and all(r.passed for r in self.results)

    @property
    def n_passed(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def n_failed(self) -> int:
        return sum(1 for r in self.results if not r.passed)


# ─── AST + filesystem helpers ────────────────────────────────────────────────

def discover_primary_graders(grader_file: Path) -> dict[str, str]:
    """AST-parse grader file; return {fixture_id: grader_function_name}.

    Handles both `PRIMARY_GRADERS = {...}` (Assign) and
    `PRIMARY_GRADERS: dict[...] = {...}` (AnnAssign). The actual file uses
    AnnAssign with a string-quoted "callable" annotation.
    """
    if not grader_file.exists():
        raise FileNotFoundError(f"grader file not found: {grader_file}")
    tree = ast.parse(grader_file.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        value = None
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "PRIMARY_GRADERS":
                    value = node.value
                    break
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id == "PRIMARY_GRADERS":
                value = node.value
        if value is None:
            continue
        if not isinstance(value, ast.Dict):
            raise ValueError("PRIMARY_GRADERS is not a dict literal")
        result: dict[str, str] = {}
        for k, v in zip(value.keys, value.values):
            if isinstance(k, ast.Constant) and isinstance(v, ast.Name):
                result[k.value] = v.id
        return result
    raise ValueError("PRIMARY_GRADERS not found in grader file")


def collect_function_names(source_file: Path) -> set[str]:
    """Walk all FunctionDef / AsyncFunctionDef nodes; return their names."""
    if not source_file.exists():
        return set()
    tree = ast.parse(source_file.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
    return names


def collect_test_names(test_dir: Path) -> set[str]:
    """Walk test_dir for test_*.py; collect every `def test_*` name."""
    names: set[str] = set()
    if not test_dir.exists():
        return names
    for path in test_dir.rglob("test_*.py"):
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError, OSError):
            continue
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name.startswith("test_"):
                names.add(node.name)
    return names


def load_registry(path: Path) -> tuple[dict[str, dict], str | None]:
    """Load registry; return ({fixture_id: entry}, error_or_none).

    Missing file → ({}, None) — lint check 4 will treat all fixtures as NEW.
    Malformed JSON → ({}, "<message>") — caller surfaces as a meta failure.
    """
    if not path.exists():
        return {}, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return {}, f"registry {path} is not valid JSON: {e}"
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        return {}, f"registry {path} missing top-level 'entries' list"
    out: dict[str, dict] = {}
    for entry in data["entries"]:
        if not isinstance(entry, dict):
            continue
        fid = entry.get("fixture_id")
        if isinstance(fid, str):
            out[fid] = entry
    return out, None


def parse_iso_date(s: Any) -> date | None:
    if not isinstance(s, str):
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


# ─── smoke run ───────────────────────────────────────────────────────────────

def smoke_run_grader(
    grader_file: Path,
    fixture_id: str,
    smoke_input: dict,
    python: str,
    timeout: float = 60.0,
) -> tuple[bool, str, dict]:
    """Invoke `score-fixture` CLI on canned input; parse stdout JSON."""
    agent_output = smoke_input.get("agent_output", "")
    if not isinstance(agent_output, str):
        agent_output = json.dumps(agent_output)
    ground_truth = smoke_input.get("ground_truth", {})
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        out_path = td_path / "output.txt"
        gt_path = td_path / "ground_truth.json"
        out_path.write_text(agent_output, encoding="utf-8")
        gt_path.write_text(json.dumps(ground_truth), encoding="utf-8")
        cmd = [
            python, str(grader_file), "score-fixture",
            "--fixture", fixture_id,
            "--output", str(out_path),
            "--ground-truth", str(gt_path),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return False, f"smoke run timed out ({timeout}s)", {}
        except FileNotFoundError as e:
            return False, f"failed to invoke grader: {e}", {}
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout).strip().splitlines()
            tail_msg = " | ".join(tail[-3:])[:400]
            return False, f"grader exit {proc.returncode}: {tail_msg}", {}
        try:
            result = json.loads(proc.stdout)
        except json.JSONDecodeError as e:
            return False, f"grader stdout not JSON: {e}", {}
        if not isinstance(result, dict):
            return False, "grader returned non-dict", {}
        return True, "smoke run ok", result


# ─── 4 checks ────────────────────────────────────────────────────────────────

def check_field_emission(fixture_id: str, grader_result: dict) -> CheckResult:
    """Check 1: formatting_exempt_status present + valid enum value."""
    status = grader_result.get("formatting_exempt_status")
    if status is None:
        return CheckResult(
            fixture_id, "field_emission", False,
            "formatting_exempt_status missing from grader return dict",
        )
    if status not in VALID_STATUSES:
        return CheckResult(
            fixture_id, "field_emission", False,
            f"formatting_exempt_status={status!r} not in {sorted(VALID_STATUSES)}",
        )
    return CheckResult(
        fixture_id, "field_emission", True,
        f"status={status!r}",
    )


def check_companion_consistency(
    fixture_id: str,
    grader_result: dict,
    grader_function_names: set[str],
    test_function_names: set[str],
) -> CheckResult:
    """Check 2: implemented => canonicalizer + variants + tests + AST presence."""
    status = grader_result.get("formatting_exempt_status")
    if status != "implemented":
        return CheckResult(
            fixture_id, "companion_consistency", True,
            f"status={status!r} — companion sub-checks skipped",
        )

    canonicalizer = grader_result.get("formatting_exempt_canonicalizer")
    variants = grader_result.get("formatting_exempt_variants")
    tests = grader_result.get("formatting_exempt_tests")
    problems: list[str] = []

    if not isinstance(canonicalizer, str) or not canonicalizer:
        problems.append("canonicalizer is null/empty")
    elif canonicalizer not in grader_function_names:
        problems.append(f"canonicalizer {canonicalizer!r} not defined in grader source")

    if not isinstance(variants, list) or not variants:
        problems.append("variants empty/missing")

    if not isinstance(tests, list) or not tests:
        problems.append("tests empty/missing")
    else:
        missing = [t for t in tests if not isinstance(t, str) or t not in test_function_names]
        if missing:
            problems.append(f"tests not found in test source: {missing}")

    if problems:
        return CheckResult(
            fixture_id, "companion_consistency", False,
            "; ".join(problems),
        )
    return CheckResult(
        fixture_id, "companion_consistency", True,
        f"canonicalizer={canonicalizer!r} variants={len(variants)} tests={len(tests)}",
    )


def check_registry_grandfathered(
    fixture_id: str,
    grader_result: dict,
    registry: dict[str, dict],
    today: date,
) -> CheckResult:
    """Check 3: grandfathered => active registry entry with lint_allow flag."""
    status = grader_result.get("formatting_exempt_status")
    if status != "grandfathered":
        return CheckResult(
            fixture_id, "registry_grandfathered", True,
            f"status={status!r} — registry check skipped",
        )
    entry = registry.get(fixture_id)
    if entry is None:
        return CheckResult(
            fixture_id, "registry_grandfathered", False,
            f"fixture_id {fixture_id!r} has no registry entry; grandfathered forbidden",
        )
    entry_status = entry.get("status")
    if entry_status not in REGISTRY_OK_FOR_GRANDFATHERED:
        return CheckResult(
            fixture_id, "registry_grandfathered", False,
            f"registry status {entry_status!r} not in {sorted(REGISTRY_OK_FOR_GRANDFATHERED)}",
        )
    if not entry.get("lint_allow_status_grandfathered", False):
        return CheckResult(
            fixture_id, "registry_grandfathered", False,
            f"registry lint_allow_status_grandfathered=false for {fixture_id}",
        )
    expiry_raw = entry.get("expiry")
    if expiry_raw is not None:
        expiry = parse_iso_date(expiry_raw)
        if expiry is None:
            return CheckResult(
                fixture_id, "registry_grandfathered", False,
                f"registry expiry {expiry_raw!r} is not ISO YYYY-MM-DD",
            )
        if today > expiry:
            return CheckResult(
                fixture_id, "registry_grandfathered", False,
                f"registry expiry {expiry.isoformat()} past (today {today.isoformat()})",
            )
    return CheckResult(
        fixture_id, "registry_grandfathered", True,
        f"registry entry active (expiry={expiry_raw})",
    )


def check_new_fixture_hard_block(
    fixture_id: str,
    grader_result: dict,
    registry: dict[str, dict],
) -> CheckResult:
    """Check 4: NEW (no registry entry) => status MUST NOT be grandfathered."""
    if fixture_id in registry:
        return CheckResult(
            fixture_id, "new_fixture_hard_block", True,
            "fixture has registry entry — not NEW",
        )
    status = grader_result.get("formatting_exempt_status")
    if status == "grandfathered":
        return CheckResult(
            fixture_id, "new_fixture_hard_block", False,
            f"NEW fixture {fixture_id!r} cannot use grandfathered (no registry entry)",
        )
    return CheckResult(
        fixture_id, "new_fixture_hard_block", True,
        f"NEW fixture status={status!r} ok",
    )


# ─── orchestration ───────────────────────────────────────────────────────────

def lint_fixture(
    *,
    fixture_id: str,
    grader_file: Path,
    grader_function_names: set[str],
    test_function_names: set[str],
    registry: dict[str, dict],
    smoke_dir: Path,
    today: date,
    python: str,
) -> list[CheckResult]:
    smoke_path = smoke_dir / f"{fixture_id}.json"
    if not smoke_path.exists():
        return [CheckResult(
            fixture_id, "field_emission", False,
            f"smoke input missing: {smoke_path}",
        )]
    try:
        smoke_input = json.loads(smoke_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return [CheckResult(
            fixture_id, "field_emission", False,
            f"smoke input not JSON: {e}",
        )]
    ok, msg, grader_result = smoke_run_grader(grader_file, fixture_id, smoke_input, python)
    if not ok:
        return [CheckResult(
            fixture_id, "field_emission", False,
            f"smoke run failed: {msg}",
        )]
    results = [check_field_emission(fixture_id, grader_result)]
    if not results[-1].passed:
        return results
    results.append(check_companion_consistency(
        fixture_id, grader_result, grader_function_names, test_function_names,
    ))
    results.append(check_registry_grandfathered(fixture_id, grader_result, registry, today))
    results.append(check_new_fixture_hard_block(fixture_id, grader_result, registry))
    return results


def run_lint(args: argparse.Namespace) -> LintReport:
    grader_file = Path(args.grader_file).resolve()
    registry_path = Path(args.registry).resolve()
    smoke_dir = Path(args.smoke_dir).resolve()
    test_dir = Path(args.test_dir).resolve()

    if args.today:
        today = parse_iso_date(args.today)
        if today is None:
            raise ValueError(f"--today {args.today!r} is not ISO YYYY-MM-DD")
    else:
        today = date.today()

    report = LintReport()

    try:
        graders = discover_primary_graders(grader_file)
    except (FileNotFoundError, ValueError) as e:
        report.add("(meta)", "discover_graders", False, str(e))
        return report

    if args.fixture:
        wanted = set(args.fixture)
        graders = {fid: fn for fid, fn in graders.items() if fid in wanted}
        if not graders:
            report.add("(meta)", "discover_graders", False,
                       f"no graders matched --fixture {sorted(wanted)}")
            return report

    registry, reg_err = load_registry(registry_path)
    if reg_err is not None:
        report.add("(meta)", "load_registry", False, reg_err)
        return report

    grader_function_names = collect_function_names(grader_file)
    test_function_names = collect_test_names(test_dir)

    python = args.python or sys.executable

    for fixture_id in sorted(graders):
        report.results.extend(lint_fixture(
            fixture_id=fixture_id,
            grader_file=grader_file,
            grader_function_names=grader_function_names,
            test_function_names=test_function_names,
            registry=registry,
            smoke_dir=smoke_dir,
            today=today,
            python=python,
        ))
    return report


# ─── output ──────────────────────────────────────────────────────────────────

def render_human(report: LintReport) -> str:
    lines: list[str] = []
    for r in report.results:
        marker = "[OK]  " if r.passed else "[FAIL]"
        lines.append(f"{marker} {r.fixture_id:<8} {r.check:<26} {r.message}")
    lines.append("")
    lines.append(
        f"Summary: {report.n_passed} passed, {report.n_failed} failed "
        f"(total {len(report.results)})  rule={RULE_ADR_ID}"
    )
    return "\n".join(lines)


def render_json(report: LintReport) -> str:
    return json.dumps({
        "rule_adr": RULE_ADR_ID,
        "all_passed": report.all_passed,
        "n_total": len(report.results),
        "n_passed": report.n_passed,
        "n_failed": report.n_failed,
        "results": [r.as_dict() for r in report.results],
    }, indent=2, sort_keys=True)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="lint-formatting-exemption",
        description=(
            "Pre-tag lint for ADR 2026-05-02-output-style-fixture-design-rule "
            "(§2.4.3). Verifies primary graders emit formatting_exempt_status "
            "with correct companion fields and registry consistency."
        ),
    )
    p.add_argument("--grader-file",
                   default=str(REPO_ROOT / "bin" / "exec-mode-grader.py"),
                   help="Path to the primary grader Python file.")
    p.add_argument("--registry",
                   default=str(REPO_ROOT / "state" / "fixtures" / "_exemption-registry.json"),
                   help="Path to the JSON exemption registry (§11).")
    p.add_argument("--smoke-dir",
                   default=str(REPO_ROOT / "tests" / "exec-mode" / "lint-smoke"),
                   help="Directory containing per-fixture smoke inputs (<fixture_id>.json).")
    p.add_argument("--test-dir",
                   default=str(REPO_ROOT / "tests"),
                   help="Directory walked for test_*.py files (AST companion check).")
    p.add_argument("--fixture", action="append", metavar="ID",
                   help="Limit lint to specific fixture ID(s); may repeat.")
    p.add_argument("--today", default=None, metavar="YYYY-MM-DD",
                   help="Override today's date for expiry comparison.")
    p.add_argument("--python", default=None,
                   help="Python interpreter for smoke run (default: sys.executable).")
    p.add_argument("--json", dest="json_output", action="store_true",
                   help="Emit JSON instead of human-readable lines.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = run_lint(args)
    except ValueError as e:
        print(f"[FAIL] config error: {e}", file=sys.stderr)
        return 1
    if args.json_output:
        print(render_json(report))
    else:
        print(render_human(report))
    return 0 if report.all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
