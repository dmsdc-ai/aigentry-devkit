# TDD Policy — Aigentry v2.0

## 3-Tier Testing Strategy

### Tier 1: Strict (Business Logic, API, Data Processing)

**Mandatory RED-GREEN-REFACTOR cycle.**

#### RED Phase
1. Create test file or add to existing
2. Write test describing expected behavior
3. Use AAA pattern:
   - **Arrange** (Given): Set up test data and conditions
   - **Act** (When): Execute the function under test
   - **Assert** (Then): Verify the expected outcome
4. Run test suite
5. **VERIFY**: Test MUST fail (exit code != 0)
6. If test passes: STOP — test is not testing new behavior, fix the test
7. Record evidence: command + failure output

#### GREEN Phase
1. Write the MINIMUM code to make the test pass
2. No over-engineering, no extra features, no premature abstractions
3. Run test suite
4. **VERIFY**: Test MUST pass (exit code == 0)
5. If test fails: fix implementation (do NOT modify tests)
6. Record evidence: command + success output

#### REFACTOR Phase
1. Improve code without changing behavior
2. Apply: DRY, KISS, SRP principles
3. Run test suite
4. **VERIFY**: All tests MUST still pass
5. Run linter/formatter

#### Test Naming
`test_[component]_[scenario]_[expected_behavior]`

Examples:
- `test_auth_login_returns_token_on_valid_credentials`
- `test_cart_add_item_increases_total`

#### Coverage Requirements
- Unit tests: >= 80%
- Integration tests: >= 70% (if applicable)

### Tier 2: Flexible (UI Components, Styling)

- Visual verification acceptable
- Snapshot tests acceptable
- Storybook or similar tools count as verification
- Coverage target: >= 50%
- Component behavior tests recommended but not mandatory

### Tier 3: Exempt (Infrastructure, Config, Prototypes)

- Manual verification allowed
- Applicable to: Dockerfile, CI/CD configs, .env templates, prototype/spike code
- **Upgrade obligation**: Must upgrade to Tier 2+ within 2 weeks
- Record in `.aigentry/state.json`:

```json
{
  "tdd_exemptions": [
    {
      "file": "Dockerfile",
      "tier": 3,
      "created_at": "2026-02-25",
      "upgrade_deadline": "2026-03-11",
      "ticket_id": "TICKET-ID"
    }
  ]
}
```

## Error States

### REGRESSION
- Definition: A previously passing test now fails
- Distinct from RED (RED is intentional new test failure)
- **Action**: Fix regression BEFORE continuing any new work

### ERROR_BLOCKED
- Definition: A gate was skipped without evidence
- **Action**: Return to previous valid state, produce required evidence

## Evidence Recording

All TDD evidence is stored in `.aigentry/state.json` under `evidence`:

```json
{
  "evidence": {
    "red_confirmed": {
      "command": "pytest tests/test_auth.py -v",
      "exit_code": 1,
      "timestamp": "2026-02-25T10:31:00Z"
    },
    "green_confirmed": {
      "command": "pytest tests/test_auth.py -v",
      "exit_code": 0,
      "timestamp": "2026-02-25T10:35:00Z"
    }
  }
}
```
