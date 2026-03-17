---
name: telepty-deliberate
description: |
  telepty 기반 멀티세션 토론을 자동 시작하고 운영하는 스킬.
  "모든 세션이랑 토론해", "멀티세션 토론", "session deliberation", "telepty deliberate",
  "세션들한테 물어봐", "전체 세션 의견 모아줘" 요청 시 사용합니다.
---

# Telepty Deliberate

telepty 활성 세션들을 상대로 쌍방향 멀티세션 토론을 시작할 때 사용하는 스킬입니다.
목표는 사용자가 긴 kickoff 프롬프트를 수동 작성하지 않게 하는 것입니다.

이 스킬이 주입하는 protocol template은 아래 7가지를 한 번에 포함합니다:

1. 쌍방향 통신 규칙 (`from` / `reply-to`)
2. 세션 디렉토리 / 프로젝트 매핑
3. sub-deliberation 허용
4. 토론 중 자동 skill matching guide
5. boundary enforcement
6. active reporting
7. 합의 후 즉시 실행 전환 규칙

## 이 스킬이 담당하는 것

- 현재 세션 ID 자동 감지: `echo $TELEPTY_SESSION_ID`
- 활성 세션 목록 수집 + 프로젝트 매핑 자동 생성
- `telepty deliberate` 지원 여부 감지
- 지원 시: `telepty deliberate`를 우선 사용
- 미지원 시: `telepty multicast`/`telepty inject` fallback으로 동일 프로토콜 주입
- `from` / `reply-to` 규칙, sub-deliberation 허용, 세션 디렉토리 매핑 자동 포함
- 토론 중 어떤 skill/tool을 먼저 써야 하는지에 대한 routing guide 포함
- 태스크 완료/블로커/장기 대기 상태에 대한 active reporting 규칙 포함
- 자기 영역 밖 핵심 로직 구현 금지 규칙 포함

## 빠른 워크플로우

### 1. 현재 세션과 telepty 기능 감지

먼저 helper script로 상태를 확인합니다:

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py features
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py discover
```

필수 확인:
- `current_session_id`가 비어 있지 않은지
- `telepty` 명령이 있는지
- `telepty deliberate`가 있는지
- 없으면 `telepty multicast` fallback 가능 여부

`TELEPTY_SESSION_ID`가 없으면:
- 현재 CLI가 telepty 관리 세션이 아닌지 확인
- 필요 시 사용자에게 kickoff를 어느 세션 기준으로 할지 짧게 확인

### 2. 토론 입력 정리

사용자에게서 아래만 확보하면 충분합니다:
- `topic` 또는 `objective`
- 필요한 배경 `context`
- 대상 세션 범위: 기본은 현재 세션을 제외한 모든 활성 세션

추가로 있으면 좋음:
- `thread_id`
- 특정 participant 제한
- 명시적 `reply_to` 세션

### 3. 기본 경로: `kickoff`

helper script는 `kickoff` 명령으로 transport를 자동 선택합니다:

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py kickoff \
  --topic "..." \
  --context "..." \
  --dry-run
```

실제 전송:

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py kickoff \
  --topic "..." \
  --context "..."
```

동작 방식:
- `telepty deliberate`가 있으면 그것을 사용
- 없으면 `telepty multicast` fallback 사용
- 현재 telepty가 `--from` / `--reply-to`를 지원하면 point-to-point 질의에는 그것을 우선 사용
- `multicast`는 여전히 본문 prefix 프로토콜을 포함

### 4. 우선 경로: `telepty deliberate`

`features` 결과에서 `has_deliberate=true`면 `kickoff`는 아래 흐름을 사용합니다:

1. `telepty deliberate --help`를 먼저 읽고 실제 인터페이스를 확인
2. helper script가 만든 protocol blob을 임시 context 파일로 저장
3. 가능하면 아래 필드를 넘깁니다:
   - `thread_id`
   - `participants`
   - `objective`
   - `context` file

현재 확인된 telepty 0.1.20 usage는 아래입니다:

```bash
telepty deliberate --topic "..." --sessions s1,s2 --context /tmp/context.txt
```

`telepty deliberate` 인터페이스가 아직 불안정하면 억지로 추측하지 말고 즉시 fallback으로 전환합니다.

### 5. fallback 경로: `telepty multicast`

`telepty deliberate`가 없거나 usage가 확정되지 않았으면 helper script가 만드는 kickoff prompt를 그대로 사용합니다:

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py kickoff-fallback \
  --topic "..." \
  --context "..." \
  --dry-run
```

`--dry-run` 출력이 맞으면 실제 전송:

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py kickoff-fallback \
  --topic "..." \
  --context "..."
```

이 fallback은 현재 telepty CLI가 `--from` / `--reply-to` 플래그를 지원하지 않아도 동작하도록,
메시지 본문 앞에 아래 텍스트 프로토콜을 붙입니다:

```text
[from: <current_session_id>] [reply-to: <reply_to_session_id>]
```

## 토론 프로토콜 규칙

kickoff prompt에는 반드시 아래 규칙을 포함합니다:

1. 다른 프로젝트/세션의 사실은 추측하지 말고 직접 해당 세션에 질문
2. 다른 세션에 보내는 모든 메시지에는 `from` / `reply-to`를 포함
3. sub-deliberation 허용
4. 각 세션은 자기 프로젝트 기준으로 아래 3가지를 먼저 답변
   - 제공 가능한 인터페이스
   - 필요한 인터페이스
   - 아직 모르는 점 / 누구에게 물어볼지
5. 답변은 가능하면 `reply-to` 세션으로 회신
6. 합의가 구현으로 이어질 수 있으면 토론만 하고 멈추지 말고 즉시 owner 세션이 실행으로 전환

## 자동 Skill Matching Guide

kickoff prompt에는 아래 매핑도 같이 넣습니다.
실제 skill 이름은 세션마다 다를 수 있으므로, **동일 의미의 로컬 skill/tool이 있으면 그것을 우선 사용**합니다.

- 코드 분석/구현 요청: `explore -> executor` 또는 동등한 분석/실행 skill
- 아키텍처 결정 필요: `architect` / `plan`
- 버그 발견: `analyze -> build-fix` 또는 동등한 디버그/수정 skill
- 보안 관련 논의: `security-review`
- API 스펙 / 공식 문서 논의: `researcher` 또는 공식 문서 조회 도구
- 테스트 필요: `tdd` / `ultraqa`
- 인터페이스 합의 완료 후 구현 전환: `deliberation-executor`
- 설계 교착 / 이견 지속: `deliberation-gate` 또는 멀티AI 검증 경로

이 매핑은 어디까지나 `routing_hints`입니다.
최종 합의, verdict, synthesis 판단은 owning system이 담당해야 합니다.

## Boundary Enforcement

kickoff prompt에는 아래 규칙도 반드시 포함합니다:

1. 자기 영역이 아닌 기능을 본인 프로젝트에 구현하지 않음
2. 다른 프로젝트 영역의 기능이 필요하면 해당 세션에 직접 `telepty inject`
3. 자기 프로젝트에는 client adapter / thin wrapper만 허용
4. 다른 프로젝트 핵심 로직 복제/재구현 금지

이 스킬은 `routing_hints`, `suggested_skills`, `protocol_template`, `constraints`, `artifact_refs`만 주입합니다.
`final_summary`, `decisions`, `consensus_state`, `verdict` 같은 판단 필드는 만들지 않습니다.

## Active Reporting

kickoff prompt에는 아래 능동 보고 규칙도 반드시 포함합니다:

1. 태스크 완료 시: 결과를 요약해서 오케스트레이터에 보고하고 다음 지시를 요청
2. 블로커 발생 시: 문제를 설명하고 오케스트레이터 또는 관련 세션에 즉시 도움 요청
3. 다른 세션 응답이 필요할 때: 기다리기 전에 해당 세션에 직접 질문
4. 30초 이상 대기 상태가 되면: 현재 상태, 대기 이유, 다음 예상 액션을 오케스트레이터에 보고

이 규칙의 목적은 세션이 무기한 대기 상태로 멈추지 않게 하는 것입니다.

## 권장 산출물

멀티세션 토론을 시작하거나 정리할 때 최소한 아래를 남깁니다:

- `thread_id`
- 참여 세션 목록
- 세션별 프로젝트 매핑
- 핵심 결정사항
- open questions
- follow-up이 필요한 직접 질문 목록

## helper script 사용법

### 세션 맵 확인

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py discover
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py discover --json
```

### 기능 감지

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py features
```

### kickoff prompt만 생성

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py prompt \
  --topic "autoresearch implementation interface alignment" \
  --context "devkit, telepty, registry, brain, dustcraw alignment"
```

### 자동 transport 선택 전송

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py kickoff \
  --topic "..." \
  --context "..."
```

### fallback 강제 전송

```bash
python3 skills/telepty-deliberate/scripts/telepty_deliberation_helper.py kickoff-fallback \
  --topic "..." \
  --context "..."
```

## 주의사항

- `telepty deliberate` 인터페이스는 아직 변할 수 있으므로, helper가 감지해도 usage를 다시 확인하고 사용합니다.
- telepty 0.1.20 이상이면 `telepty deliberate`, `telepty reply`, `--from` / `--reply-to`를 사용할 수 있습니다.
- 하위 버전 호환을 위해 fallback은 계속 본문 prefix 프로토콜을 유지합니다.
- `telepty multicast`는 한 번에 여러 세션에 같은 kickoff를 뿌릴 때만 쓰고,
  이후 세부 질의는 `telepty inject`로 특정 세션에 직접 보내는 편이 안전합니다.
- `reply-to`가 명확하지 않으면 토론이 끊기므로, kickoff 시 기본값을 현재 세션 ID로 고정합니다.
- deliberation / synthesis / consensus의 핵심 판단 로직은 해당 owning project에 맡기고, devkit에는 thin wrapper만 둡니다.
