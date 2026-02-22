#!/bin/bash
#
# Session Monitor — 단일 deliberation 세션 전용 터미널 뷰
#
# Usage:
#   bash session-monitor.sh <session_id> <project_slug>
#
# MCP 서버가 deliberation_start 시 자동으로 tmux 윈도우에서 실행합니다.
#

SESSION_ID="${1:?session_id 필요}"
PROJECT="${2:?project_slug 필요}"
STATE_FILE="$HOME/.local/lib/mcp-deliberation/state/$PROJECT/sessions/$SESSION_ID.json"

# 색상
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

clear_screen() { printf '\033[2J\033[H'; }

get_field() {
  node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('$STATE_FILE','utf-8'));
      const keys = '$1'.split('.');
      let val = d;
      for (const k of keys) val = val?.[k];
      if (Array.isArray(val)) console.log(val.length);
      else console.log(val ?? '?');
    } catch { console.log('?'); }
  " 2>/dev/null
}

render() {
  if [ ! -f "$STATE_FILE" ]; then
    echo -e "${DIM}세션 파일 대기 중: $STATE_FILE${NC}"
    return
  fi

  local topic=$(get_field "topic")
  local status=$(get_field "status")
  local round=$(get_field "current_round")
  local max_rounds=$(get_field "max_rounds")
  local speaker=$(get_field "current_speaker")
  local responses=$(get_field "log")

  # 상태 색상
  local status_color="$YELLOW"
  case "$status" in
    active) status_color="$GREEN" ;;
    completed) status_color="$CYAN" ;;
    awaiting_synthesis) status_color="$BLUE" ;;
  esac

  # 프로그레스 바
  local total=$((max_rounds * 2))
  local filled=$responses
  [ "$filled" -gt "$total" ] 2>/dev/null && filled=$total
  local bar=""
  for ((i=0; i<filled; i++)); do bar+="█"; done
  for ((i=filled; i<total; i++)); do bar+="░"; done

  # 헤더
  echo -e "${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║${NC}  ${YELLOW}$topic${NC}"
  echo -e "${BOLD}╠══════════════════════════════════════════════════════════════╣${NC}"
  echo -e "${BOLD}║${NC}  Session:  ${MAGENTA}$SESSION_ID${NC}"
  echo -e "${BOLD}║${NC}  Project:  ${CYAN}$PROJECT${NC}"
  echo -e "${BOLD}║${NC}  Status:   ${status_color}$status${NC}"
  echo -e "${BOLD}║${NC}  Round:    ${BOLD}$round/$max_rounds${NC}  |  Next: ${BOLD}$speaker${NC}"
  echo -e "${BOLD}║${NC}  Progress: [${GREEN}${bar}${NC}] ${responses}/${total}"
  echo -e "${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""

  # 토론 기록
  node -e "
    const fs = require('fs');
    try {
      const s = JSON.parse(fs.readFileSync('$STATE_FILE','utf-8'));

      if (s.synthesis) {
        console.log('\x1b[1m── Synthesis ──\x1b[0m');
        console.log('');
        const lines = s.synthesis.split('\n').slice(0, 20);
        lines.forEach(l => console.log('  ' + l));
        if (s.synthesis.split('\n').length > 20) console.log('  ...(truncated)');
        console.log('');
      }

      if (s.log.length === 0) {
        console.log('\x1b[2m  아직 응답이 없습니다. ' + s.current_speaker + ' 차례 대기 중...\x1b[0m');
        return;
      }

      console.log('\x1b[1m── Debate Log ──\x1b[0m');
      console.log('');

      for (const entry of s.log) {
        const color = entry.speaker === 'claude' ? '\x1b[34m' : '\x1b[33m';
        const icon = entry.speaker === 'claude' ? '🔵' : '🟡';
        console.log(color + '\x1b[1m' + icon + ' ' + entry.speaker + ' — Round ' + entry.round + '\x1b[0m');

        const lines = entry.content.split('\n');
        const maxLines = 12;
        const show = lines.slice(0, maxLines);
        show.forEach(l => console.log('  ' + l));
        if (lines.length > maxLines) console.log('  \x1b[2m...(' + (lines.length - maxLines) + ' more lines)\x1b[0m');
        console.log('');
      }

      if (s.status === 'active') {
        const nextColor = s.current_speaker === 'claude' ? '\x1b[34m' : '\x1b[33m';
        console.log(nextColor + '  ⏳ Waiting for ' + s.current_speaker + ' (Round ' + s.current_round + ')...\x1b[0m');
      } else if (s.status === 'awaiting_synthesis') {
        console.log('\x1b[36m  🏁 모든 라운드 종료. 합성 대기 중...\x1b[0m');
      }
    } catch(e) {
      console.log('  읽기 실패: ' + e.message);
    }
  " 2>/dev/null

  echo ""

  # 완료 시 카운트다운
  if [ "$status" = "completed" ]; then
    echo -e "${CYAN}${BOLD}  ✅ Deliberation 완료!${NC}"
    echo -e "${DIM}  이 터미널은 30초 후 자동으로 닫힙니다...${NC}"
    for i in $(seq 30 -1 1); do
      printf "\r${DIM}  닫히기까지 %2d초...${NC}" "$i"
      sleep 1
      # 파일이 삭제되었으면 즉시 종료
      [ ! -f "$STATE_FILE" ] && break
    done
    echo ""
    exit 0
  fi
}

# 메인 루프
while true; do
  clear_screen
  render
  echo -e "${DIM}[$(date +%H:%M:%S)] Auto-refresh 2s | Ctrl+C to close${NC}"

  # 파일이 삭제되었으면 종료
  if [ ! -f "$STATE_FILE" ]; then
    echo -e "${RED}세션이 삭제되었습니다.${NC}"
    sleep 3
    exit 0
  fi

  sleep 2
done
