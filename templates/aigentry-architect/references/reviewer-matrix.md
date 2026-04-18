# Reviewer Matrix

ADR/SPEC 리뷰어 선정 시 관점 다양성 보장. AWS "diverse perspectives" 원칙 + Track A 벤치 실측 (claude 18 / codex 14 / gemini 8).

## §1 관점 분류 (6개)

| 관점 | 설명 | 주요 리뷰 포인트 |
|------|------|----------------|
| **구현 복잡도** | 실제로 만들 수 있는가, LOC 추정, 테스트 가능성 | LOC estimate, testability, dep introduction |
| **헌법 정합** | aigentry 헌법 18조 위반 여부, 컴포넌트 역할 경계 | Rule 1/3/5/13/14/17 대조 |
| **성능/SLO** | 레이턴시, 메모리, 비용, 처리량 영향 | 병목점, 측정 방법 타당성 |
| **보안/트러스트 경계** | 권한, 샌드박스, 데이터 노출 | 공격 벡터, 최소 권한 원칙 |
| **크로스 플랫폼 호환** | Linux/macOS/Windows/모바일, CLI 종류 | platform-specific 가정, fallback |
| **에지 케이스** | ADR에 명시 안 된 실패/비정상 상황 | crash recovery, race condition, 역할 분리 시나리오 |

## §2 CLI 강점 매핑 (Track A 벤치 검증)

| CLI | 1차 관점 | 2차 관점 | 근거 |
|-----|---------|---------|------|
| **claude** (Opus 4.7) | 헌법 정합 | 아키텍처 구조 | 벤치: 스코프 디시플린 1위, claude 에코 native |
| **codex** (GPT-5.4 high) | 구현 복잡도 | 레거시 호환 | 벤치: 산출물 품질 1위, 처리량 2-3배 우위 |
| **gemini** (3.1 Pro Preview) | 에지 케이스 | 성능/SLO | 벤치: 자기비판 정확도 1위, 2M 컨텍스트 |

### 추가 옵션 (필요 시)

- `web-chatgpt`: 보안/트러스트 경계 (독립 2차 검증)
- `web-perplexity`: 크로스 플랫폼 호환 (외부 벤치마크 자동 조회 강점)
- `aigentry-analyst-{cli}`: 과거 사실 기반 검증 (architect가 못 본 runtime 증거)

## §3 Tier별 리뷰어 구성

### T1 (1명)
- 기본: codex (구현 가능성 1차 검증)
- 대안: 태그 기반 — `performance` 태그면 gemini, `security` 태그면 web-chatgpt

### T2 (2명)
- 기본: codex (구현) + gemini (에지)
- 스코프 확장 시: + claude (헌법 관점, cross-project일 때)

### T3 (3명)
- 필수: claude + codex + gemini (3 관점 모두 커버)
- 예외: 사용자가 특정 관점 우선순위 요청 시 재구성

### 사용자 오버라이드

사용자는 언제든 reviewer matrix 무시하고 특정 CLI 지정 가능. 이유:
- 이해 충돌 (예: gemini가 직전 ADR 작성자였다면 제외)
- 특수 도메인 (예: Android 관련 ADR → 특정 세션 참여)

## §4 제외 규칙

리뷰어 선정 시 다음 제외:

1. **Self-review 금지**: architect 작성자 본인 (claude면 claude 세션 제외)
2. **동일 세션 중복 금지**: 같은 CLI 2회 이상 리뷰어 할당 불가 (T2에서 codex 2번 등)
3. **Confilct 있는 reviewer**: 직전 관련 ADR 작성자 또는 강한 이해관계자

## §5 관점 커버리지 검증

리뷰어 확정 후 체크:

| 관점 | T1 커버 | T2 커버 | T3 커버 |
|------|:-:|:-:|:-:|
| 구현 복잡도 | ✅ | ✅ | ✅ |
| 헌법 정합 | (tag 기반) | ✅ (추가 시) | ✅ |
| 에지 케이스 | (tag 기반) | ✅ | ✅ |
| 성능/SLO | (tag 기반) | (gemini 2차) | (gemini) |
| 보안 | (tag 기반) | (필요 시 추가) | (필요 시 추가) |
| 크로스 플랫폼 | (tag 기반) | (필요 시 추가) | (필요 시 추가) |

T2 이상은 최소 2개 관점, T3는 최소 3개. 부족 시 추가 리뷰어 할당.

## §6 리뷰어 교체 시그널

다음 발생 시 해당 리뷰어 신뢰도 재평가:

- **반복 허위 긍정 (ACCEPT인데 나중 리뷰에서 결함 발견)**: 이전 ACCEPT 결정 monthly 감사
- **반복 허위 부정 (REQUEST-REVISION 이유가 부실)**: architect 반박 후 사용자 판단
- **Scope 벗어난 리뷰 (관점 외 지적)**: 해당 reviewer 다음 할당 시 다른 관점 배정

측정은 future work (현재는 수동 관찰).

## §7 ADR-76 리뷰 실례 분석

### codex 리뷰 (adr-76-review-aigentry-orchestrator-codex.md)
- 관점: **구현 복잡도 + 레거시 호환** (1차 + 2차 정확히 부합)
- 주요 지적: LOC 440 과소평가 (실제 600-700 예상), M_ctx 측정 불가, orchestrator crash 경로 누락
- 품질: HIGH (구체적 file:line 인용 풍부)

### gemini 리뷰 (동일 파일 내)
- 관점: **에지 케이스 + 성능/SLO** (1차 + 2차 정확히 부합)
- 주요 지적: spawn storm 가능성, deadlock 리스크, UI 과부하
- 품질: HIGH (실제 공격 벡터 포함)

이 실례는 관점 매핑의 실무 효과성을 입증. 동일 패턴 신규 ADR에도 적용.
