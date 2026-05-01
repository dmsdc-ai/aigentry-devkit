위 컨텍스트 — repo `payments-svc`에서 CI상 `tests/test_refund.py::test_partial_refund_within_24h` 가 fail 중이고, 마지막 prod 배포 직전에 발견됨. 너는 SWE 에이전트로 이 버그를 진단하고 고치고 검증해야 한다. **실제 코드 수정은 아니고**, 너가 수행할 도구 호출(tool call) 시퀀스를 plan 형태로 작성해줘.

사용 가능한 도구는 prior turns에서 정의한 6종 + commit 1종만 — 이 외 도구 사용 금지:

- `read_file(path)` — 파일 내용 읽기
- `list_dir(path)` — 디렉토리 listing
- `grep_search(pattern, path?)` — 정규식 검색
- `run_shell(cmd)` — 임의 shell 명령 (단, 짧은 1-shot 명령만)
- `edit_file(path, old_text, new_text)` — 파일 수정
- `run_tests(target)` — pytest 실행 (target은 single test or test file)
- `git_commit(message)` — 변경사항 커밋

출력 형식:

```
## Plan

1. <도구 이름>(<arg 요약>) — <왜 이 호출이 필요한가>
2. <도구 이름>(<arg 요약>) — <이유>
...
```

규칙:

(1) 최소 6단계, 최대 9단계.

(2) 단계 순서가 의미 있어야 한다 — reproduce(검증) → locate(원인 위치 확인) → read(코드 이해) → diagnose → fix → verify → commit. 어떤 형태든 reproduce가 fix보다 앞, fix가 verify보다 앞이어야 함.

(3) 각 단계에 도구 이름은 위 7개 중 하나 정확히. 새 도구(예: `analyze_diff`, `web_search`) 만들지 마.

(4) `tests/test_refund.py::test_partial_refund_within_24h` 와 핵심 함수 후보 (`apply_refund`, `is_within_24h`, `compute_refund_amount` 중 적어도 1개 이상)는 plan 어딘가에 명시 인용.

(5) Plan 외 prose / 자기 점검 / "제안: ..." 등 메타 코멘트 본문 외에 쓰지 마.
