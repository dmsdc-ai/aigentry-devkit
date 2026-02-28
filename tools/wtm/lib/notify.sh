#!/usr/bin/env bash
# WTM Notify Library - Desktop and webhook notifications

WTM_CONFIG="${WTM_CONFIG:-${WTM_HOME}/config.json}"

# Send a notification through all configured channels
# Args: title message [urgency=normal]
# urgency: low|normal|critical
send_notification() {
  local title="$1"
  local message="$2"
  local urgency="${3:-normal}"

  # macOS desktop notification (non-blocking)
  if command -v osascript &>/dev/null; then
    osascript &>/dev/null &<<OSASCRIPT
display notification "${message}" with title "${title}"
OSASCRIPT
  fi

  # Read webhook configs from config.json if it exists
  if [[ -f "${WTM_CONFIG}" ]]; then
    local slack_webhook discord_webhook
    slack_webhook=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    print(d.get('notifications', {}).get('slack_webhook', ''))
except Exception:
    print('')
" "${WTM_CONFIG}" 2>/dev/null) || slack_webhook=""

    discord_webhook=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    print(d.get('notifications', {}).get('discord_webhook', ''))
except Exception:
    print('')
" "${WTM_CONFIG}" 2>/dev/null) || discord_webhook=""

    # Send Slack notification (non-blocking)
    if [[ -n "${slack_webhook}" ]]; then
      local slack_payload
      slack_payload=$(python3 -c "
import json, sys
payload = {'text': '*' + sys.argv[1] + '*\n' + sys.argv[2]}
print(json.dumps(payload))
" "${title}" "${message}")
      curl -s -X POST "${slack_webhook}" \
        -H 'Content-type: application/json' \
        --data "${slack_payload}" \
        &>/dev/null &
    fi

    # Send Discord notification (non-blocking)
    if [[ -n "${discord_webhook}" ]]; then
      local discord_payload
      discord_payload=$(python3 -c "
import json, sys
payload = {'content': '**' + sys.argv[1] + '**\n' + sys.argv[2]}
print(json.dumps(payload))
" "${title}" "${message}")
      curl -s -X POST "${discord_webhook}" \
        -H 'Content-type: application/json' \
        --data "${discord_payload}" \
        &>/dev/null &
    fi
  fi
}
