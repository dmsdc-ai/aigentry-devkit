# API Errors

API 관련 에러 패턴입니다.

## 공통 에러

| 에러 | 원인 | 해결 |
|-----|------|------|
| 401 Unauthorized | API 키 오류 | 키 확인 및 갱신 |
| 429 Rate Limit | 요청 한도 초과 | 재시도 로직 또는 대기 |
| 500 Server Error | 서버 문제 | 재시도 또는 대체 서비스 |

## 서비스별 에러

(프로젝트에서 사용하는 API 에러 추가)

---

Parent: [_index.md](../_index.md)
