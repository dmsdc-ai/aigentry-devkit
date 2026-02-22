#!/bin/bash
# Simple statusline: reads Claude Code stdin JSON for real-time token display
# Claude Code pipes JSON via stdin with model, context_window, cwd data.

# Read stdin JSON
STDIN=$(cat)

# Parse JSON fields with jq (fallback to defaults if missing)
CWD=$(echo "$STDIN" | jq -r '.cwd // empty' 2>/dev/null)
CWD="${CWD:-$PWD}"
CWD=$(basename "$CWD")

MODEL=$(echo "$STDIN" | jq -r '.model.display_name // .model.id // "Unknown"' 2>/dev/null)

# Context window data
WINDOW_SIZE=$(echo "$STDIN" | jq -r '.context_window.context_window_size // 0' 2>/dev/null)
MODEL_ID=$(echo "$STDIN" | jq -r '.model.id // ""' 2>/dev/null)

# Max plan: use reported context window (200K) as-is

USED_PCT=$(echo "$STDIN" | jq -r '.context_window.used_percentage // empty' 2>/dev/null)

# Token usage from current_usage
INPUT_TOKENS=$(echo "$STDIN" | jq -r '.context_window.current_usage.input_tokens // 0' 2>/dev/null)
CACHE_CREATE=$(echo "$STDIN" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0' 2>/dev/null)
CACHE_READ=$(echo "$STDIN" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0' 2>/dev/null)

# Total used tokens
USED=$((INPUT_TOKENS + CACHE_CREATE + CACHE_READ))

# Calculate percentage
if [ -n "$USED_PCT" ] && [ "$USED_PCT" != "null" ]; then
  PCT=$(printf '%.0f' "$USED_PCT" 2>/dev/null || echo 0)
elif [ "$WINDOW_SIZE" -gt 0 ] 2>/dev/null; then
  PCT=$((USED * 100 / WINDOW_SIZE))
else
  PCT=0
fi

# Clamp percentage
[ "$PCT" -gt 100 ] 2>/dev/null && PCT=100
[ "$PCT" -lt 0 ] 2>/dev/null && PCT=0

# Format token counts (e.g. 48000 -> 48.0K, 1500000 -> 1.50M)
format_tokens() {
  local n=$1
  if [ "$n" -ge 1000000 ] 2>/dev/null; then
    local m=$((n / 10000))
    echo "$((m / 100)).$((m % 100))M"
  elif [ "$n" -ge 1000 ] 2>/dev/null; then
    local k=$((n / 100))
    echo "$((k / 10)).$((k % 10))K"
  else
    echo "${n}"
  fi
}

USED_FMT=$(format_tokens "$USED")
WINDOW_FMT=$(format_tokens "$WINDOW_SIZE")

# Color codes
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
DIM='\033[2m'
RESET='\033[0m'

# Select color based on percentage
if [ "$PCT" -ge 85 ]; then
  COLOR="$RED"
elif [ "$PCT" -ge 70 ]; then
  COLOR="$YELLOW"
else
  COLOR="$GREEN"
fi

# Build progress bar (15 chars wide)
BAR_WIDTH=15
FILLED=$((PCT * BAR_WIDTH / 100))
[ "$FILLED" -lt 0 ] 2>/dev/null && FILLED=0
EMPTY=$((BAR_WIDTH - FILLED))

FILLED_BAR=""
EMPTY_BAR=""
if [ "$FILLED" -gt 0 ]; then
  FILLED_BAR=$(printf '%0.s█' $(seq 1 "$FILLED"))
fi
if [ "$EMPTY" -gt 0 ]; then
  EMPTY_BAR=$(printf '%0.s░' $(seq 1 "$EMPTY"))
fi

# PSM Session Detection
PSM_SESSION=""
PSM_NOTIFICATIONS=0
FULL_CWD=$(echo "$STDIN" | jq -r '.cwd // empty' 2>/dev/null)
FULL_CWD="${FULL_CWD:-$PWD}"

if [ -f "${FULL_CWD}/.psm-session.json" ]; then
  PSM_SESSION=$(jq -r '.session_id // empty' "${FULL_CWD}/.psm-session.json" 2>/dev/null)
  PSM_TYPE=$(jq -r '.type // empty' "${FULL_CWD}/.psm-session.json" 2>/dev/null)
  PSM_BRANCH=$(jq -r '.branch // empty' "${FULL_CWD}/.psm-session.json" 2>/dev/null)

  # Check for pending notifications
  NOTIFY_FILE="${FULL_CWD}/.psm-notifications/pending.log"
  if [ -f "$NOTIFY_FILE" ] && [ -s "$NOTIFY_FILE" ]; then
    PSM_NOTIFICATIONS=$(wc -l < "$NOTIFY_FILE" | tr -d ' ')
  fi
fi

# Build PSM suffix
PSM_SUFFIX=""
if [ -n "$PSM_SESSION" ]; then
  CYAN='\033[36m'
  if [ "$PSM_NOTIFICATIONS" -gt 0 ]; then
    PSM_SUFFIX=$(printf ' | %bPSM:%s [%s] %b%d notif%b' "$CYAN" "$PSM_SESSION" "$PSM_BRANCH" "$YELLOW" "$PSM_NOTIFICATIONS" "$RESET")
  else
    PSM_SUFFIX=$(printf ' | %bPSM:%s [%s]%b' "$CYAN" "$PSM_SESSION" "$PSM_BRANCH" "$RESET")
  fi
fi

# Output: cwd | model | [████░░░░░░] 5% 45.2K/1.0M | PSM:session [branch]
printf '%s | %s | [%b%s%b%s%b] %b%d%% %s/%s%b%b\n' \
  "$CWD" "$MODEL" \
  "$COLOR" "$FILLED_BAR" "$DIM" "$EMPTY_BAR" "$RESET" \
  "$COLOR" "$PCT" "$USED_FMT" "$WINDOW_FMT" "$RESET" \
  "$PSM_SUFFIX"
