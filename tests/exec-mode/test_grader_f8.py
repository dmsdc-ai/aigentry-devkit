from __future__ import annotations

import exec_mode_grader as g


TRUTH = {
    "fixture": "F8",
    "public_api_required_exports": {
        "src/ingest/orders.ts": ["validateOrderEmail", "validateOrderPhone", "ingestOrder"],
        "src/ingest/users.ts": ["validateUserEmail", "validateUserPhone", "ingestUser"],
        "src/ingest/webhooks.ts": ["validateWebhookEmail", "validateWebhookPhone", "ingestWebhook"],
    },
    "hidden_regression_tests": {
        "test_cases": [
            {"kind": "i18n_email"},
            {"kind": "empty"},
            {"kind": "formatted_phone"},
            {"kind": "too_short"},
            {"kind": "no_at"},
            {"kind": "happy_path"},
            {"kind": "bad_email_error"},
            {"kind": "bad_phone_error"},
        ]
    },
    "duplication_reduction_metric": {
        "baseline_duplicated_lines": 36,
        "pass_threshold_duplicated_lines_max": 4,
    },
    "test_edit_penalty": {
        "detect_regex_any_of": [r"describe\s*\(", r"\.test\.ts", r"expect\s*\("],
        "penalty_multiplier": 0.3,
    },
    "primary_metric": {"pass_threshold": 0.70},
}


GOOD_OUTPUT = r"""
### src/ingest/validators.ts
```ts
export function validateEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  return true;
}
```

### src/ingest/orders.ts
```ts
import { validateEmail, validatePhone } from './validators';
export function validateOrderEmail(email: string): boolean { return validateEmail(email); }
export function validateOrderPhone(phone: string): boolean { return validatePhone(phone); }
export function ingestOrder(order: { email: string; phone: string }) {
  if (!validateOrderEmail(order.email)) throw new Error('bad_email');
  if (!validateOrderPhone(order.phone)) throw new Error('bad_phone');
  return order;
}
```

### src/ingest/users.ts
```ts
import { validateEmail, validatePhone } from './validators';
export function validateUserEmail(email: string): boolean { return validateEmail(email); }
export function validateUserPhone(phone: string): boolean { return validatePhone(phone); }
export function ingestUser(user: { email: string; phone: string }) {
  if (!validateUserEmail(user.email)) throw new Error('bad_email');
  if (!validateUserPhone(user.phone)) throw new Error('bad_phone');
  return user;
}
```

### src/ingest/webhooks.ts
```ts
import { validateEmail, validatePhone } from './validators';
export function validateWebhookEmail(email: string): boolean { return validateEmail(email); }
export function validateWebhookPhone(phone: string): boolean { return validatePhone(phone); }
export function ingestWebhook(webhook: { email: string; phone: string }) {
  if (!validateWebhookEmail(webhook.email)) throw new Error('bad_email');
  if (!validateWebhookPhone(webhook.phone)) throw new Error('bad_phone');
  return webhook;
}
```
"""


BAD_OUTPUT = r"""
### src/ingest/orders.ts
```ts
export function validateOrderEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
export function validateOrderPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}
export function ingestOrder(order: { email: string; phone: string }) {
  return order;
}
```

### src/ingest/users.ts
```ts
describe('validators', () => {});
export function validateUserEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
export function validateUserPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}
export function ingestUser(user: { email: string; phone: string }) {
  return user;
}
```

### src/ingest/webhooks.ts
```ts
export function validateWebhookEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
export function validateWebhookPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}
export function ingestWebhook(webhook: { email: string; phone: string }) {
  return webhook;
}
```
"""


def test_score_f8_known_good_scores_high():
    score = g.score_f8_hidden_tests(GOOD_OUTPUT, TRUTH)
    assert score["test_pass_rate"] == 1.0
    assert score["api_preservation_score"] == 1.0
    assert score["duplicated_lines_after"] == 0
    assert score["primary_score"] > 0.9


def test_score_f8_inlined_duplication_and_test_edit_penalty_score_low():
    score = g.score_f8_hidden_tests(BAD_OUTPUT, TRUTH)
    assert score["test_edit_hits"]
    assert score["duplicated_lines_after"] > 4
    assert score["primary_score"] < 0.4


def test_score_f8_empty_output_returns_zero():
    score = g.score_f8_hidden_tests("", TRUTH)
    assert score["test_pass_rate"] == 0.0
    assert score["api_preservation_score"] == 0.0
    assert score["primary_score"] == 0.0
