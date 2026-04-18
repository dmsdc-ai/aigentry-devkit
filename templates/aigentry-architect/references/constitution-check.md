# Constitution Check

aigentry 헌법 위헌 심사 프로토콜. 모든 ADR 필수 (§5.5 INVARIANT). scope=constitutional 시 18조 전수 검증.

헌법 원문: `~/projects/aigentry/docs/CONSTITUTION.md` (전문 + 18조 + 최종조)

## §1 5개 필수 질문 (모든 ADR)

각 질문에 다음 중 하나:
- **PASS** + 1문장 근거
- **FAIL** + 수정 계획
- **N/A** + 적용 불가 이유

### Q1: AI 기술 격차 해소에 복무하는가?

- **체크 포인트**: 이 결정이 비개발자/초심자에게도 가치를 주는가?
- **PASS 예**: "퍼블릭 사용자가 원클릭으로 포그라운드 세션을 동적 열고 닫을 수 있어, 오케스트레이션 진입장벽 낮춤"
- **FAIL 예**: "파워유저만 사용할 수 있는 기능 추가" → Rule 14 (범용/멀티크로스) 위반
- **원문 ref**: Preamble, 제14조 범용/멀티크로스

### Q2: 이 기능은 어느 컴포넌트의 역할인가?

- **체크 포인트**: 제안 기능이 타 컴포넌트의 역할 침범 없는가?
- **PASS 예**: "cmux 제어는 cmux CLI 책임, aigentry는 wrapper 제공만 (역할 분리)"
- **FAIL 예**: "orchestrator에 크래시 복구 책임 추가" → 별도 supervisor 컴포넌트 필요
- **원문 ref**: 제3조 컴포넌트 역할

### Q3: 이 프레임워크/라이브러리가 정말 필요한가?

- **체크 포인트**: 새 dependency 도입 없이 직접 구현 가능한가?
- **PASS 예**: "jq + bash만 사용, 외부 라이브러리 0"
- **FAIL 예**: "yargs 라이브러리 도입해서 CLI 파싱" → `while case` 기본 쉘로 충분
- **원문 ref**: 제1조 경량, 제17조 무의존

### Q4: 모든 크로스 환경에서 동작하는가?

- **체크 포인트**: macOS/Linux/Windows, 다양한 CLI(claude/codex/gemini), 크로스 머신 대응?
- **PASS 예**: "POSIX shell + jq 만 사용, 모든 Unix 계열 동일 동작"
- **FAIL 예**: "macOS 전용 API 의존" → Linux fallback 없음
- **원문 ref**: 제2조 크로스, 제14조 범용/멀티크로스

### Q5: 사용자에게 "어떻게"를 강요하지 않는가?

- **체크 포인트**: 내부 구현 복잡도를 사용자에게 노출하는가?
- **PASS 예**: "`open-session.sh --role X` 한 명령, 내부 CWD 매핑/trust 체크/CLI 부트 전부 숨김"
- **FAIL 예**: "사용자가 매번 3단계 수동 명령 실행" → abstraction 부족
- **원문 ref**: Preamble 사용자 경험 원칙

## §2 18조 전수 검증 (scope=constitutional 시)

scope가 `constitutional`로 설정된 ADR은 아래 18조 전체 대조 필수.

```
제1조 경량         — 오버엔지니어링 금지. "없이 구현 가능한가" 질문
제2조 크로스        — 모든 멀티크로스 환경 동일 UX
제3조 컴포넌트 역할  — 침범 금지
제4조 영역 경계     — 구현/분석/리서치 역할 분리
제5조 최선         — 차선책 금지, 3회 실패 시 다른 LLM
제6조 inject 전 확인
제7조 완료 보고 강제
제8조 미응답 자동 재요청
제9조 독립         — 각 컴포넌트 단독 동작 가능
제10조 동일 파일 동시 수정 금지
제10-1조 증거 기반 버그 fix
제11조 inject는 영어로
제12조 모든 구현 위임 시 컨텍스트 클리어
제13조 비판적+건설적+객관적
제14조 범용/멀티크로스 블로킹 금지
제15조 보고 vs 자유 토론 구분
제16조 범용 사용자 환경 동적 적용
제17조 무의존       — 외부 플러그인/라이브러리 의존 금지
제18조 벤치마크 우선 디버깅
최종조 헌법 수정 권한 (오케스트레이터만)
```

### 18조 검증 테이블 (scope=constitutional ADR 필수)

| 조항 | PASS/FAIL/N/A | 근거 |
|------|:-:|------|
| 제1조 경량 | | |
| 제2조 크로스 | | |
| 제3조 컴포넌트 역할 | | |
| 제4조 영역 경계 | | |
| 제5조 최선 | | |
| 제6조 inject 전 확인 | | |
| 제7조 완료 보고 | | |
| 제8조 미응답 재요청 | | |
| 제9조 독립 | | |
| 제10조 동일 파일 동시 수정 | | |
| 제10-1조 증거 기반 | | |
| 제11조 영어 inject | | |
| 제12조 컨텍스트 클리어 | | |
| 제13조 비판적+건설적+객관적 | | |
| 제14조 범용/멀티크로스 | | |
| 제15조 보고 vs 자유토론 | | |
| 제16조 범용 사용자 환경 | | |
| 제17조 무의존 | | |
| 제18조 벤치마크 우선 | | |

FAIL 1개라도 있으면 ADR 자동 REQUEST-REVISION (해당 조항 위반 해결 필수).

## §3 헌법 수정이 필요한 경우 (매우 드뭄)

ADR이 헌법 자체 수정을 제안하는 경우:

1. **최종조 참조**: 헌법 수정 권한은 오케스트레이터만 — 즉 orchestrator 세션의 사용자 인터페이스를 통해서만
2. **ADR scope**: `constitutional`, decision_type: `one-way`, Tier T3
3. **리뷰어**: claude + codex + gemini 3명 모두 필수 + 사용자 명시 승인
4. **Supersedes 체인**: 기존 헌법 버전 명시 + 변경 조항 diff 포함

## §4 Constitution Check 없는 경우 자동 처리

- CLAUDE.md §6 Pre-submit Self-Check 중 Q6 "Constitution Check 완료?" 실패
- 리뷰어 7-item checklist 중 #6 (Constitution Check) FAIL
- 2개 이상 FAIL 발생 시 자동 REQUEST-REVISION (architect가 수정 후 재제출)

**생략은 절대 허용 안 됨** (§5.5 INVARIANT).

## §5 Worked Example (ADR-76 §4)

spec-adr-76.md의 Constitution Check 섹션 참조:

> §4 Constitution Check (T2 answers for role independence, safety, SSOT registration)
> - Q5: Role independence — PASS, telepty optional via TeleptyBridge::try_connect() → Option<Self>
> - Q6: Safety — PASS, sandbox execution mandatory per Rule 20
> - Q6: SSOT registration — PASS after file-ownership.json schema update

이 방식으로 각 질문에 구체적 근거 (file:line, 조항 ref) 포함이 모범.
