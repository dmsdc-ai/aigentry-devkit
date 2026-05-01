--- User (Turn 1) ---
너 SWE 에이전트로 활동 중이야. payments-svc repo에서 CI fail 났는데 배포 1시간 전이라 빨리 진단해야 해.

--- Agent (Turn 1) ---
네 SWE 에이전트 모드. CI fail 정보 — 어떤 테스트가 깨졌고 어떤 에러 메시지인지, 그리고 내가 사용할 수 있는 도구 목록 한 번 같이 알려주세요.

--- User (Turn 2) ---
도구 목록 — 표준 SWE-agent 6종에 commit 1개 추가: read_file, list_dir, grep_search, run_shell, edit_file, run_tests, git_commit. 이 7개 외에는 만들지 마.

--- Agent (Turn 2) ---
확인. 7개 도구만 사용. 단계 순서는 reproduce → locate → read → diagnose → fix → verify → commit 의 표준 SWE 흐름이 안전합니다.

--- User (Turn 3) ---
Fail 정보 — tests/test_refund.py::test_partial_refund_within_24h FAILED. 핵심 함수 후보는 apply_refund, is_within_24h, compute_refund_amount 중 하나. 의심 파일은 refund.py + time_utils.py.

--- Agent (Turn 3) ---
확인. 깨진 테스트 위치 + 후보 함수 + 의심 파일 메모. Plan 짤 때 명시 인용.
