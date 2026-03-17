#!/usr/bin/env bash
# Test: WTM experiment runner primitives
echo "  === Experiment Runner Tests ==="

setup_test_env
source "${HOME}/.wtm/lib/common.sh"
set +e

repo_dir="${WTM_WORKTREES}/proj/experiment-runner"
mkdir -p "${repo_dir}"
git -C "${repo_dir}" init -q
git -C "${repo_dir}" config user.email "wtm-test@example.com"
git -C "${repo_dir}" config user.name "WTM Test"
cat > "${repo_dir}/main.txt" <<'EOF'
baseline
EOF
git -C "${repo_dir}" add main.txt
git -C "${repo_dir}" commit -q -m "initial"

python3 - "${WTM_SESSIONS}" "${repo_dir}" <<'PYEOF'
import json, sys

sessions_path, repo_dir = sys.argv[1:]
data = {
    "version": 3,
    "sessions": {
        "proj:experiment-runner": {
            "project": "proj",
            "type": "experiment",
            "name": "runner",
            "branch": "experiment/runner",
            "worktree": repo_dir,
            "source": repo_dir,
            "status": "active",
            "created_at": "2026-03-13T00:00:00Z",
            "context": {}
        }
    }
}
with open(sessions_path, "w") as f:
    json.dump(data, f, indent=2)
PYEOF

echo ""
echo "  -- init_experiment_state --"
state_path=$(init_experiment_state "proj:experiment-runner" --goal "Improve throughput" --metric-name "accuracy" --score-label "accuracy" --score-direction "maximize" --budget-seconds 120)
assert_file_exists "${state_path}" "init_experiment_state writes state.json"
assert_file_exists "$(experiment_results_tsv "proj:experiment-runner")" "init_experiment_state creates results.tsv"
assert_file_exists "$(experiment_results_jsonl "proj:experiment-runner")" "init_experiment_state creates results.jsonl"
assert_file_exists "$(experiment_program_file "proj:experiment-runner")" "init_experiment_state creates default program.md"

program_contents=$(cat "$(experiment_program_file "proj:experiment-runner")")
assert_contains "${program_contents}" "control plane for one WTM experiment session" "init_experiment_state renders built-in program.md template"
assert_contains "${program_contents}" "Improve throughput" "rendered program.md contains goal"

current_iteration=$(python3 - "${state_path}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(state.get("current_iteration"))
PYEOF
)
assert_eq "0" "${current_iteration}" "new experiment starts at iteration 0"

echo ""
echo "  -- run_iteration keep --"
run_output=$(run_iteration "proj:experiment-runner" --eval-cmd "printf 'iteration-one\\n'" --decision keep --score 0.80 --notes "first candidate")
assert_contains "${run_output}" "\"decision\": \"keep\"" "run_iteration returns keep JSON"

line_count=$(wc -l < "$(experiment_results_tsv "proj:experiment-runner")" | tr -d ' ')
assert_eq "2" "${line_count}" "results.tsv has header + first iteration"

best_score=$(python3 - "${state_path}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(state.get("best_score"))
PYEOF
)
assert_eq "0.8" "${best_score}" "keep promotes best score"

best_iteration=$(python3 - "${state_path}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(state.get("best_iteration"))
PYEOF
)
assert_eq "1" "${best_iteration}" "keep promotes first iteration"

echo ""
echo "  -- run_iteration discard --"
run_output=$(run_iteration "proj:experiment-runner" --status fail --decision discard --score 0.10 --notes "bad candidate")
assert_contains "${run_output}" "\"decision\": \"discard\"" "run_iteration returns discard JSON"

line_count=$(wc -l < "$(experiment_results_tsv "proj:experiment-runner")" | tr -d ' ')
assert_eq "3" "${line_count}" "results.tsv appends discard iteration"

discarded_count=$(python3 - "${state_path}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(len(state.get("discarded_iterations", [])))
PYEOF
)
assert_eq "1" "${discarded_count}" "discard iteration tracked in state"

best_score=$(python3 - "${state_path}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(state.get("best_score"))
PYEOF
)
assert_eq "0.8" "${best_score}" "discard does not replace best score"

echo ""
echo "  -- run_iteration modify --"
run_output=$(run_iteration "proj:experiment-runner" --status pass --decision modify --score 0.75 --next-status running --notes "retry with small adjustment")
assert_contains "${run_output}" "\"decision\": \"modify\"" "run_iteration returns modify JSON"

experiment_status=$(python3 - "${state_path}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(state.get("status"))
PYEOF
)
assert_eq "running" "${experiment_status}" "modify keeps experiment non-terminal"

history_count=$(python3 - "${state_path}" <<'PYEOF'
import json, sys
with open(sys.argv[1]) as f:
    state = json.load(f)
print(len(state.get("history", [])))
PYEOF
)
assert_eq "3" "${history_count}" "history records all iterations"

jsonl_count=$(wc -l < "$(experiment_results_jsonl "proj:experiment-runner")" | tr -d ' ')
assert_eq "3" "${jsonl_count}" "results.jsonl mirrors each iteration"

teardown_test_env
