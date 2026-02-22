---
name: clipboard-image
description: Capture and view clipboard image. Triggers on "clipboard", "paste image", "클립보드", "이미지 붙여넣기", "캡처 확인"
allowed-tools: Bash, Read
---

# Clipboard Image Viewer

Capture the current clipboard image and display it for analysis.

## Steps

1. Save clipboard image to a temp file:
```bash
DISPLAY=:1 xclip -selection clipboard -t image/png -o > /tmp/clipboard-image.png 2>/dev/null
```

2. Check if the image was captured successfully:
```bash
file /tmp/clipboard-image.png
```

3. If successful, use the Read tool to view `/tmp/clipboard-image.png` (Claude Code can read images natively).

4. If no image in clipboard, inform the user:
   - "클립보드에 이미지가 없습니다. 스크린샷을 복사한 후 다시 시도해주세요."

## Troubleshooting

- If DISPLAY=:1 doesn't work, try DISPLAY=:0
- If xclip fails, check: `DISPLAY=:1 xclip -selection clipboard -t TARGETS -o`
