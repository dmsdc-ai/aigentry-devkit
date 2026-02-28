#!/usr/bin/env bash
# WTM Metrics Library - ROI and usage tracking

WTM_METRICS="${WTM_METRICS:-${WTM_HOME}/metrics.json}"

# Create metrics.json with defaults if it doesn't exist
init_metrics() {
  if [[ ! -f "${WTM_METRICS}" ]]; then
    python3 -c "
import json, sys, datetime

today = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
defaults = {
    'version': 1,
    'lifetime': {
        'sessions_created': 0,
        'sessions_killed': 0,
        'symlinks_created': 0,
        'templates_used': 0,
        'handoffs': 0,
        'bundles_exported': 0,
        'bundles_imported': 0,
        'minutes_saved': 0
    },
    'daily': {
        today: {
            'sessions_created': 0,
            'sessions_killed': 0,
            'symlinks_created': 0,
            'templates_used': 0,
            'handoffs': 0
        }
    },
    'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat()
}
with open(sys.argv[1], 'w') as f:
    json.dump(defaults, f, indent=2)
" "${WTM_METRICS}"
    log_info "Initialized metrics at ${WTM_METRICS}"
  fi
}

# Increment a metric value (both lifetime and daily)
# Args: metric_path [increment=1]
# metric_path: simple key like "sessions_created"
track_metric() {
  local metric_path="$1"
  local increment="${2:-1}"

  init_metrics

  with_lock "metrics" python3 -c "
import json, sys, datetime

path = sys.argv[1]
metric_path = sys.argv[2]
increment = int(sys.argv[3])
today = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')

with open(path, 'r') as f:
    data = json.load(f)

# Update lifetime
lifetime = data.setdefault('lifetime', {})
lifetime[metric_path] = lifetime.get(metric_path, 0) + increment

# Update daily
daily = data.setdefault('daily', {})
day_data = daily.setdefault(today, {})
day_data[metric_path] = day_data.get(metric_path, 0) + increment

with open(path, 'w') as f:
    json.dump(data, f, indent=2)
" "${WTM_METRICS}" "${metric_path}" "${increment}"
}

# Get a metric value
# Args: metric_path [scope=lifetime]
get_metric() {
  local metric_path="$1"
  local scope="${2:-lifetime}"

  init_metrics

  python3 -c "
import json, sys, datetime

path = sys.argv[1]
metric_path = sys.argv[2]
scope = sys.argv[3]
today = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')

with open(path) as f:
    data = json.load(f)

if scope == 'daily':
    val = data.get('daily', {}).get(today, {}).get(metric_path, 0)
else:
    val = data.get('lifetime', {}).get(metric_path, 0)

print(val)
" "${WTM_METRICS}" "${metric_path}" "${scope}"
}

# Calculate estimated time saved
# Args: sessions symlinks
# Returns: minutes saved
calculate_time_saved() {
  local sessions="${1:-0}"
  local symlinks="${2:-0}"
  python3 -c "
sessions = int('${sessions}')
symlinks = int('${symlinks}')
# 5 min per session setup + 1 min per symlink creation
saved = sessions * 5 + symlinks * 1
print(saved)
"
}

# Generate a formatted metrics report
# Args: [period=lifetime] (daily|weekly|lifetime)
generate_report() {
  local period="${1:-lifetime}"

  init_metrics

  python3 -c "
import json, sys, datetime

path = sys.argv[1]
period = sys.argv[2]

with open(path) as f:
    data = json.load(f)

today = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
lifetime = data.get('lifetime', {})
daily_all = data.get('daily', {})

def print_metrics(metrics_dict, label):
    sessions = metrics_dict.get('sessions_created', 0)
    killed = metrics_dict.get('sessions_killed', 0)
    symlinks = metrics_dict.get('symlinks_created', 0)
    templates = metrics_dict.get('templates_used', 0)
    handoffs = metrics_dict.get('handoffs', 0)
    exports = metrics_dict.get('bundles_exported', 0)
    imports = metrics_dict.get('bundles_imported', 0)

    # Estimate time saved: 5 min/session + 1 min/symlink
    minutes_saved = sessions * 5 + symlinks * 1

    print(f'=== WTM Metrics Report ({label}) ===')
    print(f'  Sessions created:  {sessions}')
    print(f'  Sessions killed:   {killed}')
    print(f'  Symlinks created:  {symlinks}')
    print(f'  Templates used:    {templates}')
    print(f'  Handoffs:          {handoffs}')
    print(f'  Bundles exported:  {exports}')
    print(f'  Bundles imported:  {imports}')
    print(f'  Est. time saved:   {minutes_saved} min ({minutes_saved // 60}h {minutes_saved % 60}m)')

if period == 'daily':
    day_data = daily_all.get(today, {})
    print_metrics(day_data, f'Today ({today})')
elif period == 'weekly':
    # Aggregate last 7 days
    from datetime import timedelta
    week_agg = {}
    for i in range(7):
        day = (datetime.datetime.now(datetime.timezone.utc) - timedelta(days=i)).strftime('%Y-%m-%d')
        day_data = daily_all.get(day, {})
        for k, v in day_data.items():
            week_agg[k] = week_agg.get(k, 0) + v
    print_metrics(week_agg, 'Last 7 Days')
else:
    print_metrics(lifetime, 'Lifetime')
" "${WTM_METRICS}" "${period}"
}
