# Q3 ADR r3 Codex Re-review - Output-style Fixture-design Rule

Reviewer: aigentry-reviewer-q3-adr-r3-codex  
Date: 2026-05-02  
ADR under review: `~/projects/aigentry-orchestrator/docs/adr/2026-05-02-output-style-fixture-design-rule.md` @ `daaaff7`  
Prior Codex r2 review: `docs/reports/2026-05-02-q3-adr-r2-codex-review.md` @ `b06584b`  
Verdict: ACCEPT  
Top issue: None; both r2 new issues are fixed and no r3-specific blocker/condition was found.

Verification notes:

- Target commit exists: `daaaff7 docs(adr): apply r3 - Q3 ADR codex r2 new-issue fixes (R2-N1 PyYAML->JSON, R2-N2 grandfathered field-overload)`.
- Current orchestrator HEAD is later (`6482b46`), but `git diff daaaff7..HEAD -- docs/adr/2026-05-02-output-style-fixture-design-rule.md` is empty. Review target content is therefore identical for this ADR file.
- `requirements-exec-mode.txt` still contains `rapidfuzz`, `pandas`, `scipy`, `matplotlib`, `pytest`, `jsonschema`, and `tiktoken`; no `pyyaml`.
- `.venv-exec-mode/bin/python -c 'import yaml'` still fails with `ModuleNotFoundError: No module named 'yaml'`.
- Phase 5 holdout sample surface: 300/300 `metrics.json` files have top-level `fixture_id`; 300/300 have object `quality.primary_components`; 0/300 have `quality.primary_components.formatting_exempt_status`, as expected for historical metrics before the new lint contract.

## §1 New Issue Resolution Audit

### R2-N1 - YAML registry depends on PyYAML that is not in the exec-mode baseline

Prior issue statement:

> r2 §11 makes the registry YAML: `state/fixtures/_exemption-registry.yml`.
> r2 §2.4.3 and §9.4 say lint parses YAML with `pyyaml`.
> r2 §4 Q3 claims `pyyaml` is an existing devkit baseline.
> Local verification: `requirements-exec-mode.txt` contains `rapidfuzz`, `pandas`, `scipy`, `matplotlib`, `pytest`, `jsonschema`, and `tiktoken`, but no `pyyaml`.
> Local verification: `.venv-exec-mode/bin/python -c 'import yaml'` fails with `ModuleNotFoundError: No module named 'yaml'`.

Prior condition:

> Change the registry format to JSON and make §11, §2.4.3, §8.4, §9.4, and §10.6 consistently say `state/fixtures/_exemption-registry.json` parsed by Python stdlib `json`; or explicitly add PyYAML as a new dependency and redo the Article 17 dependency analysis. Best-first choice is JSON because it preserves the no-new-dependency claim.

r3 fix:

> **Dependencies**: Python stdlib only (`ast`, `json`, `pathlib`, `subprocess` for smoke run). The registry is JSON (§11), parsed by `json.load`. **No PyYAML** -- Article 17 stdlib-only path.

> The registry file `~/projects/aigentry-devkit/state/fixtures/_exemption-registry.json` (created by coder per §8.4) MUST follow this schema:

> Coder dispatch: initialize exemption registry per §8.1 milestone-row 4 (devkit repo `state/fixtures/_exemption-registry.json`); machine-readable JSON per §11 r3 schema; seed with H1 (pending-migration, expiry 2026-05-30) + H10 (grandfathered, expiry 2026-08-01) + H5 (retired, historical NB3 reference).

Verification:

- §11 is now a JSON registry schema, and the §11 code block parses with Python stdlib `json`.
- §2.4.3 check 3 now says the registry is "machine-readable JSON" loaded via Python stdlib `json.load`.
- §2.4.3 dependency line is stdlib only and explicitly says "No PyYAML".
- §8.4 / §8.1 milestone row uses `_exemption-registry.json` and `json.load`.
- §9.4 says `bin/lint-formatting-exemption.py` is Python stdlib only and parses the registry via `json.load`.
- §10.6 rows 1 and 4 use stdlib `json.load` and `state/fixtures/_exemption-registry.json`.
- `_exemption-registry.yml` / `_exemption-registry.yaml` no longer appears as an operational artifact path. The only `.yml` mention is in §15's audit-trail quote of the r2 issue and in §9.3's historical explanation that r2's `.yml` required PyYAML.
- No stale operational `pyyaml.safe_load`, `yaml.safe_load`, `import yaml`, or "parse YAML with PyYAML" instruction remains. Remaining `YAML`/`PyYAML` mentions are either structural-equivalence examples, r2 historical context, or the r3 disposition trail explaining why JSON was chosen.

VERDICT: FIXED.

### R2-N2 - `grandfathered` companion-field wording is internally contradictory

Prior issue statement:

> §2.4.2 declares `formatting_exempt_status` is one of `implemented`, `not_applicable`, `grandfathered`.
> The `grandfathered` status row says "`field value` MUST equal an active registry entry's `fixture_id` slug."
> That cannot literally refer to `formatting_exempt_status`; otherwise the status would need to be `H10`, not `grandfathered`.

Prior condition:

> Rewrite that row to say: for `formatting_exempt_status: "grandfathered"`, lint cross-checks the trial's top-level `fixture_id` (or `quality.primary_components.fixture` if that is the selected source) against an active registry entry. Do not overload `formatting_exempt_status` with a fixture slug.

r3 fix:

> The `formatting_exempt_status` field value MUST literally be the string `"grandfathered"` (NOT a fixture slug). Lint check 3 (§2.4.3) performs the registry cross-check by reading the **trial's existing top-level `fixture_id`** (or `quality.primary_components.fixture` if that is the chosen identifier source) and verifying it has an active (non-expired) entry in §11 with status `grandfathered` or `pending-migration`.

> For each grader emitting `formatting_exempt_status: "grandfathered"`: parse the §11 registry ... read the **trial's top-level `fixture_id`** from the same `metrics.json` (NOT the `formatting_exempt_status` field, which always equals the literal string `"grandfathered"`).

Verification:

- §2.4.2 now explicitly forbids treating `formatting_exempt_status` as a fixture slug.
- §2.4.3 check 3 now names the lookup source: top-level `metrics.json::fixture_id`, with `quality.primary_components.fixture` as the alternate chosen identifier source.
- The false-positive defense bullet was rewritten from a wrong-fixture-id-in-status concern to a registry coverage check on the trial's own identifier.
- The sample metrics evidence supports this lookup source: 300/300 Phase 5 holdout metrics files have top-level `fixture_id`, and `quality.primary_components.fixture` is also commonly present.

VERDICT: FIXED.

## §2 r3-specific Concerns

### YAML-to-JSON schema validation gaps

No new r3-specific validation gap found.

- The JSON example is syntactically valid and parseable by Python stdlib `json`.
- The machine-readable contract still has the same enforcement surface as r2: a registry file plus the §11 required-fields table plus lint check 3. r3 does not add a standalone JSON Schema artifact, but r2 did not have a standalone YAML schema artifact either; this is not a migration regression.
- Moving YAML comments into the `comment` field plus the per-entry field annotations preserves field semantics without depending on parser-specific comment behavior.

### Functional field preservation

The JSON registry preserves all 11 r2 functional fields:

`fixture_id`, `fixture_slug`, `status`, `grader_path`, `pre_patch_grader_sha`, `rationale`, `expiry`, `tracking_ticket`, `approving_session`, `migration_commit`, `lint_allow_status_grandfathered`.

The parsed r3 entries are:

- `H1: pending-migration`
- `H10: grandfathered`
- `H5: retired`

No r2 functional field was dropped. YAML inline comments were removed because JSON cannot carry them; their semantics are now in §11's field annotations.

### H1 and H10 JSON entry validity

H1 is valid JSON and preserves the r2 semantics:

- `fixture_id: "H1"`
- `status: "pending-migration"`
- `expiry: "2026-05-30"`
- `lint_allow_status_grandfathered: false`
- `migration_commit: null`

H10 is valid JSON and preserves the durable grandfathered exemplar:

- `fixture_id: "H10"`
- `status: "grandfathered"`
- `expiry: "2026-08-01"`
- `lint_allow_status_grandfathered: true`
- `migration_commit: null`

The H10 entry is still the correct lint smoke exemplar for the `grandfathered` path. H1 remains pending migration and is not misrepresented as a durable grandfathered fixture.

### §15 audit trail

§15 is accurate for the r3 scope.

- It correctly states that Codex r2 returned `ACCEPT_WITH_CONDITIONS`, 2 new issues (R2-N1 and R2-N2), and one residual prior-minor cleanup not counted as a new issue.
- It correctly states that Gemini r2 returned `ACCEPT` and no new decision-logic conflict.
- It correctly records r3 as a targeted fix for the two Codex r2 new issues only.
- It correctly carries the residual "CI" terminology cleanup as out of r3 scope. That wording remains polish, not a blocker, because the binding §2.4.3 terminology note defines "orchestrator-invoked pre-tag lint" clearly.

Residual note: §3.5 still says "pre-tag-CI-stage". This is the same residual cleanup called out in r2, and §15 explicitly preserves it as out of r3 scope. It does not affect the two r3 fixes or this accept verdict.

## §3 Final Verdict

ACCEPT (status flip OK).

Both r2 new issues are fixed:

- R2-N1 PyYAML dependency contradiction: FIXED by JSON registry + stdlib `json.load` + `.json` artifact path.
- R2-N2 grandfathered field overload: FIXED by making `formatting_exempt_status` literally `"grandfathered"` and moving registry lookup to the trial's `fixture_id`.

No new r3 conditions are required.

## §4 Top Issue

None; both prior new issues are fixed and no r3-specific concern blocks acceptance.
