--- User (Turn 1) ---
PR #5184 검토 좀 부탁해. services/notify_dispatcher.py 리팩토링 + Slack 채널 추가라고 하는데 prod에서 리트라이 / 권한 / 로깅 부분 좀 까다로워서 매의 눈으로 봐줘.

--- Agent (Turn 1) ---
네 PR #5184 코드리뷰. notify_dispatcher 모듈 컨텍스트 — outbound 알림 전송, 대상 채널은 email / SMS / Slack. 현재 코드 구조 한 번 볼게요. 우리 팀 표준 (timeout 명시, structured log, secret env-only, retry 멱등성) 기준으로 보겠습니다.

--- User (Turn 2) ---
좋아. 표준은 그게 맞아. 추가로 — Slack webhook URL은 vault에서 lazy load 하는 게 우리 표준이고, 직접 env에 박아넣는 건 곧바로 reject. 그리고 retry는 idempotency-key 없으면 안 돼.

--- Agent (Turn 2) ---
이해. vault lazy load + idempotency-key 강제. 추가 확인 — 알림 전송 실패시 우리 팀은 PII (이메일, 전화번호)를 로그에 절대 남기지 않습니다. 마스킹 헬퍼 (mask_pii) 사용 강제. PR diff 보면서 체크하겠습니다.

--- User (Turn 3) ---
정확. PII 로그는 hard-fail. 한 가지 더 — 이번 분기 incident OPS-4192 이후로 DB 트랜잭션 안에서 외부 HTTP 호출 금지. 트랜잭션 hold 길어지면 replica lag 폭주. 이 룰도 위반 즉시 reject.

--- Agent (Turn 3) ---
확인. (1) vault lazy-load secrets, (2) idempotency-key on retry, (3) PII masking on logs, (4) no external HTTP inside DB transaction. 4개 정책. 이제 PR diff 보면서 위반 사항 + 일반 버그 같이 정리하겠습니다.
