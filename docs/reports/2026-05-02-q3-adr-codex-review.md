# Q3 ADR Codex Review - Output-style Fixture-Design Rule

**Reviewer**: aigentry-reviewer-q3-adr-codex  
**Date**: 2026-05-02  
**Primary ADR under review**: `~/projects/aigentry-orchestrator/docs/adr/2026-05-02-output-style-fixture-design-rule.md` @ `c06c93c`  
**Verdict**: ACCEPT_WITH_CONDITIONS  
**Tier verdict**: T2-needs-3rd-reviewer  
**Issue counts**: BLOCKER 2, MAJOR 6, MINOR 4  

## §1 RFC 2119 Wording Compliance Audit

The core rule wording is defensible and uses RFC 2119 `MUST` consistently:

> Graders for structurally-equivalent data variants **MUST** implement a formatting-exemption equivalence pre-step before scoring; edge cases require explicit exemption documentation in the grader spec.

Evidence basis is adequate: Phase 5 final analysis documents H5 as a dormant output-style-bias risk rather than an observed mode-bias (`docs/reports/2026-05-01-phase5-final-analysis.md:281-309`), Gemini D3 called for a future formatting-exemption standard (`docs/reports/2026-05-01-phase5-gemini-review.md:51-55`, `:80-82`), and the parent ADR pre-registered the rule (`docs/adr/2026-05-01-rule-4-a-step-4-final-lock.md:412-414`).

Wording concerns:

- `MUST` is appropriate for graders that actually have structurally-equivalent data variants.
- The ADR's exception path is internally inconsistent. §2.1 says edge cases require documentation, and §9.2 gives cases where formatting is the scoring surface, but §2.4.3 says every NEW fixture must have `formatting_exempt_applied=true` and a `false` value is a hard block. That makes the documented edge-case exception non-operational.
- `MAY` appears only in non-core implementation discretion, but §9.3 says a coder MAY relocate the registry path. For an accepted ADR with a concrete lint path, relocation should require an ADR amendment or explicit orchestrator approval, not coder discretion alone.
- "Any document, grader review, or reviewer checklist that paraphrases this rule MUST quote it verbatim" is awkwardly scoped. Prefer "Any binding downstream artifact that restates this rule MUST quote the binding sentence verbatim." Non-binding prose should be allowed to summarize while citing the ADR.

Grandfathering is scoped by cohort in §2.3, but the H1 row is unstable because the Phase 6 spec already requires an H1 NB3 patch before pre-reg freeze (`docs/superpowers/specs/2026-05-02-phase6-design.md:269-272`, `:358-361`). Under the ADR's own "ANY non-trivial patch" rule, H1 should not remain an allowed grandfathered `false` at Phase 6 pre-reg.

## §2 Enforcement Mechanism Integrity

### §2.1 Reviewer Checklist

The two checklist items are directionally good:

- cite the canonicalization function or normalization step;
- list adversarial test names for each expected variant.

Auditable enough for human review: yes, if the reviewer is forced to cite source and tests.

False-negative risk: medium. "Each structurally-equivalent variant the grader may encounter" is not mechanically bounded. A reviewer can accept a narrow set of examples while missing common wrappers, e.g. fenced JSON plus prose preamble, YAML frontmatter, mixed table/code-block outputs, or code-fenced tool calls.

Required tightening:

- Require a fixture-local "equivalence surface" declaration listing normalized variants and non-normalized semantic-format surfaces.
- Require the checklist to cite both source function and exact tests.
- Require reviewers to mark BLOCK if the grader claims `formatting_exempt_applied=true` but has no positive/negative adversarial tests.

### §2.2 Grader-internal Flag

Current proposed storage is not compatible with the devkit harness as written.

The ADR requires a top-level `metrics.json` field (`formatting_exempt_applied`) and claims unknown top-level fields are ignored. The current schema says otherwise: `state/schema/metrics.v1.json` has `"additionalProperties": false` at top level (`state/schema/metrics.v1.json:24`), and `bin/exec-mode-experiment.sh` validates the assembled payload against that schema before writing (`bin/exec-mode-experiment.sh:680-686`). A new top-level field will fail validation unless the schema is explicitly patched.

The harness also does not pass arbitrary primary-grader return fields to top level. `score-fixture` returns `qual_json` (`bin/exec-mode-experiment.sh:666-670`), then the assembly stores the full grader result under `quality.primary_components` (`bin/exec-mode-experiment.sh:815-825`, `:931-933`). A primary grader adding `formatting_exempt_applied` to its return dict would currently land under `quality.primary_components.formatting_exempt_applied`, not at top level.

False-positive risk: high. A boolean `true` can be set without meaningful canonicalization. The ADR says the implementation must be self-evident from source, but the flag itself does not identify the canonicalizer, covered variants, or tests.

Recommended contract:

- Either patch `state/schema/metrics.v1.json` to allow optional top-level `formatting_exempt_applied: boolean` and patch the harness to extract it from `qual_raw`, or change the ADR to store the field under `quality.primary_components`.
- Add `formatting_exempt_status: implemented | not_applicable | grandfathered` or equivalent, because a boolean conflates "implemented", "no variants in scope", and "grandfathered debt".
- Add optional `formatting_exempt_rule_id` and `formatting_exempt_evidence` fields if long-term auditability matters.

### §2.3 Pre-tag Lint Script

The lint spec is not strong enough for the rule it is supposed to enforce.

The ADR says the lint scans grader source files with regex and verifies:

1. every primary grader emits the field;
2. `false` has a registry entry;
3. NEW fixtures cannot be `false`.

What could pass lint while failing the rule:

- A comment or docstring contains `formatting_exempt_applied`.
- A dead branch returns `true`; the actual scoring path omits the field.
- The field is emitted nested under `quality.primary_components`, not top-level.
- The field is `true`, but the canonicalizer is a no-op.
- The grader normalizes one wrapper, e.g. fenced JSON, but misses prose plus fenced JSON or backticked tool calls.
- The linter scans registered graders but misses the actual primary grader in `ground_truth.json`.

The linter should run at least one smoke score per in-scope fixture and parse the produced grader JSON or trial `metrics.json`, not only grep source. If source analysis is still used, use Python `ast` for Python graders and verify return-object keys on all return paths. Regex-only is acceptable for finding a candidate, not for pass/fail.

## §3 Exemption Registry Mechanics

The §11 registry is useful as a first human-visible table, but it is not sufficient as a long-term enforcement registry.

Missing fields:

- fixture slug and path;
- primary grader path;
- current grader SHA;
- exemption type: `grandfathered`, `not_applicable`, `retired`, `migrated`;
- approving reviewer/session;
- rule version or ADR ID;
- expiry/deadline as a concrete date, not "TBD";
- migration PR/commit;
- whether the lint may allow `false` for this entry.

Markdown table parsing is fragile for a linter. If the lint script consumes this registry, use JSON or YAML, or a markdown file with a fenced machine-readable block.

Grandfathering analysis:

- H5 historical entry is appropriate because Phase 5 showed dormant style bias without observed mode-bias, and Phase 6 replaces H5 (`phase6-design.md:275-283`).
- H1 should be a temporary "pending migration by Phase 6 pre-reg" entry, not a general grandfathered entry. Phase 6 already requires an NB3 patch before freeze (`phase6-design.md:271`, `:358-361`), and the ADR says any non-trivial patch must satisfy §2.4.
- H10 lacks a concrete migration deadline. "Phase 7 (TBD)" and "until next natural patch occasion" are not enough to prevent permanent debt.

Cost-benefit:

The ADR gives a plausible cost argument against patching all old fixtures immediately (§3.4), but it does not distinguish H1 from H10. H1 already has a required patch path, so the marginal cost of adding the §2.4 flag and tests is low. H10 has no in-flight patch, so deferral is more defensible, but it needs an expiry trigger.

## §4 Tier Escalation Justification

Final tier classification: T2.

The escalation from the Phase 6 spec's T1 to T2 is defensible. The architect frontmatter schema maps `type: adr` plus `scope: ecosystem` to T2 and 2 reviewers (`templates/aigentry-architect/references/frontmatter-schema.md:60-70`). The reviewer matrix's T2 default is codex plus gemini (`templates/aigentry-architect/references/reviewer-matrix.md:36-38`).

Reviewer sufficiency:

- A codex review plus a spec-document-reviewer can count as two perspectives only if the spec-document-reviewer is independent of the ADR author and its report is archived as a review artifact.
- If the spec-document-reviewer was a Claude subagent adjacent to a Claude architect author, this does not cleanly satisfy the self-review exclusion principle (`reviewer-matrix.md:50-57`).
- Because this review finds enforcement-mechanics blockers and the T2 default expects gemini for edge cases, I recommend one post-revision gemini review before final signoff.

Tier verdict: T2-needs-3rd-reviewer.

## §5 Edge Cases and Adversarial Scenarios

1. Structurally identical but semantically different JSON

JSON object key reordering is usually semantically equivalent for mapping comparison. Array order, duplicate keys, or ordered presentation requirements are not equivalent. The ADR's examples cover dictionary JSON vs YAML, but not duplicate keys, ordered objects in presentation tasks, or strict raw-output tasks.

Coverage: partial. The rule needs fixture-local equivalence-surface docs.

2. Markdown where formatting is semantic

Examples: bold marks mandatory items; italic marks optional items; table alignment or code-fence language is the scoring surface.

Coverage: contradictory. §2.1 and §9.2 recognize edge cases, but §2.4.3 hard-blocks `false` for NEW fixtures. The flag definition is insufficient unless "not applicable because formatting is the scoring surface" is an allowed lint-pass state.

3. Multi-modal outputs

Text plus code blocks plus tables, or tool-call plans with prose plus fenced snippets, can have multiple nested normalization surfaces. A single boolean cannot show which surface was normalized.

Coverage: weak. The ADR should require canonicalizer-specific tests and evidence fields.

4. Adversarial flag setting

A grader can set `"formatting_exempt_applied": true` but keep raw regex matching. Regex-source lint will pass if it only sees the key.

Coverage: weak. Require smoke-generated metrics plus adversarial unit tests.

5. H5-class tool-call rendering

The actual H5 grader uses regexes over raw text for required tools and ordering (`bin/exec-mode-grader.py:2237-2250`) and phantom-call detection (`:2285-2311`). It handles citation-context backticks for candidate functions, but it does not implement a general canonicalization pre-step for tool-call wrappers. This supports the ADR's motivation, but also shows why source-level evidence must be concrete.

Coverage: motivation strong; enforcement still needs tighter proof.

## §6 Backwards Compatibility and Downgrade Risk

Silent regression risk: high unless the metrics schema and harness are amended. As written, top-level flag emission fails schema validation because top-level additional properties are disallowed.

Prior trial invalidation:

- Historical Phase 3-5 scores should not be invalidated automatically.
- If a grader is patched to add canonicalization and old outputs are regraded, prior scores become "old grader SHA" scores and must not be mixed with new scores without explicit grader-SHA stratification.
- A future analyst report should distinguish "trial generated under old grader" from "trial regraded under new grader".

Migration test plan needed:

- Schema test: `metrics.v1.json` accepts the new field if top-level is retained.
- Harness test: a fake grader returning the flag produces a trial `metrics.json` with the field in the ADR-specified location.
- Lint tests: missing field fails; field in comment fails; `true` without canonicalizer/tests fails; allowed grandfathered fixture passes; NEW strict-format fixture passes only with explicit `not_applicable` status.
- Regrade test: same H5-style output wrapped in raw, backticked, and fenced forms yields identical primary score when the canonicalizer claims implementation.

## §7 위헌 심사 Spot Check

Article 1 경량:

Concern, not failure. The ADR adds three mechanisms plus a registry. That is heavier than a single checklist, but the cost is justified if each mechanism is real. The current version risks feature creep because the lint and registry are added without enough mechanical precision. A tighter schema/harness/lint contract would make the extra mechanisms worth their weight. Without that, Article 1 becomes questionable because two new artifacts could produce false confidence.

Article 17 무의존:

Concern, not failure. The ADR says "zero new dependencies" but also names bash + jq + grep (`2026-05-02-output-style-fixture-design-rule.md:202-203`, `:363-365`). Devkit already uses jq in multiple operational scripts and the Dockerfile installs it, so jq is likely an existing baseline, not a new dependency. The ADR should phrase this as "uses existing devkit baseline jq, with python-stdlib fallback if jq is unavailable" rather than "no dependency."

Cross-OS note:

If the implementation is a new bash script, it must also obey devkit Rule 26 and route OS-specific operations through `bin/lib/platform.sh`. The current lint spec probably does not need process control or file locks, but the coder task should explicitly say this to avoid a new bash hard-rule violation.

## §8 BLOCKERS Classification

### BLOCKER 1 - Metrics field contract is incompatible with current schema/harness

The ADR requires a new top-level `metrics.json` field and claims additive compatibility, but current schema rejects unknown top-level fields (`state/schema/metrics.v1.json:24`) and the harness validates before write (`bin/exec-mode-experiment.sh:680-686`). The current assembly keeps grader detail under `quality.primary_components`, not top-level.

Condition: before signoff, either update the ADR to include schema + harness patches as required milestones, or move the field to `quality.primary_components` and adjust lint/metrics accordingly.

### BLOCKER 2 - Edge-case exemption path conflicts with NEW-fixture lint hard block

The binding sentence allows edge cases with explicit documentation, and §9.2 gives examples where formatting is the scoring surface. But §2.4.3 says every NEW fixture must have `formatting_exempt_applied=true`; `false` is a hard block.

Condition: replace the boolean-only contract with a status enum or allow `false` for NEW fixtures when the grader spec explicitly documents "no structurally-equivalent variants in scope / formatting is scoring surface" and the reviewer/linter verifies it.

### MAJOR 1 - Regex-only lint is too weak

A regex source scan can pass comments, dead branches, nested fields, or no-op implementations. The lint should run smoke scoring and/or AST checks, then inspect actual emitted JSON.

### MAJOR 2 - `true` flag is not evidence of canonicalization

The ADR relies on source self-evidence. Require canonicalizer function citation plus adversarial tests as a lint or review gate.

### MAJOR 3 - Registry schema is not machine-robust or long-term complete

Markdown table lacks grader path, SHA, expiry, reviewer, rule version, and lint-allowance semantics. Use machine-readable registry data or a fenced block.

### MAJOR 4 - H1 grandfathering conflicts with required Phase 6 NB3 patch path

H1 is already scheduled for a non-trivial patch before pre-reg. The H1 registry row and H1-based lint smoke example should be rewritten so H1 migrates by Phase 6 pre-reg, not used as a durable `false` exemplar.

### MAJOR 5 - Missing-lint fallback weakens "all three required"

§7.4 allows manual verification if the script is not implemented by Phase 6 pre-tag, while §2.4 says all three mechanisms are required. Make lint implementation a pre-tag precondition, or define a fail-closed manual equivalent with exact evidence requirements and expiry.

### MAJOR 6 - Migration plan lacks grader-SHA and regrade isolation rules

Prior scores are safe only if old and new grader outputs are not mixed. The ADR should require grader SHA tagging in registry and analyst reports when canonicalization patches land.

### MINOR 1 - Verbatim-rule quoting language is overbroad

Limit mandatory verbatim quotation to binding downstream artifacts.

### MINOR 2 - "CI" terminology is inconsistent

Use "orchestrator-invoked pre-tag lint" consistently. There is no hosted CI.

### MINOR 3 - "zero-dependency" phrasing should account for jq

Say "no new dependency; uses existing devkit jq baseline or python stdlib fallback."

### MINOR 4 - Registry path relocation should not be coder-discretionary

If the path changes, require ADR revision or orchestrator approval before implementation.

## §9 Top Conditions Before Signoff

1. Fix the metrics contract: explicitly patch schema + harness for the top-level field, or revise the ADR to store the flag under `quality.primary_components`.
2. Replace the boolean-only exemption model with a status model that supports `implemented`, `not_applicable`, and `grandfathered`.
3. Strengthen pre-tag lint from regex-only source scan to actual emitted JSON validation plus AST/smoke/unit-test evidence.
4. Rewrite the registry schema as machine-readable data with grader path, SHA, expiry, reviewer, and migration commit fields; give H10 a concrete deadline.
5. Resolve H1: classify it as pending migration by Phase 6 pre-reg because its NB3 patch is already required, and update the lint smoke example accordingly.

## Final Recommendation

The rule itself should survive. The enforcement mechanics need revision before final signoff.

Recommended disposition: ACCEPT_WITH_CONDITIONS after the two blockers are fixed, followed by a gemini edge-case review because the ADR is T2 and the revised edge-case/lint semantics are exactly the reviewer-matrix gemini lane.
