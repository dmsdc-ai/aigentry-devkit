"""T3 — loss_layer_a (exact) + loss_layer_b (rapidfuzz) edge cases (spec §5.4)."""
from __future__ import annotations

import exec_mode_grader as g


# ─── Layer A (exact match, case-insensitive on the expected keyword) ─────────

def test_loss_layer_a_exact_substring():
    assert g.loss_layer_a("Project Xenon", "we should keep Project Xenon running") is True


def test_loss_layer_a_case_insensitive():
    assert g.loss_layer_a("XENON", "the xenon project") is True


def test_loss_layer_a_miss():
    assert g.loss_layer_a("Xenon", "no mention here") is False


def test_loss_layer_a_empty_actual():
    assert g.loss_layer_a("anything", "") is False


# ─── Layer B (rapidfuzz partial_token_set_ratio) ─────────────────────────────

def test_loss_layer_b_paraphrase_above_threshold():
    # "Project Xenon" vs "the xenon effort" — planted keyword recalled.
    assert g.loss_layer_b("Project Xenon", "the xenon effort") is True


def test_loss_layer_b_rejects_below_threshold_0_79():
    assert g.loss_layer_b("Project Xenon", "completely unrelated text") is False


def test_loss_layer_b_threshold_boundary():
    """Threshold is exclusive-lower: ratio must be strictly > threshold."""
    # threshold=1.0 can never be exceeded (max ratio is 1.0).
    assert g.loss_layer_b("abc", "abc", threshold=1.0) is False
    assert g.loss_layer_b("Xenon", "xenon project", threshold=0.5) is True


def test_loss_layer_b_default_threshold_is_0_8():
    import inspect

    sig = inspect.signature(g.loss_layer_b)
    assert sig.parameters["threshold"].default == 0.8


def test_loss_layer_b_empty_inputs_do_not_crash():
    assert g.loss_layer_b("", "") is False
    assert g.loss_layer_b("x", "") is False
    assert g.loss_layer_b("", "x") is False
