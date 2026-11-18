---
name: project-ops
description: |
  dmsdc-ai 전체 프로젝트 CI/CD 및 시크릿 관리 스킬. Trusted Publishing(OIDC) 등록, NPM_TOKEN 관리/회수, release.yml 셋업, 헬스체크.
  키워드: project-ops, 프로젝트 관리, 전역 설정, CI/CD 관리, NPM_TOKEN 관리, 시크릿 관리, repo 관리, trusted publishing, OIDC
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

| 패키지 | 레포 | 설명 | publish 자격증명 |
|--------|------|------|------------------|
| `@dmsdc-ai/aigentry-deliberation` | aigentry-deliberation | MCP Deliberation Server | Trusted Publishing (OIDC) |
| `@dmsdc-ai/aigentry-devkit` | aigentry-devkit | 크로스플랫폼 설치/도구 번들 | Trusted Publishing (OIDC) |
| `@dmsdc-ai/aigentry-brain` | aigentry-brain | AI Brain 시스템 | Trusted Publishing (OIDC) |
| `@dmsdc-ai/aigentry-registry` | aigentry-registry | AI Agent 레지스트리 | NPM_TOKEN (미이관) |

### publish 자격증명 관리

**기본값은 Trusted Publishing(OIDC)입니다.** 위 표에서 OIDC로 표시된 레포는 `release.yml` 이
저장된 토큰을 전혀 참조하지 않습니다. publish 잡이 `id-token: write` 로 받은 GitHub OIDC
토큰을 npm이 단기 publish 자격증명으로 교환합니다. 그 레포에는 **NPM_TOKEN을 배포하지
않습니다** — 새로 넣으면 워크플로우가 쓰지는 않지만 회수해야 할 자격증명이 하나 늘어납니다.

등록 값과 당일 규칙, 수동 검증, 롤백은 `npm-release` 스킬의 "Trusted Publishing(OIDC) 등록"
절에 있습니다. 요약: Organization or user `dmsdc-ai`, Repository 는 레포 이름, Workflow
filename `release.yml`, Environment 비움, Allowed actions 에 `npm publish` 명시 허용. 새 설정은
2일 안에 publish가 성공하지 않으면 만료되고 수정이 불가능하므로 **등록 후 같은 날 태그를
push** 합니다.

**NPM_TOKEN 관리 (아직 이관하지 않은 레포 + 롤백 자료):**

dmsdc-ai 계정은 **개인 계정**이므로 Organization secrets를 사용할 수 없습니다. 따라서 아직
토큰으로 publish하는 레포에는 repo-level secret으로 설정합니다.

- npm 토큰은 **1개만** 유지 (dmsdc-ai 전용 Granular Access Token)
- 토큰 타입: **Granular Access Token** (Bypass 2FA, Read-Write)
- 토큰 갱신 시 **아직 토큰을 쓰는 레포에만** 일괄 업데이트
- 이미 OIDC로 이관한 레포의 기존 NPM_TOKEN 시크릿은 **첫 OIDC publish가 검증될 때까지
  남겨 둡니다** (롤백 자료). 워크플로우가 참조하지 않고 GitHub은 참조된 시크릿만 주입하므로
  런을 통과시킨 원인이 될 수 없습니다. 검증 후 삭제합니다.
- publish 워크플로우가 **없는** 레포에 남아 있는 NPM_TOKEN은 어떤 워크플로우도 읽을 수 없으니
  삭제해도 릴리스가 깨지지 않습니다. 삭제 전에 npmjs.com에서 토큰 값을 다시 얻을 수 있는지
  확인하십시오 — GitHub은 저장된 시크릿 값을 보여주지 않습니다.

## 운영 프로세스

### 1. NPM_TOKEN 일괄 배포 (아직 이관하지 않은 레포에만)

OIDC로 이관한 레포에는 토큰을 배포하지 않습니다. 대상은 아직 토큰으로 publish하는 레포뿐입니다.

```bash
# 아직 NPM_TOKEN으로 퍼블리쉬하는 레포 목록
# (aigentry-deliberation / aigentry-devkit / aigentry-brain 은 Trusted Publishing(OIDC)으로
#  이관되어 release.yml이 토큰을 참조하지 않으므로 여기에 넣지 않습니다)
TOKEN_REPOS="aigentry-registry"

# 일괄 설정
for repo in $TOKEN_REPOS; do
  echo "=== Setting NPM_TOKEN for dmsdc-ai/$repo ==="
  echo "{NEW_TOKEN}" | gh secret set NPM_TOKEN --repo "dmsdc-ai/$repo"
done
```

사용자에게 토큰을 물어보고 설정합니다:

1. AskUserQuestion으로 npm 토큰 입력 요청
2. 대상 레포에만 설정 (OIDC 레포는 제외)
3. 설정 확인: `gh secret list --repo dmsdc-ai/{repo}`

이관된 레포에 토큰이 필요해 보인다면 그것은 신호입니다: 보통 trusted publisher 등록이
없거나 만료된 것이므로, 토큰을 되살리지 말고 등록을 확인하십시오.

### 2. NPM_TOKEN 갱신

기존 토큰 만료/교체 시. 갱신 대상은 §1의 `TOKEN_REPOS` 와 같습니다.

```bash
# 현재 시크릿 설정 날짜 확인
for repo in $TOKEN_REPOS; do
  echo "=== dmsdc-ai/$repo ==="
  gh secret list --repo "dmsdc-ai/$repo"
done

# 새 토큰으로 일괄 업데이트
for repo in $TOKEN_REPOS; do
  echo "{NEW_TOKEN}" | gh secret set NPM_TOKEN --repo "dmsdc-ai/$repo"
done
```

OIDC 레포에 남아 있는 예전 NPM_TOKEN 시크릿은 **갱신하지 않습니다**. 첫 OIDC publish가
검증되기 전까지는 롤백 자료로 그대로 두고, 검증 후에는 갱신이 아니라 삭제합니다.

### 3. release.yml 헬스체크

모든 npm 레포에 release.yml이 올바르게 설정되어 있는지 확인합니다.

OIDC 레포에서 확인해야 하는 것은 "토큰이 있는가"가 아니라 그 반대입니다: release.yml이 토큰을
참조하지 **않고**, `id-token: write` 가 publish 잡에 있는가.

```bash
NPM_REPOS="aigentry-deliberation aigentry-devkit aigentry-brain aigentry-registry"

for repo in $NPM_REPOS; do
  echo "=== dmsdc-ai/$repo ==="

  # release.yml 존재 확인 + 본문 확보
  WF="$(gh api "repos/dmsdc-ai/$repo/contents/.github/workflows/release.yml" \
    --jq '.content' 2>/dev/null | base64 -d 2>/dev/null)"
  if [ -n "$WF" ]; then echo "  release.yml: OK"; else echo "  release.yml: MISSING"; fi

  # 자격증명 방식 판별 (워크플로우 본문이 근거; 시크릿 존재 여부는 근거가 아님)
  if printf '%s' "$WF" | grep -q 'id-token: *write'; then
    echo "  publish 자격증명: OIDC (id-token: write)"
    # OIDC 레포는 토큰 참조가 0건이어야 합니다
    printf '%s' "$WF" | grep -q 'secrets\.NPM_TOKEN' \
      && echo "  !! secrets.NPM_TOKEN 가 남아 있음 — 반쪽 이관. OIDC가 실패해도 토큰으로 조용히 성공할 수 있음" \
      || echo "  secrets.NPM_TOKEN 참조: 없음 (정상)"
    # id-token 은 publish 잡에만 있어야 합니다
    echo "  id-token 출현 횟수: $(printf '%s' "$WF" | grep -c 'id-token: *write') (1이어야 정상)"
  else
    echo "  publish 자격증명: NPM_TOKEN (미이관)"
    gh secret list --repo "dmsdc-ai/$repo" --json name --jq '.[].name' 2>/dev/null \
      | grep -q NPM_TOKEN && echo "  NPM_TOKEN: OK" || echo "  NPM_TOKEN: MISSING"
  fi

  # 최신 릴리스 Actions 상태
  gh run list --repo "dmsdc-ai/$repo" --workflow release.yml --limit 1 \
    --json status,conclusion --jq '.[0] | "\(.status): \(.conclusion)"' 2>/dev/null \
    || echo "  Last release run: N/A"

  echo ""
done
```

이 세 레포(deliberation / devkit / brain)의 release.yml에는 registry read-back이 없으므로,
런이 녹색이라는 사실만으로는 npm이 그 버전을 서비스한다고 말할 수 없습니다. 릴리스 직후
`npm view <pkg>@<version> dist.shasum` 으로 직접 확인합니다.

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
    # id-token 은 publish 잡에만. 이 파일 전체에서 한 번만 나와야 합니다.
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      # Node 24 (npm >= 11.5.1). registry-url 없음 — 있으면 setup-node가 _authToken npmrc를
      # 써서 저장된 토큰이 다시 publish할 수 있는 경로가 남습니다.
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm ci
      - name: npm >= 11.5.1 확인
        run: |
          set -euo pipefail
          node --version
          npm --version
          node -e '
            const m = process.argv[1];
            const [a, b, c] = m.split(".").map(Number);
            if (a < 11 || (a === 11 && (b < 5 || (b === 5 && c < 1)))) {
              console.error("::error::npm " + m + " < 11.5.1 — OIDC 교환 불가");
              process.exit(1);
            }
            console.log("npm " + m + " >= 11.5.1: OIDC publish 가능");' "$(npm --version)"
      - run: |
          set -euo pipefail
          : > "${RUNNER_TEMP}/empty-npmrc"
          npm_config_userconfig="${RUNNER_TEMP}/empty-npmrc" \
            npm publish --access public

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

`prepublishOnly` / `prepack` 훅이 있는 레포에는 이 템플릿을 그대로 쓰지 마십시오. 디렉터리를
publish하면 그 훅이 publish 잡의 Node에서 돌기 때문에, Node만 24로 올리면 CI가 인증하지 않은
Node에서 빌드/테스트가 실행됩니다. 그 경우 publish 잡에 setup-node를 두 번 두고(인증된 Node에서
훅이 하던 일을 명시적 스텝으로 실행 → Node '24' → `npm publish --access public --ignore-scripts`)
퍼블리쉬합니다. 자세한 내용은 `npm-release` 스킬을 따릅니다.

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

1. **package.json 확인**: `@dmsdc-ai/` 스코프, `publishConfig.access: "public"`,
   `repository.url` 이 실제 GitHub 레포와 정확히 일치 (trusted publishing 요구사항)
2. **Trusted publisher 등록**: npmjs.com → 패키지 → Settings → Trusted publishing → GitHub
   Actions (`dmsdc-ai` / 레포 이름 / `release.yml` / environment 비움 / `npm publish` 허용).
   새 publisher는 처음부터 OIDC로 시작하고 NPM_TOKEN은 **설정하지 않습니다**. 등록은
   첫 태그 push와 같은 날에 — 2일 안에 publish가 성공하지 않으면 만료됩니다
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
  publish 자격증명: OIDC (id-token: write ×1)
  secrets.NPM_TOKEN: 없음 (정상)
  release.yml:  OK
  Last release: completed: success
  npm version:  0.0.47
aigentry-devkit
  publish 자격증명: OIDC (id-token: write ×1)
  secrets.NPM_TOKEN: 없음 (정상)
  release.yml:  OK
  Last release: completed: success
  npm version:  0.1.14
aigentry-brain
  publish 자격증명: OIDC (id-token: write ×1)
  secrets.NPM_TOKEN: 없음 (정상)
  release.yml:  OK
  Last release: completed: success
  npm version:  0.3.1
aigentry-registry
  publish 자격증명: NPM_TOKEN (미이관)
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
Repos:  1/1 updated
  aigentry-registry      OK
Skipped (Trusted Publishing, 토큰 불필요):
  aigentry-deliberation  aigentry-devkit  aigentry-brain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 주의사항

- dmsdc-ai는 **개인 계정**입니다. Organization secrets를 사용할 수 없습니다.
- **기본 publish 방식은 Trusted Publishing(OIDC)입니다.** 이관된 레포에는 NPM_TOKEN을
  새로 배포하지 않습니다 — 워크플로우가 읽지 않는 자격증명은 회수 대상만 늘립니다.
- npm 토큰은 **1개만** 유지하고, **아직 토큰으로 publish하는 레포에만** 동일 토큰을 설정합니다.
- 토큰 갱신 시 **토큰을 쓰는 레포 전체**에 일괄 업데이트해야 합니다 (OIDC 레포는 제외).
- 이관된 레포의 기존 NPM_TOKEN은 첫 OIDC publish 검증 전까지 롤백 자료로 남기고, 검증 후
  삭제합니다. 삭제 전에 npmjs.com에서 토큰 값을 다시 얻을 수 있는지 확인하십시오 — GitHub은
  저장된 시크릿 값을 보여주지 않습니다.
- 첫 OIDC publish 검증 후, 패키지별 하드닝(package Settings → Publishing access → "Require
  two-factor authentication and disallow tokens")을 고려합니다. 검증 **전에** 켜면 해당
  패키지의 릴리스가 깨집니다.
- npm 토큰은 https://www.npmjs.com/settings/duckyoungkim/tokens 에서 관리합니다.
- GitHub 시크릿 관리에는 `repo` 스코프가 필요합니다.
