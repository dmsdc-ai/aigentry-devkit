---
name: context-manage
description: |
  컨텍스트 윈도우 관리 스킬. 모든 세션(오케스트레이터+하위)에서 컨텍스트 압박 시 자동 발동.
  "context high", "컨텍스트 높아", "compact 해야", "context pressure", "토큰 부족",
  "rate limit", "컨텍스트 관리", "스냅샷 저장" 요청 시 또는 컨텍스트 50%+ 감지 시 사용.
  Silent skill — 컨텍스트 압박 감지 시 자동 발동, 명시적 호출도 가능.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Context Manage

컨텍스트 윈도우를 안전하게 관리하여 작업 연속성을 보장합니다.
오케스트레이터와 모든 하위 세션에서 동일하게 동작합니다.

## 핵심 원칙

1. **컨텍스트 보존 없이 compact 금지**
2. **compact 후 이전 작업 상태를 모르는 상태로 진행 금지**
3. **Rate limit은 예방이 최선**

## Phase 1: 예방 (상시 적용)

컨텍스트가 높아지기 전에 항상 적용하는 습관:

### 토큰 절약 패턴

| 패턴 | 설명 |
|------|------|
| **선택적 읽기** | 파일 전체 읽기 금지. `offset`+`limit`으로 필요 부분만 읽기 |
| **출력 제한** | `head -20`, `--limit`, `| head` 등으로 출력량 제한 |
| **분할 작성** | 100줄 이상 코드 작성 시 파일 분할 또는 subagent 위임 |
| **도구 우선** | grep/read/glob 전용 도구 사용 (bash grep 대신 Grep 도구) |
| **반복 금지** | 같은 파일 재읽기 방지. 필요 정보는 메모해두기 |
| **subagent 활용** | 탐색/리서치는 subagent에 위임하여 메인 컨텍스트 보호 |

### 대규모 작업 시

```
- 한 번에 수백 줄 작성하지 않는다
- 파일 전체를 읽지 않고 관련 부분만 읽는다
- 빌드 출력, 테스트 출력은 요약만 확인한다
- git diff는 --stat 먼저, 필요 시 특정 파일만 full diff
```

## Phase 2: 스냅샷 저장 (compact 전 필수)

컨텍스트가 높아져서 compact가 필요할 때, **반드시 스냅샷을 먼저 저장**합니다.

### 스냅샷 파일 위치

| 세션 유형 | 스냅샷 경로 |
|----------|-----------|
| 프로젝트 세션 | `{project-root}/.context-snapshot.md` |
| 오케스트레이터 | `$AIGENTRY_ORCH_DIR/.context-snapshot.md` |
| 벤치마크 세션 | `{cwd}/.context-snapshot.md` |

`$AIGENTRY_ORCH_DIR` = your aigentry orchestrator project root. 미설정 시 `install.sh`와 동일하게 `<projects-root>/aigentry-orchestrator`로 해석하고 (projects-root 기본값 `~/projects`), 그 디렉토리도 없으면 세션의 프로젝트 루트에 저장합니다.

### 스냅샷 작성 템플릿

```markdown
# Context Snapshot ({YYYY-MM-DD HH:MM})

## 현재 작업
- 무엇을 하고 있었는가 (태스크 ID 포함)
- 어디까지 완료했는가

## 진행 상태
- [x] 완료된 항목
- [ ] 미완료 항목
- [ ] 다음에 할 작업

## 수정한 파일
- path/to/file1.rs — 변경 요약
- path/to/file2.swift — 변경 요약

## 핵심 결정 사항
- 결정 1: 이유
- 결정 2: 이유

## 대기 중인 보고/응답
- {session-id}: 무엇을 기다리는 중

## 디버깅 컨텍스트 (있는 경우)
- 에러 메시지 요약
- 시도한 접근법
- 유력한 원인
```

### 스냅샷 작성 절차

```
1. 현재 작업 상태를 위 템플릿으로 .context-snapshot.md에 저장
2. 저장 확인 (파일 존재 + 내용 비어있지 않음)
3. /compact 실행
4. compact 후 즉시 Phase 3 실행
```

## Phase 3: 복원 (compact 후 필수)

compact 직후 반드시 실행:

```
1. .context-snapshot.md 읽기
2. 현재 git status 확인 (수정 파일 목록과 스냅샷 대조)
3. 미완료 항목 확인
4. 대기 중인 보고/응답 확인
5. 작업 재개
```

### 복원 체크리스트

- [ ] 스냅샷 읽었는가?
- [ ] 현재 git status와 스냅샷이 일치하는가?
- [ ] 미완료 항목을 파악했는가?
- [ ] 대기 중인 외부 응답이 있는가?
- [ ] 작업 재개 가능한가?

## Phase 4: 오케스트레이터 연동 (하위 세션 전용)

하위 세션이 컨텍스트 압박을 느끼면 오케스트레이터에 보고합니다.

### 보고 타이밍

| 상황 | 액션 |
|------|------|
| compact 필요 | 스냅샷 저장 후 보고: "CONTEXT: compact 예정, 스냅샷 저장 완료" |
| compact 완료 | 복원 후 보고: "CONTEXT: compact 완료, 작업 재개" |
| rate limit 발생 | 즉시 보고: "RATE_LIMIT: {details}" |

### 보고 형식

```bash
telepty inject --from {my-session-id} aigentry-orchestrator-claude \
  "CONTEXT: {status} | snapshot: {path} | remaining: {미완료 항목 수} | resuming: {yes/no}"
```

## Phase 5: Rate Limit 대응

```
1. 1분 대기 후 자동 재시도
2. 3회 실패 시 오케스트레이터에 보고
3. 예방이 최선 — Phase 1을 항상 적용
```

## 자동 발동 조건

이 스킬은 다음 상황에서 자동 발동됩니다:

| 신호 | 액션 |
|------|------|
| 시스템이 "context window" 경고 표시 | Phase 2 즉시 시작 |
| 대규모 파일 읽기/쓰기 시도 | Phase 1 패턴 적용 |
| /compact 명령 전 | Phase 2 필수 실행 |
| /compact 명령 후 | Phase 3 필수 실행 |
| rate limit 에러 | Phase 5 실행 |

## 금지 사항

- **컨텍스트 보존 없이 compact 금지**
- **compact 후 이전 작업을 모르는 상태로 진행 금지**
- **스냅샷 없이 "이전 대화 요약" 기능에만 의존 금지**
- **대규모 출력을 무제한으로 컨텍스트에 적재 금지**
