---
name: deliberation-test
description: 딜리버레이션 테스트를 자동으로 오케스트레이션합니다. 모든 CLI 턴을 자동 실행하고 결과를 분석합니다.
triggers:
  - "딜리버레이션 테스트"
  - "deliberation test"
  - "토론 테스트"
  - "deliberation 테스트"
  - "테스트 돌려"
---

# Deliberation Test Orchestrator

딜리버레이션 세션을 자동으로 오케스트레이션하며 모든 턴을 실행하고 결과를 분석합니다.

## 워크플로우

### 1. 세션 시작
`deliberation_start` MCP 도구로 세션을 시작합니다.

기본 설정:
- **speakers**: claude (critic), codex (implementer), gemini (researcher)
- **rounds**: 2
- **ordering_strategy**: cyclic
- **role_preset**: review

사용자가 topic을 지정하지 않으면 현재 프로젝트 컨텍스트에서 적절한 주제를 생성합니다.

### 2. 턴 실행
모든 라운드의 모든 턴을 순서대로 자동 실행합니다:

```
for each round:
  for each speaker:
    deliberation_cli_auto_turn(session_id, timeout_sec=180)
    → 결과 확인 및 다음 턴으로 진행
```

각 턴 완료 후 진행 상황을 사용자에게 보고합니다:
- `R{round}/{max_rounds} — {speaker} 완료 ({elapsed}초)`

### 3. 합성
모든 라운드 완료 후 `deliberation_history`로 전체 히스토리를 조회하고 `deliberation_synthesize`로 합성 보고서를 작성합니다.

합성 보고서에는 반드시 포함:
- 검증 결과 요약 (테이블)
- 합의 사항
- 후속 과제 (우선순위별)
- 세션 통계 (라운드, 턴, 합의율, 평균 응답시간)

### 4. 결과 검증
세션 완료 후 자동으로 검증합니다:

1. **투표 마커 준수율**: 모든 턴에 [AGREE]/[DISAGREE]/[CONDITIONAL] 포함 여부
2. **role_drift 오탐**: 각 턴의 role_drift 플래그 확인
3. **런타임 로그**: `runtime.log`에 SESSION_CREATED, TURN, CLI_TURN, SYNTHESIZED 이벤트 존재 확인
4. **응답 시간**: 각 CLI 턴의 소요 시간 확인

검증 결과를 테이블로 출력합니다.

### 5. 아카이브 확인
Obsidian 아카이브가 생성되었는지 확인하고 경로를 출력합니다.

## 주의사항
- 각 CLI 턴의 timeout은 180초 (cold-start 대비)
- 턴 실패 시 1회 재시도 후 다음 턴으로 진행
- 세션 상태는 `deliberation_status`로 수시 확인 가능
