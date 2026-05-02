위 PR diff (`services/notify_dispatcher.py`)의 **코드 리뷰**를 수행해줘. PR 작성자는 가벼운 리팩토링과 신규 알림 채널(Slack) 추가라고 주장하지만, 우리 팀의 코딩 표준 + 프로덕션 운영 경험상 **bug/regression 후보 6건**이 숨어 있다.

출력은 markdown 테이블을 권장하지만 다른 형식(JSON, 리스트 등)도 허용됩니다 (포맷은 감점 대상이 아님):

```
| ID | Line | Severity | Issue | Recommended fix |
|----|------|----------|-------|-----------------|
| B1 | 23   | Critical | ...   | ...             |
| B2 | ...  | ...      | ...   | ...             |
```

규칙:

(1) 각 행은 우리 팀이 정의한 severity 레벨 — `Critical` / `High` / `Medium` / `Low` 중 하나.

(2) `Line` 컬럼은 diff 본문(`services/notify_dispatcher.py` 새 버전 기준) 줄 번호.

(3) `Issue`는 한 줄 설명(왜 버그인지). `Recommended fix`는 한 줄.

(4) 불필요한 prose는 피해주세요.

(5) **확실하지 않은 항목은 적지 말 것.** 잘못된 flag(false positive)는 리뷰어 신뢰도에 페널티. 우리 팀에는 "스타일 취향"을 버그로 보고하는 관행이 없다 — 명확한 incorrectness, security risk, 또는 production-impact 만 포함.

(6) 정답 분포: severity별 1건 이상이 다 있다고 가정하지 마. 정답 분포는 일부 severity가 0건일 수 있다. 분포 균형을 위해 항목을 추가하지 마.
