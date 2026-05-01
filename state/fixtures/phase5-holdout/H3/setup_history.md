=== PRIOR CONVERSATION HISTORY ===

--- Turn 1 ---
User: 다음 주 글로벌 발표 자료에 한국 launch 브리핑 영문판이 필요해. 번역 좀 부탁할게.

--- Turn 2 ---
Agent: 네, 한국어 launch 브리핑 → 영문 외부 발표용. 사람 이름, 제품명, 기술 용어, 수치 보존이 중요한 자료라 표기 가이드 먼저 확인하면 좋을 것 같아요. 영문 표기 정해진 게 있나요?

--- Turn 3 ---
User: 응 — (a) 사람 이름은 성-이름 순서, romanization은 발표자 본인 LinkedIn 표기 따라가. 박서연 PM은 "Park Seoyeon"으로, 김도현 엔지니어는 "Kim Dohyeon", Carla Rivera (외국인)은 그대로. (b) 제품명 노바3 → "Nova 3" (스페이스 포함, 공식 영문). (c) 한국지사 → "Korea office".

--- Turn 4 ---
Agent: 확인. (a) 사람 이름 매핑 — 박서연→Park Seoyeon, 김도현→Kim Dohyeon, Carla Rivera→그대로 (b) Nova 3 (with space) (c) Korea office. 추가로 — 약어, 버전, 수치는 어떻게 처리할까요?

--- Turn 5 ---
User: 약어는 첫 등장 시 풀어쓰기 + 약어 형식. 한국어 원문에 "PSP (Payment Service Provider)" 식으로 표기돼 있으면 영문판도 "Payment Service Provider (PSP)"로. 버전 / 수치 / API 경로는 변형 없이 그대로. p99 < 80ms, v3.7.2, /v1/orders, 4,200 RPS, 2026-06-15 같은 토큰들. 그리고 원문에 없는 정보 절대 추가하지 마 — 발표 자료라 사실관계 틀리면 곧장 오류.

--- Turn 6 ---
Agent: 확인. (a) 약어 풀어쓰기 첫 등장 시 (b) 버전/수치/API/날짜/RPS 토큰 변형 없이 그대로 (c) 원문에 없는 사실 추가 금지. 문서 구조 (헤더, bullet, 표) 1:1 보존도 적용하겠습니다.

--- Turn 7 ---
User: 좋아. 아래가 원문이야:

```
## Nova 3 한국 출시 브리핑

발표일: 2026-06-15  
발표자: 박서연 (PM, 한국지사)  
지원: 김도현 (엔지니어), Carla Rivera (글로벌 PM)

### 1. 제품 개요

Nova 3는 v3.7.2 부터 PSP (Payment Service Provider) 통합을 정식 GA로 전환했다. 베타 기간(2026-Q1) 동안 5개 PSP 파일럿을 진행했고, 현재는 12개 PSP가 연동되어 있다.

### 2. 성능 SLO

API 라우트 `/v1/orders` 기준 — p99 < 80ms, 평균 처리량 4,200 RPS. 베타 대비 RPS 1.7배, p99 latency 32% 감소.

| 지표 | 베타 | GA |
| --- | --- | --- |
| p99 latency | 118ms | 80ms |
| Throughput (RPS) | 2,470 | 4,200 |
| 통합 PSP 수 | 5 | 12 |

### 3. 출시 후 30일 계획

- 한국지사 야간 on-call 로테이션 시작
- 글로벌 PM Carla Rivera 매주 2회 sync
- v3.7.3 hotfix window 2026-07-01 ~ 2026-07-15
```

이거 영문판으로 만들어줘.

=== END OF PRIOR HISTORY ===

