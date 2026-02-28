#!/usr/bin/env bash
# WTM UI Library - Table formatting and display helpers
# Provides consistent terminal output: headers, tables, separators,
# and value formatting for durations, byte sizes, truncation, and status colors.
# Depends on color variables exported by common.sh (RED GREEN YELLOW BLUE CYAN NC).

# Fall back to safe defaults if sourced before common.sh
RED="${RED:-\033[0;31m}"
GREEN="${GREEN:-\033[0;32m}"
YELLOW="${YELLOW:-\033[1;33m}"
BLUE="${BLUE:-\033[0;34m}"
CYAN="${CYAN:-\033[0;36m}"
NC="${NC:-\033[0m}"

# Default terminal width used when no width is supplied
_WTM_DEFAULT_WIDTH=80

# ---------------------------------------------------------------------------
# print_header <title>
#
# Print a visually prominent section header surrounded by a separator line.
# Example output:
#   ════════════════════════════════════
#    Sessions
#   ════════════════════════════════════
# ---------------------------------------------------------------------------
print_header() {
  local title="$1"
  local width="${_WTM_DEFAULT_WIDTH}"
  local sep
  sep=$(printf '═%.0s' $(seq 1 "${width}"))
  echo -e "${BLUE}${sep}${NC}"
  echo -e "${BLUE} ${title}${NC}"
  echo -e "${BLUE}${sep}${NC}"
}

# ---------------------------------------------------------------------------
# print_table_header <col1> [col2] [col3] ...
#
# Print a colored table header row followed by a dashed separator.
# Columns are printed left-aligned in fixed 20-character fields.
# ---------------------------------------------------------------------------
print_table_header() {
  local header_line=""
  for col in "$@"; do
    header_line+=$(printf "%-20s" "${col}")
  done
  echo -e "${CYAN}${header_line}${NC}"
  print_separator
}

# ---------------------------------------------------------------------------
# print_separator [width]
#
# Print a horizontal separator line of dashes.
# Defaults to _WTM_DEFAULT_WIDTH characters wide.
# ---------------------------------------------------------------------------
print_separator() {
  local width="${1:-${_WTM_DEFAULT_WIDTH}}"
  printf '%*s\n' "${width}" '' | tr ' ' '-'
}

# ---------------------------------------------------------------------------
# format_duration <minutes>
#
# Convert an integer number of minutes into a human-readable "Xh Ym" string.
# Examples:
#   format_duration 90   → "1h 30m"
#   format_duration 45   → "45m"
#   format_duration 120  → "2h 0m"
# ---------------------------------------------------------------------------
format_duration() {
  local minutes="${1:-0}"
  python3 - "${minutes}" <<'PYEOF'
import sys
mins = int(sys.argv[1])
h, m = divmod(abs(mins), 60)
if h > 0:
    print(f"{h}h {m}m")
else:
    print(f"{m}m")
PYEOF
}

# ---------------------------------------------------------------------------
# format_bytes <kb>
#
# Convert a size in kilobytes to a human-readable string with K / M / G suffix.
# Examples:
#   format_bytes 512    → "512K"
#   format_bytes 2048   → "2.0M"
#   format_bytes 1572864 → "1.5G"
# ---------------------------------------------------------------------------
format_bytes() {
  local kb="${1:-0}"
  python3 - "${kb}" <<'PYEOF'
import sys
kb = float(sys.argv[1])
if kb >= 1024 * 1024:
    print(f"{kb / (1024 * 1024):.1f}G")
elif kb >= 1024:
    print(f"{kb / 1024:.1f}M")
else:
    print(f"{kb:.0f}K")
PYEOF
}

# ---------------------------------------------------------------------------
# truncate <string> <max_len>
#
# Return the string unchanged if it fits within max_len characters.
# Otherwise return the first (max_len - 3) characters followed by "...".
# ---------------------------------------------------------------------------
truncate() {
  local string="$1"
  local max_len="${2:-20}"
  python3 - "${string}" "${max_len}" <<'PYEOF'
import sys
s, max_len = sys.argv[1], int(sys.argv[2])
if len(s) <= max_len:
    print(s)
else:
    print(s[:max_len - 3] + "...")
PYEOF
}

# ---------------------------------------------------------------------------
# color_status <status>
#
# Print the status string wrapped in the appropriate ANSI color code.
#   active  → GREEN
#   lazy    → YELLOW
#   error   → RED
#   stopped → YELLOW (dim)
#   (other) → no color (plain)
# ---------------------------------------------------------------------------
color_status() {
  local status="$1"
  case "${status}" in
    active)
      echo -e "${GREEN}${status}${NC}" ;;
    lazy|stopped)
      echo -e "${YELLOW}${status}${NC}" ;;
    error)
      echo -e "${RED}${status}${NC}" ;;
    *)
      echo "${status}" ;;
  esac
}
