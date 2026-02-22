---
name: youtube-analyzer
description: |
  YouTube 영상의 메타데이터와 자막을 추출하여 내용을 분석합니다.
  yt-dlp를 사용하여 영상을 다운로드하지 않고 자막과 정보만 추출합니다.
  "유튜브 분석", "영상 분석", "youtube 분석", "이 영상 봐줘" 요청 시 사용합니다.
---

# YouTube 영상 분석 스킬

YouTube URL을 입력받아 메타데이터와 자막/스크립트를 추출하고 내용을 분석합니다.

## 필수 요구사항

### 시스템 의존성
- Python 3.8+
- yt-dlp (`pip install yt-dlp`)

### 설치 확인
```bash
python3 -c "import yt_dlp; print('OK')"
```

## 워크플로우

### 1단계: 영상 정보 추출
```bash
python3 ~/.claude/skills/youtube-analyzer/scripts/analyze_youtube.py --url "YOUTUBE_URL"
```
- 메타데이터 추출 (제목, 채널, 조회수, 설명 등)
- 자막/스크립트 다운로드 (한국어 우선, 영어 폴백)
- 마크다운 형식으로 출력

### 2단계: 내용 분석
추출된 텍스트를 기반으로:
- 영상 요약
- 핵심 포인트 정리
- 사용자 질문에 맞춰 분석

## 사용 예시

```
"이 유튜브 영상 분석해줘: https://youtube.com/watch?v=xxx"
"이 영상에서 핵심 내용 뽑아줘: https://youtu.be/xxx"
"유튜브 영상 요약: https://youtube.com/shorts/xxx"
```

## 지원 URL 형식
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`

## 주의사항
1. 비공개/삭제된 영상은 분석 불가
2. 자막이 없는 영상은 메타데이터+설명만 분석
3. 영상 자체는 다운로드하지 않음 (자막+메타데이터만)
