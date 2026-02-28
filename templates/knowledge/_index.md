# Knowledge Base

이 프로젝트의 지식 베이스입니다.
단계적 탐색 기법(Hierarchical Navigation Pattern)을 따릅니다.

## 규칙

1. **한 번에 1개 파일만** 읽어 Context window 효율화
2. **100줄 이하** 모든 파일은 atomic size 유지
3. **Next References** 각 파일 하단의 링크로 탐색

## 카테고리

| 카테고리 | 설명 | 경로 |
|---------|------|------|
| agents | 에이전트 사용법 | [agents/_index.md](agents/_index.md) |
| errors | 에러 해결 패턴 | [errors/_index.md](errors/_index.md) |
| costs | 비용 정보 | [costs/_index.md](costs/_index.md) |
| tools | 도구 선택 규칙 | [tools/_index.md](tools/_index.md) |
| prompts | 프롬프트 템플릿 | [prompts/_index.md](prompts/_index.md) |

## 자동 캡처

개발 중 발생하는 이벤트는 자동으로 캡처됩니다:
- **에러** → `errors/` (에이전트 실행 시)
- **비용** → `costs/daily/` (API 호출 시)
- **프롬프트** → `prompts/` (콘텐츠 생성 시)

---

## Next References

- [에이전트 목록](agents/_index.md)
- [에러 카테고리](errors/_index.md)
- [도구 선택 규칙](tools/_index.md)
