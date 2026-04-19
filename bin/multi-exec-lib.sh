#!/usr/bin/env bash
# multi-exec-lib.sh — shared library (source'd by multi-exec.sh and bats tests)
# Spec: docs/superpowers/specs/2026-04-19-multi-exec-automation-design.md
# Rule 17: bash 4+ / jq / awk / sed / flock only. No python/yaml/yq.

# shellcheck disable=SC2034  # consumed by sourcing scripts + bats
MULTI_EXEC_VERSION="0.1.0"

# parse_frontmatter(plan-file) → stdout: JSON object of multi_exec block, or empty
# Returns non-zero if no multi_exec block.
# Hand-parse the narrow YAML shape (flat keys + chunk_gates list) with awk.
parse_frontmatter() {
  local plan="$1"
  [[ -f "$plan" ]] || { echo "plan file not found: $plan" >&2; return 2; }

  local lines
  lines=$(awk '
    BEGIN { in_fm=0; in_me=0; indent=-1 }
    /^---$/ {
      if (in_fm) { exit } else { in_fm=1; next }
    }
    in_fm && /^multi_exec:/ { in_me=1; next }
    in_me {
      line=$0
      n=0; while (substr(line, n+1, 1) == " ") n++
      if (indent == -1) indent = n
      if (n < indent) { in_me=0; next }
      sub(/^ +/, "", line)
      if (line == "" || line ~ /^#/) next
      print line
    }
  ' "$plan")

  [[ -z "$lines" ]] && return 1
  printf '%s\n' "$lines" | _me_lines_to_json
}

# _me_lines_to_json(stdin) — narrow YAML → JSON for our fixed schema.
# Accepts lines like:
#   enabled: true
#   coder_session: ID
#   chunk_gates:
#     - after_chunk: 1
#       type: user_approval
_me_lines_to_json() {
  local raw
  raw=$(awk '
    BEGIN { print "{" ; first=1; in_cg=0; cg_open=0 }
    function comma() { if (!first) printf ","; first=0 }
    /^chunk_gates:/ { comma(); printf "\"chunk_gates\":["; in_cg=1; cg_first=1; next }
    in_cg && /^- after_chunk:/ {
      if (!cg_first) printf ",";
      cg_first=0
      gsub(/^- after_chunk:[[:space:]]*/, "", $0)
      ac=$0
      printf "{\"after_chunk\":%s", ac
      cg_open=1
      next
    }
    in_cg && /^  type:/ {
      gsub(/^  type:[[:space:]]*/, "", $0)
      tp=$0
      printf ",\"type\":\"%s\"}", tp
      cg_open=0
      next
    }
    /^[a-zA-Z_]+:/ {
      split($0, a, /:[[:space:]]*/)
      k=a[1]; v=a[2]
      comma()
      if (v ~ /^(true|false|[0-9]+)$/)
        printf "\"%s\":%s", k, v
      else
        printf "\"%s\":\"%s\"", k, v
    }
    END { if (cg_open) printf "}"; if (in_cg) printf "]"; print "}" }
  ')
  # Non-empty test: "{}" alone means no keys parsed.
  [[ "$raw" == $'{\n}' || "$raw" == "{}" ]] && return 1
  printf '%s\n' "$raw" | jq -c . 2>/dev/null || return 1
}

# parse_report(stdin) → emits JSON to stdout
# Supports two grammars:
#   strict: one "key: value" per line (files/tests/commits/issues/next + REPORT: Task N header)
#   legacy: "REPORT: Task N complete | files: ... | tests: ... | commits: ... | ..."
parse_report() {
  local text
  text="$(cat)"
  local task commit files tests issues next

  task=$(printf '%s\n' "$text" | head -1 | grep -oE 'Task[[:space:]]+[0-9]+' | head -1 | grep -oE '[0-9]+')
  if [[ -z "$task" ]]; then
    jq -n '{error: "no task number in REPORT"}'
    return 1
  fi

  if printf '%s\n' "$text" | grep -qE '^(files|tests|commits?|issues|next):'; then
    files=$(printf '%s\n' "$text"  | awk '/^files:/   {sub(/^files:[[:space:]]*/,"");    print; exit}')
    tests=$(printf '%s\n' "$text"  | awk '/^tests:/   {sub(/^tests:[[:space:]]*/,"");    print; exit}')
    commit=$(printf '%s\n' "$text" | awk '/^commits?:/ {sub(/^commits?:[[:space:]]*/,""); print; exit}')
    issues=$(printf '%s\n' "$text" | awk '/^issues:/  {sub(/^issues:[[:space:]]*/,"");   print; exit}')
    next=$(printf '%s\n' "$text"   | awk '/^next:/    {sub(/^next:[[:space:]]*/,"");     print; exit}')
  else
    files=$(printf '%s\n' "$text"  | grep -oE 'files: [^|]+'    | sed -E 's/^files: //; s/[[:space:]]+$//')
    tests=$(printf '%s\n' "$text"  | grep -oE 'tests: [^|]+'    | sed -E 's/^tests: //; s/[[:space:]]+$//')
    commit=$(printf '%s\n' "$text" | grep -oE 'commits?: [^|]+' | sed -E 's/^commits?: //; s/[[:space:]]+$//')
    issues=$(printf '%s\n' "$text" | grep -oE 'issues: [^|]+'   | sed -E 's/^issues: //; s/[[:space:]]+$//')
    next=$(printf '%s\n' "$text"   | grep -oE 'next: [^|]+'     | sed -E 's/^next: //; s/[[:space:]]+$//')
  fi

  jq -n \
    --arg task   "$task" \
    --arg files  "${files:-}" \
    --arg tests  "${tests:-}" \
    --arg commit "${commit:-}" \
    --arg issues "${issues:-none}" \
    --arg next   "${next:-}" \
    '{task: ($task|tonumber), files: $files, tests: $tests, commit: $commit, issues: $issues, next: $next}'
}

# parse_tasks(plan-file) → stdout: lines of "chunk_n<TAB>task_n<TAB>line_nr"
# Portable awk: no 3-arg match(), sub() only.
parse_tasks() {
  local plan="$1"
  awk '
    /^## Chunk [0-9]+:/ {
      sub(/^## Chunk /, "", $0); sub(/:.*$/, "", $0); chunk=$0; next
    }
    /^### Task [0-9]+:/ {
      line=$0
      sub(/^### Task /, "", line); sub(/:.*$/, "", line); task=line
      print chunk "\t" task "\t" NR
    }
  ' "$plan"
}
