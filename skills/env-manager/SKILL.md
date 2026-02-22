---
name: env-manager
description: |
  전역 환경변수 관리 스킬. direnv 기반 계층형 환경변수 시스템 관리.
  키워드: env, 환경변수, environment, .env, direnv, env-check, 환경설정
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Environment Variable Manager

direnv 기반 계층형 환경변수 관리 시스템을 운영하는 스킬입니다.

## 아키텍처

```
~/.env              (전역 API 키 - Single Source of Truth)
~/.envrc            (direnv: dotenv_if_exists ~/.env)
  |
  +-- ~/Projects/<project>/
        .envrc      (source_up_if_exists + dotenv_if_exists .env.local)
        .env.local  (프로젝트 전용 변수)
        .env        (AUTO-GENERATED: ~/.env + .env.local 병합, Docker용)
        scripts/generate-docker-env.sh  (브릿지 스크립트)
```

**변수 우선순위**: `.env.local` > `~/.env` (direnv source_up 체인)

## 명령 분기

사용자 요청에 따라 아래 워크플로우 중 하나를 실행합니다.

### 1. 감사 (Audit)

**트리거**: "env check", "환경변수 점검", "env 상태"

```bash
~/bin/env-check
```

출력 항목:
- `[Files]` - 파일 목록 및 키 개수, 브릿지 파일 신선도
- `[Duplicates]` - 전역/로컬 간 중복 키 탐지
- `[Placeholders]` - 빈 값 또는 플레이스홀더 경고
- `[direnv Status]` - 각 디렉토리 direnv 허용 상태

### 2. 새 프로젝트 초기화

**트리거**: "env init", "새 프로젝트 환경변수 설정"

사용자에게 확인할 사항:
1. 프로젝트 경로 (예: `~/Projects/my-project`)
2. Docker 사용 여부 (브릿지 스크립트 필요 여부)

#### Step 1: .envrc 생성

```bash
# ~/Projects/<project>/.envrc
source_up_if_exists
dotenv_if_exists .env.local
```

Docker 사용 시 추가:
```bash
bash scripts/generate-docker-env.sh 2>/dev/null || true
```

#### Step 2: .env.local 생성

프로젝트 전용 변수만 포함하는 파일 생성:
```bash
# Project-specific environment variables
# Global API keys are inherited from ~/.env via direnv
```

#### Step 3: 브릿지 스크립트 (Docker 사용 시)

`scripts/generate-docker-env.sh` 생성:
```bash
#!/usr/bin/env bash
set -euo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
ENV_LOCAL="$PROJECT_DIR/.env.local"
GLOBAL_ENV="$HOME/.env"
{
  echo "# AUTO-GENERATED for Docker compatibility -- do not edit"
  echo "# Edit ~/.env (global) or .env.local (project) instead"
  echo "# Generated at: $(date -Iseconds)"
  echo ""
  echo "# === Global API Keys (from ~/.env) ==="
  grep -v '^\s*#' "$GLOBAL_ENV" | grep -v '^\s*$' || true
  echo ""
  echo "# === Project-Specific (from .env.local) ==="
  if [[ -f "$ENV_LOCAL" ]]; then
    grep -v '^\s*#' "$ENV_LOCAL" | grep -v '^\s*$' || true
  fi
} > "$ENV_FILE"
```

```bash
chmod +x scripts/generate-docker-env.sh
```

#### Step 4: .gitignore 업데이트

`.gitignore`에 추가:
```
.env
.env.local
```

#### Step 5: .env.local.example 생성

온보딩용 템플릿 (플레이스홀더 포함):
```bash
# Project-specific environment variables
# Copy to .env.local and fill in values
# Global API keys are inherited from ~/.env via direnv
```

#### Step 6: direnv allow

```bash
cd ~/Projects/<project> && direnv allow
```

#### Step 7: 브릿지 실행 (Docker 사용 시)

```bash
cd ~/Projects/<project> && bash scripts/generate-docker-env.sh
```

### 3. 변수 추가/수정

**트리거**: "env add", "환경변수 추가", "API 키 추가"

사용자에게 확인:
1. 키 이름 (예: `NEW_API_KEY`)
2. 값
3. 범위: 전역(`~/.env`) 또는 프로젝트(`<project>/.env.local`)

#### 전역 변수 추가

```bash
# ~/.env 에 추가
echo 'NEW_API_KEY=value' >> ~/.env
```

추가 후:
1. direnv가 자동 반영 (새 셸에서)
2. Docker 프로젝트의 브릿지 파일 재생성 필요:
```bash
for project in shipfast n8n-video; do
  if [[ -f "$HOME/Projects/$project/scripts/generate-docker-env.sh" ]]; then
    bash "$HOME/Projects/$project/scripts/generate-docker-env.sh"
  fi
done
```

#### 프로젝트 변수 추가

```bash
# ~/Projects/<project>/.env.local 에 추가
echo 'PROJECT_VAR=value' >> ~/Projects/<project>/.env.local
```

Docker 사용 프로젝트라면 브릿지 재생성:
```bash
bash ~/Projects/<project>/scripts/generate-docker-env.sh
```

### 4. 브릿지 재생성

**트리거**: "env regen", "브릿지 재생성", "docker env 갱신"

특정 프로젝트:
```bash
bash ~/Projects/<project>/scripts/generate-docker-env.sh
```

전체 프로젝트:
```bash
for project_dir in ~/Projects/*/; do
  if [[ -f "$project_dir/scripts/generate-docker-env.sh" ]]; then
    project=$(basename "$project_dir")
    echo "Regenerating: $project"
    bash "$project_dir/scripts/generate-docker-env.sh"
  fi
done
```

### 5. 변수 제거

**트리거**: "env remove", "환경변수 삭제"

1. 대상 파일 확인 (`~/.env` 또는 `.env.local`)
2. Edit 도구로 해당 라인 제거
3. 브릿지 재생성 (Docker 프로젝트)

### 6. 변수 검색

**트리거**: "env find", "환경변수 찾기", "어디에 정의되어 있어"

```bash
# 전역에서 검색
grep -n "KEY_NAME" ~/.env

# 모든 프로젝트에서 검색
grep -rn "KEY_NAME" ~/.env ~/Projects/*/.env.local 2>/dev/null
```

## 파일 위치 참조

| 파일 | 용도 |
|------|------|
| `~/.env` | 전역 API 키 (SSOT) |
| `~/.envrc` | 전역 direnv 설정 |
| `~/bin/env-check` | 감사 스크립트 |
| `~/Projects/<p>/.envrc` | 프로젝트 direnv (source_up 체인) |
| `~/Projects/<p>/.env.local` | 프로젝트 전용 변수 |
| `~/Projects/<p>/.env` | Docker용 자동생성 파일 |
| `~/Projects/<p>/scripts/generate-docker-env.sh` | 브릿지 스크립트 |
| `~/Projects/<p>/.env.local.example` | 온보딩 템플릿 |

## 주의사항

- `.env` 파일은 **절대 직접 편집하지 않음** (AUTO-GENERATED 표시 있는 파일)
- 전역 키는 반드시 `~/.env`에만 보관 (중복 금지)
- `python-dotenv`의 `load_dotenv(override=False)` 기본 동작과 호환
- Docker Compose는 셸 환경변수를 읽지 않으므로 브릿지 필수
- `.env.local`은 `.gitignore`에 포함 필수
