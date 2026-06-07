# Spec — open-session.sh cmux workspace readiness barrier (BUG-A, fix the submit-race)

Status: **SPEC FIRST — awaiting orchestrator APPROVED. No implementation yet.**
Owner role: coder (`fix-a-opensession`). Date: 2026-06-07.

## Problem (recap)
`bin/open-session.sh` cmux branch returns the workspace ref **optimistically** on a
string-parse of `workspace:N` from `cmux new-workspace` stdout — *not* on the pane's
surface PTY being live. The pane process + `telepty allow` foreground proc come up async
*after* the ref is returned. With no readiness barrier, the daemon's subsequent
`cmux send-key --workspace <id> return` can fire before the surface socket exists →
`Error: Failed to write to socket` → the worker's Enter never lands → claude never starts →
daemon mislabels it `TASK_COMPLETE … idle` → worker dies → bash residue.

## RECON — what cmux actually exposes (tested live, 2026-06-07)

Commands present: `list-workspaces`, `surface-health [--workspace]`, `list-pane-surfaces`,
`read-screen`, `tree`, `send-key`, `send`. No `--json` on list-workspaces/surface-health
(plain text). `wait-for` is a tmux-signal compat shim, not pane-readiness.

Live experiments (throwaway `sleep` workspaces, probed then `close-workspace`):

1. **`cmux new-workspace` blocks ~0.8s** then prints `OK workspace:N`. By the time it
   returns, the surface usually exists (surface-health + read-screen succeeded at +27ms in
   a quiet run). The race window is narrow in isolation but real under load/instability
   (matches the daemon-log evidence).

2. **rc is UNRELIABLE.** `cmux read-screen --surface …` returned `Error: invalid_params:
   Surface is not a terminal` with **rc=0**. `send-key … C-c` returned rc=1. So the gate
   **must inspect output text**, not just `$?`.

3. **Bogus refs SILENTLY FALL BACK to the caller.** `surface-health --workspace
   workspace:9999` and `--surface surface:9999` returned the *caller's own* surface with
   **rc=0** (default = `$CMUX_WORKSPACE_ID`). A naïve "rc=0 ⇒ ready" probe is therefore a
   **false positive** — it would report a dead/nonexistent workspace as ready.

4. **`cmux list-workspaces` is a fallback-immune existence oracle.** It lists ONLY real
   workspaces in the current window; `grep workspace:9999` → 0 matches. A freshly created
   ws appeared there at ~192ms. This is the safe anchor that defeats finding (3).

5. **Do not gate on `in_window`.** Both a live throwaway pane and *this* running session
   report `in_window=false`. The readiness fact is "a `type=terminal` surface line exists
   for the target ws", not `in_window`.

6. **send-key-noop is not viable** (finding 2 + no true noop key; any real key corrupts
   claude's prompt). Reactive + intrusive → rejected.

### Chosen readiness signal (cheapest reliable proof)
Per poll iteration, BOTH must hold (text-inspected, not rc):
- **(a) Existence:** `cmux list-workspaces` output contains the exact `<ref>` token
  (word-anchored). Fallback-immune ⇒ defeats the caller-fallback false positive.
- **(b) Surface live:** `cmux surface-health --workspace <ref>` output contains a
  `type=terminal` line AND contains no `Error`. Because (a) already proved `<ref>` is real,
  surface-health cannot fall back to the caller here ⇒ it asserts the *target* pane's
  surface — the exact object `send-key` writes to.

`read-screen`-nonempty was considered as a stricter add-on but rejected for v1: a live but
unpainted pane returns empty (false-negative → wasted wait), and the `--surface` form
errored. surface-health is cheaper and sufficient. (Noted as a follow-up if residual races
appear.)

## Where to gate
`bin/open-session.sh`, `open_in_terminal()` → `cmux)` branch. Insert the barrier
**after** ref extraction (`ref=$(echo "$out" | grep -oE 'workspace:[0-9]+' …)` and the
empty-ref guard, ~line 178) and **before** `echo "$ref"` (~line 180). Rename stays in
place. New helper `_cmux_wait_ready <ref>` defined in the cmux branch / file scope.

Bounded wait-loop:
- timeout default **10000ms** (`CMUX_READY_TIMEOUT_MS` override) — generous vs observed
  ~0.2s; interval **200ms** (`CMUX_READY_INTERVAL_MS` override), matching the existing
  `sleep 0.2` idiom in `cmux-inject.sh`.
- deadline via `date +%s%N`-free integer math: use `SECONDS`/`date +%s` coarse seconds or a
  millisecond counter via `$(($(date +%s000)))` style portable arithmetic; loop:
  `while not(ready) and not(deadline): sleep interval`.
- on ready → return 0 (caller then echoes ref).
- **on timeout → fail loud:** print actionable message to **stderr**, best-effort
  `cmux close-workspace --workspace <ref>` (don't leave the half-dead ws as residue), and
  **exit non-zero (exit 3)** — do **NOT** echo a ref for a dead workspace.

## Cross-OS (Rule 26)
The `cmux` branch is inherently **macOS-only** (cmux is a macOS app), so OS-portability is
moot for this branch. The loop uses only portable primitives already used throughout
`lib/platform-unix.sh` (`date +%s`, `sleep 0.2`, `case`/`grep`) — no GNU-only bashisms, no
new OS abstraction needed. No change to `platform.sh`/`platform-unix.sh`. (If a helper were
warranted it'd be `platform::sleep_ms`, but that's over-engineering per Article 1 — keep the
loop inline in open-session.sh, which also satisfies §3 ownership.)

## No workaround / root-cause (Rule 27)
The race is *producer-side*: open-session returns a ref that does not yet mean "pane can
receive keys." The barrier changes the ref's contract — it is returned **only after**
`surface-health` confirms the target ws has a live terminal surface, i.e. exactly the
precondition `send-key` needs. This closes the window **at the source**, so every downstream
consumer (daemon submit, dispatch-verify) is automatically safe with no per-consumer retry.
Existing `--submit-retry`/`dispatch-verify` resends become belt-and-suspenders, not the
primary defense. On unrecoverable failure it fails loud instead of emitting a ref for a dead
pane (the precise cause of the "TASK_COMPLETE idle → bash residue" symptom).

## Test plan (hermetic, T39 — current highest is T38)
New `tests/dispatch/T39_open_session_cmux_readiness.sh` (sources `lib.sh` for
`t_setup`/`T_TMP`/`STUB_BIN`; auto-picked by `run-all.sh` glob). A fake `cmux` stub on PATH,
driven by a counter file, simulates "not-ready N times then ready". Runs the real
symlinked `$REPO_ROOT/bin/open-session.sh` with `CMUX_WORKSPACE_ID=test` (forces the cmux
branch) and `HOME=$T_TMP` (isolates the open-session.log write). Cases:
- **T39a wait-then-ready:** stub reports not-ready 3× then ready ⇒ assert open-session
  loops then prints the ref, exit 0, and probed surface-health ≥ 4×.
- **T39b timeout fail-loud:** stub never ready (short `CMUX_READY_TIMEOUT_MS`) ⇒ assert
  exit ≠ 0, stdout has **no** `workspace:` ref, stderr has the actionable message, and the
  stub recorded a best-effort `close-workspace`.
- **T39c fallback-immunity:** stub `list-workspaces` omits the ref while `surface-health`
  "succeeds" (simulated caller-fallback) ⇒ assert the gate does **not** pass on
  surface-health alone (existence required) → proves the false-positive defense.

Verification: `bash -n` on open-session.sh (+ platform files), run T39, run
`tests/dispatch/run-all.sh` → no NEW reds.

## Snyk
Only POSIX shell is touched → not a Snyk Code-supported SAST language. **N/A (shell).**

## RISKS / things the orchestrator must decide
1. **Cross-repo (KEY):** the file to edit, `bin/open-session.sh` + `lib/`, physically lives
   in **`aigentry-devkit`** (the orchestrator's `bin/open-session.sh` is a symlink to it).
   The **tests** live in **`aigentry-orchestrator/tests/dispatch/`**. So the fix is **two
   commits across two repos**, both on `main`, no push. Confirm this is acceptable / which
   repo owns what. (devkit working tree is clean on these files; orchestrator has a
   pre-existing unrelated dirty `T27_…` — not mine, left untouched per Rule 29.)
2. surface-health proves the surface exists but in theory the PTY socket could lag a hair;
   covered by the observed race + fail-loud timeout. Follow-up: add read-screen-nonempty as
   a 2nd confirmation only if residual races recur.
3. Best-effort `close-workspace` on timeout is a small scope addition (residue hygiene) —
   flag if you'd rather fail without cleanup.
