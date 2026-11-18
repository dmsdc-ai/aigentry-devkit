---
name: npm-release
description: |
  npm 패키지 릴리스 자동화 스킬. 버전 범프, 테스트, 퍼블리쉬, git tag, GitHub Release까지 원클릭.
  키워드: release, publish, npm publish, npm release, 릴리스, 퍼블리쉬, 배포, npm 배포, version bump
allowed-tools: Bash, Read, Edit, Glob, Grep, AskUserQuestion
---

# npm Release Automation

npm 패키지 릴리스의 전체 프로세스를 자동화합니다.

## 트리거

- "release", "publish", "npm publish", "릴리스", "퍼블리쉬", "배포"

## 전제 조건 확인

릴리스 전 반드시 아래 항목을 순서대로 확인합니다:

### 1. 프로젝트 유효성

```bash
# package.json 존재 확인
test -f package.json || { echo "ERROR: package.json not found"; exit 1; }

# 현재 버전 확인
node -p "require('./package.json').version"

# 패키지명 확인
node -p "require('./package.json').name"
```

### 2. Git 상태

```bash
# 커밋되지 않은 변경사항 확인
git status --porcelain

# 현재 브랜치 확인 (main/master 권장)
git branch --show-current

# remote와 동기화 확인
git fetch && git status -sb
```

만약 커밋되지 않은 변경사항이 있으면:
- 사용자에게 알리고 커밋 여부 확인
- 릴리스에 포함할 변경사항이면 커밋 후 진행
- 관련 없는 변경이면 stash 후 진행

### 3. 테스트

```bash
npm test
```

테스트 실패 시 릴리스 중단. 사용자에게 알림.

### 4. npm 인증 (수동 publish 경로에만 해당)

```bash
npm whoami
```

인증 실패 시 `npm login` 안내.

GitHub Actions `release.yml` 로 퍼블리쉬하는 경우에는 이 확인이 필요하지 않습니다. CI는 npm
Trusted Publishing(OIDC)으로 인증하며 저장된 토큰을 쓰지 않습니다. `npm whoami` 는 OIDC 인증의
증거가 아니므로 CI 워크플로우에는 넣지 않습니다.

### 5. 이전 버전 확인

```bash
npm view $(node -p "require('./package.json').name") versions --json 2>/dev/null || echo "[]"
```

## 릴리스 프로세스

### Step 1: 버전 타입 선택

사용자에게 AskUserQuestion으로 질문:

- **patch** (0.0.x) — 버그 수정, 작은 변경
- **minor** (0.x.0) — 새 기능 추가 (하위 호환)
- **major** (x.0.0) — 브레이킹 체인지

사용자가 직접 버전을 지정할 수도 있음 (예: "1.2.3")

### Step 2: 버전 범프 + 커밋 + 태그

```bash
# npm version이 자동으로: package.json 수정 → git commit → git tag v{version}
npm version {patch|minor|major}
```

또는 직접 버전 지정:
```bash
npm version {specific-version}
```

### Step 3: Push (코드 + 태그)

```bash
git push && git push --tags
```

### Step 4: 결과 확인

GitHub Actions release.yml이 설정되어 있는 경우:
- 태그 push로 자동 트리거됨
- test → npm publish → GitHub Release 자동 수행
- Actions 상태 확인:

```bash
gh run list --repo $(git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/.git$//') --limit 3
```

GitHub Actions가 없는 경우 (수동 publish):
```bash
npm publish --access public
```

### Step 5: 검증

```bash
# npm에서 새 버전 확인
npm view $(node -p "require('./package.json').name") version

# 설치 테스트
npx $(node -p "require('./package.json').name") --help 2>/dev/null || echo "No --help handler"
```

## GitHub Actions 셋업 (최초 1회)

release.yml이 없으면 자동 생성을 제안합니다:

### Trusted Publishing(OIDC) 등록 — 저장된 토큰 대신

`@dmsdc-ai/*` 패키지는 저장된 `NPM_TOKEN` 시크릿이 아니라 npm Trusted Publishing(OIDC)으로
퍼블리쉬합니다. publish 잡이 `id-token: write` 로 받은 GitHub OIDC 토큰을 npm이 단기 publish
자격증명으로 교환하므로, CI에 토큰을 등록할 필요가 없습니다.

npmjs.com → 해당 패키지 → Settings → Trusted publishing → GitHub Actions 에서 등록합니다.
모든 필드는 대소문자를 구분하며 정확히 일치해야 하고, npm은 저장 시점에 값을 검증하지
않습니다 — 잘못된 값은 publish 실패로만 드러납니다:

| 필드 | 값 |
|------|-----|
| Organization or user | `dmsdc-ai` |
| Repository | 레포 이름 (예: `aigentry-devkit`) |
| Workflow filename | `release.yml` — 파일명만. 경로가 아니고, 워크플로우의 `name:` 값도 아님 |
| Environment name | 비움 (어떤 잡도 GitHub environment를 쓰지 않음) |
| Allowed actions | `npm publish` 를 **명시적으로 허용**. 2026-09-03 이후 생성된 설정은 stage publish만 허용하는 것이 기본값이므로, 그대로 두면 release가 실패함 |

**당일 규칙.** 새로 만든 설정은 2일 안에 publish가 성공하지 않으면 만료되고, 만료 후에는
수정할 수 없습니다. 잘못 입력한 값은 삭제 후 재생성으로만 고칠 수 있으며 2일 시계가 다시
시작됩니다. 그러므로 **등록은 마지막에 하고, 태그 push는 같은 날(며칠이 아니라 몇 시간 내)**
진행합니다.

**첫 OIDC publish는 손으로 확인해야 합니다.** 아래 표준 `release.yml` 에는 registry
read-back이 없으므로 녹색 런 자체는 npm이 그 버전을 서비스한다는 증거가 아닙니다:

```bash
npm view <pkg>@<version> dist.shasum
```

provenance는 **공개 레포 + 공개 패키지**일 때만 자동으로 붙습니다. 비공개 레포라면
attestation이 없는 것이 정상이며 실패가 아닙니다.

**롤백.** trusted publishing으로 옮긴 커밋을 `git revert` 하면 publish 잡의 `registry-url` 과
publish 스텝의 토큰 환경이 복구됩니다. 첫 OIDC publish가 검증될 때까지 레포 시크릿
`NPM_TOKEN` 은 일부러 **남겨 둡니다** — 워크플로우가 참조하지 않고 GitHub은 참조된 시크릿만
주입하므로, 런을 통과시킨 원인이 될 수 없습니다. 검증 후에만 삭제합니다. `workflow_dispatch`
가 없는 레포에서는 거부된 publish를 같은 태그로 재시도할 수 없습니다 — npm 버전은 불변이므로
패치 버전 하나를 쓰고 새 태그를 만들어야 합니다.

Trusted publishing을 지원하지 않는 레지스트리/프로젝트에서만 기존 토큰 방식을 씁니다
(`gh secret list --repo {owner/repo}` 로 확인, `gh secret set NPM_TOKEN --repo {owner/repo}` 로
등록, publish 스텝에 `NODE_AUTH_TOKEN` 환경변수 추가).

### release.yml 생성

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
    # id-token 은 publish 잡에만 줍니다 (OIDC의 핵심 요구사항).
    # contents: write 는 이 잡이 main에 push하는 스텝을 가진 경우에만 필요합니다.
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      # Node 24: trusted publishing은 npm >= 11.5.1 을 요구하고 Node 20은 그보다 낮은 npm을
      # 싣습니다. registry-url 은 넣지 않습니다 — 넣으면 setup-node가
      # `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` npmrc를 써서, 저장된 토큰이
      # 다시 publish할 수 있는 경로를 남깁니다.
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm ci
      - name: npm >= 11.5.1 확인 (가정하지 않고 측정)
        run: |
          set -euo pipefail
          node --version
          npm --version
          node -e '
            const m = process.argv[1];
            const [a, b, c] = m.split(".").map(Number);
            if (a < 11 || (a === 11 && (b < 5 || (b === 5 && c < 1)))) {
              console.error("::error::npm " + m + " < 11.5.1 — 이 잡은 OIDC 교환을 할 수 없습니다.");
              process.exit(1);
            }
            console.log("npm " + m + " >= 11.5.1: OIDC publish 가능");' "$(npm --version)"
      # 토큰 환경 없음 + registry-url 없음 + 빈 userconfig = 폴백할 자격증명이 없음.
      # 그래서 OIDC 교환이 실패하면 publish가 조용히 성공하지 않고 실패합니다.
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

**`prepublishOnly` / `prepack` 훅이 있는 프로젝트는 위 템플릿을 그대로 쓰지 않습니다.** 디렉터리를
publish하면 그 훅이 publish 잡의 Node에서 실행되므로, 단순히 Node를 24로 올리면 CI 매트릭스가
인증하지 않은 Node에서 빌드/테스트가 돌아갑니다. 이 경우 publish 잡에 setup-node를 **두 번**
둡니다: 먼저 CI가 인증하는 Node(보통 '20')에서 훅이 하던 일을 **명시적인 스텝**으로 실행하고,
그 다음 setup-node로 Node '24'를 올려 `npm publish --access public --ignore-scripts` 로
퍼블리쉬합니다. 명시적 스텝을 빼먹으면 `--ignore-scripts` 때문에 빌드나 마지막 테스트 게이트가
조용히 사라집니다 — 훅이 만들던 산출물이 `files` 에 포함된다면 publish되는 내용 자체가 줄어듭니다.

## 체크리스트 요약

릴리스 전 자동 확인 항목:

- [ ] package.json 존재 + name/version 유효
- [ ] git 커밋되지 않은 변경 없음
- [ ] 테스트 통과
- [ ] npm 인증 확인 (수동 publish 시에만)
- [ ] 새 버전이 기존 버전과 충돌하지 않음
- [ ] Trusted publisher 등록됨 — `npm publish` 허용, environment 비움, 당일 등록 (CI 사용 시)
- [ ] release.yml 존재 + `id-token: write` 가 publish 잡에만 있음 (CI 사용 시)

## 출력 형식

릴리스 완료 후 아래 요약을 출력합니다:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
npm Release Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Package:  {name}
Version:  {old} → {new}
Tag:      v{new}
Registry: https://www.npmjs.com/package/{name}
CI:       {GitHub Actions URL or "manual publish"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
