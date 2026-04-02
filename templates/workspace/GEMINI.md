<!-- aterm:initial — This is an auto-generated template. Customize for your project or run /init to auto-analyze. -->

@AGENTS.md

# Gemini CLI Settings / Gemini CLI 설정

- Session ID / 세션 ID: {{WORKSPACE_NAME}}-gemini

## Session Communication Rules / 세션 통신 규칙

- **respond/reply** = answer in current conversation. Default action. / 현재 대화에서 응답. 기본 동작.
- **inject** = send text to ANOTHER session. Only when explicitly requested. / 다른 세션에 텍스트 전송. 명시적 요청 시에만.
- **broadcast** = send to ALL sessions. Only when explicitly requested. / 모든 세션에 전송. 명시적 요청 시에만.

| User says / 사용자 요청 | Action / 동작 |
|--------------------------|---------------|
| "respond", "reply", "answer", "ACK" (no target) | Reply in current session / 현재 세션에서 응답 |
| "inject <target>", "send to <target>" | `aterm inject` / `telepty inject` |
| "broadcast" | `aterm broadcast` / `telepty broadcast` |
| Ambiguous / 모호한 경우 | Ask for clarification. Do NOT assume inject. / 확인 요청. inject 추정 금지. |

- NEVER inject unless cross-session intent is explicit. / 크로스 세션 의도가 명시적이지 않으면 절대 inject 금지.
- NEVER inject into your own session. / 자기 세션에 inject 금지.
- If `$ATERM_IPC_SOCKET` set: use `aterm inject` for internal, `telepty inject` for external. / 내부는 aterm, 외부는 telepty.
- If `$ATERM_IPC_SOCKET` unset: use `telepty inject`. / aterm 없으면 telepty 사용.

## Reporting Rule / 보고 규칙

- Orchestrator-delegated task → report to orchestrator: `aterm inject "$ATERM_ORCHESTRATOR_SESSION" 'REPORT: summary'`. / 오케스트레이터가 위임한 태스크 → 오케스트레이터에 보고.
- Free discussion / messaging / ACK between sessions → no mandatory reporting. / 세션 간 자유 토론/메시징/ACK → 보고 의무 없음.
- Mandatory reporting applies ONLY to orchestrator-delegated tasks. / mandatory reporting은 오케스트레이터 위임 시에만 적용.
- If sender is specified, ACK goes to that sender, not orchestrator. / 사용자가 sender를 지정한 경우 ACK는 해당 sender에게.
