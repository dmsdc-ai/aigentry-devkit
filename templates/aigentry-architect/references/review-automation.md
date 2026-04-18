# Review Automation

ADR/SPEC 리뷰 프로세스 전체. frontmatter 기반 자동 tier 결정 + Yes-if 응답 + revision 루프.

## §1 Tier 결정 (frontmatter 자동 매핑)

`references/frontmatter-schema.md` §4-tier 테이블 참조. 요약:

| type | scope | decision_type | Tier | Reviewers | 트리거 |
|------|-------|---------------|:-:|:-:|------|
| spec | local | two-way | T0 | 0 | user approval only |
| spec | local | one-way | T1 | 1 | user + 1 reviewer |
| spec | cross-project | * | T1 | 1 | user + 1 reviewer |
| spec | ecosystem | * | T1 | 1 | user + 1 reviewer |
| adr | * | two-way | T2 | 2 | user + 2 reviewers |
| adr | ecosystem | * | T2 | 2 | user + 2 reviewers |
| adr | constitutional | one-way | T3 | 3 | user + 3 reviewers |

**Max reviewers = 4** (AWS "10명 이하" 원칙 준수, 실제 풀 가용성 고려).

## §2 Reviewer 선정 (관점 다양성)

`references/reviewer-matrix.md`에서 CLI ↔ 관점 매핑 확인. T2 이상은 최소 2개 관점, T3는 최소 3개 관점 커버.

### 선정 알고리즘

```
1. 풀: [claude, codex, gemini] (기본) + [web-chatgpt, web-perplexity] (옵션)
2. 제외: architect 작성자 자신 (self-review 금지)
3. 목표: 각 tier 필요 관점 최대 커버 (reviewer-matrix.md 참조)
4. 기본 조합:
   T1: codex (구현 복잡도)
   T2: codex + gemini (구현 + 에지 케이스)
   T3: claude + codex + gemini (헌법 + 구현 + 에지)
```

### Orchestrator의 역할

architect는 **리뷰어를 직접 부르지 않음**. 스펙 제출 시 orchestrator에 "reviewers-required=N" 포함 보고. Orchestrator가 deliberation 세션 또는 개별 세션 디스패치.

## §3 Response 포맷 (Yes-if)

Squarespace 검증된 4-라벨 응답. 리뷰어는 반드시 다음 중 하나 사용:

### ACCEPT
- 의미: 그대로 승인
- 사용: 스펙이 완결, 수정 필요 없음
- 예: "ACCEPT. Constitution Check complete, alternatives well-analyzed, verification metrics measurable."

### ACCEPT-IF {condition}
- 의미: 특정 조건 충족 시 승인
- 사용: 사소한 수정으로 accept 가능
- 필수: condition이 **구체적** (어떤 섹션/문장/로직 변경 필요한지)
- 예: "ACCEPT-IF §6 Backward Compat에 기존 v1 consumer list (최소 5개) 명시."

### REQUEST-REVISION
- 의미: 구조적 재작성 필요
- 사용: 여러 섹션에 걸친 큰 수정
- 필수: 구체적 이슈 목록 + 우선순위
- 예: "REQUEST-REVISION. Issues: (1) §3 Alternative B가 strawman 수준 — 실질 대안 필요 (2) §8 verification metrics 측정 불가능함 (3) Constitution Check §4 Q3 FAIL 근거 부족. 재작성 후 iter 2 진입."

### BLOCK
- 의미: 근본 반대, 이 방향 자체를 재고해야 함
- 사용: 드물게, 근본적 설계 결함
- 필수: 명확한 근거 (headline + 3+ 이유) + 대안 제시
- 예: "BLOCK. This ADR violates Rule 3 컴포넌트 역할 — orchestrator에 crash recovery 책임 추가는 역할 침범. 대안: crash recovery는 별도 supervisor 컴포넌트로 분리."

## §4 7-Item Reviewer Checklist

각 리뷰어는 ACCEPT/ACCEPT-IF 응답 전 다음 7항목 **각각 PASS/FAIL/N/A** 표기. 2개 이상 FAIL → 자동 REQUEST-REVISION.

1. **[ ]** Context 섹션이 결정 필요성을 충분히 설명하는가
2. **[ ]** 최소 2개 대안 + 트레이드오프가 제시됐는가
3. **[ ]** Decision이 구체적이고 실행 가능한가
4. **[ ]** 실패 모드 / 리스크가 명시됐는가
5. **[ ]** Backward compatibility 영향이 분석됐는가 (또는 적용 불가 근거)
6. **[ ]** Constitution Check가 완료됐는가 (5 질문 답변)
7. **[ ]** Verification plan 메트릭이 측정 가능한가

리뷰 파일에 체크리스트 결과 포함:
```markdown
## Checklist Results
- [x] 1. Context — PASS
- [x] 2. Alternatives — PASS
- [ ] 3. Decision concrete — FAIL (M_ctx measurement 불가능)
- [x] 4. Failure modes — PASS
- [ ] 5. Backward compat — FAIL (기존 consumer 목록 없음)
- [x] 6. Constitution Check — PASS
- [ ] 7. Verification metrics — FAIL (M1-M5 측정 방법 부재)

Total: 3 FAIL → REQUEST-REVISION
```

## §5 Revision Loop

### 흐름

```
ACCEPT-IF / REQUEST-REVISION 수신
  → architect가 iter++
  → 수정 후 재제출 (status=revision → proposed 재진입)
  → 동일 리뷰어 재확인 (기존 이슈 해결 + 새 이슈 없음)
  → ACCEPT 수신 시 다음 단계
```

### Iteration 제한

- **최대 3 iter**: iter 4 진입 시도 → 자동 **사용자 에스컬레이션**
- 에스컬레이션 사유: convergence 실패. 근본 disagreement 가능성.
- 사용자 개입: 원 ADR 방향 재검토 / 리뷰어 교체 / 스펙 폐기 결정

### 에스컬레이션 포맷

```bash
telepty inject --ref --from aigentry-architect-{cli} aigentry-orchestrator-claude \
  "ESCALATE: spec-file={path} | iter=3+ | reviewers=[{A}, {B}] | convergence-fail=true | top-blocker={issue}"
```

## §6 Accepted 전이 조건

다음 모두 충족 시 `status: accepted`:

1. **모든 지정 리뷰어가 ACCEPT** 응답 (ACCEPT-IF 아님)
2. **사용자 최종 승인** (orchestrator 경유)
3. **체크리스트 7개 전부 PASS** (어떤 리뷰어도 FAIL 없음)

하나라도 미충족 시 `status: revision` 유지.

## §7 리뷰 파일 경로 규칙

```
docs/reviews/adr-NNNN-review-{reviewer-cli}.md
```

예시:
- `docs/reviews/adr-264-review-codex.md`
- `docs/reviews/adr-264-review-gemini.md`
- `docs/reviews/adr-76-review-aigentry-orchestrator-codex.md` (기존 실례)

리뷰 파일 구조:
```markdown
# RE-SCORE: ADR-NNNN {slug} ({reviewer-cli} independent review)

**Response**: ACCEPT / ACCEPT-IF {cond} / REQUEST-REVISION / BLOCK

## Checklist Results (7 items)
...

## Strengths (2-3)
...

## Weaknesses / Blind spots (2-5)
...

## Specific Disagreements (sectional)
- §N.N ...

## Recommendations (numbered, for architect)
1. ...
2. ...
```

## §8 Known Patterns from ADR-76 Reviews

기존 ADR-76의 codex/gemini 리뷰에서 확립된 패턴:
- Trade-off matrix weight 재검증 (reviewer가 architect의 weight 주장 재평가)
- Evidence trace (architect 주장에 "파일:line" 인용 있는지 대조)
- Constitution check 각 Q 답변의 근거 강도
- "orchestrator crash" 같은 보이지 않는 실패 시나리오 탐지

신규 리뷰어는 이 패턴 참조 가능.
