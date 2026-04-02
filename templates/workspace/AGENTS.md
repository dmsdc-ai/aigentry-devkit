<!-- aterm:initial — This is an auto-generated template. Customize for your project or run /init to auto-analyze. -->

# Session Communication / 세션 통신

## Internal Sessions / 내부 세션

| English action | 한국어 동작 | Command |
|----------------|------------|---------|
| List sessions | 세션 목록 보기 | `aterm list` |
| Send to session | 세션에 메시지 보내기 | `aterm inject <workspace> 'message'` |
| Check session status | 세션 상태 확인 | `aterm status <workspace>` |
| Create session | 세션 생성 | `aterm create <name> --cli <cli> --cwd <path>` |
| Restart session | 세션 재시작 | `aterm restart <workspace>` |
| Kill session | 세션 종료 | `aterm kill <workspace>` |
| Restart all dead sessions | 죽은 세션 전체 재시작 | `aterm restart-all` |
| Show tasks | 태스크 보기 | `aterm tasks` |
| Add task | 태스크 추가 | `aterm tasks add 'description'` |
| Complete task | 태스크 완료 | `aterm tasks done <id>` |
| Show lessons | 레슨 보기 | `aterm lessons` |
| Add lesson | 레슨 추가 | `aterm lessons add 'lesson'` |
| Dispatch task | 태스크 디스패치 | `aterm dispatch <task-id>` |
| Dispatch free-text task | 자유 텍스트 태스크 디스패치 | `aterm dispatch --plan 'description'` |
| Show help | 도움말 보기 | `aterm help` |

## External Sessions / 외부 세션

| English action | 한국어 동작 | Command |
|----------------|------------|---------|
| List sessions | 세션 목록 보기 | `telepty list` |
| Send to session | 세션에 메시지 보내기 | `telepty inject <session> 'message'` |

## Natural Language -> Command / 자연어 -> 명령어

| English request | 한국어 요청 | Command |
|----------------|------------|---------|
| `list sessions` | `세션 목록 보여줘` | `aterm list` |
| `send to workspace` | `워크스페이스에 메시지 보내줘` | `aterm inject <ws> 'msg'` |
| `check status` | `상태 확인해줘` | `aterm status <ws>` |
| `create session` | `세션 만들어줘` | `aterm create <name> --cli <cli> --cwd <path>` |
| `restart session` | `세션 재시작해줘` | `aterm restart <ws>` |
| `kill session` | `세션 종료해줘` | `aterm kill <ws>` |
| `show tasks` | `태스크 목록 보여줘` | `aterm tasks` |
| `add task` | `태스크 추가해줘` | `aterm tasks add 'desc'` |
| `task done` | `태스크 완료` | `aterm tasks done <id>` |
| `show lessons` | `레슨 보여줘` | `aterm lessons` |
| `add lesson` | `레슨 추가해줘` | `aterm lessons add 'lesson'` |
| `dispatch task` | `태스크 분배해줘` | `aterm dispatch <task-id>` |
| `help` | `도움말` | `aterm help` |

## Rules / 규칙

- If `$ATERM_IPC_SOCKET` exists, use `aterm` commands. / `$ATERM_IPC_SOCKET` 이 있으면 `aterm` 명령을 사용합니다.
- If `$ATERM_IPC_SOCKET` is absent, use `telepty` commands. / `$ATERM_IPC_SOCKET` 이 없으면 `telepty` 명령을 사용합니다.
- Detect all AI CLIs: `claude`, `codex`, `gemini`, `ollama`, `aider`. / 모든 AI CLI를 감지합니다.

## Principles / 원칙

- Critical: point out weaknesses. / 약점을 분명히 짚습니다.
- Constructive: provide alternatives. / 대안을 함께 제시합니다.
- Objective: balanced analysis. / 균형 잡힌 분석을 유지합니다.

## Reporting / 보고

- Reporting vs discussion / 보고 vs 자유 토론:
  - Orchestrator-delegated task → report to orchestrator: `aterm inject "$ATERM_ORCHESTRATOR_SESSION" 'REPORT: summary'`. / 오케스트레이터가 위임한 태스크 → 오케스트레이터에 보고.
  - Free discussion / messaging / ACK between sessions → no reporting line. / 세션 간 자유 토론/메시징/ACK → 보고 라인 없음.
  - Mandatory reporting applies ONLY to orchestrator-delegated tasks. / mandatory reporting은 오케스트레이터 위임 시에만 적용.
  - If sender is specified by user, ACK goes to that sender. / 사용자가 sender를 지정한 경우 ACK는 해당 sender에게.
