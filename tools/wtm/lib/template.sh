#!/usr/bin/env bash
# WTM Template Library - Session templates management

WTM_TEMPLATES="${WTM_TEMPLATES:-${WTM_HOME}/templates}"
WTM_BUILTIN_TEMPLATES="${WTM_BUILTIN_TEMPLATES:-${HOME}/.local/lib/wtm/templates}"

resolve_template_file() {
  local template_name="$1"

  if [[ -z "${template_name}" ]]; then
    log_error "Usage: resolve_template_file <template_name>"
    return 1
  fi

  local candidate
  for candidate in "${WTM_TEMPLATES}/${template_name}.json" "${WTM_BUILTIN_TEMPLATES}/${template_name}.json"; do
    [[ -f "${candidate}" ]] || continue
    printf '%s\n' "${candidate}"
    return 0
  done

  return 1
}

resolve_template_asset() {
  local template_name="$1"
  local asset_path="$2"

  if [[ -z "${template_name}" ]] || [[ -z "${asset_path}" ]]; then
    log_error "Usage: resolve_template_asset <template_name> <asset_path>"
    return 1
  fi

  local template_file
  template_file=$(resolve_template_file "${template_name}") || return 1

  case "${asset_path}" in
    "~"*) expand_path "${asset_path}" ;;
    /*) printf '%s\n' "${asset_path}" ;;
    *) printf '%s\n' "$(cd "$(dirname "${template_file}")" && pwd)/${asset_path}" ;;
  esac
}

# List available templates from ~/.wtm/templates/*.json plus built-ins
list_templates() {
  mkdir -p "${WTM_TEMPLATES}"
  python3 - "${WTM_TEMPLATES}" "${WTM_BUILTIN_TEMPLATES}" <<'PYEOF'
import glob, json, os, sys

search_dirs = [path for path in sys.argv[1:] if path]
seen = set()
entries = []

for root in search_dirs:
    if not os.path.isdir(root):
        continue
    for tmpl in sorted(glob.glob(os.path.join(root, "*.json"))):
        try:
            with open(tmpl) as f:
                data = json.load(f)
        except Exception:
            continue
        name = data.get("name") or os.path.splitext(os.path.basename(tmpl))[0]
        if name in seen:
            continue
        seen.add(name)
        entries.append((name, data.get("type", "?"), data.get("description", "")))

if not entries:
    sys.exit(2)

print(f"{'NAME':<30} {'TYPE':<12} DESCRIPTION")
print(f"{'─' * 30:<30} {'─' * 12:<12} {'─' * 40}")
for name, ttype, desc in entries:
    print(f"{name:<30} {ttype:<12} {desc}")
PYEOF
  local rc=$?
  if [[ ${rc} -eq 2 ]]; then
    log_info "No templates found in ${WTM_TEMPLATES} or ${WTM_BUILTIN_TEMPLATES}"
    return 0
  fi
  return ${rc}
}

# Save current session as a template
# Args: session_id template_name
create_template_from_session() {
  local session_id="$1"
  local template_name="$2"

  if [[ -z "${session_id}" ]] || [[ -z "${template_name}" ]]; then
    log_error "Usage: create_template_from_session <session_id> <template_name>"
    return 1
  fi

  local session_json
  session_json=$(get_session "${session_id}" 2>/dev/null) || {
    log_error "Session not found: ${session_id}"
    return 1
  }

  mkdir -p "${WTM_TEMPLATES}"
  local output_file="${WTM_TEMPLATES}/${template_name}.json"

  python3 -c "
import json, sys, datetime

session_json = sys.argv[1]
template_name = sys.argv[2]
output_file = sys.argv[3]

s = json.loads(session_json)

template = {
    'name': template_name,
    'description': f'Template created from session {s.get(\"id\", \"unknown\")}',
    'type': s.get('type', 'feature'),
    'ttl_hours': 168,
    'tags': s.get('tags', []),
    'post_create_commands': [],
    'pre_commit_checks': [],
    'symlink_patterns': s.get('symlink_patterns', []),
    'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'source_session': s.get('id', session_json[:20])
}

with open(output_file, 'w') as f:
    json.dump(template, f, indent=2)

print(output_file)
" "${session_json}" "${template_name}" "${output_file}"

  log_ok "Template '${template_name}' created at ${output_file}"
}

# Read a template and return its settings as JSON
# Args: template_name
apply_template() {
  local template_name="$1"

  if [[ -z "${template_name}" ]]; then
    log_error "Usage: apply_template <template_name>"
    return 1
  fi

  local tmpl_file
  tmpl_file=$(resolve_template_file "${template_name}") || {
    log_error "Template not found: ${template_name}"
    return 1
  }

  track_metric "templates_used" 1 >/dev/null 2>&1 || true

  python3 - "${tmpl_file}" <<'PYEOF'
import json, os, sys

path = sys.argv[1]
with open(path) as f:
    data = json.load(f)

data["template_path"] = path
program_template = data.get("program_template")
if isinstance(program_template, str) and program_template:
    if program_template.startswith("~"):
        resolved = os.path.expanduser(program_template)
    elif os.path.isabs(program_template):
        resolved = program_template
    else:
        resolved = os.path.abspath(os.path.join(os.path.dirname(path), program_template))
    data["program_template_path"] = resolved

print(json.dumps(data, indent=2))
PYEOF
}

# Show a single template's details
# Args: template_name
show_template() {
  local template_name="$1"

  if [[ -z "${template_name}" ]]; then
    log_error "Usage: show_template <template_name>"
    return 1
  fi

  local tmpl_file
  tmpl_file=$(resolve_template_file "${template_name}") || {
    log_error "Template not found: ${template_name}"
    return 1
  }

  python3 - "${tmpl_file}" <<'PYEOF'
import json, os, sys

path = sys.argv[1]
with open(path) as f:
    t = json.load(f)

print(f'Name:        {t.get("name", "?")}')
print(f'Description: {t.get("description", "?")}')
print(f'Type:        {t.get("type", "?")}')
print(f'TTL (hours): {t.get("ttl_hours", "?")}')
print(f'Source:      {path}')
print(f'Tags:        {" ".join(t.get("tags", []))}')

program_template = t.get("program_template")
if program_template:
    if program_template.startswith("~"):
        resolved = os.path.expanduser(program_template)
    elif os.path.isabs(program_template):
        resolved = program_template
    else:
        resolved = os.path.abspath(os.path.join(os.path.dirname(path), program_template))
    print(f'Program tpl: {resolved}')

cmds = t.get('post_create_commands', [])
if cmds:
    print('Post-create commands:')
    for c in cmds:
        print(f'  - {c}')
checks = t.get('pre_commit_checks', [])
if checks:
    print('Pre-commit checks:')
    for c in checks:
        print(f'  - {c}')
syms = t.get('symlink_patterns', [])
if syms:
    print('Symlink patterns:')
    for s in syms:
        print(f'  - {s}')
PYEOF
}
