# ADR Template

신규 ADR 작성 시 이 스켈레톤 복사. 파일명: `docs/adr-NNNN-{slug}.md`.

---

```markdown
---
type: adr
status: proposed
scope: local | cross-project | ecosystem | constitutional
decision_type: two-way | one-way
date: YYYY-MM-DD
author: aigentry-architect-{cli}
tags: []
supersedes: []
related: []
related_tasks: []
---

# ADR-NNNN: {한 줄 요약 — 무엇을 결정했는가}

## §1 Context

왜 이 결정이 필요한가. 문제 상황, 트리거 이벤트, 제약 조건.

### §1.1 Evidence

- [REF: analyst-diagnostic-{id}] — 관련 런타임 증거
- [REF: benchmark-{id}] — 성능/품질 데이터
- [REF: user-request / task-#{id}] — 사용자 요건

### §1.2 기존 메커니즘 대조 (해당 시)

이미 존재하는 capability 목록 — 재구현 회피 (§5.3 ADR-76 패턴).

| Capability | Already exists | Location |
|-----------|:-:|----------|
| ... | YES / NO | file:line |

## §2 Decision

한 문단 핵심 결정. 다음 섹션에서 근거 상세.

## §3 Alternatives Considered

**§5.3 INVARIANT: 최소 2개 대안 필수, 각 트레이드오프 명시.**

### §3.1 Alternative A: {이름}

- **설명**: 어떤 접근인가
- **장점**: ...
- **단점**: ...
- **탈락 이유**: evidence에 기반한 비교 결과

### §3.2 Alternative B: {이름}

(동일 구조)

### §3.3 Chosen: {선택한 접근}

- **설명**: ...
- **선택 근거**: Alt A/B 대비 우위 (§5 Trade-off Matrix 참조)

## §4 Constitution Check

aigentry 헌법 §4 위헌 심사. `references/constitution-check.md` 5개 필수 질문에 각각 답변.

### Q1: AI 기술 격차 해소에 복무하는가?
- PASS / FAIL / N/A + 1문장 근거

### Q2: 이 기능은 어느 컴포넌트의 역할인가?
- PASS / FAIL / N/A + 근거

### Q3: 이 프레임워크/라이브러리가 정말 필요한가?
- PASS / FAIL / N/A + 근거

### Q4: 모든 크로스 환경에서 동작하는가?
- PASS / FAIL / N/A + 근거

### Q5: 사용자에게 "어떻게"를 강요하지 않는가?
- PASS / FAIL / N/A + 근거

### Q6+ (scope: constitutional 시)

`references/constitution-check.md` 18조 전수 검증.

## §5 Trade-off Matrix

| 기준 | Weight | Alt A | Alt B | Chosen |
|-----|:-:|:-:|:-:|:-:|
| 구현 복잡도 | 2 | | | |
| 리스크 | 3 | | | |
| 헌법 정합 | 5 | | | |
| 크로스 플랫폼 호환 | 3 | | | |
| 성능/비용 | 2 | | | |
| 가역성 | 2 | | | |
| Total (weighted) | | | | |

## §6 Backward Compatibility

**§5.8 INVARIANT: 이 섹션 누락 금지.**

- 기존 consumer 목록
- 각 consumer의 수정 필요성
- Migration path (필요 시) 또는 "Additive, no migration needed"

## §7 Consequences

### §7.1 긍정적 결과

- ...

### §7.2 비용 / 부정적 결과

- ...

### §7.3 알려지지 않은 리스크

- ...

### §7.4 의존 컴포넌트 실패 시나리오 (§6.2 FAILED APPROACHES 반영)

- orchestrator crash 시 동작
- 리뷰어 풀 부족 시 fallback
- ...

## §8 Verification Plan

**§5.9 INVARIANT: 측정 가능한 메트릭 필수.**

| 메트릭 | 측정 방법 | 성공 임계값 | 실패 시 rollback 트리거 |
|-------|---------|-----------|----------------------|
| M1 | | | |
| M2 | | | |

## §9 Open Questions

구현 전 해결 필요한 모호 점. 답변 없이 accepted 금지.

- Q1: ...
- Q2: ...

## §10 Related

- **Supersedes**: 대체하는 이전 ADR (있을 경우)
- **Related ADRs**: 참조/의존 관계
- **Related tasks**: task-queue #{id} 목록
- **Analyst diagnostics**: 증거 기반 진단 ref
- **Benchmarks**: 성능/품질 측정 결과
```

---

## 네이밍 규칙

- `adr-NNNN-{slug}.md` 형식
- NNNN: task-queue ID (우선) 또는 증가 시퀀스
- slug: kebab-case, 3-6 단어, 결정의 핵심 표현

예:
- `adr-264-mcp-deliberation-api-v2.md`
- `adr-76-dynamic-subsession-lifecycle.md`

## Worked Example

canonical reference: `~/projects/aigentry-architect/docs/spec-adr-76.md`

해당 파일은 이 템플릿의 실제 구현 예시. 신규 ADR 작성 시 병행 참조 권장.
