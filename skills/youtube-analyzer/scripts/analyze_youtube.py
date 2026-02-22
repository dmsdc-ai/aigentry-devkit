#!/usr/bin/env python3
"""
YouTube 영상 메타데이터 및 자막 추출 스크립트.
yt-dlp Python API를 사용하여 영상 정보와 자막을 추출합니다.
"""

import argparse
import os
import re
import sys
import tempfile
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(
        description="YouTube 영상 메타데이터 및 자막 추출"
    )
    parser.add_argument("--url", required=True, help="YouTube 영상 URL")
    return parser.parse_args()


def format_duration(seconds):
    if seconds is None:
        return "알 수 없음"
    seconds = int(seconds)
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def format_number(n):
    if n is None:
        return "알 수 없음"
    return f"{n:,}"


def format_date(date_str):
    if not date_str:
        return "알 수 없음"
    # yt-dlp returns YYYYMMDD
    if len(date_str) == 8:
        return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    return date_str


def extract_metadata(url):
    """영상 메타데이터만 추출 (다운로드 없음)."""
    try:
        import yt_dlp
    except ImportError:
        print("오류: yt-dlp가 설치되어 있지 않습니다. pip install yt-dlp 로 설치하세요.", file=sys.stderr)
        sys.exit(1)

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignoreerrors": False,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    return info


def extract_subtitles(url, tmpdir):
    """자막을 추출합니다. 한국어 우선, 없으면 영어 폴백."""
    try:
        import yt_dlp
    except ImportError:
        return None, None

    # 사용 가능한 자막 언어 확인
    check_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "ignoreerrors": False,
    }

    with yt_dlp.YoutubeDL(check_opts) as ydl:
        info = ydl.extract_info(url, download=False)

    available_subs = info.get("subtitles", {})
    available_auto = info.get("automatic_captions", {})

    # 언어 우선순위: ko, ko-KR, en, en-US
    preferred_langs = ["ko", "ko-KR", "en", "en-US", "en-orig"]

    chosen_lang = None
    is_auto = False

    for lang in preferred_langs:
        if lang in available_subs:
            chosen_lang = lang
            is_auto = False
            break

    if chosen_lang is None:
        for lang in preferred_langs:
            if lang in available_auto:
                chosen_lang = lang
                is_auto = True
                break

    if chosen_lang is None:
        # 아무 자막도 없으면 None 반환
        return None, None

    # 선택된 언어의 자막 다운로드
    sub_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "writesubtitles": not is_auto,
        "writeautomaticsub": is_auto,
        "subtitleslangs": [chosen_lang],
        "subtitlesformat": "vtt/srt/best",
        "outtmpl": os.path.join(tmpdir, "subtitle"),
        "ignoreerrors": False,
    }

    with yt_dlp.YoutubeDL(sub_opts) as ydl:
        ydl.download([url])

    # 다운로드된 자막 파일 찾기
    subtitle_file = None
    for ext in ["vtt", "srt", "srv3", "ttml"]:
        candidates = list(Path(tmpdir).glob(f"*.{ext}"))
        if candidates:
            subtitle_file = str(candidates[0])
            break

    if subtitle_file is None:
        return None, chosen_lang

    return subtitle_file, chosen_lang


def parse_vtt(content):
    """WebVTT 자막 파싱하여 (timestamp, text) 목록 반환."""
    lines = content.splitlines()
    entries = []
    i = 0

    # WEBVTT 헤더 건너뛰기
    while i < len(lines) and not lines[i].strip().startswith("00:") and "-->" not in lines[i]:
        i += 1

    while i < len(lines):
        line = lines[i].strip()

        # 타임스탬프 라인 감지
        if "-->" in line:
            timestamp_match = re.match(r"(\d{1,2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})", line)
            if timestamp_match:
                timestamp = timestamp_match.group(1)
                # HH:MM:SS.mmm 형식으로 정규화
                if timestamp.count(":") == 1:
                    timestamp = "00:" + timestamp
                # 밀리초 제거하여 간결하게
                timestamp = timestamp[:8]

                # 텍스트 수집
                i += 1
                text_lines = []
                while i < len(lines) and lines[i].strip():
                    text_line = lines[i].strip()
                    # VTT 태그 제거 (<c>, </c>, <00:00:00.000> 등)
                    text_line = re.sub(r"<[^>]+>", "", text_line)
                    text_line = re.sub(r"&amp;", "&", text_line)
                    text_line = re.sub(r"&lt;", "<", text_line)
                    text_line = re.sub(r"&gt;", ">", text_line)
                    text_line = re.sub(r"&nbsp;", " ", text_line)
                    if text_line:
                        text_lines.append(text_line)
                    i += 1

                if text_lines:
                    text = " ".join(text_lines)
                    entries.append((timestamp, text))
                continue

        i += 1

    return entries


def parse_srt(content):
    """SRT 자막 파싱하여 (timestamp, text) 목록 반환."""
    entries = []
    blocks = re.split(r"\n\n+", content.strip())

    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 3:
            continue

        # 첫 줄: 번호 (건너뜀)
        # 둘째 줄: 타임스탬프
        timestamp_line = lines[1] if len(lines) > 1 else ""
        ts_match = re.match(r"(\d{2}:\d{2}:\d{2})", timestamp_line)
        if not ts_match:
            continue

        timestamp = ts_match.group(1)
        text_lines = lines[2:]
        text = " ".join(t.strip() for t in text_lines if t.strip())
        # HTML 태그 제거
        text = re.sub(r"<[^>]+>", "", text)

        if text:
            entries.append((timestamp, text))

    return entries


def parse_subtitle_file(filepath):
    """자막 파일을 파싱하여 (timestamp, text) 목록 반환."""
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    ext = Path(filepath).suffix.lower()

    if ext == ".vtt":
        entries = parse_vtt(content)
    elif ext == ".srt":
        entries = parse_srt(content)
    else:
        # 알 수 없는 형식은 VTT로 시도 후 SRT 시도
        entries = parse_vtt(content)
        if not entries:
            entries = parse_srt(content)

    return entries


def find_overlap(prev, curr):
    """이전 텍스트의 끝부분과 현재 텍스트의 시작부분이 겹치는 길이를 반환."""
    max_overlap = min(len(prev), len(curr))
    for i in range(max_overlap, 0, -1):
        if prev.endswith(curr[:i]):
            return i
    return 0


def deduplicate_entries(entries):
    """자동자막의 스크롤링 중복을 제거하고 깨끗한 텍스트로 병합."""
    if not entries:
        return entries

    # 1단계: 겹침을 제거하며 전체 텍스트를 병합
    merged_parts = [entries[0][1]]
    timestamps = [entries[0][0]]

    for ts, text in entries[1:]:
        prev_text = merged_parts[-1]
        # 완전 동일 → 무시
        if text == prev_text:
            continue
        # 이전이 현재에 완전 포함 → 교체
        if prev_text in text:
            merged_parts[-1] = text
            continue
        # 현재가 이전에 완전 포함 → 무시
        if text in prev_text:
            continue
        # 접미/접두 겹침 감지
        overlap = find_overlap(prev_text, text)
        if overlap > 5:
            # 겹침 부분을 제거하고 새 부분만 추가
            new_part = text[overlap:].strip()
            if new_part:
                merged_parts[-1] = prev_text + " " + new_part
            continue
        # 겹침 없음 → 새 항목
        merged_parts.append(text)
        timestamps.append(ts)

    # 2단계: 적절한 길이로 분할하여 타임스탬프와 매핑
    result = list(zip(timestamps, merged_parts))
    return result


def format_subtitle_output(entries, lang):
    """자막 엔트리를 읽기 쉬운 텍스트로 포맷."""
    if not entries:
        return "자막을 파싱할 수 없습니다."

    lang_label = ""
    if lang:
        if lang.startswith("ko"):
            lang_label = " (한국어)"
        elif lang.startswith("en"):
            lang_label = " (영어)"

    lines = [f"*언어: {lang}{lang_label}*", ""]

    for ts, text in entries:
        lines.append(f"[{ts}] {text}")

    return "\n".join(lines)


def main():
    args = parse_args()
    url = args.url

    # 메타데이터 추출
    try:
        info = extract_metadata(url)
    except Exception as e:
        error_msg = str(e)
        if "Private video" in error_msg:
            print(f"오류: 비공개 영상입니다.", file=sys.stderr)
        elif "Video unavailable" in error_msg or "not available" in error_msg.lower():
            print(f"오류: 영상을 사용할 수 없습니다.", file=sys.stderr)
        else:
            print(f"오류: 영상 정보를 가져올 수 없습니다. {error_msg}", file=sys.stderr)
        sys.exit(1)

    title = info.get("title", "알 수 없음")
    channel = info.get("channel") or info.get("uploader", "알 수 없음")
    upload_date = format_date(info.get("upload_date"))
    duration = format_duration(info.get("duration"))
    view_count = format_number(info.get("view_count"))
    like_count = format_number(info.get("like_count"))
    tags = info.get("tags") or []
    description = info.get("description") or ""

    tags_str = ", ".join(tags[:20]) if tags else "없음"
    if len(tags) > 20:
        tags_str += f" 외 {len(tags) - 20}개"

    # 설명 길이 제한 (너무 길면 잘라냄)
    max_desc_len = 3000
    if len(description) > max_desc_len:
        description = description[:max_desc_len] + f"\n\n... (이하 생략, 총 {len(description)}자)"

    # 자막 추출
    subtitle_text = None
    with tempfile.TemporaryDirectory() as tmpdir:
        try:
            subtitle_file, lang = extract_subtitles(url, tmpdir)
            if subtitle_file:
                entries = parse_subtitle_file(subtitle_file)
                entries = deduplicate_entries(entries)
                subtitle_text = format_subtitle_output(entries, lang)
            elif lang:
                subtitle_text = f"*언어 {lang}의 자막을 찾았으나 다운로드에 실패했습니다.*"
        except Exception as e:
            subtitle_text = f"*자막 추출 중 오류 발생: {e}*"

    # 출력
    output_parts = [
        "# YouTube 영상 분석",
        "",
        "## 메타데이터",
        f"- **제목**: {title}",
        f"- **채널**: {channel}",
        f"- **업로드일**: {upload_date}",
        f"- **길이**: {duration}",
        f"- **조회수**: {view_count}",
        f"- **좋아요**: {like_count}",
        f"- **태그**: {tags_str}",
        "",
        "## 설명",
        description if description else "(설명 없음)",
        "",
        "## 자막/스크립트",
        subtitle_text if subtitle_text else "이 영상에는 자막이 없습니다.",
    ]

    print("\n".join(output_parts))


if __name__ == "__main__":
    main()
