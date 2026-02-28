#!/usr/bin/env bash
# WTM Template Library - Session templates management

WTM_TEMPLATES="${WTM_TEMPLATES:-${WTM_HOME}/templates}"

# List available templates from ~/.wtm/templates/*.json
list_templates() {
  mkdir -p "${WTM_TEMPLATES}"
  local found=0
  printf "%-30s %-12s %s\n" "NAME" "TYPE" "DESCRIPTION"
  printf "%-30s %-12s %s\n" "$(printf '─%.0s' {1..30})" "$(printf '─%.0s' {1..12})" "$(printf '─%.0s' {1..40})"
  for tmpl in "${WTM_TEMPLATES}"/*.json; do
    [[ -f "${tmpl}" ]] || continue
    found=1
    python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    t = json.load(f)
name = t.get('name', 'unknown')
ttype = t.get('type', '?')
desc = t.get('description', '')
print(f'{name:<30} {ttype:<12} {desc}')
" "${tmpl}"
  done
  if [[ ${found} -eq 0 ]]; then
    log_info "No templates found in ${WTM_TEMPLATES}"
  fi
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

  local tmpl_file="${WTM_TEMPLATES}/${template_name}.json"

  if [[ ! -f "${tmpl_file}" ]]; then
    log_error "Template not found: ${template_name}"
    return 1
  fi

  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    t = json.load(f)
print(json.dumps(t, indent=2))
" "${tmpl_file}"
}

# Show a single template's details
# Args: template_name
show_template() {
  local template_name="$1"

  if [[ -z "${template_name}" ]]; then
    log_error "Usage: show_template <template_name>"
    return 1
  fi

  local tmpl_file="${WTM_TEMPLATES}/${template_name}.json"

  if [[ ! -f "${tmpl_file}" ]]; then
    log_error "Template not found: ${template_name}"
    return 1
  fi

  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    t = json.load(f)
print(f'Name:        {t.get(\"name\", \"?\")}')
print(f'Description: {t.get(\"description\", \"?\")}')
print(f'Type:        {t.get(\"type\", \"?\")}')
print(f'TTL (hours): {t.get(\"ttl_hours\", \"?\")}')
print(f'Tags:        {\" \".join(t.get(\"tags\", []))}')
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
" "${tmpl_file}"
}
