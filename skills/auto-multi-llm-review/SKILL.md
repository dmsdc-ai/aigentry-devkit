---
name: auto-multi-llm-review
description: |
  오케스트레이터가 단일 LLM blind spot을 감지하면 자동으로 multi-LLM deliberation을 호출하는 스킬.
  사용자 요청 없이 오케스트레이터가 자율적으로 트리거합니다.
  아키텍처 결정, 트레이드오프 분석, 합의안 재검토, 구현 방향 불확실, 보안/성능/확장성 결정 시 자동 활성화.
---

# Auto Multi-LLM Review

오케스트레이터가 단일 LLM의 blind spot을 감지했을 때, 사용자 요청 없이 자율적으로 multi-LLM deliberation을 시작하는 스킬입니다.

## 핵심 원칙

이 스킬은 **사용자가 호출하지 않습니다.** 오케스트레이터가 아래 조건을 자율 판단하여 자동 트리거합니다.

## 자동 트리거 조건

오케스트레이터는 다음 중 하나라도 감지하면 이 스킬을 자동 호출합니다:

| 조건 | 예시 |
|------|------|
| 아키텍처 결정이 필요할 때 | monorepo vs polyrepo, DB 선택, 서비스 분리 기준 |
| 트레이드오프 분석이 필요할 때 | 성능 vs 가독성, 일관성 vs 가용성, 단순성 vs 확장성 |
| 기존 합의안 재검토할 때 | 이전 deliberation 결론에 새 제약이 생김 |
| 구현 방향에 확신이 없을 때 | 2개 이상의 동등한 접근 방식이 존재 |
| 보안/성능/확장성 중요 결정일 때 | 인증 방식, 캐싱 전략, 샤딩 기준 |

### 트리거 판단 기준

아래 신호가 2개 이상 동시에 감지되면 높은 확률로 트리거합니다:

1. **불확실성 언어**: "~일 수도", "아마", "확실하지 않지만", "둘 다 가능"
2. **대안 존재**: 동등한 선택지가 2개 이상 식별됨
3. **영향 범위**: 결정이 3개 이상의 파일/모듈/서비스에 영향
4. **되돌리기 비용**: 결정 후 변경 비용이 높음 (DB 스키마, API 계약, 인증 체계)
5. **도메인 경계**: 결정이 2개 이상의 팀/프로젝트 영역에 걸침

### 트리거하지 않는 경우

- 단순 구현 작업 (패턴이 명확한 CRUD, 유틸 함수)
- 이미 합의된 방향의 세부 구현
- 문서화, 포맷팅, 린트 수정
- 사용자가 명시적으로 방향을 지정한 경우

## 워크플로우

### 1. Blind Spot 감지

오케스트레이터가 작업 중 위 트리거 조건을 감지합니다.

### 2. 사용자 알림 (1줄)

```
> Auto-triggering multi-LLM review: "{topic}" — 아키텍처 결정에 다각적 검증이 필요합니다.
```

사용자가 즉시 취소할 수 있도록 짧게 알립니다. 취소하지 않으면 자동 진행합니다.

### 3. Deliberation 시작

MCP deliberation 서버를 통해 구조화된 토론을 시작합니다.

```
deliberation_start({
  topic: "<감지된 결정 사항>",
  speakers: ["claude", "codex", "gemini"],
  rounds: 3,
  context: "<현재 작업 컨텍스트, 코드 스니펫, 제약 조건>"
})
→ session_id 획득
```

**speakers 선택 규칙:**
- 기본: `claude`, `codex`, `gemini` (3개 CLI)
- `deliberation_speaker_candidates`로 실제 가용 speaker 확인
- 가용하지 않은 speaker는 자동 제외
- 최소 2개 speaker가 필요. 1개만 가용하면 트리거 취소

### 4. 자동 진행

```
deliberation_run_until_blocked({ session_id: "<session_id>" })
```

모든 라운드가 자동으로 진행됩니다. CLI speaker는 자동 응답하고, 브라우저 speaker가 있으면 CDP로 자동화합니다.

blocked 상태가 되면:
- `deliberation_route_turn`으로 현재 차례 확인
- 수동 입력이 필요한 speaker가 있으면 skip하고 다음으로 진행
- 전체 blocked이면 현재까지 결과로 synthesis

### 5. Synthesis

```
deliberation_synthesize({ session_id: "<session_id>" })
```

합성 보고서를 생성하고 토론을 완료합니다.

### 6. 결과 반환

오케스트레이터에게 아래 구조로 결과를 반환합니다:

```markdown
## Multi-LLM Review 결과

**주제:** {topic}
**참여:** {speakers}
**라운드:** {actual_rounds}

### 합의 사항
- ...

### 미합의 / 주의 사항
- ...

### 권장 방향
- ...
```

### 7. 오케스트레이터 후속 처리

오케스트레이터는 결과를 바탕으로:
- 합의 사항을 구현 방향에 반영
- 미합의 사항은 사용자에게 결정을 요청하거나 추가 deliberation 진행
- 권장 방향을 executor에게 전달

## 컨텍스트 구성

deliberation에 넘기는 context는 아래를 포함합니다:

1. **현재 작업 설명**: 무엇을 하고 있었는지
2. **결정 필요 사항**: 구체적으로 어떤 결정이 필요한지
3. **선택지**: 식별된 대안들
4. **제약 조건**: 기술적/비즈니스 제약
5. **관련 코드**: 핵심 코드 스니펫 (있으면)
6. **이전 결정**: 관련된 과거 deliberation 결론 (있으면)

## Deliberation 프로토콜 규칙

각 speaker에게 아래 응답 구조를 요청합니다:

```markdown
**입장:** (추천하는 방향)
**근거:** (2-3개)
**리스크:** (이 방향의 약점 1-2개)
**대안 평가:** (다른 선택지에 대한 의견)
**합의 가능 포인트:** (동의할 수 있는 것)
```

## 에러 핸들링

| 상황 | 처리 |
|------|------|
| MCP deliberation 서버 미등록 | 스킬 트리거 취소, 오케스트레이터에 fallback 알림 |
| speaker 2개 미만 | 트리거 취소, 단일 LLM으로 분석 속행 |
| deliberation_start 실패 | 1회 재시도 후 실패면 취소 |
| deliberation_run_until_blocked 타임아웃 | 현재까지 결과로 synthesis 시도 |
| synthesis 실패 | deliberation_history로 원본 로그 반환 |

## 설정

이 스킬의 동작은 아래 환경변수로 조정할 수 있습니다:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AUTO_MULTI_LLM_REVIEW_ENABLED` | `true` | 자동 트리거 활성화 여부 |
| `AUTO_MULTI_LLM_REVIEW_MIN_SPEAKERS` | `2` | 최소 speaker 수 |
| `AUTO_MULTI_LLM_REVIEW_MAX_ROUNDS` | `3` | 최대 라운드 수 |
| `AUTO_MULTI_LLM_REVIEW_SPEAKERS` | `claude,codex,gemini` | 기본 speaker 목록 |

## 주의사항

1. 이 스킬은 **오케스트레이터 전용**입니다. 사용자가 직접 토론을 원하면 `deliberation` 스킬을 사용합니다.
2. 자동 트리거는 작업 흐름을 중단시키지 않습니다. deliberation은 비동기로 진행되고 결과만 반환합니다.
3. 동일 주제로 중복 트리거하지 않습니다. 최근 30분 내 동일/유사 주제 deliberation이 있으면 그 결과를 재사용합니다.
4. deliberation 결과는 최종 판단이 아니라 **참고 자료**입니다. 오케스트레이터가 결과를 종합하여 최종 방향을 결정합니다.
5. `deliberation_synthesize`의 verdict/consensus 판단은 deliberation 시스템이 담당합니다. 이 스킬은 결과를 전달만 합니다.
