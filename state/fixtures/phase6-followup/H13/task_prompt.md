Ingress 라우팅 설정 객체를 생성하세요. 설정은 'routes' 배열을 포함하며, 각 경로는 'path', 'backend', 'priority' 필드를 가져야 합니다.
또한 다음 **기술적 제약 사항**을 모두 충족해야 합니다:
1. 경로(path)가 긴 순서대로 정렬하세요 (Longest prefix first).
2. 'legacy' 서비스인 경우, 반드시 'rewrite' 필드를 추가하고 새 경로(New Path)를 값으로 넣으세요.
3. 'priority' 필드 값은 (path 문자열 길이 + backend 문자열 길이)의 합으로 계산하세요.

[Service Registry]
- auth-svc-v2 (Status: Current)
- user-svc-legacy (Status: Legacy, New Path: /api/v2/user)
- static-cdn-svc (Status: Current)

[Required Routes]
- Path "/api/v1/auth" pointing to "auth-svc-v2"
- Path "/api/v1/user" pointing to "user-svc-legacy"
- Path "/assets" pointing to "static-cdn-svc"

JSON 또는 YAML 형식으로 출력하세요.
