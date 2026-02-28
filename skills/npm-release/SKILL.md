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

### 4. npm 인증

```bash
npm whoami
```

인증 실패 시 `npm login` 안내.

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

### NPM_TOKEN 시크릿 확인

```bash
gh secret list --repo {owner/repo}
```

NPM_TOKEN이 없으면:
1. https://www.npmjs.com/settings/{username}/tokens 안내
2. **Automation** 타입 토큰 생성
3. GitHub 시크릿 등록:

```bash
gh secret set NPM_TOKEN --repo {owner/repo}
# 프롬프트에 토큰 붙여넣기
```

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

## 체크리스트 요약

릴리스 전 자동 확인 항목:

- [ ] package.json 존재 + name/version 유효
- [ ] git 커밋되지 않은 변경 없음
- [ ] 테스트 통과
- [ ] npm 인증 확인
- [ ] 새 버전이 기존 버전과 충돌하지 않음
- [ ] NPM_TOKEN 시크릿 설정됨 (CI 사용 시)
- [ ] release.yml 존재 (CI 사용 시)

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
