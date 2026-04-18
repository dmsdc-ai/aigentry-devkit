# Frontmatter Schema

모든 ADR/SPEC 파일은 YAML frontmatter 필수. tier 자동 계산의 입력.

## Required Fields

| 필드 | 타입 | 값 | 설명 |
|------|------|-----|------|
| `type` | string | `adr` \| `spec` | 산출물 종류 |
| `status` | string | `proposed` \| `reviewing` \| `revision` \| `accepted` \| `deprecated` | 상태 머신 (§6 AGENTS.md) |
| `scope` | string | `local` \| `cross-project` \| `ecosystem` \| `constitutional` | 영향 범위 |
| `decision_type` | string | `two-way` \| `one-way` | 되돌림 가능 여부 (Bezos 원칙) |
| `date` | string | ISO 8601 (예: `2026-04-18`) | 작성일 |
| `author` | string | 세션 식별자 (예: `aigentry-architect-claude`) | 작성자 |

## Optional Fields

| 필드 | 타입 | 설명 |
|------|------|------|
| `tags` | string[] | 자유 태그 (예: `[mcp-api, telepty, rendering]`) |
| `supersedes` | string[] | 대체하는 ADR 참조 (예: `[ADR-76]`) |
| `related` | string[] | 관련 ADR/task/ref (예: `[ADR-42, task-#264]`) |
| `related_tasks` | number[] | task-queue ID 참조 |

## 예시

### ADR
```yaml
---
type: adr
status: proposed
scope: ecosystem
decision_type: one-way
date: 2026-04-18
author: aigentry-architect-claude
tags: [mcp-api, deliberation, observability]
supersedes: []
related: [ADR-76]
related_tasks: [252, 253, 254, 257]
---
```

### SPEC
```yaml
---
type: spec
status: proposed
scope: local
decision_type: two-way
date: 2026-04-18
author: aigentry-architect-claude
tags: [prompt-engineering]
---
```

## 4-Tier Reviewer 계산

`type` + `scope` + `decision_type` 조합으로 자동 결정:

| type | scope | decision_type | Tier | Reviewers |
|------|-------|---------------|:-:|:-:|
| spec | local | two-way | **T0** | 0 (사용자 승인만) |
| spec | local | one-way | **T1** | 1 |
| spec | cross-project | * | **T1** | 1 |
| spec | ecosystem | * | **T1** | 1 |
| spec | constitutional | * | **T2** | 2 (ADR 승격 권장) |
| adr | local | two-way | **T2** | 2 (ADR 기본) |
| adr | cross-project | * | **T2** | 2 |
| adr | ecosystem | * | **T2** | 2 |
| adr | constitutional | two-way | **T2** | 2 |
| adr | constitutional | one-way | **T3** | 3 + 사용자 |

## 계산 예시

**예 1**: MCP API 변경 (task #264 Cluster-A)
```yaml
type: adr
scope: ecosystem
decision_type: one-way
```
→ T2 = **2 reviewers** (codex + gemini 기본)

**예 2**: aterm 렌더링 버그 fix 설계
```yaml
type: spec
scope: local
decision_type: two-way
```
→ T0 = **0 reviewers** (사용자 승인만)

**예 3**: 헌법 조항 수정
```yaml
type: adr
scope: constitutional
decision_type: one-way
```
→ T3 = **3 reviewers + 사용자** (claude + codex + gemini 모두)

**예 4**: task-queue.json 스키마 확장 (backward compat)
```yaml
type: spec
scope: ecosystem
decision_type: two-way
```
→ T1 = **1 reviewer**

## 검증 규칙

- 필수 필드 누락 시 submit 거부
- `status: accepted`는 tier 리뷰 충족 + 사용자 승인 후에만 허용 (§5.6 INVARIANT)
- `scope: constitutional` 시 §4 Constitution Check에 18조 전수 검증 필수
