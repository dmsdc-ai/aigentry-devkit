---
name: sawe
description: |
  세션 자율 워크플로우 엔진. 스펙을 받아 구현→빌드→테스트→검증을 자율 실행합니다.
  "sawe", "autonomous workflow", "자율 워크플로우", "spec execute", "스펙 실행" 요청 시 사용합니다.
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# SAWE — Session Autonomous Workflow Engine

세션이 스펙을 받아 자율적으로 구현→검증→보고하는 워크플로우 엔진.

## 핵심 워크플로우

```
RECEIVE SPEC → REVIEW → IMPLEMENT → VERIFY (build+test) → PASS? → DONE
                                                    ↓ NO
                                               AUTO-FIX (max 3회) → BLOCKED
```

## 1단계: 스펙 리뷰

스펙을 받으면 즉시 실행하지 않고 먼저 리뷰:

1. **목표 확인**: 무엇을 만들어야 하는가?
2. **완료 조건**: 어떤 상태가 "완료"인가? (빌드 통과, 테스트 통과, 파일 생성 등)
3. **검증 명령**: 완료를 증명할 구체적 명령어 (npm test, npm run build, node -c file.js 등)
4. **범위**: 어디까지 이 세션에서 처리하는가?

스펙이 불명확하면 **NEEDS_CONTEXT** 상태로 보고:
```json
{"status": "NEEDS_CONTEXT", "questions": ["검증 명령이 없습니다. build 명령은?", "..."]}
```

## 2단계: 구현

스펙이 명확하면 구현 시작:

- 코드 변경은 최소 범위로 (스펙에 명시된 것만)
- 한 번에 하나의 논리적 단위씩 진행
- 구현 중 에러 발생 시 즉시 자율 수정 시도 (3회 한도)

## 3단계: Evidence Gate (검증)

**완료 선언 전 반드시 검증 명령 실행.** 이것은 절대 규칙.

```bash
# 1. 빌드 검증
{build_command}    # e.g., npm run build, node -c file.js

# 2. 테스트 검증 (있으면)
{test_command}     # e.g., npm test, pytest

# 3. 린트 검증 (있으면)
{lint_command}     # e.g., npm run lint
```

각 명령의 exit code + 출력을 증거로 수집.

## 4단계: 자율 수정 (실패 시)

검증 실패 시:
1. 에러 메시지 분석
2. 원인 파악 → 수정 시도
3. 재검증
4. **3회 실패 시 BLOCKED 상태로 보고** (같은 가설에 갇히지 않기 위해)

## 5단계: 보고

작업 완료 시 반드시 오케스트레이터에 보고. 형식:

### DONE (성공)
```
telepty inject --ref --from {session-id} {orchestrator-id} 'REPORT: DONE | {summary}'
```

보고 내용 (ref 파일):
```json
{
  "status": "DONE",
  "evidence": {
    "build": {"command": "npm run build", "exit_code": 0, "output_snippet": "..."},
    "test": {"command": "npm test", "exit_code": 0, "output_snippet": "..."}
  },
  "changes": ["lib/sync.js (new)", "bin/aigentry-devkit.js (modified)"],
  "attempts": 1
}
```

### DONE_WITH_CONCERNS (통과했지만 우려)
```json
{
  "status": "DONE_WITH_CONCERNS",
  "evidence": { ... },
  "concerns": ["테스트 커버리지가 낮음", "레거시 API 사용"],
  "changes": [...],
  "attempts": 2
}
```

### BLOCKED (3회 자율 수정 실패)
```json
{
  "status": "BLOCKED",
  "error": "TypeError: Cannot read property 'id' of undefined",
  "attempts": 3,
  "tried": ["null check 추가", "optional chaining", "default value"],
  "changes_so_far": [...],
  "needs": "task-queue.json 스키마 확인 필요"
}
```

### NEEDS_CONTEXT (스펙 불명확)
```json
{
  "status": "NEEDS_CONTEXT",
  "questions": ["빌드 명령이 지정되지 않았습니다", "테스트 범위가 불명확합니다"]
}
```

## 세션 CLAUDE.md 통합

이 스킬은 telepty 세션의 CLAUDE.md에서 다음과 같이 참조:

```markdown
## 자율 워크플로우

이 세션은 SAWE 프로토콜을 따릅니다:
1. 스펙을 받으면 리뷰 → 구현 → 검증 → 보고
2. 검증 실패 시 3회 자율 수정
3. 완료/차단 시 오케스트레이터에 보고
4. 완료 선언 전 반드시 evidence (빌드+테스트 결과) 첨부
```

## 금지 사항

- 검증 없이 DONE 보고 금지
- exit code 확인 없이 "통과"라고 판단 금지
- 3회 초과 같은 접근법으로 재시도 금지
- 스펙 범위 밖의 변경 금지
- 오케스트레이터 보고 없이 종료 금지
