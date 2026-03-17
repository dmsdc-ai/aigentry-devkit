# aigentry Orchestrator Routing Table

이 파일은 오케스트레이터 세션의 CLAUDE.md에 포함되어 멀티세션 라우팅을 자동화합니다.

## Session Registry

| Session ID Pattern | Project | Owner | Role |
|--------------------|---------|-------|------|
| `aigentry-orchestrator-*` | aigentry-orchestrator | orchestrator | 전체 조율, 의사결정 |
| `aigentry-devkit-*` | aigentry-devkit | devkit | 설치/배포/스킬/WTM |
| `aigentry-telepty-*` | aigentry-telepty | telepty | 세션 전송/데몬/라우팅 |
| `aigentry-deliberation-*` | aigentry-deliberation | deliberation | MCP 토론/합의/synthesis |
| `aigentry-brain-*` | aigentry-brain | brain | 프로필/메모리/MCP |
| `aigentry-dustcraw-*` | aigentry-dustcraw | dustcraw | 크롤러/시그널/전략 |
| `aigentry-registry-*` | aigentry-registry | registry | HTTP API/테넌트/키 |

## Routing Rules

### 메시지 라우팅

```
요청 유형              → 대상 세션                → transport
설치/배포 관련         → aigentry-devkit-*        → telepty inject
세션 전송/데몬 이슈    → aigentry-telepty-*       → telepty inject
토론/합의 요청         → aigentry-deliberation-*  → telepty inject
프로필/메모리 관련     → aigentry-brain-*         → telepty inject
크롤링/시그널 관련     → aigentry-dustcraw-*      → telepty inject
API/테넌트/키 관련     → aigentry-registry-*      → telepty inject
```

### 자동 라우팅 키워드

| 키워드 | 라우팅 대상 |
|--------|------------|
| install, setup, skill, hook, wtm, devkit, profile | aigentry-devkit |
| session, daemon, transport, multicast, inject | aigentry-telepty |
| deliberation, debate, synthesis, speaker, consensus | aigentry-deliberation |
| brain, memory, profile, bootstrap, sync | aigentry-brain |
| crawl, signal, strategy, preset, dustcraw | aigentry-dustcraw |
| registry, tenant, api-key, endpoint, health | aigentry-registry |

### 프로토콜

모든 세션 간 메시지에는 반드시 포함:
```
[from: <sender_session_id>] [reply-to: <reply_session_id>]
```

### Boundary Rules

1. 각 세션은 자기 프로젝트 영역의 코드만 수정
2. 다른 프로젝트 기능이 필요하면 해당 세션에 telepty inject
3. 자기 프로젝트에는 client adapter / thin wrapper만 허용
4. 다른 프로젝트 핵심 로직 복제/재구현 금지

## Module Health Check

오케스트레이터는 주기적으로 각 모듈의 상태를 확인합니다:

```bash
# devkit
npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit doctor

# telepty
telepty --version && curl -sf http://localhost:3848/api/meta

# deliberation
npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-doctor

# brain
aigentry-brain health

# dustcraw
dustcraw demo --non-interactive

# registry
curl -sf ${AIGENTRY_API_URL}/health
```

## Upsell Detection

오케스트레이터는 아래 패턴을 감지하면 현재 프로파일 상위 프로파일을 제안합니다:

| 현재 프로파일 | 감지 패턴 | 제안 |
|-------------|----------|------|
| core | `dustcraw`, `crawl`, `signal` 키워드 사용 | curator-public |
| core | `experiment`, `benchmark`, `evaluation` 키워드 사용 | autoresearch-public |
| core | `brain`, `memory`, `profile` 키워드 사용 | curator-public |
| autoresearch-public | `dustcraw`, `crawl` 키워드 사용 | ecosystem-full |
| curator-public | `experiment`, `benchmark` 키워드 사용 | ecosystem-full |

## Response Style

이 오케스트레이터는 `orchestrator-response-style` 스킬의 3원칙(비판적+건설적+객관적)을 모든 답변에 적용합니다.
