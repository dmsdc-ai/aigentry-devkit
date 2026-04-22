---
title: "P3 Pilot 결과 — 4개 실행 모드 쉬운 해설 (중간 요약)"
date: 2026-04-21
updated: 2026-04-22 (H8 deep-fix 후 재채점 반영 · fix4 스냅샷)
audience: 에이전트리 사용자 / 비기술 독자
status: 중간 요약 (Claude analyst 완료 기준, Codex 교차검증 대기 중)
supersedes: 기술 보고서 "2026-04-21-exec-mode-analyst-phase3.md"의 평이한 번역
---

## Addendum — H8 fix 이후 업데이트 (2026-04-22)

F10 grader 버그(H8, commit `f5fdd3d`)가 수정되어 40 × F10 trial을 **재채점**했습니다. 본문 수치는 모두 **fix4 스냅샷**(`docs/data/raw/2026-04-21-full-pilot-fix4.tar.gz`, SHA-256 `98d733b5…`) 기준으로 갱신되었습니다.

| 항목 | 업데이트 전 (fix2/3) | 업데이트 후 (fix4) | 참고 |
|---|---:|---:|---|
| D 품질 | 0.684 | **0.734** | F10이 0.0 → 1.0으로 반등 |
| S 품질 | 0.637 | **0.727** | 같은 원인 — D와 거의 동률 |
| Pfresh 품질 | 0.478 | **0.503** | F10 부분 통과 (0.0 → 0.25) |
| Pacc 품질 | 0.164 | **0.184** | F10 일부 통과 (0.0 → 0.32) |
| F10 D/S 품질 | 0.0 / 0.1 | **1.0 / 1.0** | grader bug가 실제 100% 성공을 0%로 오판하고 있었음 |
| Non-zero trials (D/S) | 90 / 86 | **95 / 95** | 모드 순위(D ≈ S)는 유지 |

변경 사항:
- fix3 (pre-H8) 원본은 `2026-04-21-full-pilot-fix2.tar.gz`로 **보존** (감사용 불변 스냅샷).
- fix4 (post-H8) 가 이후 분석·의사결정 트리의 canonical snapshot.
- 비용/오염/유실 수치는 H8 재채점 대상이 아니므로 fix2와 동일 (F10 cost도 그대로 유지).
- "Codex 교차검증 대기 중"/"interim" 상태 플래그는 그대로 유지 — 교차검증은 fix4 기준으로 진행.

이하 본문은 fix4 수치 기준으로 갱신되었습니다. "(interim)" 표기가 남아있는 구간은 Codex 교차검증·Phase 4 완료 전까지의 한정 문구입니다.

---

# P3 Pilot 결과 — 4개 실행 모드 쉬운 해설

## 1. 이 실험이 뭘 측정했는가

**질문**: "Claude 세션에 새 작업을 맡길 때, 4가지 실행 방식 중 무엇을 선택해야 하나?"

**4가지 방식**:
| 방식 | 뜻 | 비유 |
|---|---|---|
| **D** (Dynamic) | 매 작업마다 새 세션 | 매번 새 기사 불러서 질문 |
| **Pfresh** (Persistent-fresh) | 세션은 쓰지만 매번 초기화 + 워밍업 재생 | 같은 기사인데 메모 버리고 프로토콜만 재전달 |
| **Pacc** (Persistent-accumulated) | 세션에 계속 일 쌓기 | 한 기사에게 10개 연속 질문 |
| **S** (Subagent) | 서브에이전트에 위임 | 보조자에게 태스크 이관 |

**측정 4가지 (독립적으로)**:
1. **Quality (품질)** — 작업 정확도 (0~1)
2. **Cost (비용)** — 토큰 사용량 환산 가격
3. **Pollution (오염)** — 이전 작업의 정보가 새 작업에 오작동 유발
4. **Loss (유실)** — 이전 정보가 기억에서 사라져 요청 시 답 못 함

**규모**: 4 모드 × 10 fixture (시나리오) × 10 seed (반복) = **400 trials**, 실제 **399 수집** (1건 타임아웃)

---

## 2. 핵심 발견 5가지

### 🥇 **D가 종합 승자** (품질 0.73, 비용 $0.10)
- 품질 최고, 비용 중간
- 95% 작업이 "정상 결과" 냈음 (fix4 재채점 후)
- **안전한 기본 선택**

### 🥈 **S는 D와 거의 동등** (품질 0.73, 비용 $0.11)
- D와 품질 차이 ≤ 0.01 (사실상 동률)
- 통계적으로 D와 구분 안 됨 (CI 겹침)
- **차이점**: S는 subagent 사용 — context 격리되어 오염 조금 덜함

### 🥉 **Pfresh는 비용함정** (품질 0.50, 비용 $0.51 at n=1)
- **핵심 숨겨진 사실**: 단 1회 사용 시 **$0.51/trial** — D보다 **5배 비쌈**
- Warmup(프로토콜 재생) 비용이 지배적
- 10회 이상 재사용할 때만 D와 비슷해짐
- **규칙**: "이 세션 최소 10번 쓸 것 같으면 Pfresh 고려"

### 🚨 **Pacc는 누적 붕괴** (품질 0.18, 비용 $0.12)
- **충격 발견**: 세션에 작업 쌓을수록 품질 급락
  - 첫 번째 작업 (pos=1): 품질 **0.49**
  - 여덟 번째 (pos=8): 품질 **0.00**
  - 10개 작업 후: 거의 쓸모없음
- 10개 fixture 중 **8개에서 탈락** (Fa, F10 부분 통과는 H8 fix 이후 확인)
- **규칙**: "Pacc 쓰지 마세요" (Fa/F10 예외도 고위험)

### ✅ **F10 fixture — H8 재채점으로 해소됨**
- fix2 기준: D 0%, Pfresh 0%, Pacc 0%, S 0% (grader bug로 전부 오판)
- fix4 기준: **D 100%, Pfresh 25%, Pacc 32%, S 100%**
- 원인: grader의 `## (a)` 라벨 정규식이 체크리스트 통과를 false-negative 처리
- 수정 완료: commit `f5fdd3d` (H8 deep-fix) + fix4 재채점

---

## 3. 숫자로 한눈에

| Mode | 품질 | 비용/trial | Non-zero % | 주요 특징 |
|---|---:|---:|---:|---|
| **D** | **0.734** | $0.102 | 95% | 종합 승자 |
| **S** | 0.727 | $0.108 | 95% | D와 사실상 동률 |
| **Pfresh** | 0.503 | $0.51 (n=1) | 75% | 재사용 많아야 값어치 |
| **Pacc** | **0.184** | $0.116 | 40% | 사용 금지 (Fa 제외) |

수치는 2026-04-22 fix4 스냅샷 (`data.csv` — `docs/data/analyzer-output-fix4/`) 기준. CI는 모두 bootstrap 95% 신뢰구간 (통계적 엄밀성 있음, N=100 per mode, Pacc는 N=99).

---

## 4. 실전 의사결정 트리 (초안 — 아직 LOCK 안 됨)

```
시작: 새 작업 맡길 때
│
├─ 이 세션 10회+ 재사용할 예정?
│   │
│   ├─ 예 → **Pfresh** 고려 (amortization 이득)
│   │       └─ 단, 작업이 다양하면 D가 나을 수 있음
│   │
│   └─ 아니오 → 아래로
│
├─ 작업들이 서로 관련 있고 context 쌓기 필요?
│   │
│   ├─ 예 → ⚠️ **Pacc 쓰지 말 것** (누적 붕괴)
│   │       └─ 예외: Fa-type fixture만 (false prior 감지)
│   │
│   └─ 아니오 → 아래로
│
├─ Subagent 격리가 필요? (context 오염 최소화)
│   │
│   ├─ 예 → **S** 선택
│   │
│   └─ 아니오 → **D** (기본 선택)
│
└─ 어려운 fixture 감지 (F7, F10 같은 구조적 난점)?
    └─ 두 모드 중 고르고 실패 시 재시도 권장
```

**초안인 이유**: F10 재채점은 완료(fix4)되었으나, Codex 교차검증·Phase 4 replication 전까지는 tree v1 lock 유보 (interim).

---

## 5. 에이전트리 프로젝트에 어떻게 적용?

### AGENTS.md Rule 4 (위임 기준) 업데이트 예정
현재 Rule 4는 "언제 위임할지" 기준. 여기에 **"어떤 모드로 위임할지"** 추가 예정:

**초안 5가지 규칙**:
1. **재사용 수평선 게이트**: n<10이면 D 우선 (Pfresh 금지)
2. **Context-heavy 게이트**: context 많으면 S (subagent 격리)
3. **Harmful-carry 예외**: 이전 작업이 다음을 오염시킬 위험 → D 강제
4. **어려운 fixture escalation**: 연속 실패 시 모드 교체
5. **D vs S 선호**: 같은 환경에서 D가 기본, S는 context 격리 필요할 때

### 실사용 시나리오 예시
| 상황 | 추천 모드 | 이유 |
|---|---|---|
| 새 bug fix 1회 | D | 단발, 빠름 |
| 같은 코드베이스 30개 기능 | Pfresh | warmup amortize |
| 민감한 데이터 처리 후 다른 작업 | S 또는 D 신규 | 오염 방지 |
| 세션에 10개 연관 작업 쌓기 | ⛔ Pacc 금지 | 누적 붕괴 |
| 의사결정 트리 복잡 | D + 여러 session | 병렬 |

---

## 6. 실험 신뢰도

- **Pre-registration**: 실험 전 모든 계획 확정 (Git tag `exec-mode-v3-max-preregistered-20260420-fix2/fix3`, 재채점 후 canonical `…-fix4`)
- **Bootstrap CI**: 95% 신뢰구간으로 모든 수치에 오차범위 제공
- **교차검증 진행 중**: Codex (독립 LLM)가 같은 데이터 독립 분석 중 — 일치하면 신뢰도↑, 불일치하면 재조사
- **Phase 4 계획**: 추가 20 seeds × 4 modes = 800 trials 예정 (완전 lock-in 이전 최종 검증)

---

## 7. 지금 당장 사용해도 되는 결론

✅ **확신**:
- Pacc는 쓰지 마세요 (Fa 예외)
- D는 안전한 기본값
- Pfresh는 10회+ 재사용 확정일 때만
- S ≈ D (context 격리 필요 시 S)

⏳ **대기 중**:
- Codex 교차검증 (fix4 기준) → 수치 재확인 후 decision tree LOCK
- F10 재채점은 완료(fix4), 아래 LOCK 조건만 남음

🚧 **Phase 4 필요**:
- 30 seed 전체 replication (현재 10 seed)
- Holdout fixtures 추가 (5개)
- Krippendorff α (jury reliability)

---

## 8. 상세 데이터 접근

- **전체 CSV (fix4)**: `docs/data/analyzer-output-fix4/data.csv`
- **히트맵 (fix4)**: `docs/data/analyzer-output-fix4/heatmaps/` (cost, quality, pollution, loss)
- **Pacc 위치별 그래프 (fix4)**: `docs/data/analyzer-output-fix4/position_effect_pacc_F*.png` (10개)
- **기술 보고서**: `docs/reports/2026-04-21-exec-mode-analyst-phase3.md` (Claude analyst, 472cc9f)
- **원본 데이터**: `docs/data/raw/2026-04-21-full-pilot-fix2.tar.gz` (pre-H8) + `2026-04-21-full-pilot-fix4.tar.gz` (post-H8 canonical) — 둘 다 SHA-256 인증

---

## 9. 다음 단계

| 단계 | 상태 | 결과물 |
|---|:-:|---|
| Phase 3 Codex 교차검증 (fix4 기준) | 🔨 실행 중 | `phase3-codex.md` |
| Reconciliation (Claude vs Codex) | 대기 | orchestrator 수행 |
| H8 grader fix 재채점 | ✅ 완료 | `f5fdd3d` + fix4 snapshot |
| Decision tree v1 **LOCK** | 조건부 | reconciliation 통과 시 |
| AGENTS.md Rule 4 업데이트 | 대기 | architect 세션 |
| Phase 4 실행 (800 trials) | 계획됨 | 완전 검증 |

---

*이 요약은 Claude analyst 완료(`472cc9f`) 시점 기준이며, Codex 교차검증 완료 후 수치 업데이트 예정.*
