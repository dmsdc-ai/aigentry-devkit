---
name: workspace-lifecycle
description: |
  cmux/aterm 워크스페이스의 포그라운드 lifecycle 자동화. 공식 cmux 스킬의 primitive를 래핑하여
  open → inject prompt → wait until pattern/exit-file → read output → close 패턴을 1-shot 실행.
  "워크스페이스 열었다 닫았다", "세션 포그라운드 자동화", "workspace lifecycle",
  "open send wait close", "병렬 세션 팬아웃" 시 자동 트리거.
---

# Workspace Lifecycle 자동화 스킬

공식 `cmux` 스킬 (`~/.claude/skills/cmux`)이 커버하지 않는 **완료 감지 폴링 + lifecycle 체인**만 제공합니다. primitive CLI 호출은 공식 스킬 사용.

## 범위

| 기능 | 공식 cmux 스킬 | 이 스킬 |
|------|:-:|:-:|
| new-workspace / close-workspace / focus / move | ✅ | ❌ (공식 사용) |
| send / send-key / read-screen | ✅ | ❌ (공식 사용) |
| **wait until pattern match** | ❌ | ✅ |
| **wait until exit-file exists** | ❌ | ✅ |
| **open → send → wait → read → close 체인 래퍼** | ❌ | ✅ |

## 사용

```bash
LC=~/.claude/skills/workspace-lifecycle/scripts

# 패턴 등장까지 대기
$LC/wait.sh --ws workspace:33 --pattern "REPORT:" --timeout 600

# 특정 파일 등장까지 대기 (CMD 쪽에서 `touch /tmp/done`)
$LC/wait.sh --ws workspace:33 --exit-file /tmp/done --timeout 600

# 1-shot 체인: 열고 → 주입 → 대기 → 읽기 → 닫기
$LC/run-once.sh \
  --cwd /tmp/bench-orch \
  --command 'codex exec -m gpt-5.4' \
  --prompt-file /tmp/prompt.txt \
  --wait-pattern "^\$ " \
  --timeout 300 \
  --output /tmp/codex-output.txt
  # 자동으로 close함. --keep-open 옵션으로 유지 가능
```

## 백엔드

현재 cmux만 지원. aterm 백엔드는 aterm CLI가 `aterm workspace new/send/read/close` 노출 시 추가. 이 스킬 자체는 백엔드 agnostic한 wait 로직만 제공 → 드라이버 추가로 확장.

## 사전 조건

- cmux 0.62+ (검증된 버전)
- 공식 `cmux` 스킬 심볼릭 활성화 (`~/.claude/skills/cmux`)
- 포그라운드 (GUI) 환경 — headless 서버에서는 동작 안 함

## 왜 별도 스킬?

- 공식 `cmux` 스킬은 **documentation-only** (SKILL.md + references). 폴링 로직은 제공하지 않음.
- `workspace-lifecycle`은 폴링 + 체인의 **행동 스크립트**를 추가. 공식과 역할 분리.
- aigentry 에코와 무관한 범용 유틸리티 (헌법 Rule 14 범용/크로스 준수).
