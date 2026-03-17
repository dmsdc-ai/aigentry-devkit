---
name: upsell-trigger
description: |
  현재 설치 프로파일보다 상위 프로파일이 필요한 패턴을 감지하여 업그레이드를 제안하는 스킬.
  오케스트레이터가 자율적으로 트리거합니다. 사용자 요청 없이 자동 감지.
---

# Upsell Trigger

현재 설치된 aigentry 프로파일에서 사용할 수 없는 기능을 사용자가 요청하거나 언급할 때, 상위 프로파일로의 업그레이드를 자연스럽게 제안하는 스킬입니다.

## 트리거 조건

오케스트레이터는 사용자 메시지에서 아래 패턴을 감지하면 이 스킬을 자동 호출합니다.

### core → autoresearch-public

| 감지 키워드 | 의미 |
|------------|------|
| `experiment`, `실험` | WTM experiment runner 필요 |
| `benchmark`, `벤치마크` | experiment + registry 필요 |
| `evaluation`, `평가` | experiment 프로그램 필요 |
| `leaderboard`, `리더보드` | registry wiring 필요 |
| `program.md`, `experiment-program` | experiment template 필요 |

### core → curator-public

| 감지 키워드 | 의미 |
|------------|------|
| `dustcraw`, `crawl`, `크롤링` | dustcraw 모듈 필요 |
| `signal`, `시그널`, `큐레이션` | dustcraw signal pipeline 필요 |
| `brain`, `메모리`, `프로필` | brain 모듈 필요 |
| `strategy.md`, `전략 프리셋` | dustcraw preset 필요 |

### autoresearch-public → ecosystem-full

| 감지 키워드 | 의미 |
|------------|------|
| `dustcraw`, `crawl` 키워드 사용 | dustcraw 미포함 |
| `signal pipeline` | dustcraw 필요 |

### curator-public → ecosystem-full

| 감지 키워드 | 의미 |
|------------|------|
| `experiment`, `benchmark` | experiment runner 미포함 |
| `wtm-experiment` | experiment template 필요 |

## 동작 방식

### 1. 현재 프로파일 확인

```bash
# install-state.json에서 현재 프로파일 읽기
cat ~/.config/aigentry-devkit/install-state.json | jq -r '.profile'
```

install-state.json이 없으면 `core`로 가정합니다.

### 2. 패턴 감지

사용자 메시지에서 위 키워드 테이블을 매칭합니다. 매칭된 키워드가 현재 프로파일에 포함되지 않은 모듈을 필요로 하면 트리거합니다.

### 3. 제안 메시지 (1회만)

동일 세션에서 같은 업그레이드를 2번 이상 제안하지 않습니다.

제안 형식:
```
> 참고: `{keyword}` 기능은 `{target_profile}` 프로파일에 포함되어 있습니다.
> 업그레이드: `npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install --profile {target_profile}`
```

### 4. 사용자 반응 존중

- 사용자가 무시하면 추가 제안하지 않음
- 사용자가 "나중에", "skip" 등으로 응답하면 해당 세션에서 더 이상 제안하지 않음
- 사용자가 관심을 보이면 업그레이드 명령 + 추가될 기능 목록 제공

## 제안하지 않는 경우

- 이미 `ecosystem-full` 프로파일인 경우
- install-state.json이 없고 사용자가 프로파일을 명시적으로 언급하지 않은 경우
- 사용자가 이미 해당 모듈을 수동으로 설치한 경우 (healthcheck로 확인)

## 주의사항

1. **비침습적**: 작업 흐름을 중단하지 않습니다. 참고 메시지만 표시합니다.
2. **1회 제안**: 동일 업그레이드 제안은 세션당 1회로 제한합니다.
3. **정확한 매칭**: 키워드가 코드 내 문자열이 아닌 사용자 의도에서 감지될 때만 트리거합니다.
4. **압박 금지**: "반드시 업그레이드해야 합니다" 같은 압박성 문구 사용 금지.
