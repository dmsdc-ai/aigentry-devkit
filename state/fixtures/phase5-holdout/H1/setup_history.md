=== PRIOR CONVERSATION HISTORY ===
(다음은 이 task와 관련된 이전 대화 turn들입니다. 이 맥락을 참고하여 아래 task를 수행하세요.)

--- Turn 1 ---
User: PR #5184 검토 좀 부탁해. `services/notify_dispatcher.py` 리팩토링 + Slack 채널 추가라고 하는데 prod에서 리트라이 / 권한 / 로깅 부분 좀 까다로워서 매의 눈으로 봐줘.

--- Turn 2 ---
Agent: 네 PR #5184 코드리뷰. notify_dispatcher 모듈 컨텍스트 — outbound 알림 전송, 대상 채널은 email / SMS / Slack. 현재 코드 구조 한 번 볼게요. 우리 팀 표준 (timeout 명시, structured log, secret env-only, retry 멱등성) 기준으로 보겠습니다.

--- Turn 3 ---
User: 좋아. 표준은 그게 맞아. 추가로 — Slack webhook URL은 vault에서 lazy load 하는 게 우리 표준이고, 직접 env에 박아넣는 건 곧바로 reject. 그리고 retry는 idempotency-key 없으면 안 돼.

--- Turn 4 ---
Agent: 이해. vault lazy load + idempotency-key 강제. 추가 확인 — 알림 전송 실패시 우리 팀은 PII (이메일, 전화번호)를 로그에 절대 남기지 않습니다. 마스킹 헬퍼 (`mask_pii`) 사용 강제. PR diff 보면서 체크하겠습니다.

--- Turn 5 ---
User: 정확. PII 로그는 hard-fail. 한 가지 더 — 이번 분기 incident OPS-4192 이후로 DB 트랜잭션 안에서 외부 HTTP 호출 금지. 트랜잭션 hold 길어지면 replica lag 폭주. 이 룰도 위반 즉시 reject.

--- Turn 6 ---
Agent: 확인. (1) vault lazy-load secrets, (2) idempotency-key on retry, (3) PII masking on logs, (4) no external HTTP inside DB transaction. 4개 정책. 이제 PR diff 보면서 위반 사항 + 일반 버그 같이 정리하겠습니다.

--- Turn 7 ---
User: 좋아. 아래가 변경된 파일 전체야 (`services/notify_dispatcher.py` 새 버전, line numbering 1부터). 

```python
  1: import os
  2: import json
  3: import logging
  4: import requests
  5: from typing import Optional
  6: from .db import db_session
  7: from .models import NotificationLog, User
  8:
  9: SLACK_WEBHOOK_URL = os.environ["SLACK_WEBHOOK_URL"]
 10: TWILIO_API_KEY = os.environ.get("TWILIO_API_KEY", "")
 11: SMTP_HOST = "smtp.internal.example.com"
 12: log = logging.getLogger(__name__)
 13:
 14:
 15: def _post_slack(payload: dict, retries: int = 3) -> bool:
 16:     for attempt in range(retries):
 17:         try:
 18:             r = requests.post(SLACK_WEBHOOK_URL, json=payload)
 19:             if r.status_code < 300:
 20:                 return True
 21:         except Exception as exc:
 22:             log.warning(f"slack post failed attempt={attempt} err={exc}")
 23:     return False
 24:
 25:
 26: def _post_sms(to: str, body: str) -> bool:
 27:     log.info(f"sending SMS to {to} body={body[:30]}")
 28:     r = requests.post(
 29:         "https://api.twilio.com/2010-04-01/Messages.json",
 30:         data={"To": to, "Body": body, "From": "+15555550100"},
 31:         auth=("AC_demo", TWILIO_API_KEY),
 32:         timeout=5,
 33:     )
 34:     return r.status_code == 201
 35:
 36:
 37: def _post_email(to: str, subject: str, body: str) -> bool:
 38:     try:
 39:         r = requests.post(
 40:             f"http://{SMTP_HOST}/relay",
 41:             json={"to": to, "subject": subject, "body": body},
 42:             timeout=5,
 43:         )
 44:         return r.ok
 35:     except Exception:
 46:         return False
 47:
 48:
 49: def dispatch(user_id: int, channel: str, message: str) -> bool:
 50:     with db_session() as session:
 51:         user = session.query(User).get(user_id)
 52:         if not user:
 53:             return False
 54:         ok = False
 55:         if channel == "slack":
 56:             ok = _post_slack({"text": message})
 57:         elif channel == "sms":
 58:             ok = _post_sms(user.phone, message)
 59:         elif channel == "email":
 60:             ok = _post_email(user.email, "Notice", message)
 61:         entry = NotificationLog(user_id=user_id, channel=channel, ok=ok, body=message)
 62:         session.add(entry)
 63:         session.commit()
 64:         return ok
```

이게 새 버전 전체. 자, 위 4개 정책 + 일반적 버그 둘 다 잡아내서 review 테이블 작성해줘. 6건 정도 나올 거야.

=== END OF PRIOR HISTORY ===

