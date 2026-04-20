"""Shared pytest fixtures for tests/exec-mode/.

The grader lives at bin/exec-mode-grader.py (hyphen per build spec §3), so we
load it via importlib rather than a plain `import` — file name isn't a valid
Python module identifier. The loaded module is registered as
`exec_mode_grader` in sys.modules so test files can `import exec_mode_grader`.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
BIN_DIR = REPO_ROOT / "bin"
FIXTURE_DIR = Path(__file__).parent / "fixtures"
GRADER_PATH = BIN_DIR / "exec-mode-grader.py"


def _load_grader():
    spec = importlib.util.spec_from_file_location("exec_mode_grader", GRADER_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["exec_mode_grader"] = module
    spec.loader.exec_module(module)
    return module


if GRADER_PATH.exists() and "exec_mode_grader" not in sys.modules:
    _load_grader()


@pytest.fixture
def fixture_dir() -> Path:
    return FIXTURE_DIR


@pytest.fixture
def repo_root() -> Path:
    return REPO_ROOT


@pytest.fixture
def grader_path() -> Path:
    return GRADER_PATH
