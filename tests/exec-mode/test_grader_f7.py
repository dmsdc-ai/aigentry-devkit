from __future__ import annotations

import exec_mode_grader as g


TRUTH = {
    "fixture": "F7",
    "stage1_output_checks": {
        "refactored_file_must_contain_regex_any_of": [r"\bOption<User>", r"\bOption<"],
        "error_pattern_regex_any_of": [r"\bResult<", r"Result<\s*void", r"Result<\s*User"],
        "banned_pattern_detect_regex": r"\bEither<",
        "superseded_mention_regex_any_of": [r"(D2|Either).*supersed", r"Turn\s*4.*supersed"],
    },
    "primary_metric": {
        "latest_decision_correctness": {
            "component_weights": {"option_present": 0.4, "result_present": 0.4, "no_either": 0.2}
        },
        "pass_threshold": 0.70,
    },
}


GOOD_OUTPUT = """
(a)
```ts
type Option<T> = T | null;
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export async function findUserById(id: string): Promise<Option<User>> {
  const row = await db.queryOne('SELECT ... WHERE id = ?', id);
  if (!row) return null;
  return mapRow(row);
}

export async function deleteUser(id: string): Promise<Result<void, DbError>> {
  try {
    await db.exec('DELETE FROM users WHERE id = ?', id);
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, error: new DbError('delete failed', { cause: err }) };
  }
}
```

(b)
- Turn 6 / D3 governs the optional return type for findUserById.
- Turn 8 / D4 governs the error return type for deleteUser.

(c)
Either from D2 on Turn 4 was superseded by Turn 8 / D4, so this file avoids that older pattern.
"""


BAD_OUTPUT = """
(a)
```ts
type Either<L, R> = { left: L } | { right: R };
export async function findUserById(id: string): Promise<User | null> { return null; }
export async function deleteUser(id: string): Promise<Either<DbError, void>> {
  return { right: undefined };
}
```

(b)
- Turn 4 said to use Either.
"""


def test_score_f7_known_good_scores_high():
    score = g.score_f7_latest_decision(GOOD_OUTPUT, TRUTH)
    assert score["option_present"] is True
    assert score["result_present"] is True
    assert score["either_type_present"] is False
    assert score["primary_score"] > 0.85


def test_score_f7_using_either_is_hard_penalty():
    score = g.score_f7_latest_decision(BAD_OUTPUT, TRUTH)
    assert score["either_type_present"] is True
    assert score["primary_score"] < 0.3
    assert score["primary_pass"] is False


def test_score_f7_empty_output_returns_zero():
    score = g.score_f7_latest_decision("", TRUTH)
    assert score["latest_decision_correctness"] == 0.2
    assert score["primary_score"] < 0.2
