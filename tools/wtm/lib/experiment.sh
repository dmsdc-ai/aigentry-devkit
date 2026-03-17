#!/usr/bin/env bash
# WTM Experiment Library - stateful experiment runner primitives

WTM_EXPERIMENTS="${WTM_EXPERIMENTS:-${WTM_HOME}/experiments}"

experiment_safe_id() {
  local session_id="$1"
  echo "${session_id//[:\/]/_}"
}

experiment_dir() {
  local session_id="$1"
  echo "${WTM_EXPERIMENTS}/$(experiment_safe_id "${session_id}")"
}

experiment_state_file() {
  local session_id="$1"
  echo "$(experiment_dir "${session_id}")/state.json"
}

experiment_results_tsv() {
  local session_id="$1"
  echo "$(experiment_dir "${session_id}")/results.tsv"
}

experiment_results_jsonl() {
  local session_id="$1"
  echo "$(experiment_dir "${session_id}")/results.jsonl"
}

experiment_program_file() {
  local session_id="$1"
  echo "$(experiment_dir "${session_id}")/program.md"
}

_render_experiment_program_template() {
  local template_path="$1"
  local output_path="$2"
  local session_id="$3"
  local project="$4"
  local worktree="$5"
  local goal="$6"
  local budget_seconds="$7"
  local metric_name="$8"
  local score_label="$9"
  local score_direction="${10}"

  python3 - "${template_path}" "${output_path}" "${session_id}" "${project}" "${worktree}" "${goal}" "${budget_seconds}" "${metric_name}" "${score_label}" "${score_direction}" <<'PYEOF'
import pathlib, sys

(template_path, output_path, session_id, project, worktree, goal, budget_seconds,
 metric_name, score_label, score_direction) = sys.argv[1:]

template = pathlib.Path(template_path).read_text()
rendered = (
    template
    .replace("{{SESSION_ID}}", session_id)
    .replace("{{PROJECT}}", project)
    .replace("{{WORKTREE}}", worktree)
    .replace("{{GOAL}}", goal or "Describe the objective for this experiment.")
    .replace("{{BUDGET_SECONDS}}", budget_seconds)
    .replace("{{METRIC_NAME}}", metric_name)
    .replace("{{SCORE_LABEL}}", score_label)
    .replace("{{SCORE_DIRECTION}}", score_direction)
)
pathlib.Path(output_path).write_text(rendered)
PYEOF
}

_resolve_experiment_program_path() {
  local worktree="$1"
  local program_path="$2"

  if [[ -z "${program_path}" ]]; then
    return 1
  fi

  case "${program_path}" in
    "~"*) expand_path "${program_path}" ;;
    /*) echo "${program_path}" ;;
    *) echo "${worktree}/${program_path}" ;;
  esac
}

_git_rev_parse_or_empty() {
  local worktree="$1"
  if [[ -d "${worktree}/.git" ]] || git -C "${worktree}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "${worktree}" rev-parse HEAD 2>/dev/null || true
  fi
}

_git_single_changed_file() {
  local worktree="$1"
  local files

  files=$(git -C "${worktree}" diff --name-only --relative 2>/dev/null || true)
  if [[ -z "${files}" ]]; then
    files=$(git -C "${worktree}" diff --cached --name-only --relative 2>/dev/null || true)
  fi

  if [[ -n "${files}" ]] && [[ "$(printf '%s\n' "${files}" | sed '/^$/d' | wc -l | tr -d ' ')" == "1" ]]; then
    printf '%s\n' "${files}" | sed '/^$/d' | head -n 1
  fi
}

get_experiment_state() {
  local session_id="$1"
  local state_file
  state_file="$(experiment_state_file "${session_id}")"
  [[ -f "${state_file}" ]] || return 1
  cat "${state_file}"
}

init_experiment_state() {
  local session_id="$1"
  shift || true

  local template_name="experiment-program"
  local budget_seconds=""
  local metric_name=""
  local score_label=""
  local score_direction=""
  local program_path=""
  local goal=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --template) template_name="${2:-experiment-program}"; shift 2 ;;
      --budget-seconds) budget_seconds="${2:-300}"; shift 2 ;;
      --metric-name) metric_name="${2:-score}"; shift 2 ;;
      --score-label) score_label="${2:-score}"; shift 2 ;;
      --score-direction) score_direction="${2:-maximize}"; shift 2 ;;
      --program-path) program_path="${2:-}"; shift 2 ;;
      --goal) goal="${2:-}"; shift 2 ;;
      *)
        log_warn "Unknown init_experiment_state option: $1"
        shift
        ;;
    esac
  done

  local session_json
  session_json="$(get_session "${session_id}")" || {
    log_error "Session '${session_id}' not found"
    return 1
  }

  mkdir -p "${WTM_EXPERIMENTS}"

  local project worktree root state_file results_tsv results_jsonl now resolved_program template_json template_metric_name template_score_label template_score_direction template_budget_seconds template_goal program_template_source
  project=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('project',''))")
  worktree=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('worktree',''))")
  root="$(experiment_dir "${session_id}")"
  state_file="$(experiment_state_file "${session_id}")"
  results_tsv="$(experiment_results_tsv "${session_id}")"
  results_jsonl="$(experiment_results_jsonl "${session_id}")"
  now="$(now_iso)"

  mkdir -p "${root}/artifacts" "${root}/patches"

  if [[ -n "${template_name}" ]]; then
    template_json=$(apply_template "${template_name}" 2>/dev/null || true)
    if [[ -n "${template_json}" ]]; then
      template_metric_name=$(echo "${template_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('metric_name',''))")
      template_score_label=$(echo "${template_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('score_label',''))")
      template_score_direction=$(echo "${template_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('score_direction',''))")
      template_budget_seconds=$(echo "${template_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('budget_seconds',''))")
      template_goal=$(echo "${template_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('goal',''))")
      program_template_source=$(echo "${template_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('program_template_path',''))")
    fi
  fi

  metric_name="${metric_name:-${template_metric_name:-score}}"
  score_label="${score_label:-${template_score_label:-${metric_name}}}"
  score_direction="${score_direction:-${template_score_direction:-maximize}}"
  budget_seconds="${budget_seconds:-${template_budget_seconds:-300}}"
  goal="${goal:-${template_goal:-}}"

  if [[ -n "${program_path}" ]]; then
    resolved_program="$(_resolve_experiment_program_path "${worktree}" "${program_path}")"
  else
    resolved_program="$(experiment_program_file "${session_id}")"
  fi

  mkdir -p "$(dirname "${resolved_program}")"
  if [[ ! -f "${resolved_program}" ]]; then
    if [[ -n "${program_template_source}" ]] && [[ -f "${program_template_source}" ]]; then
      _render_experiment_program_template "${program_template_source}" "${resolved_program}" "${session_id}" "${project}" "${worktree}" "${goal}" "${budget_seconds}" "${metric_name}" "${score_label}" "${score_direction}"
    else
      cat > "${resolved_program}" <<EOF
# Experiment Program

## Goal
${goal:-Describe the objective for this experiment.}

## Constraints
- Single-file scope by default
- Time budget: ${budget_seconds} seconds
- Metric: ${metric_name}
- Score label: ${score_label}
- Direction: ${score_direction}

## Evaluation
- Setup command:
- Eval command:
- Keep threshold:
EOF
    fi
  fi

  if [[ ! -f "${results_tsv}" ]]; then
    printf 'timestamp\titeration\tstatus\tdecision\tscore\tscore_label\tduration_ms\ttarget_file\tbase_commit\tgit_commit\texit_code\teval_command\tnotes\tartifact_path\n' > "${results_tsv}"
  fi
  [[ -f "${results_jsonl}" ]] || : > "${results_jsonl}"

  local lock_name="experiment.$(experiment_safe_id "${session_id}")"

  with_lock "${lock_name}" python3 - "${state_file}" "${session_id}" "${project}" "${worktree}" "${resolved_program}" "${metric_name}" "${score_label}" "${score_direction}" "${budget_seconds}" "${goal}" "${template_name}" "${now}" <<'PYEOF'
import json, os, sys

state_path, session_id, project, worktree, program_path, metric_name, score_label, score_direction, budget_seconds, goal, template_name, now = sys.argv[1:]
budget_seconds = int(budget_seconds)

if os.path.exists(state_path):
    with open(state_path) as f:
        state = json.load(f)
else:
    state = {
        "session_id": session_id,
        "project": project,
        "worktree": worktree,
        "status": "initialized",
        "created_at": now,
        "current_iteration": 0,
        "best_iteration": None,
        "best_score": None,
        "best_commit": None,
        "promoted_iterations": [],
        "discarded_iterations": [],
        "modified_iterations": [],
        "history": []
    }

state["project"] = project
state["worktree"] = worktree
state["template"] = template_name or None
state["program_path"] = program_path
state["metric_name"] = metric_name
state["score_label"] = score_label
state["score_direction"] = score_direction
state["budget_seconds"] = budget_seconds
state["goal"] = goal
state["updated_at"] = now

with open(state_path, "w") as f:
    json.dump(state, f, indent=2)
PYEOF

  emit_event "experiment.started" "{\"session_id\":\"${session_id}\",\"project\":\"${project}\",\"program_path\":\"${resolved_program}\",\"metric_name\":\"${metric_name}\",\"score_label\":\"${score_label}\"}"
  track_metric "experiment_sessions_initialized" 1 >/dev/null 2>&1 || true
  printf '%s\n' "${state_file}"
}

record_result_tsv() {
  local session_id="$1"
  shift || true

  local iteration=""
  local status=""
  local decision=""
  local score=""
  local score_label=""
  local duration_ms="0"
  local target_file=""
  local base_commit=""
  local git_commit=""
  local exit_code=""
  local eval_command=""
  local notes=""
  local artifact_path=""
  local timestamp=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --iteration) iteration="${2:-}"; shift 2 ;;
      --status) status="${2:-}"; shift 2 ;;
      --decision) decision="${2:-}"; shift 2 ;;
      --score) score="${2:-}"; shift 2 ;;
      --score-label) score_label="${2:-}"; shift 2 ;;
      --duration-ms) duration_ms="${2:-0}"; shift 2 ;;
      --target-file) target_file="${2:-}"; shift 2 ;;
      --base-commit) base_commit="${2:-}"; shift 2 ;;
      --git-commit) git_commit="${2:-}"; shift 2 ;;
      --exit-code) exit_code="${2:-}"; shift 2 ;;
      --eval-command) eval_command="${2:-}"; shift 2 ;;
      --notes) notes="${2:-}"; shift 2 ;;
      --artifact-path) artifact_path="${2:-}"; shift 2 ;;
      --timestamp) timestamp="${2:-}"; shift 2 ;;
      *)
        log_warn "Unknown record_result_tsv option: $1"
        shift
        ;;
    esac
  done

  [[ -n "${iteration}" ]] || { log_error "record_result_tsv requires --iteration"; return 1; }
  [[ -n "${status}" ]] || { log_error "record_result_tsv requires --status"; return 1; }
  [[ -n "${decision}" ]] || { log_error "record_result_tsv requires --decision"; return 1; }

  local results_tsv results_jsonl state_file session_json project now lock_name
  state_file="$(experiment_state_file "${session_id}")"
  [[ -f "${state_file}" ]] || { log_error "Experiment state not initialized for ${session_id}"; return 1; }

  if [[ -z "${score_label}" ]]; then
    score_label=$(python3 - "${state_file}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(state.get("score_label", "score"))
PYEOF
)
  fi

  session_json="$(get_session "${session_id}")" || {
    log_error "Session '${session_id}' not found"
    return 1
  }
  project=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('project',''))")
  results_tsv="$(experiment_results_tsv "${session_id}")"
  results_jsonl="$(experiment_results_jsonl "${session_id}")"
  now="${timestamp:-$(now_iso)}"
  lock_name="experiment.$(experiment_safe_id "${session_id}")"

  with_lock "${lock_name}" python3 - "${results_tsv}" "${results_jsonl}" "${session_id}" "${project}" "${now}" "${iteration}" "${status}" "${decision}" "${score}" "${score_label}" "${duration_ms}" "${target_file}" "${base_commit}" "${git_commit}" "${exit_code}" "${eval_command}" "${notes}" "${artifact_path}" <<'PYEOF'
import csv, json, sys

(tsv_path, jsonl_path, session_id, project, timestamp, iteration, status, decision, score,
 score_label, duration_ms, target_file, base_commit, git_commit, exit_code, eval_command,
 notes, artifact_path) = sys.argv[1:]

row = {
    "timestamp": timestamp,
    "iteration": int(iteration),
    "status": status,
    "decision": decision,
    "score": score,
    "score_label": score_label,
    "duration_ms": int(duration_ms or 0),
    "target_file": target_file,
    "base_commit": base_commit,
    "git_commit": git_commit,
    "exit_code": exit_code,
    "eval_command": eval_command,
    "notes": notes,
    "artifact_path": artifact_path,
}

with open(tsv_path, "a", newline="") as f:
    writer = csv.writer(f, delimiter="\t")
    writer.writerow([
        row["timestamp"],
        row["iteration"],
        row["status"],
        row["decision"],
        row["score"],
        row["score_label"],
        row["duration_ms"],
        row["target_file"],
        row["base_commit"],
        row["git_commit"],
        row["exit_code"],
        row["eval_command"],
        row["notes"],
        row["artifact_path"],
    ])

payload = dict(row)
payload["session_id"] = session_id
payload["project"] = project
with open(jsonl_path, "a") as f:
    f.write(json.dumps(payload, ensure_ascii=False) + "\n")
PYEOF
}

promote_or_discard() {
  local session_id="$1"
  shift || true

  local iteration=""
  local decision=""
  local status=""
  local score=""
  local git_commit=""
  local base_commit=""
  local target_file=""
  local notes=""
  local duration_ms="0"
  local timestamp=""
  local artifact_path=""
  local next_status="queued"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --iteration) iteration="${2:-}"; shift 2 ;;
      --decision) decision="${2:-}"; shift 2 ;;
      --status) status="${2:-}"; shift 2 ;;
      --score) score="${2:-}"; shift 2 ;;
      --git-commit) git_commit="${2:-}"; shift 2 ;;
      --base-commit) base_commit="${2:-}"; shift 2 ;;
      --target-file) target_file="${2:-}"; shift 2 ;;
      --notes) notes="${2:-}"; shift 2 ;;
      --duration-ms) duration_ms="${2:-0}"; shift 2 ;;
      --timestamp) timestamp="${2:-}"; shift 2 ;;
      --artifact-path) artifact_path="${2:-}"; shift 2 ;;
      --next-status) next_status="${2:-queued}"; shift 2 ;;
      *)
        log_warn "Unknown promote_or_discard option: $1"
        shift
        ;;
    esac
  done

  [[ -n "${iteration}" ]] || { log_error "promote_or_discard requires --iteration"; return 1; }
  [[ -n "${decision}" ]] || { log_error "promote_or_discard requires --decision"; return 1; }

  local state_file lock_name now
  state_file="$(experiment_state_file "${session_id}")"
  [[ -f "${state_file}" ]] || { log_error "Experiment state not initialized for ${session_id}"; return 1; }
  now="${timestamp:-$(now_iso)}"
  lock_name="experiment.$(experiment_safe_id "${session_id}")"

  with_lock "${lock_name}" python3 - "${state_file}" "${iteration}" "${decision}" "${status}" "${score}" "${git_commit}" "${base_commit}" "${target_file}" "${notes}" "${duration_ms}" "${artifact_path}" "${next_status}" "${now}" <<'PYEOF'
import json, math, sys

(state_path, iteration, decision, status, score, git_commit, base_commit, target_file,
 notes, duration_ms, artifact_path, next_status, now) = sys.argv[1:]
iteration = int(iteration)

with open(state_path) as f:
    state = json.load(f)

score_direction = state.get("score_direction", "maximize")
existing_best = state.get("best_score")

def to_float(value):
    try:
        if value == "":
            return None
        return float(value)
    except Exception:
        return None

candidate_score = to_float(score)
best_score = to_float(existing_best) if existing_best is not None else None

history = state.setdefault("history", [])
history.append({
    "iteration": iteration,
    "status": status,
    "decision": decision,
    "score": candidate_score if candidate_score is not None else score,
    "git_commit": git_commit or None,
    "base_commit": base_commit or None,
    "target_file": target_file or None,
    "notes": notes or None,
    "duration_ms": int(duration_ms or 0),
    "artifact_path": artifact_path or None,
    "timestamp": now,
})

state["current_iteration"] = max(iteration, int(state.get("current_iteration", 0)))
state["last_status"] = status
state["last_decision"] = decision
state["last_iteration"] = history[-1]
state["updated_at"] = now

def better(direction, current, best):
    if current is None:
        return best is None
    if best is None:
        return True
    if direction == "minimize":
        return current < best
    return current > best

event_name = "experiment.finished"
event_payload = {
    "session_id": state.get("session_id"),
    "project": state.get("project"),
    "iteration": iteration,
    "status": status,
    "decision": decision,
    "score": candidate_score if candidate_score is not None else score,
    "git_commit": git_commit,
    "base_commit": base_commit,
    "target_file": target_file,
    "artifact_path": artifact_path,
}

if decision == "keep":
    promoted = state.setdefault("promoted_iterations", [])
    if iteration not in promoted:
        promoted.append(iteration)
    state["status"] = "promoted"
    state["experiment_outcome"] = {"verdict": "keep", "suggested_action": "advance", "terminal": True}
    if better(score_direction, candidate_score, best_score):
        state["best_iteration"] = iteration
        state["best_score"] = candidate_score if candidate_score is not None else score
        state["best_commit"] = git_commit or None
        state["best_target_file"] = target_file or None
    event_name = "experiment.promoted"
elif decision == "discard":
    discarded = state.setdefault("discarded_iterations", [])
    if iteration not in discarded:
        discarded.append(iteration)
    state["status"] = "discarded"
    state["experiment_outcome"] = {"verdict": "discard", "suggested_action": "revert", "terminal": True}
    event_name = "experiment.discarded"
elif decision == "modify":
    modified = state.setdefault("modified_iterations", [])
    if iteration not in modified:
        modified.append(iteration)
    state["status"] = next_status
    state["experiment_outcome"] = {"verdict": "modify", "suggested_action": "retry", "terminal": False}
else:
    state["status"] = "review"
    state["experiment_outcome"] = {"verdict": decision, "suggested_action": "review", "terminal": False}

with open(state_path, "w") as f:
    json.dump(state, f, indent=2)

print(json.dumps({"event_name": event_name, "event_payload": event_payload}))
PYEOF
}

run_iteration() {
  local session_id="$1"
  shift || true

  local eval_command=""
  local status=""
  local decision=""
  local score=""
  local score_label=""
  local target_file=""
  local base_commit=""
  local git_commit=""
  local notes=""
  local next_status="queued"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --eval-cmd) eval_command="${2:-}"; shift 2 ;;
      --status) status="${2:-}"; shift 2 ;;
      --decision) decision="${2:-}"; shift 2 ;;
      --score) score="${2:-}"; shift 2 ;;
      --score-label) score_label="${2:-}"; shift 2 ;;
      --target-file) target_file="${2:-}"; shift 2 ;;
      --base-commit) base_commit="${2:-}"; shift 2 ;;
      --git-commit) git_commit="${2:-}"; shift 2 ;;
      --notes) notes="${2:-}"; shift 2 ;;
      --next-status) next_status="${2:-queued}"; shift 2 ;;
      *)
        log_warn "Unknown run_iteration option: $1"
        shift
        ;;
    esac
  done

  local state_file session_json worktree artifact_path iteration score_label_resolved start_ms end_ms duration_ms exit_code final_status final_git_commit final_base_commit result_json event_name event_payload

  state_file="$(experiment_state_file "${session_id}")"
  if [[ ! -f "${state_file}" ]]; then
    init_experiment_state "${session_id}" >/dev/null
  fi

  session_json="$(get_session "${session_id}")" || {
    log_error "Session '${session_id}' not found"
    return 1
  }
  worktree=$(echo "${session_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('worktree',''))")
  [[ -n "${worktree}" ]] || { log_error "Session '${session_id}' has no worktree"; return 1; }

  iteration=$(python3 - "${state_file}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(int(state.get("current_iteration", 0)) + 1)
PYEOF
)

  if [[ -z "${score_label}" ]]; then
    score_label_resolved=$(python3 - "${state_file}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(state.get("score_label", "score"))
PYEOF
)
  else
    score_label_resolved="${score_label}"
  fi

  final_base_commit="${base_commit:-$(_git_rev_parse_or_empty "${worktree}")}"
  artifact_path="$(experiment_dir "${session_id}")/artifacts/iter-$(printf '%04d' "${iteration}").log"
  mkdir -p "$(dirname "${artifact_path}")"
  start_ms=$(python3 -c 'import time; print(int(time.time() * 1000))')

  exit_code=0
  if [[ -n "${eval_command}" ]]; then
    set +e
    WTM_EXPERIMENT_WORKTREE="${worktree}" bash -lc 'cd "$WTM_EXPERIMENT_WORKTREE" && '"${eval_command}" > "${artifact_path}" 2>&1
    exit_code=$?
    set -e
  else
    : > "${artifact_path}"
  fi

  end_ms=$(python3 -c 'import time; print(int(time.time() * 1000))')
  duration_ms=$((end_ms - start_ms))
  final_git_commit="${git_commit:-$(_git_rev_parse_or_empty "${worktree}")}"

  if [[ -z "${target_file}" ]]; then
    target_file="$(_git_single_changed_file "${worktree}")"
  fi

  if [[ -z "${status}" ]]; then
    if [[ "${exit_code}" == "0" ]]; then
      final_status="pass"
    else
      final_status="fail"
    fi
  else
    final_status="${status}"
  fi

  if [[ -z "${decision}" ]]; then
    if [[ "${final_status}" == "pass" ]]; then
      decision="keep"
    else
      decision="discard"
    fi
  fi

  record_result_tsv "${session_id}" \
    --iteration "${iteration}" \
    --status "${final_status}" \
    --decision "${decision}" \
    --score "${score}" \
    --score-label "${score_label_resolved}" \
    --duration-ms "${duration_ms}" \
    --target-file "${target_file}" \
    --base-commit "${final_base_commit}" \
    --git-commit "${final_git_commit}" \
    --exit-code "${exit_code}" \
    --eval-command "${eval_command}" \
    --notes "${notes}" \
    --artifact-path "${artifact_path}"

  emit_event "experiment.iteration.finished" "{\"session_id\":\"${session_id}\",\"iteration\":${iteration},\"status\":\"${final_status}\",\"decision\":\"${decision}\",\"score\":\"${score}\",\"score_label\":\"${score_label_resolved}\"}"
  track_metric "experiment_iterations" 1 >/dev/null 2>&1 || true

  result_json=$(promote_or_discard "${session_id}" \
    --iteration "${iteration}" \
    --decision "${decision}" \
    --status "${final_status}" \
    --score "${score}" \
    --git-commit "${final_git_commit}" \
    --base-commit "${final_base_commit}" \
    --target-file "${target_file}" \
    --notes "${notes}" \
    --duration-ms "${duration_ms}" \
    --artifact-path "${artifact_path}" \
    --next-status "${next_status}")

  event_name=$(echo "${result_json}" | python3 -c "import json,sys; print(json.loads(sys.stdin.read()).get('event_name','experiment.finished'))")
  event_payload=$(echo "${result_json}" | python3 -c "import json,sys; import json as _j; print(_j.dumps(json.loads(sys.stdin.read()).get('event_payload', {})))")
  emit_event "${event_name}" "${event_payload}"

  if [[ "${decision}" == "keep" ]]; then
    track_metric "experiment_promotions" 1 >/dev/null 2>&1 || true
  elif [[ "${decision}" == "discard" ]]; then
    track_metric "experiment_discards" 1 >/dev/null 2>&1 || true
  elif [[ "${decision}" == "modify" ]]; then
    track_metric "experiment_retries" 1 >/dev/null 2>&1 || true
  fi

  python3 - "${session_id}" "${iteration}" "${final_status}" "${decision}" "${score}" "${duration_ms}" "${target_file}" "${final_base_commit}" "${final_git_commit}" "${artifact_path}" "${exit_code}" <<'PYEOF'
import json, sys

session_id, iteration, status, decision, score, duration_ms, target_file, base_commit, git_commit, artifact_path, exit_code = sys.argv[1:]
print(json.dumps({
    "session_id": session_id,
    "iteration": int(iteration),
    "status": status,
    "decision": decision,
    "score": score,
    "duration_ms": int(duration_ms),
    "target_file": target_file or None,
    "base_commit": base_commit or None,
    "git_commit": git_commit or None,
    "artifact_path": artifact_path,
    "exit_code": int(exit_code),
}))
PYEOF
}
