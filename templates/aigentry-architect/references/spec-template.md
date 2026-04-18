# SPEC Template

경량 feature-level 설계. ADR보다 간결. 파일명: `docs/spec-{slug}.md`.

SPEC을 쓸지 ADR을 쓸지 불확실하면 CLAUDE.md §4 Decision Tree 참조.

---

```markdown
---
type: spec
status: proposed
scope: local | cross-project | ecosystem
decision_type: two-way | one-way
date: YYYY-MM-DD
author: aigentry-architect-{cli}
tags: []
related_tasks: []
---

# SPEC: {feature-name}

## Goal

한 문단. 무엇을 달성하려는가.

## Scope

### In
- 포함 범위 (구체)

### Out
- 명시적 제외 (착각 방지)

## Approach

### Chosen
- 이번 SPEC에서 택할 접근 (1문단)

### Alternative considered
- 대안 1개 이상 + 탈락 이유 (§5.3 INVARIANT 축약 준수)

## Files Affected

| 경로 | 변경 유형 | 담당 세션 (coder) |
|------|---------|-----------------|
| path/to/file.ts | 수정 | aigentry-{project}-coder |
| new/file.ts | 신규 | aigentry-{project}-coder |

## Verification

- 성공 기준 1-3개 (측정 가능)
- 테스트 전략 (tester 세션이 수행)

## Risks

- 최소 1-3개 + 각 완화책

## Backward Compatibility (해당 시)

- 기존 사용자 영향 분석 (scope ≥ cross-project일 때 필수)

## Open Questions

- 구현 전 명확히 해야 할 모호 점
```

---

## SPEC vs ADR 전환 기준

SPEC 작성 중 다음 조건 발견 시 **ADR로 승격**:

- 영구 결정 (되돌리기 어려운 선택 포함)
- 2+ 프로젝트에 걸친 영향
- 헌법 조항과 연계
- 공개 API / 데이터 스키마 변경

전환 시 SPEC 파일 `status: deprecated`로 변경 + 새 ADR의 `supersedes` 필드에 SPEC 참조.

## Worked Example

짧은 예시 — 신규 SPEC은 다음 템플릿에 맞춰:

```yaml
---
type: spec
status: proposed
scope: local
decision_type: two-way
date: 2026-04-18
author: aigentry-architect-claude
tags: [prompt-engineering]
related_tasks: [255]
---

# SPEC: Gemini vestigial tag 억제 프롬프트

## Goal
Gemini CLI 응답 끝의 [AGREE]/[DISAGREE]/[CONDITIONAL] 태그 제거. Deliberation 출력 품질 개선.

## Scope
### In
- deliberation MCP 서버의 gemini speaker_instructions 템플릿

### Out
- claude / codex CLI 프롬프트 (미변경)
- 다른 deliberation 설정 필드

## Approach
### Chosen
speaker_instructions에 "Do NOT end responses with any square-bracket status tags" 추가 + few-shot counter-example 1개.

### Alternative considered
응답 후처리로 정규식 제거 — 출력 내용에 legitimate 태그 있을 경우 오탐 리스크로 탈락.

## Files Affected
| 경로 | 변경 | 담당 |
|------|-----|------|
| `~/.local/lib/mcp-deliberation/index.js` | 수정 (default speaker_instructions) | aigentry-deliberation-codex |

## Verification
- 10회 deliberation 실행 후 gemini 응답 중 `[AGREE]` 등 태그 발생률 < 10%
- claude/codex 응답은 영향 없음 (regression 체크)

## Risks
- Gemini가 instruction 무시 지속 → fallback: 응답 후처리 추가 (future SPEC)

## Open Questions
- 기존 deliberation 사용자 중 태그를 의도적으로 사용하는 케이스?
```

이런 정도 길이 (100줄 이하)가 SPEC 타깃. ADR보다 가벼움.
