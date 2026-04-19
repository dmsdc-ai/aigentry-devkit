# Platform Abstraction Layer

Spec: `aigentry-orchestrator/docs/superpowers/specs/2026-04-19-session-cleanup-and-platform-abstraction-design.md`

## Purpose

Keep new bash code free of OS-specific calls so a future Windows-native backend is a single file swap. `bin/lib/platform.sh` detects the host and sources the matching backend; callers invoke `platform::*` only.

## API

Source once per script:

```bash
source "$(dirname "$0")/lib/platform.sh"
```

Double-source is a no-op (guard flag `_PLATFORM_SH_SOURCED`).

### OS detection

- `platform::os_type` → `macos | linux | windows | unknown`
  - Honors `PLATFORM_OVERRIDE` env var (test injection).

### Session lifecycle

- `platform::is_alive <pid>` → 0 if the process is alive, non-zero otherwise.
- `platform::kill_pid <pid>` → SIGTERM, 5s grace, SIGKILL fallback. Idempotent; a missing pid returns 0.
- `platform::pid_exists <pidfile>` → read `<pidfile>` and call `is_alive`.

### Concurrency

- `platform::file_lock <path> <fn> [args...]` → acquire lock for `<path>`, run `<fn>` with `<args>`, release. `flock` preferred, `mkdir` + PID-liveness fallback.
- `platform::file_unlock <path>` → best-effort release for script-wide locks.

### Events

- `platform::event_wait <dir> <timeout_sec>` → block until `<dir>` gains an entry, or timeout. Three-tier backend selection at call time:
  1. `gtimeout` / `timeout` + `fswatch -1` — GNU coreutils path.
  2. Background `fswatch -1` + watchdog kill — for older fswatch (e.g. Homebrew 1.18.3) that lacks `--timeout`.
  3. Pure `sleep`-poll fallback — when `fswatch` is absent.

## `PLATFORM_OVERRIDE` (test injection)

```bash
PLATFORM_OVERRIDE=windows source bin/lib/platform.sh
# platform::os_type → "windows" → platform-windows.sh backend sourced
```

Used by `tests/platform.bats` to exercise the Windows stub and by
`check-platform-usage.sh` regression probes.

## Backends

- `platform-unix.sh` — macOS + Linux. Pure bash / `kill` / `flock` / `fswatch` + poll fallback.
- `platform-windows.sh` — stub. Every function returns exit 3 with a tracking message pointing at #305 and WSL as the workaround.

## Example

```bash
source "$(dirname "$0")/lib/platform.sh"

my_work() {
  echo "doing stuff in locked section"
}

platform::file_lock /tmp/my.lock my_work

if platform::is_alive 12345; then
  platform::kill_pid 12345
fi

platform::event_wait /tmp/inbox 30 || echo "timeout"
```

## Rule 26

`aigentry-devkit/AGENTS.md` Rule 26 requires new bash code to call `platform::*` instead of `flock` / `fswatch` / `kill -TERM|-KILL|-9`. Enforcement: `bin/check-platform-usage.sh` (exit 1 on violation; exit 0 on clean).

Documented exception: `bin/multi-exec-lib.sh` holds `flock` on fd 9 for the full runner lifetime — the wrap-fn signature of `platform::file_lock` does not fit that lifecycle. Migration tracked when `platform::file_lock_persistent` lands (see #307).

## macOS fswatch gotcha

Homebrew `fswatch 1.18.3` does **not** support `--timeout`. The Unix backend's 3-tier fallback handles this silently; no caller code changes needed. If your environment ships a newer fswatch (≥ 1.14 with `--timeout`), the first tier (`timeout` + `fswatch`) takes over.

## Roadmap

- [x] Phase 1: Abstract + Unix + Windows stub (#304)
- [ ] Phase 2: Legacy code migration — remaining direct `flock`/`kill` callsites (#307)
- [ ] Phase 3: Windows native PowerShell backend (#305)
- [ ] Phase 4: `platform::file_lock_persistent` lifetime-hold API → removes the multi-exec-lib.sh allowlist exception
