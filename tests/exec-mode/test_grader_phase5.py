"""Unit tests for Phase 5 H-fixture primary graders (Track #329 E27 α-step-13).

Each grader is exercised with two outputs: a known-good output that should
score above the fixture's pass_threshold, and a known-bad output that should
score well below it. Both outputs are authored independently of the grader
implementation (rubric-first, not output-first per Constitution Rule 13).

The fixture ground_truth.json files are loaded from disk so the test exercises
the actual rubric the runner will use, not a stub.
"""
from __future__ import annotations

import json
from pathlib import Path

import exec_mode_grader as g

REPO_ROOT = Path(__file__).resolve().parents[2]
HOLDOUT = REPO_ROOT / "state" / "fixtures" / "phase5-holdout"


def _load_truth(fixture: str) -> dict:
    return json.loads((HOLDOUT / fixture / "ground_truth.json").read_text(encoding="utf-8"))


# ─── H10 — strict instruction following ─────────────────────────────────────
H10_GOOD = """## 무슨 일이 있었나
4월 한 달간 운영 인시던트 세 건이 차례로 발생했다. 첫째는 OPS-4187, 둘째는 OPS-4192, 셋째는 OPS-4205 였다. 세 건 모두 production 영향이 명확했고, 페이저 발생까지 평균 응답 시간은 약 네 분 정도였다. 각 인시던트의 직접 원인은 서로 달랐고 상호 의존은 없는 독립 사건이었다. 첫 주에는 로드밸런서 헬스체크의 false-positive로 인해 us-east-1 region 트래픽이 잠깐 빠졌다. 둘째 주에는 데이터베이스 vacuum hold가 replica 지연을 유발했다. 마지막 주에는 CDN 인증서 만료가 누락되어 일부 외부 요청이 실패로 떨어졌다. 세 사건 모두 알람은 정상적으로 울렸고 on-call 인지에는 큰 지연이 없었다.

## 영향
세 건을 합쳐 사용자 직접 영향 시간은 약 23분 가량 누적되었다. 운영팀 페이저는 총 11회 울렸다. 트래픽 peak는 1,247 req/s 까지 도달했다. 401 응답은 3,408 건 기록되었으며 replica lag 는 최대 47초 까지 튀었다. 서비스 SLO 한 달 budget 의 약 39 퍼센트를 소모했다. 결제 흐름의 직접 영향은 한정적이었지만 신호로는 분명했다.

## 근본원인
공통 패턴은 운영 변경 직후 모니터링 보강이 따라오지 않은 것이다. 로드밸런서 정책 변경 직후 헬스체크 임계값을 보수적으로 잡지 않은 점, vacuum 작업이 트랜잭션 락을 길게 잡아 replica가 따라오지 못한 점, 그리고 인증서 만료 알림이 이미 폐기된 채널로만 가던 점이 각각 핵심 원인이었다.

## 후속조치
헬스체크 임계값 시뮬레이션 자동 검증, vacuum 시간대 격리 정책, 인증서 만료 알림 채널 다중화 세 가지 작업을 이번 달 안에 완료한다. 각 작업의 owner 와 일정은 별도 티켓에 추적한다.
회고 작성자 사인오프: ops-on-call."""


H10_BAD = """## 무슨 일이 있었나
maybe a few problems happened in April. We had OPS-4187 and OPS-4192 and OPS-4205 and possibly OPS-4900 too.

- one
  - nested
- two

It seems we lost about 1247 requests at peak and 3408 broke later.

[link](http://example.com)

회고 작성자 사인오프: ops-on-call."""


def test_h10_good_output_passes_threshold():
    truth = _load_truth("H10")
    score = g.score_h10_strict_instruction_following(H10_GOOD, truth)
    threshold = truth["primary_metric"]["pass_threshold"]
    assert score["primary_score"] >= threshold, (
        f"good output scored {score['primary_score']} < threshold {threshold}; "
        f"failures: {[c for c in score['constraint_results'] if not c['passed']]}"
    )
    assert score["primary_pass"] is True


def test_h10_bad_output_fails_multiple_constraints():
    truth = _load_truth("H10")
    score = g.score_h10_strict_instruction_following(H10_BAD, truth)
    failed = [c for c in score["constraint_results"] if not c["passed"]]
    failed_ids = {c["id"] for c in failed}
    # bad output violates: word count (too short), section set (1 H2 not 4),
    # link present, nested bullet, hedging words, integers without commas,
    # ticket count (4 found incl OPS-4900 not in approved set)
    expected_violations = {"C1", "C2", "C3", "C4", "C5", "C6", "C8"}
    assert expected_violations.issubset(failed_ids), (
        f"expected violations {expected_violations} not subset of {failed_ids}"
    )
    assert score["primary_score"] < 0.5
    assert score["primary_pass"] is False


# ─── H1 — long-form code review ─────────────────────────────────────────────
H1_GOOD = """| ID | Line | Severity | Issue | Recommended fix |
|----|------|----------|-------|-----------------|
| B1 | 50 | Critical | requests.post inside db_session() transaction holds the DB lock during external HTTP I/O — exactly the pattern OPS-4192 forbids. | Move the dispatch outside the transaction; commit user lookup, then issue HTTP, then write NotificationLog in a second short transaction. |
| B2 | 9  | High | SLACK_WEBHOOK_URL is read from os.environ at module import — violates the vault lazy-load policy for secrets. | Lazy-load the webhook from vault inside _post_slack on first use; cache after first fetch. |
| B3 | 18 | High | _post_slack retries with no Idempotency-Key header — duplicate posts on transient 5xx. | Compute a stable idempotency-key from (user_id, message hash) and add it to the request payload. |
| B4 | 27 | High | _post_sms logs the recipient phone and message body unmasked — PII leak forbidden by team policy; mask_pii helper not applied. | Apply mask_pii(to) and mask_pii(body[:30]) before log.info; same fix for line 61's NotificationLog body. |
| B5 | 18 | High | requests.post in _post_slack has no timeout — call can hang indefinitely. | Pass timeout=5 (or the team default) and convert exceptions to retry-eligible errors. |
| B6 | 45 | Medium | Line numbering jumps backward (44 → 35) inside _post_email — broken diff, the file as-shipped will not be parseable; gap suggests a copy-paste error. | Renumber lines 35-46 sequentially after 44; ensure the diff was generated from a clean tree. |
"""

H1_BAD = """| ID | Line | Severity | Issue | Recommended fix |
|----|------|----------|-------|-----------------|
| X1 | 11 | Medium | SMTP_HOST is hardcoded magic value, should be from config. | Move to config file. |
| X2 | 52 | High | user not found returns False silently. | Raise NotFoundError instead. |
| X3 | 22 | Low | log.warning should be log.error on failure. | Change level to error. |
"""


def test_h1_good_output_passes_threshold():
    truth = _load_truth("H1")
    score = g.score_h1_long_form_code_review(H1_GOOD, truth)
    threshold = truth["primary_metric"]["pass_threshold"]
    assert score["primary_score"] >= threshold, (
        f"good scored {score['primary_score']} < {threshold}; missed={score['missed_issue_ids']}"
    )
    assert score["matched_issue_ids"] == ["B1", "B2", "B3", "B4", "B5", "B6"]
    assert score["flagged_distractors"] == []


def test_h1_bad_output_only_flags_distractors():
    truth = _load_truth("H1")
    score = g.score_h1_long_form_code_review(H1_BAD, truth)
    assert score["matched_issue_ids"] == []
    assert set(score["flagged_distractors"]) == {"D1", "D2", "D3"}
    assert score["primary_score"] == 0.0
    assert score["primary_pass"] is False


# ─── H2 — multi-hop reasoning ───────────────────────────────────────────────
H2_GOOD = """## 추론
- step 1: 단서 3에 의해 Bob = 데스크 4 + TypeScript로 fix.
- step 2: 단서 4와 단서 2를 함께 적용하면 27"는 데스크 2, 32"는 데스크 3이므로 데스크 1과 4에는 34"/43"이 남는다.
- step 3: 단서 5에 의해 Go 사용자가 43" 모니터를 쓴다. Bob(데스크 4)은 TypeScript이므로 43"가 아니다 → Bob = 34", 데스크 1 = 43" + Go.
- step 4: 단서 1에 의해 Alice는 Rust 사용자의 바로 왼쪽이다. 만약 Alice가 데스크 3이면 Rust는 데스크 4(Bob)이어야 하는데 Bob은 TypeScript라 모순(contradict). 따라서 Alice는 데스크 1 또는 2. 데스크 1(43"+Go)이 가장 일관 → Alice = 데스크 1 + 43" + Go.
- step 5: Carol 모니터 > Dan 모니터(단서 4)이므로 Carol = 32"(데스크 3), Dan = 27"(데스크 2). Rust = 데스크 2 = Dan.
- step 6: 남은 언어는 Python, Carol에게 할당. 단서 6 (Dan ≠ Python)도 만족.

## 답
- (Q-A) 답: Carol 이 Python 을 사용한다.
- (Q-B) 답: Rust 사용자(Dan)의 모니터는 27" 이다.
- (Q-C) 답: 43" 모니터는 데스크 1번에 있다.
"""

H2_BAD = """## 답
- (Q-A) 답: Bob.
- (Q-B) 답: 32".
- (Q-C) 답: 데스크 3번.
"""


def test_h2_good_output_passes_threshold():
    truth = _load_truth("H2")
    score = g.score_h2_multi_hop_reasoning(H2_GOOD, truth)
    threshold = truth["primary_metric"]["pass_threshold"]
    assert score["primary_score"] >= threshold
    assert score["sub_question_correct_count"] == 3
    assert len(score["matched_steps"]) >= 3


def test_h2_bad_output_fails():
    truth = _load_truth("H2")
    score = g.score_h2_multi_hop_reasoning(H2_BAD, truth)
    assert score["sub_question_correct_count"] == 0
    assert score["matched_steps"] == []
    assert score["primary_score"] < 0.3
    assert score["primary_pass"] is False


# ─── H3 — multilingual recall ko→en ─────────────────────────────────────────
H3_GOOD = """## Nova 3 Korea Launch Briefing

Date: 2026-06-15
Speaker: Park Seoyeon (PM, Korea office)
Support: Kim Dohyeon (engineer), Carla Rivera (global PM)

### 1. Product Overview

Nova 3 promotes Payment Service Provider (PSP) integration to GA starting v3.7.2. During the beta period (2026 Q1) we ran a five-PSP pilot; twelve PSPs are now wired in.

### 2. Performance SLO

For the API route /v1/orders, p99 < 80ms with average throughput 4,200 RPS. Compared to beta, RPS is 1.7x higher and p99 latency is 32% lower.

| Metric | Beta | GA |
| --- | --- | --- |
| p99 latency | 118ms | 80ms |
| Throughput (RPS) | 2,470 | 4,200 |
| PSPs integrated | 5 | 12 |

### 3. First 30 Days Plan

- Korea office begins night-time on-call rotation.
- Twice-weekly sync with global PM Carla Rivera.
- v3.7.3 hotfix window 2026-07-01 ~ 2026-07-15.
"""

H3_BAD = """Nova3 launched in Korea. Park Seoyeon presented. It is the market leader and best-in-class.
Performance is great.
"""


def test_h3_good_output_passes_threshold():
    truth = _load_truth("H3")
    score = g.score_h3_multilingual_recall_ko_en(H3_GOOD, truth)
    threshold = truth["primary_metric"]["pass_threshold"]
    assert score["primary_score"] >= threshold
    assert not score["fabrication_hits"]
    assert score["entity_rate"] == 1.0


def test_h3_bad_output_fails_with_fabrication():
    truth = _load_truth("H3")
    score = g.score_h3_multilingual_recall_ko_en(H3_BAD, truth)
    assert score["fabrication_hits"]  # "market leader", "best-in-class"
    assert score["primary_pass"] is False
    assert score["primary_score"] < 0.5


# ─── H5 — agentic tool use ──────────────────────────────────────────────────
H5_GOOD = """## Plan

1. run_tests(target="tests/test_refund.py::test_partial_refund_within_24h") — reproduce the failure deterministically; capture the AssertionError trace and confirm exit code is non-zero before touching code.
2. read_file(path="tests/test_refund.py") — read the failing test (line 42) so I know the exact inputs `order_id=42` and `amount=Decimal("12.50")` and the expected `is True` invariant.
3. grep_search(pattern="def (apply_refund|is_within_24h|compute_refund_amount)", path="payments-svc/") — locate definitions of the three candidate functions across refund.py and time_utils.py.
4. read_file(path="payments-svc/refund.py") — read apply_refund's body and follow its calls into time_utils to identify the buggy comparison or rounding step.
5. read_file(path="payments-svc/time_utils.py") — confirm whether is_within_24h returns the expected bool for a now-vs-order_time delta around the 24h boundary.
6. edit_file(path="payments-svc/time_utils.py", old_text="<exact off-by-one comparison>", new_text="<corrected inclusive comparison>") — apply the minimal fix once the diagnosis is confirmed.
7. run_tests(target="tests/test_refund.py::test_partial_refund_within_24h") — verify the fix turns the failure green; then run the broader `tests/` to confirm no regression.
8. git_commit(message="fix(refund): inclusive 24h boundary in is_within_24h (apply_refund test)") — commit only after both the targeted and broader test passes.
"""

H5_BAD = """## Plan

1. analyze_diff(path="refund.py") — figure out what changed.
2. web_search(query="partial refund bug python") — look up similar issues online.
3. ask_user(question="what should I do?") — confirm direction.
"""


def test_h5_good_output_passes_threshold():
    truth = _load_truth("H5")
    score = g.score_h5_agentic_tool_use(H5_GOOD, truth)
    threshold = truth["primary_metric"]["pass_threshold"]
    assert score["primary_score"] >= threshold, (
        f"good scored {score['primary_score']} < {threshold}; recall={score['required_recall']} "
        f"order={score['ordering_rate']} phantom={score['phantom_tool_calls']}"
    )
    assert set(score["matched_required_tools"]) == {"read_file", "grep_search", "edit_file", "run_tests"}
    assert score["phantom_tool_calls"] == []
    assert score["citation"]["test_target"] is True


def test_h5_bad_output_uses_phantom_tools():
    truth = _load_truth("H5")
    score = g.score_h5_agentic_tool_use(H5_BAD, truth)
    assert "analyze_diff" in score["phantom_tool_calls"]
    assert "web_search" in score["phantom_tool_calls"]
    assert "ask_user" in score["phantom_tool_calls"]
    assert score["primary_pass"] is False
    assert score["primary_score"] < 0.3
