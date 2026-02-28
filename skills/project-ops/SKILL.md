---
name: project-ops
description: |
  dmsdc-ai 전체 프로젝트 CI/CD 및 시크릿 관리 스킬. NPM_TOKEN 일괄 배포, release.yml 셋업, 헬스체크.
  키워드: project-ops, 프로젝트 관리, 전역 설정, CI/CD 관리, NPM_TOKEN 관리, 시크릿 관리, repo 관리
allowed-tools: Bash, Read, Edit, Write, Glob, Grep, AskUserQuestion
---

# dmsdc-ai Project Operations

dmsdc-ai 계정의 모든 프로젝트를 일관되게 관리합니다.

## 트리거

- "project-ops", "프로젝트 관리", "전역 설정", "CI/CD 관리", "시크릿 관리"
- "NPM_TOKEN 설정", "release.yml 확인", "레포 관리", "repo 관리"
- "전역으로 관리", "일괄 설정", "모든 프로젝트"

## 인프라 현황

### 계정 정보

- **GitHub**: `dmsdc-ai` (개인 계정, Organization 아님)
- **npm**: `@dmsdc-ai` 스코프
- **Organization secrets 미지원**: 개인 계정이므로 repo-level secrets 사용

### npm 패키지 목록

| 패키지 | 레포 | 설명 |
|--------|------|------|
| `@dmsdc-ai/aigentry-deliberation` | aigentry-deliberation | MCP Deliberation Server |
| `@dmsdc-ai/aigentry-devkit` | aigentry-devkit | 크로스플랫폼 설치/도구 번들 |
| `@dmsdc-ai/aigentry-brain` | aigentry-brain | AI Brain 시스템 |
| `@dmsdc-ai/aigentry-registry` | aigentry-registry | AI Agent 레지스트리 |

### NPM_TOKEN 관리

dmsdc-ai 계정은 **개인 계정**이므로 Organization secrets를 사용할 수 없습니다.
대신 **하나의 npm 토큰**을 모든 레포에 repo-level secret으로 설정합니다.

**토큰 관리 원칙:**
- npm 토큰은 **1개만** 유지 (dmsdc-ai 전용 Granular Access Token)
- 토큰 타입: **Granular Access Token** (Bypass 2FA, Read-Write)
- 모든 `@dmsdc-ai/*` 패키지에 대한 publish 권한
- 토큰 갱신 시 모든 레포에 일괄 업데이트

## 운영 프로세스

### 1. NPM_TOKEN 일괄 배포

새 npm 토큰을 모든 npm 패키지 레포에 설정합니다.

```bash
# npm 패키지를 퍼블리쉬하는 레포 목록
NPM_REPOS="aigentry-deliberation aigentry-devkit aigentry-brain aigentry-registry"

# 일괄 설정
for repo in $NPM_REPOS; do
  echo "=== Setting NPM_TOKEN for dmsdc-ai/$repo ==="
  echo "{NEW_TOKEN}" | gh secret set NPM_TOKEN --repo "dmsdc-ai/$repo"
done
```

사용자에게 토큰을 물어보고 설정합니다:

1. AskUserQuestion으로 npm 토큰 입력 요청
2. 4개 레포에 일괄 설정
3. 설정 확인: `gh secret list --repo dmsdc-ai/{repo}`

### 2. NPM_TOKEN 갱신

기존 토큰 만료/교체 시:

```bash
# 현재 시크릿 설정 날짜 확인
for repo in $NPM_REPOS; do
  echo "=== dmsdc-ai/$repo ==="
  gh secret list --repo "dmsdc-ai/$repo"
done

# 새 토큰으로 일괄 업데이트
for repo in $NPM_REPOS; do
  echo "{NEW_TOKEN}" | gh secret set NPM_TOKEN --repo "dmsdc-ai/$repo"
done
```

### 3. release.yml 헬스체크

모든 npm 레포에 release.yml이 올바르게 설정되어 있는지 확인합니다.

```bash
NPM_REPOS="aigentry-deliberation aigentry-devkit aigentry-brain aigentry-registry"

for repo in $NPM_REPOS; do
  echo "=== dmsdc-ai/$repo ==="

  # release.yml 존재 확인
  gh api "repos/dmsdc-ai/$repo/contents/.github/workflows/release.yml" \
    --jq '.name' 2>/dev/null && echo "  release.yml: OK" || echo "  release.yml: MISSING"

  # NPM_TOKEN 시크릿 확인
  gh secret list --repo "dmsdc-ai/$repo" --json name --jq '.[].name' 2>/dev/null \
    | grep -q NPM_TOKEN && echo "  NPM_TOKEN: OK" || echo "  NPM_TOKEN: MISSING"

  # 최신 릴리스 Actions 상태
  gh run list --repo "dmsdc-ai/$repo" --workflow release.yml --limit 1 \
    --json status,conclusion --jq '.[0] | "\(.status): \(.conclusion)"' 2>/dev/null \
    || echo "  Last release run: N/A"

  echo ""
done
```

### 4. release.yml 일괄 생성

release.yml이 없는 레포에 표준 템플릿을 생성합니다.

표준 release.yml:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm test

  publish:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

  github-release:
    needs: publish
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

### 5. 전체 레포 상태 대시보드

```bash
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "dmsdc-ai Project Status Dashboard"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 모든 활성 레포 목록
gh repo list dmsdc-ai --no-archived --json name,description,updatedAt \
  --jq '.[] | "  \(.name) — \(.description // "no description") (updated: \(.updatedAt[:10]))"'

echo ""
echo "Archived:"
gh repo list dmsdc-ai --archived --json name \
  --jq '.[] | "  \(.name)"'

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

### 6. 새 프로젝트 온보딩

새 npm 패키지 레포를 추가할 때:

1. **package.json 확인**: `@dmsdc-ai/` 스코프, `publishConfig.access: "public"`
2. **NPM_TOKEN 설정**: `gh secret set NPM_TOKEN --repo dmsdc-ai/{repo}`
3. **release.yml 생성**: `.github/workflows/release.yml`
4. **CI workflow 확인**: `.github/workflows/ci.yml` (test on push/PR)
5. **package.json scripts 확인**:
   ```json
   {
     "scripts": {
       "test": "vitest run",
       "prepublishOnly": "vitest run",
       "release:patch": "npm version patch && git push && git push --tags",
       "release:minor": "npm version minor && git push && git push --tags",
       "release:major": "npm version major && git push && git push --tags"
     }
   }
   ```

### 7. 시크릿 일괄 관리 (범용)

NPM_TOKEN 외 다른 시크릿도 일괄 관리할 수 있습니다:

```bash
# 특정 시크릿을 모든 레포에 설정
SECRET_NAME="SOME_SECRET"
SECRET_VALUE="some_value"
REPOS="repo1 repo2 repo3"

for repo in $REPOS; do
  echo "$SECRET_VALUE" | gh secret set "$SECRET_NAME" --repo "dmsdc-ai/$repo"
done
```

```bash
# 모든 레포의 시크릿 현황 조회
gh repo list dmsdc-ai --no-archived --json name --jq '.[].name' | while read repo; do
  echo "=== $repo ==="
  gh secret list --repo "dmsdc-ai/$repo" 2>/dev/null || echo "  (no secrets)"
  echo ""
done
```

## 출력 형식

### 헬스체크 결과

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
dmsdc-ai Project Health Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
aigentry-deliberation
  NPM_TOKEN:    OK (2026-02-28)
  release.yml:  OK
  Last release: completed: success
  npm version:  0.0.5
aigentry-devkit
  NPM_TOKEN:    OK (2026-02-28)
  release.yml:  OK
  Last release: completed: success
  npm version:  0.0.3
aigentry-brain
  NPM_TOKEN:    OK (2026-02-28)
  release.yml:  MISSING ← 생성 필요
  npm version:  (not published)
aigentry-registry
  NPM_TOKEN:    OK (2026-02-28)
  release.yml:  MISSING ← 생성 필요
  npm version:  (not published)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### NPM_TOKEN 배포 결과

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NPM_TOKEN Deployment Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Token:  dmsdc-ai (Granular Access Token)
Repos:  4/4 updated
  aigentry-deliberation  OK
  aigentry-devkit        OK
  aigentry-brain         OK
  aigentry-registry      OK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 주의사항

- dmsdc-ai는 **개인 계정**입니다. Organization secrets를 사용할 수 없습니다.
- npm 토큰은 **1개만** 유지하고, 모든 레포에 동일 토큰을 설정합니다.
- 토큰 갱신 시 반드시 **모든 레포**에 일괄 업데이트해야 합니다.
- npm 토큰은 https://www.npmjs.com/settings/duckyoungkim/tokens 에서 관리합니다.
- GitHub 시크릿 관리에는 `repo` 스코프가 필요합니다.
