---
name: work-breakdown
description: |
  Spec이나 자연어 설명을 병렬화 가능한 태스크로 분해하고, 사용 가능한 세션에 할당하는 스킬.
  "work breakdown", "태스크 분해", "작업 분배", "spec 분해", "병렬 작업", "세션 할당" 요청 시 사용합니다.
allowed-tools: Bash, Read, Glob, Grep
---

# Work Breakdown

Spec 또는 자연어 설명을 병렬화 가능한 태스크로 분해하고, idle 세션에 할당하여 inject 메시지를 생성합니다.

## 입력

다음 중 하나를 받습니다:

1. **Spec 파일 경로** — 파일을 읽어 분석
2. **자연어 설명** — 직접 분석
3. **telepty shared 파일** — `~/.telepty/shared/*.md` 경로

입력이 없으면 사용자에게 요청합니다.

## 실행 워크플로우

### Step 1: 입력 파싱

spec 파일이 있으면 읽고, 자연어이면 그대로 사용합니다.
핵심 추출 항목:
- **목표**: 최종 산출물
- **범위**: 포함/제외 기능
- **제약**: 기술 스택, 성능, 보안 요구사항
- **완료 기준**: 검증 방법

### Step 2: 세션 디스커버리

두 소스를 교차 참조하여 가용 세션을 판별합니다.

**2-A: telepty 세션 목록**

```bash
telepty list --json 2>/dev/null
```

각 세션의 다음 정보를 수집합니다:
- `id`: 세션 식별자
- `command`: CLI 타입 (claude, codex, gemini)
- `cwd`: 작업 디렉토리 (도메인 전문성 추론)
- `idleSeconds`: 유휴 시간
- `healthStatus`: 연결 상태
- `semantic.phase`: 현재 작업 단계
- `semantic.current_task`: 현재 태스크
- `semantic.blocker`: 블로커 유무

**2-B: task-queue 교차 참조**

```bash
# $AIGENTRY_ORCH_DIR = your aigentry orchestrator project root.
# 미설정 시 install.sh와 동일한 순서로 해석합니다.
# 오케스트레이터 저장소가 없으면 2-B를 건너뛰고 telepty 상태만으로 판정합니다.
PROJECTS_ROOT="${AIGENTRY_PROJECTS_ROOT:-$HOME/projects}"
cat "${AIGENTRY_ORCH_DIR:-$PROJECTS_ROOT/aigentry-orchestrator}/state/task-queue.json"
```

task-queue에서 `status == "delegated"`인 태스크의 `session` 필드를 수집합니다.
해당 세션은 **BUSY** — 새 태스크를 할당하지 않습니다.

**가용성 판정 매트릭스:**

| telepty 상태 | task-queue 상태 | 판정 | 사유 |
|-------------|----------------|------|------|
| CONNECTED + idle | delegated 없음 | **IDLE** — 할당 가능 | 연결됨 + 작업 없음 |
| CONNECTED + idle | delegated 있음 | **BUSY** — 할당 불가 | 오케스트레이터가 태스크 위임 중 |
| CONNECTED + working | delegated 없음 | **BUSY** — 주의 | semantic.phase가 working이면 자체 작업 중 |
| CONNECTED + working | delegated 있음 | **BUSY** — 할당 불가 | 위임 태스크 수행 중 |
| DISCONNECTED | any | **OFFLINE** — 제외 | 연결 끊김 |

**세션 디스커버리 출력 형식:**

```
### 세션 현황
| 세션 ID | CLI | 상태 | 현재 태스크 (task-queue) | 판정 |
|---------|-----|------|------------------------|------|
| aterm-claude | claude | CONNECTED (idle 5s) | T8: 사이드바 수정 | BUSY |
| aterm-codex | codex | CONNECTED (idle 0s) | T35: 워크스페이스 UI, T47: make install | BUSY |
| deliberation-claude | claude | CONNECTED (idle 1070s) | - | IDLE |
| telepty-claude | claude | CONNECTED (idle 166s) | - | IDLE |
```

**가용 세션 부족 경고:**

가용(IDLE) 세션이 분해된 태스크 수보다 적으면 경고를 출력합니다:

```
⚠️ 가용 세션 부족: {idle_count}개 IDLE / {task_count}개 태스크
→ 추천: session-create 스킬로 새 세션 생성
→ 또는: 현재 세션에서 직접 실행할 태스크를 식별하여 분리
```

### Step 3: 세션 역량 매핑

CLI 타입별 강점:

| CLI | 강점 | 약점 | 최적 태스크 |
|-----|------|------|------------|
| `claude` | 복잡한 추론, 아키텍처, 멀티파일 리팩토링, 테스트 | 느릴 수 있음 | 설계, 복잡한 구현, 디버깅, 리뷰 |
| `codex` | 빠른 코드 편집, 단일 파일 변경, 자동 수정 | 복잡한 추론 약함 | 단순 구현, 타입 수정, 포맷팅, 보일러플레이트 |
| `gemini` | 리서치, 문서 분석, 웹 검색, 대안 탐색 | 코드 편집 제한적 | 조사, 문서화, 비교 분석, API 탐색 |

프로젝트별 도메인 전문성 (cwd 기반):

| cwd 패턴 | 도메인 |
|----------|--------|
| `aigentry-aterm` | 터미널, Rust, Swift, wgpu, PTY |
| `aigentry-deliberation` | MCP, 토론 프로토콜, Node.js |
| `aigentry-telepty` | 세션 관리, IPC, CLI 도구 |
| `aigentry-orchestrator` | 오케스트레이션, 태스크 관리 |
| `aigentry-dustcraw` | 웹 크롤링, 데이터 수집 |
| `aigentry-logger` | 로깅, 모니터링 |
| `ghostty` / `winit` | 터미널 에뮬레이터, 윈도우 시스템 |

### Step 4: 태스크 분해

spec을 3~12개의 독립적 태스크로 분해합니다.

각 태스크 구조:

```
task_id: T{N}
title: 한 줄 요약
description: 상세 설명
domain: 관련 도메인 (aterm, telepty, deliberation, ...)
complexity: low | medium | high
estimated_files: 영향받는 파일 목록
dependencies: [T{M}, ...] (선행 태스크)
verification: 완료 검증 방법
```

분해 원칙:
- **단일 책임**: 태스크 하나는 하나의 목표
- **최소 의존성**: 가능한 병렬 실행 가능하도록
- **명확한 경계**: 파일 충돌 없도록 (같은 파일을 두 태스크가 수정하지 않음)
- **검증 가능**: 각 태스크에 완료 기준 포함

### Step 5: 의존성 그래프

태스크 간 의존 관계를 DAG로 표현합니다:

```
Phase 1 (병렬): T1, T2, T3     ← 의존성 없음, 동시 실행
Phase 2 (병렬): T4, T5          ← T1 완료 후
Phase 3 (직렬): T6              ← T4, T5 모두 완료 후
Phase 4 (병렬): T7, T8          ← T6 완료 후
```

의존성 판단 기준:
- 같은 파일 수정 → 직렬
- API 정의 → 구현 → 직렬
- 독립 모듈 → 병렬
- 테스트 → 구현 완료 후

### Step 6: 세션 할당

할당 알고리즘:

1. **가용성 필터**: Step 2 판정이 **IDLE**인 세션만 후보 (task-queue delegated 교차 확인 필수)
2. **역량 매칭**: 태스크 complexity + domain → CLI 강점 매칭
3. **부하 분산**: 세션당 최대 2개 태스크 (직렬 실행)
4. **도메인 친화**: cwd가 태스크 도메인과 일치하면 우선

할당 규칙:

| 태스크 특성 | 최적 세션 |
|------------|----------|
| high complexity + 아키텍처 | claude 세션 |
| low complexity + 단일 파일 | codex 세션 |
| 리서치 + 문서 분석 | gemini 세션 |
| 해당 프로젝트 코드 수정 | 해당 프로젝트 세션 |

가용 세션이 부족하면:
- 현재 세션에서 직접 실행할 태스크 식별
- 새 세션 생성 제안 (`session-create` 스킬 참조)
- Step 2의 "가용 세션 부족 경고" 출력

### Step 7: Inject 메시지 생성

각 할당에 대해 ready-to-send inject 명령을 생성합니다:

```bash
telepty inject --ref --from {orchestrator-session-id} {target-session-id} "$(cat <<'TASK'
[Task {task_id}] {title}

## 목표
{description}

## 영향 파일
{estimated_files}

## 완료 기준
{verification}

## 의존성
{dependencies 설명 또는 "없음 — 즉시 시작 가능"}

## 보고
완료 시: telepty inject --ref --from {target-session-id} {orchestrator-session-id} "DONE T{N}: {요약}"
블로커 시: telepty inject --ref --from {target-session-id} {orchestrator-session-id} "BLOCKED T{N}: {이유}"
TASK
)"
```

`--ref` 플래그: shared 파일로 전달 (긴 메시지에 적합).

### Step 8: 결과 출력

최종 출력 형식:

```
## Work Breakdown: {spec 제목}

### 세션 현황
| 세션 ID | CLI | 상태 | 현재 태스크 (task-queue) | 판정 |
|---------|-----|------|------------------------|------|
| aterm-claude | claude | CONNECTED (idle 5s) | T8: 사이드바 수정 | BUSY |
| aterm-codex | codex | CONNECTED (idle 0s) | T35: 워크스페이스 UI, T47: make install | BUSY |
| deliberation-claude | claude | CONNECTED (idle 1070s) | - | IDLE |
| telepty-claude | claude | CONNECTED (idle 166s) | - | IDLE |

(⚠️ 가용 세션 부족 경고 — 해당 시에만 표시)

### 태스크 목록
| ID | 제목 | 복잡도 | 도메인 | 할당 세션 | 의존성 |
|----|------|--------|--------|----------|--------|
| T1 | ... | low | aterm | aigentry-aterm-codex | - |
| T2 | ... | high | telepty | aigentry-telepty-claude | - |
| T3 | ... | medium | deliberation | aigentry-deliberation-claude | T1 |

### 의존성 그래프
Phase 1 (병렬): T1, T2
Phase 2 (T1 완료 후): T3
Phase 3 (T2, T3 완료 후): T4

### Inject 명령어
(각 세션별 inject 명령어)

### 실행 추정
- 총 태스크: N개
- 병렬 가능: M개
- 예상 Phase: K개
- 가용 세션: L개 (IDLE) / M개 (BUSY) / K개 (OFFLINE)
```

## 품질 규칙

- 파일 충돌 방지: 같은 파일을 두 세션이 동시에 수정하지 않도록 할당
- lessons.json 참조: `$AIGENTRY_ORCH_DIR/state/lessons.json` (2-B와 동일하게 해석)에서 해당 프로젝트의 invariants와 failed approaches를 inject에 포함 — 파일이 없으면 생략
- 헌법 준수: 제3조(역할 분리), 제9조(독립 동작) 기반 분해
- CONNECTED 세션만 할당: DISCONNECTED 세션은 제외
- 오케스트레이터 세션은 할당 대상에서 제외 (조율 전용)

## 사용 예시

```text
"이 spec을 세션들에게 분배해줘: ~/specs/feature-x.md"
"work breakdown: 로깅 시스템 전면 리팩토링"
"태스크 분해하고 idle 세션에 할당해줘"
"spec 분해: OAuth 로그인 + 소셜 연동 + 권한 관리"
```
