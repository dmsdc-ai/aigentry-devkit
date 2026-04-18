# aigentry Session Conventions

오케스트레이터가 동적으로 하위 세션을 여닫을 때 지켜야 할 규칙. `task-queue.json v2`와 연동되어 컨텍스트 스위칭 일관성을 보장.

## 1. 폴더 정책 (CWD)

절대로 `~` (홈)에서 CLI 부트하지 않는다. Trust prompt + 권한 사이드이펙트 발생.

| Role | CWD |
|------|-----|
| `architect` | `~/projects/aigentry-architect` |
| `deliberation` | `~/projects/aigentry-deliberation` |
| `tester` | `~/projects/aigentry-tester` |
| `builder` | `~/projects/aigentry-builder` |
| `analyst` | `~/projects/aigentry-analyst` |
| `logger` | `~/projects/aigentry-logger` |
| `brain` | `~/projects/aigentry-brain` |
| `aterm` | `~/projects/aigentry-aterm` |
| `dustcraw` | `~/projects/aigentry-dustcraw` |
| `bench` | `/tmp/bench-{task-id}` (자동 생성) |
| 기타 `aigentry-*` | `~/projects/aigentry-{role}` 자동 매핑 |
| 미매핑 | `--cwd` 필수 |

## 2. Workspace 네이밍

**패턴**: `{track-id}-{role}-{task-id}`

| 예시 | 의미 |
|------|------|
| `B-architect-264` | Track B, architect, task 264 |
| `C-codex-260` | Track C, codex 구현, task 260 |
| `A-bench-250` | Track A, 벤치 실행, task 250 |

**이유**:
- 트랙 필터링 (`B-*`)
- Role 즉시 식별
- task-queue.json 직접 조회 가능
- 중복 방지 (같은 task 재오픈 시 충돌 감지 가능)

## 3. Telepty 세션 ID 매핑

cmux 워크스페이스 ↔ telepty 세션 (있을 경우):

| cmux title | telepty session_id |
|-----------|--------------------|
| `B-architect-264` | `aigentry-architect-claude` |
| `B-codex-254` | `aigentry-deliberation-codex` |

규칙: telepty ID는 기존 `aigentry-{project}-{cli}` 유지. cmux는 task 레벨까지 세분화. 두 ID 매핑은 `task-queue.json`의 `session` 필드에 기록.

## 4. Trust 프리시드 (1회 설정)

모든 `aigentry-*` + `/tmp/bench-*` 경로를 `~/.claude.json` `projects[]`에 `hasTrustDialogAccepted: true` 등록.

```bash
# 자동화 스크립트 (devkit에 포함)
bash aigentry-devkit/bin/trust-aigentry.sh
```

CLI 부팅 시 `--permission-mode bypassPermissions` 추가로 안전장치.

## 5. Claude CLI 부팅 명령

```bash
cmux new-workspace \
  --cwd ~/projects/aigentry-{role} \
  --command 'cd ~/projects/aigentry-{role} && exec claude --permission-mode bypassPermissions'
```

**주의**: `cmux --cwd`만으로는 interactive shell의 pwd가 해당 경로로 설정되지 않음. `cd <path> && exec claude` 명시 필요.

## 6. 라이프사이클

| 단계 | 액션 | 주체 |
|------|------|------|
| **OPEN** | `open-session.sh --track T --role R --task N` | 오케 |
| **INJECT** | `cmux send` + `cmux send-key enter` | 오케 |
| **WATCH** | 사이드바 클릭, 실시간 관찰 | 사용자 |
| **REPORT** | 세션이 `telepty inject` 또는 파일로 리포트 | 세션 |
| **REVIEW** | 오케가 리포트 수신 + 사용자 승인 | 오케+사용자 |
| **CLOSE** | `cmux close-workspace --workspace REF` | 오케 |

## 7. Wrapper 스크립트

`aigentry-devkit/bin/open-session.sh` — 위 규칙 자동 적용.

### 사용

```bash
# 기본 — claude CLI
REF=$(aigentry-devkit/bin/open-session.sh --track B --role architect --task 264)
echo "Opened: $REF"  # e.g. workspace:38

# Codex
REF=$(aigentry-devkit/bin/open-session.sh --track C --role codex --task 260 --cli codex)

# 임의 경로
REF=$(aigentry-devkit/bin/open-session.sh --track A --role bench --task 250 --cwd /tmp/bench-orch)

# 추가 플래그
REF=$(aigentry-devkit/bin/open-session.sh --track D --role architect --task 270 --extra-flags "--effort high")
```

### Wrapper 동작

1. Role → 프로젝트 경로 자동 매핑
2. Workspace 타이틀 규칙 적용 (`{track}-{role}-{task}`)
3. `cd` + `exec {cli} --permission-mode bypassPermissions` boot 커맨드 생성
4. `cmux new-workspace` + `rename-workspace`
5. `~/.aigentry/open-session.log`에 기록 (ref, title, cwd, cli, task)
6. stdout에 workspace ref 출력

## 8. 엔드투엔드 위임 예시

```bash
# 1. 오픈
REF=$(aigentry-devkit/bin/open-session.sh --track B --role architect --task 264)

# 2. 부팅 대기
sleep 6

# 3. 프롬프트 주입
cmux send --workspace "$REF" "$(cat spec-prompt.txt)"
cmux send-key --workspace "$REF" enter

# 4. 완료까지 기다림 (workspace-lifecycle 스킬 활용)
~/.claude/skills/workspace-lifecycle/scripts/wait.sh \
  --ws "$REF" --pattern "REPORT: architect#264" --timeout 1800

# 5. 리포트 수신 확인 후 close
cmux close-workspace --workspace "$REF"
```

## 9. 헌법 적합성

- **Rule 1 (경량)**: jq + bash만 의존. claude CLI는 이미 있는 것 활용
- **Rule 2 (크로스)**: aigentry 생태계 전체 공통. 추후 aterm 백엔드 확장 시에도 동일 컨벤션
- **Rule 14 (범용/멀티크로스)**: devkit 설치 시 모든 사용자에게 자동 배포
- **Rule 17 (무의존)**: Claude Code/plugin 특정 의존 없음

## 10. 설치 (신규 aigentry 사용자)

```bash
# 1. devkit 설치 (기존)
# 2. Trust 프리시드
bash ~/projects/aigentry-devkit/bin/trust-aigentry.sh
# 3. PATH 등록
export PATH="$HOME/projects/aigentry-devkit/bin:$PATH"
# 4. 확인
open-session.sh --help
```
