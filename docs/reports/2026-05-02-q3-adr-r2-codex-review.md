# Q3 ADR r2 Codex Re-review - Output-style Fixture-design Rule

Reviewer: aigentry-reviewer-q3-adr-r2-codex  
Date: 2026-05-02  
ADR under review: `~/projects/aigentry-orchestrator/docs/adr/2026-05-02-output-style-fixture-design-rule.md` @ `c73565c`  
Prior Codex review: `docs/reports/2026-05-02-q3-adr-codex-review.md` @ `aed61e8`  
Verdict: ACCEPT_WITH_CONDITIONS  
Tier verdict: T2-pass  

Summary:

- Prior blockers: 2/2 FIXED.
- Prior Codex conditions C1-C5: 5/5 INTEGRATED, 0 waived, 0 missing.
- Random spot-check of prior majors/minors: MAJOR 2, MAJOR 4, MAJOR 6, MINOR 3, MINOR 4 all materially addressed.
- Additional terminology check: prior MINOR 2 is only partially cleaned up because residual "CI" wording remains in non-binding sections.
- New r2 issues: 2, plus 1 residual prior-minor cleanup.
- Top issue: r2 makes YAML registry parsing depend on PyYAML while devkit's exec-mode venv and requirements file do not include PyYAML.

## Section 1 - Blocker resolution audit

### BLOCKER 1 - Metrics field contract

Prior blocker statement:

> The ADR requires a new top-level `metrics.json` field and claims additive compatibility, but current schema rejects unknown top-level fields (`state/schema/metrics.v1.json:24`) and the harness validates before write (`bin/exec-mode-experiment.sh:680-686`). The current assembly keeps grader detail under `quality.primary_components`, not top-level.
>
> Condition: before signoff, either update the ADR to include schema + harness patches as required milestones, or move the field to `quality.primary_components` and adjust lint/metrics accordingly.

r2 fix:

> r2 chooses the lighter path: relocate the field under `quality.primary_components`, which the schema declares as a free-form object (`metrics.v1.json:156-159`: "Free-form per-fixture grader sub-scores").
>
> Field location confirmation: `metrics.json::quality.primary_components.formatting_exempt_status` (NOT top-level).

Verdict: FIXED.

Verification:

- `state/schema/metrics.v1.json` still has top-level `additionalProperties: false`, so the original top-level design would still fail.
- `quality.primary_components` is typed as object/null and has no `additionalProperties: false`, so extra grader sub-keys are schema-compatible.
- `bin/exec-mode-experiment.sh` still passes the full `score-fixture` return dict through as `quality.primary_components` (`qual_raw` -> `quality_components` -> metrics payload), so no harness extraction patch is required.
- Actual Phase 5 holdout sample: 300/300 `state/exec-mode-experiment/phase5-holdout/**/metrics.json` files have `quality.primary_components` as an object. Fixture counts were H1/H2/H3/H5/H10 = 60 each. All 300 historical files lack `formatting_exempt_status`, which is acceptable for historical metrics under r2; future absence is handled by lint check 1.

Risk of silent regression from adding the new sub-key: low at schema/harness level. The main risk is grader omission, not schema rejection; r2's emitted-JSON lint check targets that risk directly.

### BLOCKER 2 - Edge-case exemption path vs NEW-fixture hard block

Prior blocker statement:

> The binding sentence allows edge cases with explicit documentation, and §9.2 gives examples where formatting is the scoring surface. But §2.4.3 says every NEW fixture must have `formatting_exempt_applied=true`; `false` is a hard block.
>
> Condition: replace the boolean-only contract with a status enum or allow `false` for NEW fixtures when the grader spec explicitly documents "no structurally-equivalent variants in scope / formatting is scoring surface" and the reviewer/linter verifies it.

r2 fix:

> r2 replaces the boolean with a status enum that operationally distinguishes the three legitimate states.
>
> `formatting_exempt_status`: `implemented` | `not_applicable` | `grandfathered`
>
> Hard rule: NEW fixtures (per §2.3 row 1) MUST emit `implemented` OR `not_applicable`.

Verdict: FIXED, with one cleanup condition in Section 5.

Enum design audit:

- The three emitted values are exhaustive for the per-trial compliance state:
  - `implemented`: normalization exists.
  - `not_applicable`: formatting is the scoring surface.
  - `grandfathered`: pre-Phase-6 behavior is temporarily accepted through the registry.
- Future lifecycle labels such as `pending-migration`, `migrated`, and `retired` belong in the registry, not in per-trial metrics. A fourth emitted value is not needed now.
- r2 does contain an ambiguous sentence for `grandfathered`: "`field value` MUST equal an active registry entry's `fixture_id` slug." That cannot literally refer to `formatting_exempt_status`, because that field must equal `grandfathered`. See new issue R2-N2.

## Section 2 - Conditions integration audit

### C1 - Metrics contract

Prior condition:

> Fix the metrics contract: explicitly patch schema + harness for the top-level field, or revise the ADR to store the flag under `quality.primary_components`.

r2 location:

> §2.4.2 + §6.3: store status field at `quality.primary_components.formatting_exempt_status`; no schema/harness patch required.

Verdict: INTEGRATED.

### C2 - Status model

Prior condition:

> Replace the boolean-only exemption model with a status model that supports `implemented`, `not_applicable`, and `grandfathered`.

r2 location:

> §2.4.2 status semantics table: `implemented`, `not_applicable`, `grandfathered`.

Verdict: INTEGRATED.

### C3 - Stronger lint

Prior condition:

> Strengthen pre-tag lint from regex-only source scan to actual emitted JSON validation plus AST/smoke/unit-test evidence.

r2 location:

> §2.4.3: run smoke `score-fixture`, parse emitted JSON, AST-check canonicalizer existence, AST-check named tests, and fail closed on AST/smoke failures.

Verdict: INTEGRATED.

### C4 - Machine-readable registry and H10 deadline

Prior condition:

> Rewrite the registry schema as machine-readable data with grader path, SHA, expiry, reviewer, and migration commit fields; give H10 a concrete deadline.

r2 location:

> §11: `state/fixtures/_exemption-registry.yml` with `grader_path`, `pre_patch_grader_sha`, `expiry`, `approving_session`, `migration_commit`, and `lint_allow_status_grandfathered`; H10 expiry = `2026-08-01`.

Verdict: INTEGRATED, with a dependency-format cleanup condition in Section 5.

### C5 - H1 pending migration

Prior condition:

> Resolve H1: classify it as pending migration by Phase 6 pre-reg because its NB3 patch is already required, and update the lint smoke example accordingly.

r2 location:

> §2.3 row 2 + §8.6 + §11: H1 status = `pending-migration`, expiry = `2026-05-30`, NB3 patch must satisfy §2.4, and durable `grandfathered` smoke example switches from H1 to H10.

Verdict: INTEGRATED.

## Section 3 - Majors and minors verification

Random spot-check sample selected by `python3 random.sample`: MAJOR 2, MAJOR 4, MAJOR 6; MINOR 3, MINOR 4.

### MAJOR 2 - `true` flag is not evidence

Prior finding:

> `true` flag is not evidence of canonicalization. Require canonicalizer function citation plus adversarial tests as a lint or review gate.

r2 verification:

- §2.4.2 adds `formatting_exempt_canonicalizer`, `formatting_exempt_variants`, and `formatting_exempt_tests`.
- §2.4.3 check 2 requires the canonicalizer function to exist in the grader source via Python AST and named tests to exist in the test file via AST.

Verdict: ADDRESSED.

### MAJOR 4 - H1 grandfathering conflict

Prior finding:

> H1 grandfathering conflicts with required Phase 6 NB3 patch path.

r2 verification:

- §2.3 splits H1 out from durable grandfathering and marks it `pending-migration`.
- §8.6 requires the H1 NB3 patch to satisfy §2.4 before Phase 6 pre-reg.
- §11 sets H1 expiry to `2026-05-30` and explicitly says the durable grandfathered smoke example must be H10, not H1.

Verdict: ADDRESSED.

### MAJOR 6 - Grader-SHA and regrade isolation

Prior finding:

> Migration plan lacks grader-SHA and regrade isolation rules.

r2 verification:

- §6.2.1 states pre-patch and post-patch grader SHA scores must not be mixed unless explicitly disclosed as a between-grader-SHA contrast.
- §11 adds `pre_patch_grader_sha` and `migration_commit`.
- §8.2 M7 checks analyst-report disclosure.

Verdict: ADDRESSED.

### MINOR 3 - Zero-dependency phrasing

Prior finding:

> "zero-dependency" phrasing should account for jq.

r2 verification:

- r2 no longer chooses bash+jq for lint; §2.4.3 and §9.4 choose Python AST/JSON.
- However, r2 now claims PyYAML is an existing baseline. That claim is false in devkit's exec-mode venv and requirements file. This is not the old jq wording problem, but it introduces a new dependency issue. See R2-N1.

Verdict: ADDRESSED IN FORM, NEW ISSUE INTRODUCED.

### MINOR 4 - Registry path relocation

Prior finding:

> Registry path relocation should not be coder-discretionary.

r2 verification:

- §9.3 now says relocation is "NOT coder-discretionary" and requires architect ADR revision or explicit orchestrator approval recorded in the relocation commit message.

Verdict: ADDRESSED.

### Additional prior-minor cleanup check

Prior MINOR 2 ("CI terminology is inconsistent") is not fully cleaned up. r2 correctly defines "orchestrator-invoked pre-tag lint" in §2.4.3, but `rg '\bCI\b|pre-tag-CI'` still finds residual wording such as "CI lint", "no CI check", and "pre-tag-CI-stage" in §1.4 and §3. This is not a blocker, but it should be cleaned before accept.

## Section 4 - Tier resolution audit

r2 §1.2.1 correctly cites the frontmatter schema:

- `adr + ecosystem + *` maps to T2 with 2 reviewers.
- T3 is reserved for `adr + constitutional + one-way`.
- r1 had codex + gemini, which mechanically satisfies the T2 count.
- r2 also correctly clarifies that a Claude spec-document-reviewer subagent is supplemental and cannot count as a replacement for an independent reviewer.

This satisfies my original tier concern on classification. My prior `T2-needs-3rd-reviewer` concern was driven by enforcement blockers and the possibility that a Claude subagent was being counted as the second reviewer. r2 fixes the counting explanation and this r2 Codex re-review verifies the blocker fixes.

I do not see a T3 trigger. The ADR remains ecosystem-scoped, not constitutional-scoped.

Tier verdict for r2: T2-pass, with content conditions listed below.

## Section 5 - New issues introduced by r2

### R2-N1 - YAML registry depends on PyYAML that is not in the exec-mode baseline

Evidence:

- r2 §11 makes the registry YAML: `state/fixtures/_exemption-registry.yml`.
- r2 §2.4.3 and §9.4 say lint parses YAML with `pyyaml`.
- r2 §4 Q3 claims `pyyaml` is an existing devkit baseline.
- Local verification: `requirements-exec-mode.txt` contains `rapidfuzz`, `pandas`, `scipy`, `matplotlib`, `pytest`, `jsonschema`, and `tiktoken`, but no `pyyaml`.
- Local verification: `.venv-exec-mode/bin/python -c 'import yaml'` fails with `ModuleNotFoundError: No module named 'yaml'`.

Impact:

- This introduces a dependency contradiction with Article 17 / no-new-dependency language.
- The ADR says "if absent registry uses JSON" in one place, but §11 still says the registry MUST be YAML and §9.4 still says the script uses PyYAML.

Condition R2-COND-1:

Change the registry format to JSON and make §11, §2.4.3, §8.4, §9.4, and §10.6 consistently say `state/fixtures/_exemption-registry.json` parsed by Python stdlib `json`; or explicitly add PyYAML as a new dependency and redo the Article 17 dependency analysis. Best-first choice is JSON because it preserves the no-new-dependency claim.

### R2-N2 - `grandfathered` companion-field wording is internally contradictory

Evidence:

- §2.4.2 declares `formatting_exempt_status` is one of `implemented`, `not_applicable`, `grandfathered`.
- The `grandfathered` status row says "`field value` MUST equal an active registry entry's `fixture_id` slug."
- That cannot literally refer to `formatting_exempt_status`; otherwise the status would need to be `H10`, not `grandfathered`.

Impact:

- Implementers could encode the fixture ID in the wrong field.
- Lint check 3 could be implemented against the wrong value.

Condition R2-COND-2:

Rewrite that row to say: for `formatting_exempt_status: "grandfathered"`, lint cross-checks the trial's top-level `fixture_id` (or `quality.primary_components.fixture` if that is the selected source) against an active registry entry. Do not overload `formatting_exempt_status` with a fixture slug.

### R2-RESIDUAL-1 - Residual "CI" terminology remains

Evidence:

- r2 says it removes CI ambiguity, but `rg '\bCI\b|pre-tag-CI'` still finds "CI lint", "no CI check", and "pre-tag-CI-stage" in non-binding sections.

Impact:

- Minor documentation consistency issue only.
- This is not counted as a new r2 issue; it is an incomplete cleanup of prior MINOR 2.

Condition R2-COND-3:

Replace remaining "CI" references with "orchestrator-invoked pre-tag lint" or "pre-tag lint" unless the sentence is explicitly contrasting against hosted CI.

### Other Section 5 checks

Schema-validation gaps from relocation: no new schema gap found. The relocation uses the existing free-form `quality.primary_components` extension point and is compatible with actual Phase 5 metrics shape.

Enum backwards-compat with existing graders: acceptable. Historical metrics remain valid without the field; future in-scope graders are gated by lint. The enum itself is not expected to break existing analysts that ignore `quality.primary_components`.

Deadline realism:

- H1 `2026-05-30`: realistic because it is tied to the already-required NB3 patch before Phase 6 pre-reg.
- H10 `2026-08-01`: realistic because it leaves roughly three months from 2026-05-02 for one grandfathered fixture and aligns with a future phase deadline. The deadline is not an unrealistic migration burden.

## Section 6 - Final verdict

Final verdict: ACCEPT_WITH_CONDITIONS.

Required before status flips to accepted:

1. Apply R2-COND-1: make the registry parser dependency story consistent, preferably by switching the registry to stdlib JSON.
2. Apply R2-COND-2: clarify that `grandfathered` registry matching uses the trial fixture ID, not the status field value.
3. Apply R2-COND-3: remove residual CI terminology except explicit "no hosted CI" contrast language.

I do not recommend rejection or re-architecture. The r2 design fixed the two substantive r1 blockers and integrated all five prior Codex conditions.

## Section 7 - Top issue

Top issue: YAML registry parsing relies on PyYAML, but PyYAML is not present in the exec-mode requirements or venv, contradicting r2's no-new-dependency claim.
