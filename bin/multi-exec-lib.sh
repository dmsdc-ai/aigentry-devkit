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

# ---------------------------------------------------------------------------
# Concurrency guards
# ---------------------------------------------------------------------------

LOCKFILE_PATH=""

_pidfile_path() {
  printf '%s\n' "${HOME}/.wtm/contexts/orchestrator/multi-exec.pid"
}

# acquire_lock(plan) — per-plan exclusive lock. Prefers flock, falls back
# to atomic mkdir + pid-liveness.
# fd 9 is RESERVED by this library for the lockfile; callers must not reuse.
acquire_lock() {
  local plan="$1"
  LOCKFILE_PATH="${plan}.multi-exec.lock"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCKFILE_PATH" || return 1
    flock -n 9 || { echo "lock held by another runner: $LOCKFILE_PATH" >&2; return 1; }
    return 0
  fi
  local lockdir="${LOCKFILE_PATH}.d"
  if mkdir "$lockdir" 2>/dev/null; then
    echo $$ > "$lockdir/pid"
    return 0
  fi
  local holder
  holder=$(cat "$lockdir/pid" 2>/dev/null || echo 0)
  if ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$lockdir"
    mkdir "$lockdir" && echo $$ > "$lockdir/pid" && return 0
  fi
  echo "lock held by live pid $holder" >&2
  return 1
}

release_lock() {
  if [[ -n "$LOCKFILE_PATH" ]]; then
    if command -v flock >/dev/null 2>&1; then
      exec 9>&- 2>/dev/null || true
    else
      rm -rf "${LOCKFILE_PATH}.d" 2>/dev/null || true
    fi
  fi
}

# acquire_pid_mutex — per-orchestrator single-runner guard.
# Skips the manual log write when another live runner owns the pidfile.
acquire_pid_mutex() {
  local pf
  pf=$(_pidfile_path)
  mkdir -p "$(dirname "$pf")"
  if [[ -f "$pf" ]]; then
    local holder
    holder=$(cat "$pf" 2>/dev/null || echo 0)
    if kill -0 "$holder" 2>/dev/null; then
      echo "another multi-exec running (pid $holder)" >&2
      return 1
    fi
    rm -f "$pf"
  fi
  echo $$ > "$pf"
}

release_pid_mutex() {
  local pf
  pf=$(_pidfile_path)
  rm -f "$pf" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Dispatch helpers
# ---------------------------------------------------------------------------

# dispatch_task(coder_sid, plan, chunk, task, line, auto_trust) — inject SAWP
# envelope into coder session via telepty.
dispatch_task() {
  local sid="$1" plan="$2" chunk="$3" task="$4" line="$5" auto_trust="$6"
  emit_event "dispatch" "$(jq -n --argjson c "$chunk" --argjson t "$task" '{chunk:$c, task:$t}')"

  if [[ "$auto_trust" -eq 1 ]]; then
    echo "[multi-exec] --auto-trust enabled (informational)" >&2
  fi

  # FULL SAWP envelope per aigentry-orchestrator/AGENTS.md Rule 17 (verbatim, 7 bullets).
  local sawp_block='[SAWP] After completing this task:
- Code + compile check (cargo check / swift build), do NOT run app (builder handles app execution)
- Do NOT run tests (tester handles tests)
- If compile error → fix immediately, do NOT report "ready for builder" with broken code
- If stuck after 3 attempts → report STUCK with full error
- Never idle — report immediately when done
- Evidence only — no "should work" or "probably fixed"
- Preserve ALL existing fixes in modified files (check file invariants before reporting)'

  local msg
  msg="[IMPLEMENT APPROVED] ${sawp_block}

Plan file: $plan. Execute Chunk $chunk Task $task (starts line $line). Follow plan verbatim. INVARIANTS per plan §INVARIANTS section.

REPORT format (strict, key:value per line):
REPORT: Task $task complete
files: <comma-separated>
tests: <pass>/<total>
commits: <sha>
issues: <text or none>
next: <Task N+1 | AWAIT <gate>>

Send via: telepty inject --ref --from $sid aigentry-orchestrator

⚠️ MANDATORY: Do NOT idle after completing. Report IS required before orchestrator continues to next task."

  if command -v telepty >/dev/null 2>&1; then
    telepty inject --ref <(echo "$msg") --from aigentry-orchestrator "$sid" "" >&2 || true
    telepty enter "$sid" >&2 || true
  else
    echo "[multi-exec] telepty CLI missing — dispatch inject skipped (dry mode)" >&2
  fi
}

# _find_new_ref(shared_dir, seen_file) — emit single newest ref path present
# in shared_dir but absent in seen_file. Uses mtime (ls -t) ordering.
_find_new_ref() {
  local shared_dir="$1" seen="$2"
  local now_list
  now_list=$(ls -t "$shared_dir"/*.md 2>/dev/null || true)
  diff <(printf '%s\n' "$now_list") "$seen" 2>/dev/null \
    | awk '/^< / {sub(/^< /, ""); print; exit}'
}

# await_task_report(coder_sid, task) — block (event-driven via fswatch if
# available, else sleep-poll) until a new .md ref in $HOME/.telepty/shared
# parses as this task's REPORT. Emits impl_done + review_skipped events.
# Timeout via MULTI_EXEC_TIMEOUT (default 600s). Exits 7 on timeout.
await_task_report() {
  local sid="$1" task="$2"
  local timeout="${MULTI_EXEC_TIMEOUT:-600}"
  local deadline=$(( $(date +%s) + timeout ))
  local shared_dir="$HOME/.telepty/shared"
  mkdir -p "$shared_dir"
  local seen_file
  seen_file=$(mktemp)
  ls -t "$shared_dir"/*.md 2>/dev/null > "$seen_file" || true

  while [[ $(date +%s) -lt $deadline ]]; do
    if command -v fswatch >/dev/null 2>&1; then
      local remaining=$(( deadline - $(date +%s) ))
      [[ $remaining -le 0 ]] && break
      fswatch -1 --event Created --event Updated --latency 0.5 \
        --timeout "${remaining}000" "$shared_dir" >/dev/null 2>&1 || true
    else
      sleep 5
    fi
    local newest
    newest=$(_find_new_ref "$shared_dir" "$seen_file")
    if [[ -n "$newest" && -f "$newest" ]]; then
      local rep rep_task
      rep=$(parse_report < "$newest" 2>/dev/null || echo '{}')
      rep_task=$(echo "$rep" | jq -r '.task // empty' 2>/dev/null)
      if [[ "$rep_task" == "$task" ]]; then
        emit_event "impl_done" "$rep"
        emit_event "review_skipped" "$(jq -n --argjson t "$task" '{task:$t, reason:"phase1-no-reviewer-bridge"}')"
        rm -f "$seen_file"
        return 0
      fi
      ls -t "$shared_dir"/*.md 2>/dev/null > "$seen_file" || true
    fi
  done

  rm -f "$seen_file"
  emit_event "stuck" "$(jq -n --argjson t "$task" --arg r "timeout" '{task:$t, reason:$r}')"
  echo "TIMEOUT waiting for Task $task REPORT" >&2
  return 7
}

# handle_chunk_gate(fm_json, chunk) — route to auto_approved (no-op) or
# user_approval (Task 5 stubs to auto-approve for now).
handle_chunk_gate() {
  local fm="$1" chunk="$2"
  local gate_type
  gate_type=$(echo "$fm" | jq -r --argjson c "$chunk" '.chunk_gates[] | select(.after_chunk == $c) | .type // empty')
  if [[ "$gate_type" == "auto_approved" || -z "$gate_type" ]]; then
    emit_event "chunk_complete" "$(jq -n --argjson c "$chunk" --arg g auto '{chunk:$c, gate:$g}')"
    return 0
  fi
  # user_approval real implementation lands in Task 5. Stub: auto-close.
  emit_event "chunk_gate_waiting" "$(jq -n --argjson c "$chunk" '{chunk:$c}')"
  echo "[multi-exec] Awaiting [CHUNK $chunk APPROVED] inject from orchestrator..." >&2
  emit_event "chunk_complete" "$(jq -n --argjson c "$chunk" --arg g user '{chunk:$c, gate:$g}')"
  return 0
}

# emit_event(event, meta_json) — log through wtm-context if available.
# Degrades silently when wtm-context is missing.
emit_event() {
  local event="${1:-}"
  local meta="${2:-}"
  [[ -z "$meta" ]] && meta='{}'
  if command -v wtm-context >/dev/null 2>&1; then
    wtm-context log orchestrator exec-event "$event" "$meta" 2>/dev/null || true
  elif [[ -x "$HOME/.wtm/bin/wtm-context" ]]; then
    "$HOME/.wtm/bin/wtm-context" log orchestrator exec-event "$event" "$meta" 2>/dev/null || true
  fi
}
