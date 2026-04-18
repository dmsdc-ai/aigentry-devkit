# Task Queue v2 — Track-Based Context Switching

aigentry 오케스트레이터 세션이 사용하는 태스크 큐 스키마. **다중 초기 (트랙)를 동시에 진행하면서 컨텍스트 스위칭 비용을 최소화**하기 위한 구조.

## 파일 위치

- **Per-user runtime**: `~/projects/aigentry-orchestrator/state/task-queue.json`
- **Template (new users)**: `aigentry-devkit/templates/workspace/state/task-queue.template.json`
- **Override path**: `TQ` 환경변수로 커스텀 경로 지정 가능

## 스키마

```json
{
  "schema_version": 2,
  "active_focus": "track-id | null",
  "tracks": {
    "<track-id>": {
      "name": "string",
      "desc": "string",
      "status": "backlog|in-progress|analysis-done|mvp-installed|blocked|done",
      "priority": "low|medium|high|high-now",
      "resume_ref": "path or URL to key context artifact",
      "blocks": ["<track-id>", ...],
      "blocked_by": ["<track-id>", ...],
      "started_at": "ISO 8601"
    }
  },
  "main_topics": ["legacy field — top-level themes"],
  "completed": ["legacy field — archived task summaries"],
  "tasks": [
    {
      "id": 248,
      "desc": "...",
      "priority": "P0|P1|P2|P3",
      "status": "pending|in_progress|completed|blocked|delegated",
      "session": "session-id or null",
      "note": "optional legacy note",

      // v2 optional additive fields:
      "track": "<track-id>",
      "created_at": "ISO 8601",
      "updated_at": "ISO 8601",
      "resume_context": "1-2 sentences — what to load/recall to continue",
      "blocks": [<task-id>, ...],
      "blocked_by": [<task-id>, ...],
      "tags": ["string", ...]
    }
  ]
}
```

## 하위 호환

- `schema_version` 미지정 = v1 간주. 모든 v2 필드는 optional
- 기존 태스크 238개 무수정 유지
- 신규 태스크만 `track`/`created_at`/`resume_context` 사용 권장

## 헬퍼 CLI

`aigentry-devkit/bin/`에 배포. PATH 등록 시 어디서나 사용.

### `tq-status.sh`
전체 개요 — active_focus, 트랙 목록, 태스크 상태 분포, 트랙별 pending 수, 최근 활동 Top 5.

### `tq-track.sh <track-id> [--all]`
특정 트랙 상세 — 트랙 메타(status/priority/resume_ref/blocks) + 소속 태스크의 desc/priority/resume_context/blocked_by.
- `--all`: 완료된 태스크까지 포함

### `tq-focus.sh [track-id]`
- 인자 없음: 현재 active_focus + 해당 트랙의 다음 액션 가능 태스크 Top 5
- 인자 있음: active_focus를 해당 트랙으로 전환 후 다음 액션 출력

## 사용 패턴

### 세션 시작
```bash
tq-status.sh
# 현재 어디 있는지, 어느 트랙이 활성, blocked 상태 파악
```

### 트랙 전환
```bash
tq-focus.sh B-delib-bench
# 포커스 전환 + 즉시 다음 액션 확보
```

### 트랙 재개 (컴팩트 후 등)
```bash
tq-track.sh A-multi-llm
# resume_ref 경로 + 각 pending 태스크의 resume_context 읽어 빠르게 복귀
```

### 컴팩트 전 절차
1. 현재 진행 중 태스크의 `resume_context` / `updated_at` 수동 jq로 업데이트
2. `/compact`
3. 세션 재개 시 `tq-focus.sh` → 자동 복원

## 트랙 네이밍 규칙

`<대문자-알파벳>-<짧은-슬러그>`. 예:
- `A-multi-llm` — 전략 분석 트랙
- `B-delib-bench` — 인프라 개선 트랙
- `C-ws-skill` — 도구 개발 트랙
- `D-task-mgmt` — 메타 트랙

영문 1-2단어 슬러그 권장. Track ID는 변경 불가 (다른 태스크 참조에 쓰임).

## 3-레이어 컨텍스트 저장소

| 레이어 | 실체 | 수명 |
|--------|------|------|
| **L1 세션 내** | Claude `TaskCreate`/`TaskList` | 세션 종료 시 소멸 |
| **L2 크로스 세션** | `task-queue.json` v2 + `tq-*.sh` | 지속 (프로젝트 파일) |
| **L3 장기 지식** | Brain (`aigentry-brain`) | 영구 + 크로스 프로젝트 |

v2 태스크 큐는 **L2**. L1/L3와 역할 겹치지 않도록:
- L1 → 현재 턴 내 세부 실행 step
- L2 → 트랙 + 태스크 + resume_context (이 파일)
- L3 → invariants / 교훈 / 아키텍처 결정

## 초기 설정 (신규 aigentry 사용자)

```bash
# 1. 템플릿 복사
mkdir -p ~/projects/aigentry-orchestrator/state
cp $(aigentry-devkit path)/templates/workspace/state/task-queue.template.json \
   ~/projects/aigentry-orchestrator/state/task-queue.json

# 2. 헬퍼 PATH 등록 (devkit 설치 시 자동)
export PATH="$HOME/projects/aigentry-devkit/bin:$PATH"

# 3. 확인
tq-status.sh
```

## 헌법 적합성

- **Rule 1 (경량)**: 외부 라이브러리 0, jq만 의존 (POSIX 표준 유사)
- **Rule 2 (크로스)**: 모든 CLI/환경에서 동일 UX (bash + jq)
- **Rule 14 (범용/멀티크로스)**: aigentry 사용자 누구나 devkit install 시 자동 획득
- **Rule 17 (무의존)**: Claude Code/plugin 의존 없음. 순수 쉘 스크립트
