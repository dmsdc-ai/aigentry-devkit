<!-- aterm:initial — This is an auto-generated template. Customize for your project or run /init to auto-analyze. -->

@AGENTS.md

# Gemini CLI Settings / Gemini CLI 설정

- Session ID / 세션 ID: {{WORKSPACE_NAME}}-gemini

## Reporting Rule / 보고 규칙

- Orchestrator-delegated task → report to orchestrator: `aterm inject "$ATERM_ORCHESTRATOR_SESSION" 'REPORT: summary'`. / 오케스트레이터가 위임한 태스크 → 오케스트레이터에 보고.
- Free discussion / messaging / ACK between sessions → no mandatory reporting. / 세션 간 자유 토론/메시징/ACK → 보고 의무 없음.
- Mandatory reporting applies ONLY to orchestrator-delegated tasks. / mandatory reporting은 오케스트레이터 위임 시에만 적용.
- If sender is specified, ACK goes to that sender, not orchestrator. / 사용자가 sender를 지정한 경우 ACK는 해당 sender에게.
