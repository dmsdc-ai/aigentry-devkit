from __future__ import annotations

import exec_mode_grader as g


class _FakeProc:
    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _fake_curl_for_dispatch(cmd, *, capture_output=True, text=True, timeout=None, check=False, **_kw):
    url = cmd[-1]
    if "-I" in cmd:
        return _FakeProc(0, "HTTP/2 200\n", "")
    return _FakeProc(0, f"body for {url}", "")


def _cases():
    return {
        "F2": (
            g.score_f2_invariants,
            "old new mapping | Old section | CVE-2025-1234 ADR",
            {
                "fixture": "F2",
                "invariants_checklist": {"invariants": [{"id": "x", "regex_any_of": ["CVE-2025-1234"]}]},
                "output_structure_checks": {"must_contain_all": ["old", "new", "mapping"], "must_contain_any_of": [r"Old section"]},
                "primary_metric": {"pass_threshold": 0.5},
            },
        ),
        "F3": (
            g.score_f3_severity_f1,
            "| ID | Severity | File:Line | Issue | Recommendation |\n| A1 | Critical | x:5 | sql injection | fix |\nblock merge",
            {
                "fixture": "F3",
                "ground_truth_issues": [{"id": "A1", "severity": "Critical", "must_cite_line": 5, "match_regex_any_of": ["sql injection"]}],
                "severity_weights": {"Critical": 4.0, "Medium": 1.0},
                "secondary_signals": {
                    "table_format": {"regex_any_of": [r"\|\s*ID\s*\|"]},
                    "verdict_paragraph": {"regex_any_of": ["block"]},
                },
                "primary_metric": {"pass_threshold": 0.5},
            },
        ),
        "F4": (
            g.score_f4_oracle_graph,
            "crates/core/src/lib.rs crates/core/src/analyze.rs crates/ffi/src/lib.rs python/pkg/_bindings.py\n```mermaid\ngraph TD\ncrates/core/src/lib.rs -->|re-exports| crates/core/src/analyze.rs\n```\n```mermaid\ngraph TD\npython/pkg/_bindings.py -->|ffi| crates/ffi/src/lib.rs\n```\n```mermaid\ngraph TD\ncrates/ffi/src/lib.rs --> python/pkg/_bindings.py\n```",
            {
                "fixture": "F4",
                "oracle_graph": {
                    "nodes": ["crates/core/src/lib.rs", "crates/core/src/analyze.rs", "crates/ffi/src/lib.rs", "python/pkg/_bindings.py"],
                    "node_aliases": {},
                    "edges": [{"src": "crates/core/src/lib.rs", "dst": "crates/core/src/analyze.rs", "kind": "re-exports"}],
                },
                "output_format_checks": {
                    "mermaid_diagram_count_min": 3,
                    "mermaid_regex": r"```mermaid[\s\S]*?```",
                    "file_inventory_regex": [r"crates/core/src/lib\.rs"],
                    "ffi_boundary_regex": [r"crates/ffi/src/lib\.rs[\s\S]{0,120}python/pkg/_bindings\.py"],
                },
                "primary_metric": {"weights": {"node": 0.4, "edge": 0.5, "hallucination_penalty": 0.1}, "pass_threshold": 0.1},
            },
        ),
        "F5": (
            g.score_f5_citations,
            '## Executive Summary\nanalysis analysis analysis analysis analysis\n> "dispatch quote body for f5" - [Source](https://python.org/x)\n## Release Timeline\ntext\n## PEP Highlights\ntext\n## Breaking Change Review\ntext\n## Ecosystem Support\ntext\n## Recommendation\ntext\n## Sources\n- https://python.org/x',
            {
                "fixture": "F5",
                "word_count_bounds": {"min": 1, "max": 1000},
                "section_requirements": {
                    "required_heading_regex_any_of": [[r"Executive"], [r"Release"], [r"PEP"], [r"Breaking"], [r"Ecosystem"], [r"Recommendation"]]
                },
                "primary_source_allowlist": {"domains": ["python.org"], "blocklist_hint": ["medium.com"]},
                "citation_quota": {"min_primary_citations": 1},
                "sources_section_requirement": {"heading_regex": r"^##\s*Sources", "min_urls_in_section": 1},
                "primary_metric": {"pass_threshold": 0.1},
            },
        ),
        "F6": (
            g.score_f6_build_turns,
            "--- a/aigentry_config/loader.py\n+++ b/aigentry_config/loader.py\n@@\n-    return cfg.get('timeout', default=30)\n+    return cfg.get('timeout', 30)\nnext error",
            {
                "fixture": "F6",
                "stage1_fix_3_checks": {
                    "diff_format_regex": r"^---\s*a/aigentry_config/loader\.py",
                    "fix_content_regex_any_of": [r"cfg\.get\('timeout', 30\)"],
                    "must_not_contain_regex": [r"default\s*="],
                    "next_step_prediction_regex": r"next error",
                },
                "primary_metric": {"optimal_remaining_turns": 2, "max_turns": 10, "pass_threshold": 0.1},
            },
        ),
        "F7": (
            g.score_f7_latest_decision,
            "Option<User> Result<void, DbError> Turn 6 D3 Turn 8 D4 D2 superseded",
            {
                "fixture": "F7",
                "stage1_output_checks": {
                    "refactored_file_must_contain_regex_any_of": [r"Option<User>"],
                    "error_pattern_regex_any_of": [r"Result<"],
                    "banned_pattern_detect_regex": r"\bEither<",
                    "superseded_mention_regex_any_of": [r"D2.*supersed"],
                },
                "primary_metric": {
                    "latest_decision_correctness": {"component_weights": {"option_present": 0.4, "result_present": 0.4, "no_either": 0.2}},
                    "pass_threshold": 0.1,
                },
            },
        ),
        "F8": (
            g.score_f8_hidden_tests,
            "### src/ingest/validators.ts\n```ts\nexport function validateEmail(email: string): boolean { if (!email || email.length > 254) return false; return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email); }\nexport function validatePhone(phone: string): boolean { const digits = phone.replace(/\\D/g, ''); if (digits.length < 7 || digits.length > 15) return false; return true; }\n```\n### src/ingest/orders.ts\n```ts\nimport { validateEmail, validatePhone } from './validators'; export function validateOrderEmail(email: string): boolean { return validateEmail(email); } export function validateOrderPhone(phone: string): boolean { return validatePhone(phone); } export function ingestOrder(order: { email: string; phone: string }) { if (!validateOrderEmail(order.email)) throw new Error('bad_email'); if (!validateOrderPhone(order.phone)) throw new Error('bad_phone'); return order; }\n```\n### src/ingest/users.ts\n```ts\nimport { validateEmail, validatePhone } from './validators'; export function validateUserEmail(email: string): boolean { return validateEmail(email); } export function validateUserPhone(phone: string): boolean { return validatePhone(phone); } export function ingestUser(user: { email: string; phone: string }) { if (!validateUserEmail(user.email)) throw new Error('bad_email'); if (!validateUserPhone(user.phone)) throw new Error('bad_phone'); return user; }\n```\n### src/ingest/webhooks.ts\n```ts\nimport { validateEmail, validatePhone } from './validators'; export function validateWebhookEmail(email: string): boolean { return validateEmail(email); } export function validateWebhookPhone(phone: string): boolean { return validatePhone(phone); } export function ingestWebhook(webhook: { email: string; phone: string }) { if (!validateWebhookEmail(webhook.email)) throw new Error('bad_email'); if (!validateWebhookPhone(webhook.phone)) throw new Error('bad_phone'); return webhook; }\n```",
            {
                "fixture": "F8",
                "public_api_required_exports": {
                    "src/ingest/orders.ts": ["validateOrderEmail", "validateOrderPhone", "ingestOrder"],
                    "src/ingest/users.ts": ["validateUserEmail", "validateUserPhone", "ingestUser"],
                    "src/ingest/webhooks.ts": ["validateWebhookEmail", "validateWebhookPhone", "ingestWebhook"],
                },
                "hidden_regression_tests": {"test_cases": [{"kind": "i18n_email"}, {"kind": "bad_email_error"}]},
                "duplication_reduction_metric": {"baseline_duplicated_lines": 36},
                "test_edit_penalty": {"detect_regex_any_of": [r"describe\s*\("], "penalty_multiplier": 0.3},
                "primary_metric": {"pass_threshold": 0.1},
            },
        ),
        "F9": (
            g.score_f9_root_cause,
            "(a) missing CircuitOpenError in the catch path on Turn 5\n(b) off-by-one and overflow are not the cause\n(c)\n--- a/net/client.ts\n+++ b/net/client.ts\n+import { CircuitOpenError } from './errors'\n+if (e instanceof CircuitOpenError) {}",
            {
                "fixture": "F9",
                "true_root_cause": {"match_regex_any_of": [r"CircuitOpenError.*catch", r"missing.*CircuitOpenError"], "must_reference_turn_any_of": [5]},
                "canonical_fix": {
                    "diff_file_target_regex": r"a/net/client\.ts",
                    "fix_regex_any_of_in_diff": [r"CircuitOpenError.*from.*errors", r"instanceof\s+CircuitOpenError"],
                    "min_regex_matches": 2,
                },
                "wrong_root_cause_penalty": {"detect_regex_any_of": [r"root cause.*off[-\s]?by[-\s]?one"]},
                "primary_metric": {"pass_threshold": 0.1},
            },
        ),
        "F10": (
            g.score_f10_checklist,
            "(a) Status summary: ready.\n(b) Next actions\n- email validation from Turn 4\n- integration test fixture from Turn 2\n(c) Stale items rejected\n| # | Item | Status | Reason |\n| 1 | route | stale | already done |\n| 2 | schema | stale | A complete |\n| 4 | handler | stale | handler complete |",
            {
                "fixture": "F10",
                "hidden_unresolved_checklist": {
                    "items": [
                        {"id": "U1", "match_regex_any_of": [r"email\s*validation"], "must_reference_turn_any_of": [4]},
                        {"id": "U2", "match_regex_any_of": [r"integration\s*test"], "must_reference_turn_any_of": [2]},
                    ]
                },
                "stale_decoy_items": {
                    "items": [
                        {"id": "S1", "turn7_number": 1, "rejection_regex_any_of": [r"already\s*done", r"stale"]},
                        {"id": "S2", "turn7_number": 2, "rejection_regex_any_of": [r"A\s*complete", r"stale"]},
                        {"id": "S3", "turn7_number": 4, "rejection_regex_any_of": [r"handler\s*complete", r"stale"]},
                    ]
                },
                "output_format_checks": {
                    "status_summary_regex": [r"Status summary"],
                    "next_actions_regex": [r"Next actions"],
                    "stale_table_regex": [r"\|\s*#\s*\|.*Item", r"stale"],
                },
                "primary_metric": {"pass_threshold": 0.1},
            },
        ),
        "Fa": (
            g.score_fa_false_prior,
            "import rapidfuzz\nfrom rapidfuzz import fuzz, process\n# changelog\n# stale prior reversed\n",
            {
                "fixture": "Fa",
                "binary_false_prior_leak": {"leak_patterns": [r"unidecode"]},
                "task_correctness": {
                    "must_contain_all": ["rapidfuzz"],
                    "must_contain_any_of": [r"process"],
                    "must_not_contain_regex": [r"unidecode"],
                    "return_shape_check": {"heuristic_regex": [r"fuzz"], "min_heuristic_hits": 1},
                },
                "citation_to_reversal": {"signal_keywords_regex": [r"changelog", r"stale"], "min_hits_for_citation": 2},
            },
        ),
    }


def test_primary_graders_registry_has_all_expected_entries():
    # Phase 4 F-fixtures (10) + Phase 5 holdout H-fixtures (5, Track #329 E27)
    # + Phase 6 holdout H11–H14 (Q3 ADR §10.6 + Phase 6 spec §6.2).
    assert set(g.PRIMARY_GRADERS) == {
        "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "Fa",
        "H1", "H2", "H3", "H5", "H10",
        "H11", "H12", "H13", "H14",
    }
    assert g.PRIMARY_GRADERS["F2"] is g.score_f2_invariants
    assert g.PRIMARY_GRADERS["F10"] is g.score_f10_checklist
    assert g.PRIMARY_GRADERS["Fa"] is g.score_fa_false_prior
    assert g.PRIMARY_GRADERS["H1"] is g.score_h1_long_form_code_review
    assert g.PRIMARY_GRADERS["H10"] is g.score_h10_strict_instruction_following
    assert g.PRIMARY_GRADERS["H11"] is g.score_h11_structured_data_extraction
    assert g.PRIMARY_GRADERS["H12"] is g.score_h12_multilingual_summarization
    assert g.PRIMARY_GRADERS["H13"] is g.score_h13_schema_strict_routes
    assert g.PRIMARY_GRADERS["H14"] is g.score_h14_agentic_tool_sequence


def test_score_primary_dispatch_matches_direct_call(monkeypatch):
    monkeypatch.setattr(g.subprocess, "run", _fake_curl_for_dispatch)
    for fixture_id, (grader, output, truth) in _cases().items():
        via_dispatch = g.score_primary(fixture_id, output, truth)
        direct = grader(output, truth)
        assert via_dispatch == direct
