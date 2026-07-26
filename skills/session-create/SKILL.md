---
name: session-create
description: Create a new aigentry ecosystem project with full session bootstrapping — folder, CLAUDE.md, devkit bootstrap, terminal-agnostic session spawn (cmux/aterm/tmux/wezterm/iterm/warp via open-session.sh), grid layout. Use this skill whenever the user says "새 프로젝트 만들어", "세션 만들어", "session create", "프로젝트 생성", "새 세션", "폴더 만들어", or anything involving creating a new project/session in the aigentry ecosystem. Also trigger when the orchestrator needs to spawn a new top-level project (not a sub-folder).
---

# Session Create

Create a new aigentry ecosystem project with full session bootstrapping in one shot.

## Why This Exists

Every new aigentry project needs the same 7 steps. Missing any one causes problems — orphan windows, missing CLAUDE.md, telepty not connected, grid misaligned. This skill ensures nothing is forgotten.

## Arguments

The user provides the project name (without `aigentry-` prefix). Examples:
- "design" → `aigentry-design`
- "forum" → `aigentry-forum`
- "aterm" → `aigentry-aterm`

If no name is provided, ask the user.

## Workflow

Execute ALL 7 steps in order. Do not skip any.

### Step 1: Validate & Create Folder

```bash
NAME="<user-provided-name>"
PROJECT_DIR="$HOME/projects/aigentry-${NAME}"
SESSION_ID="aigentry-${NAME}-claude"

# Check if already exists
if [ -d "$PROJECT_DIR" ]; then
  echo "⚠️ Folder already exists: $PROJECT_DIR"
  # Ask user: continue with existing folder or abort?
fi

mkdir -p "$PROJECT_DIR"
```

### Step 2: Generate CLAUDE.md

Write a CLAUDE.md to `$PROJECT_DIR/CLAUDE.md` with:

```markdown
# aigentry-{name}

이 프로젝트는 aigentry 에코시스템의 **{role description}** 입니다.

## 에코시스템 위치
- 오케스트레이터: aigentry-orchestrator-claude
- 통신: telepty inject/reply

## 통신 방법
- 오케스트레이터에게 보고: `telepty reply "내용"`
- 다른 세션에 요청: `telepty inject --from {session_id} <target> "내용"`
- 브로드캐스트 수신 시 응답 필수

## 자율 재귀적 오케스트레이션
작업 복잡도가 높거나 독립 도메인이 식별되면 자율적으로:
1. 하위 폴더 생성
2. CLAUDE.md 작성
3. telepty allow로 하위 세션 생성
4. 하위 세션 오케스트레이션

## 주요 명령어
- 빌드: (프로젝트에 맞게 작성)
- 테스트: (프로젝트에 맞게 작성)
```

The role description should be inferred from the project name, or ask the user if unclear.

### Step 3: Request Devkit Bootstrap

```bash
telepty inject --from aigentry-orchestrator-claude aigentry-devkit-claude \
  "~/projects/aigentry-${NAME}/ 프로젝트에 .claude/settings.json 생성해주세요. MCP 설정(deliberation, brain) + 권한 설정 포함."
```

Do not wait for devkit response — continue to next step.

### Step 4: Check & Clean Orphan Windows

```bash
# Cross-terminal orphan teardown — delegate to the atomic script layer.
# session-cleanup.sh routes to wh_close_for_sid (cmux lookup falls back to
# title==sid), so a stale surface named $SESSION_ID is closed on ANY host
# (cmux/aterm/tmux/wezterm/iterm/warp/headless). Idempotent no-op if none.
if telepty list 2>/dev/null | grep -q "${SESSION_ID}"; then
  ~/projects/aigentry-orchestrator/bin/session-cleanup.sh "${SESSION_ID}" || true
fi
```

### Step 5: Spawn Session (terminal-agnostic)

```bash
# Terminal-agnostic spawn — delegate to open-session.sh, which auto-detects the
# host terminal (cmux/aterm/tmux/wezterm/iterm/warp/headless), spawns a VISIBLE
# foreground surface in the orchestrator's own terminal, wraps the CLI in
# `telepty allow --id <sid> --auto-restart`, and blocks on a readiness gate.
# SID convention: open-session.sh derives sid = "<track>-<name>", so
# --track aigentry --name "${NAME}-claude" yields sid = "${SESSION_ID}".
# NEVER hardcode kitty/cmux here.
~/projects/aigentry-orchestrator/bin/open-session.sh \
  --track aigentry \
  --name "${NAME}-claude" \
  --cwd "${PROJECT_DIR}" \
  --cli claude
```

### Step 6: Verify Registration

```bash
sleep 3
telepty list 2>/dev/null | grep "${SESSION_ID}"
```

If not found, wait 3 more seconds and retry once. If still not found, report error.

### Step 7: Re-arrange Grid Layout

```bash
# Grid layout is owned by the host terminal, not this skill. session-layout.py
# is kitty-only (drives AppleScript `tell process "kitty"`); under cmux it is a
# no-op/error. Run it ONLY when the live host is genuinely kitty; under cmux the
# workspace host owns its own tiling, so skip (no reimplementation of layout).
if [ -z "${CMUX_WORKSPACE_ID:-}" ] && command -v kitty >/dev/null 2>&1 && kitty @ ls >/dev/null 2>&1; then
  python3 ~/projects/aigentry-orchestrator/bin/session-layout.py || true
else
  echo "Skipping kitty grid layout — host terminal (cmux/other) owns tiling."
fi
```

### Step 8: Initial Inject

```bash
telepty inject --from aigentry-orchestrator-claude "${SESSION_ID}" \
  "오케스트레이터입니다. 새 세션 생성 완료. 프로젝트 상태 파악 후 대기해주세요."
```

## Completion Report

After all steps, report:

```
✅ 세션 생성 완료
- 폴더: ~/projects/aigentry-{name}/
- 세션: {session_id}
- CLAUDE.md: 생성됨
- devkit 부트스트랩: 요청됨
- 그리드: 재배치 완료
```

## Common Mistakes to Avoid

- Forgetting `aigentry-` prefix on folder name
- Not checking for orphan windows before creating new one
- Hardcoding a terminal (kitty/cmux) in spawn — always delegate to open-session.sh
- Not requesting devkit bootstrap (missing .claude/settings.json)
