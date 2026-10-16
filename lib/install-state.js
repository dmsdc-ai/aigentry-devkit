"use strict";

// #1147 durable installer recovery journal — the single writer of
// ~/.config/aigentry-devkit/install-journal.json and install-state.json, shared
// by install.sh and install.ps1 so the two installers cannot drift on schema,
// atomicity, permissions or redaction.
//
// Why a journal: every mutating phase (1 devkit-core … 8 orchestrator-role)
// used to be recorded only in Phase 7, i.e. after all of them, so a failure in
// 1-6 left global/HOME mutations with no record at all. Here a `running` record
// is made durable BEFORE the first mutation of a phase and a terminal record
// (completed/failed/unknown) after the last one, so an interrupted install is
// always classifiable. A trap is not the contract: the pre-phase record is.
//
// What this never does: it never rolls back, deletes or migrates user state, it
// never replays an unknown external effect on its own, it never records a
// secret payload (not even a hash — the secret is not passed to this process at
// all, only a presence boolean), and it never treats a corrupt record as an
// absent one.
//
// Atomicity: write to <file>.tmp-<pid>-<rand> in the same directory, fsync,
// rename() onto the live path, best-effort fsync of the directory. A reader
// therefore sees either the previous or the new complete document. This is
// atomic *replacement*, not power-loss durability (see SPEC §1.3). Files are
// created 0600 and re-chmod'ed after the write so a loose umask cannot widen
// them; the state directory is 0700.
//
// Concurrency: an O_EXCL lock file, no flock, no PID probe and no signal
// (forbidden by tests/install-telepty-version.test.js's source guard and by
// #1147's own constraints). A pre-existing lock is refused rather than guessed
// dead; AIGENTRY_INSTALL_FORCE_UNLOCK=1 is the explicit, recorded escape.
//
// Zero dependencies. CLI only (no require() consumer in tracked source yet —
// wiring bin/aigentry-devkit.js to `read` is a serialized follow-up owned by
// #1145, which owns that file).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA = "aigentry-devkit/install-journal@1";
const SCHEMA_MAJOR = "aigentry-devkit/install-journal@";
const JOURNAL_NAME = "install-journal.json";
const LOCK_NAME = "install-journal.lock";
const STATE_NAME = "install-state.json";
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

// Replay classification per phase. This is a policy decision about observable
// effects, deliberately NOT read from the installer manifest: the manifest
// declares what to install, not whether re-running a half-done effect is safe.
//   safe     — re-entry is guarded in the installer itself (existence checks,
//              idempotent npm -g, grep-guarded wiring).
//   verified — re-entry re-observes reality and decides (#1213 telepty policy).
//   unknown  — the effect is not observable to the devkit, so re-running it
//              could duplicate it (a second tenant/API key, a second init).
const PHASES = {
  // Phase 0 is mutating too: it may install tmux through brew/apt/dnf/yum/pacman.
  0: { label: "prerequisites", effect: "system-package-manager", replay: "safe" },
  1: { label: "devkit-core", effect: "local-files", replay: "safe" },
  2: { label: "telepty", effect: "global-npm+daemon", replay: "verified" },
  3: { label: "deliberation", effect: "external-installer", replay: "unknown" },
  4: { label: "brain", effect: "global-npm", replay: "safe" },
  5: { label: "dustcraw", effect: "global-npm+external-init", replay: "unknown" },
  6: { label: "registry-wiring", effect: "remote-tenant-bootstrap", replay: "unknown" },
  7: { label: "config-fanout", effect: "local-state-files", replay: "safe" },
  8: { label: "orchestrator-role", effect: "clone+unit-generation", replay: "safe" },
};

const PHASE_STATUS = ["running", "completed", "failed", "unknown"];
const RUN_OUTCOME = ["running", "completed", "failed", "unknown"];
const UNKNOWN_POLICY = ["refuse", "skip", "replay"];
// Bounded test seam so interrupted-write behaviour is measured, not raced. The
// only effect of any of these is exiting with 70; nothing else is reachable.
const CRASH_POINTS = ["after-tmp-write", "before-rename", "after-rename"];

function crashPoint(point) {
  const want = process.env.AIGENTRY_INSTALL_JOURNAL_CRASH;
  if (want && CRASH_POINTS.indexOf(want) !== -1 && want === point) process.exit(70);
}

function nowIso() {
  return new Date().toISOString();
}

// ── atomic, 0600, same-directory replacement ────────────────────────────────

function atomicWrite(targetPath, text, allowCrash = true) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const tmp = path.join(dir, `${path.basename(targetPath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`);
  const fd = fs.openSync(tmp, "wx", FILE_MODE);
  try {
    fs.writeFileSync(fd, text);
    if (allowCrash) crashPoint("after-tmp-write");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // writeFileSync's mode is masked by umask; make the mode explicit.
  fs.chmodSync(tmp, FILE_MODE);
  if (allowCrash) crashPoint("before-rename");
  fs.renameSync(tmp, targetPath);
  if (allowCrash) crashPoint("after-rename");
  // Best effort: a directory fsync is what makes the rename itself durable, but
  // opening a directory is not portable (it throws on Windows).
  try {
    const dfd = fs.openSync(dir, "r");
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch (err) { /* not available on this platform — documented limitation */ }
}

// Remove *this writer's* leftover temp files only (a crash between write and
// rename). Never touches anything it did not create the name shape of.
function sweepTemp(dir, baseName) {
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (err) { return []; }
  const swept = [];
  for (const name of entries) {
    if (name.indexOf(`${baseName}.tmp-`) !== 0) continue;
    try { fs.unlinkSync(path.join(dir, name)); swept.push(name); } catch (err) { /* keep going */ }
  }
  return swept;
}

// ── read side — absent / ok / corrupt / unsupported, never "corrupt as absent" ──

function readJournal(dir) {
  const file = path.join(dir, JOURNAL_NAME);
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { status: "absent", file, journal: null };
    return { status: "corrupt", file, journal: null, reason: `unreadable: ${err.code || err.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (err) {
    return { status: "corrupt", file, journal: null, reason: "not valid JSON (truncated or torn write)" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "corrupt", file, journal: null, reason: "not a JSON object" };
  }
  if (typeof parsed.schema !== "string" || parsed.schema.indexOf(SCHEMA_MAJOR) !== 0) {
    return { status: "corrupt", file, journal: null, reason: "missing or foreign schema marker" };
  }
  if (parsed.schema !== SCHEMA) {
    return { status: "unsupported", file, journal: null, reason: `journal schema ${parsed.schema} is newer than this installer understands` };
  }
  if (!Array.isArray(parsed.attempts)) {
    return { status: "corrupt", file, journal: null, reason: "attempts[] missing" };
  }
  return { status: "ok", file, journal: parsed };
}

// ── the one shared unknown-effect fold ──────────────────────────────────────

// unresolvedPhases(journal) -> ascending, de-duplicated phase ids whose effect
// is not proven resolved. That is the whole meaning of the answer: "not proven
// resolved", never "the process that wrote this is dead" and never "the process
// that wrote this is alive". Liveness is not derivable from the journal and is
// not guessed here — no clock, no PID probe, no signal.
//
// PURE: no fs, no process, no env, no clock, and the input is never mutated. It
// is exported and used by begin-run so a reader (#1145's CLI) can ask the same
// question through the same definition instead of re-deriving it — re-deriving
// is how the "a resolved unknown blocks forever" defect appears one layer up.
//
// Chronological per phase, because attempts are appended and phases within an
// attempt are recorded in run order:
//   unknown   -> unresolved
//   running   -> unresolved, as PENDING. A `running` record is durable and
//                expected: it is written before the first mutation of every
//                phase, and it is exactly what a SIGKILL leaves behind because
//                no handler can run. It is genuinely ambiguous — during a live
//                run the phase really is running, after an interruption the
//                effect is indeterminate — and the journal cannot tell those
//                apart. So it counts as pending in BOTH cases, including while
//                an installer is still running: a conservative false "pending"
//                is acceptable, answering "nothing is unresolved" about bytes
//                begin-run will refuse is not. begin-run reclassifies `running`
//                to `unknown` and persists that before it folds, so this is
//                also what keeps the read path and begin-run from disagreeing
//                about the same bytes (review RW-A).
//   completed -> supersedes an earlier unknown or pending for that phase
//                (resolved) — but only a CLEAN completion; see degraded below
//   degraded  -> a completed record with degraded:true does NOT supersede. The
//     completed   journal has no trustworthy per-effect completion bit, so a
//                 soft-failed phase cannot prove its unknown external effect
//                 landed; clearing on it would switch the duplicate-effect
//                 protection off exactly when the replay did not land (review
//                 RW-B). It only withholds the supersession: on its own it adds
//                 nothing, so a benign warning on a phase that was never
//                 unresolved cannot fabricate an unresolved effect.
//   failed    -> leaves an unresolved unknown unresolved; a replay that did not
//                land cannot answer the question it was meant to answer
//
// So a later clean completion always clears, and a later running/unknown
// reopens: resolution is a fact about one phase at one point in time, folded at
// read time, never produced by editing, deleting or pruning a record.
//
// Deliberately NOT applied here: the replay classification, the start-phase
// cursor and the component-selection filter. Those are per-invocation policy and
// belong to begin-run; leaking them into the generic answer would make a reader
// silently under-report. Total on unexpected shapes: returns [] rather than
// throwing.
function unresolvedPhases(journal) {
  if (!journal || typeof journal !== "object" || !Array.isArray(journal.attempts)) return [];
  const unresolved = new Set();
  for (const attempt of journal.attempts) {
    if (!attempt || typeof attempt !== "object" || !Array.isArray(attempt.phases)) continue;
    for (const rec of attempt.phases) {
      if (!rec || typeof rec !== "object" || !Number.isInteger(rec.phase)) continue;
      if (rec.status === "unknown" || rec.status === "running") unresolved.add(rec.phase);
      else if (rec.status === "completed" && rec.degraded !== true) unresolved.delete(rec.phase);
    }
  }
  return [...unresolved].sort((a, b) => a - b);
}

function writeJournal(dir, journal, allowCrash = true) {
  journal.updated_at = nowIso();
  atomicWrite(path.join(dir, JOURNAL_NAME), `${JSON.stringify(journal, null, 2)}\n`, allowCrash);
}

function findAttempt(journal, runId) {
  return journal.attempts.filter((a) => a && a.run_id === runId)[0] || null;
}

function phaseRecord(attempt, phase) {
  return attempt.phases.filter((p) => p && p.phase === phase)[0] || null;
}

// ── output helpers — one tab-separated line, like lib/telepty-version-policy.js ──

function emit(status, fields, message) {
  process.stdout.write(`${[status, fields.runId || "-", fields.attempt || "-", fields.skip || "-", message].join("\t")}\n`);
}

function fail(message) {
  process.stderr.write(`install-state: ${message}\n`);
  return 1;
}

// ── subcommands ─────────────────────────────────────────────────────────────

function cmdBeginRun(args) {
  const dir = args["--dir"];
  const startPhase = Number(args["--start-phase"]);
  const components = splitCsv(args["--components"]);
  const policy = args["--unknown-effect"] || "refuse";
  if (UNKNOWN_POLICY.indexOf(policy) === -1) {
    return fail(`AIGENTRY_INSTALL_UNKNOWN_EFFECT must be one of ${UNKNOWN_POLICY.join("|")}`);
  }

  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  try { fs.chmodSync(dir, DIR_MODE); } catch (err) { /* pre-existing dir owned by the user */ }

  const read = readJournal(dir);
  if (read.status === "corrupt" || read.status === "unsupported") {
    // Preserved, never rewritten and never degraded to "absent" (F7).
    emit(read.status, {}, `${read.file} is ${read.status} (${read.reason}); it was left untouched and nothing was installed. Inspect or move it aside, then re-run.`);
    return 1;
  }

  // Lock before the first journal write so two installers cannot interleave.
  const lockPath = path.join(dir, LOCK_NAME);
  const runId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  let lockForced = false;
  // True only while this invocation holds a lock it created EXCLUSIVELY and has
  // not yet handed to a successful run. Everything below keys off this.
  let ownsFreshLock = false;
  try {
    const lfd = fs.openSync(lockPath, "wx", FILE_MODE);
    fs.writeFileSync(lfd, `${JSON.stringify({ run_id: runId, pid: process.pid, started_at: nowIso() })}\n`);
    fs.closeSync(lfd);
    ownsFreshLock = true;
  } catch (err) {
    if (err.code !== "EEXIST") return fail(`could not create ${lockPath}: ${err.code || err.message}`);
    if (args["--force-unlock"] !== "1") {
      emit("locked", {}, `${lockPath} exists: another aigentry-devkit installer may be running, so nothing was installed. If you are sure none is, re-run with AIGENTRY_INSTALL_FORCE_UNLOCK=1.`);
      return 1;
    }
    lockForced = true;
    fs.writeFileSync(lockPath, `${JSON.stringify({ run_id: runId, pid: process.pid, started_at: nowIso(), forced: true })}\n`);
    fs.chmodSync(lockPath, FILE_MODE);
    // Deliberately NOT ownsFreshLock: an adopted lock was not created here, so a
    // later failure leaves it in place and the next run needs another explicit
    // force. Safe over convenient (see SPEC §P4.2).
  }

  // Release on a failed hand-off, and ONLY this invocation's own lock. Both
  // conditions must hold: we created it exclusively in this process, and the
  // bytes on disk still carry this run_id. That second condition is a
  // CONTENT-OWNERSHIP check: a run_id is a fresh uuid per invocation, so matching
  // bytes can only have been written by this run, and no in-product path can
  // remove or replace a lock whose run_id does not match (here and in end-run,
  // both gated). It is NOT a proof of inode identity and it does not close the
  // read/unlink TOCTOU: the residual window needs an out-of-band removal (rm)
  // between the readFileSync and the unlinkSync below, and POSIX has no portable
  // atomic unlink-by-inode to close it with. No new lock mechanism is introduced
  // for it. No global unlock, no PID probe, no age-based deletion, no forced
  // removal.
  //
  // Registered as an exit hook because the bounded crash seam uses
  // process.exit(70), which runs no catch or finally — but does run exit hooks.
  // An abrupt kill (SIGKILL) runs nothing and retains the lock by contract.
  const releaseOwnLockOnFailure = () => {
    if (!ownsFreshLock) return;
    try {
      const held = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (held && held.run_id === runId) fs.unlinkSync(lockPath);
    } catch (err) { /* absent, foreign or unreadable — never force-remove */ }
  };
  process.on("exit", releaseOwnLockOnFailure);

  const journal = read.journal || { schema: SCHEMA, updated_at: nowIso(), state_file: path.join(dir, STATE_NAME), attempts: [] };
  sweepTemp(dir, JOURNAL_NAME);

  // A phase left `running` by an earlier run is not running now: it is unknown.
  // This is new durable knowledge about a past attempt, so it is persisted even
  // if this run is about to be refused — the on-disk record must never keep
  // claiming that a dead process is still working.
  let reclassified = false;
  for (const attempt of journal.attempts) {
    if (!attempt || !Array.isArray(attempt.phases)) continue;
    for (const rec of attempt.phases) {
      if (rec && rec.status === "running") {
        rec.status = "unknown";
        rec.detail = rec.detail || "no terminal record was written (interrupted); effect is indeterminate";
        reclassified = true;
      }
    }
    if (attempt.outcome === "running") {
      attempt.outcome = "unknown";
      attempt.ended_at = attempt.ended_at || null;
      reclassified = true;
    }
  }
  if (reclassified) writeJournal(dir, journal);

  // What is still unresolved comes from the one shared fold (see
  // unresolvedPhases): an unknown effect is a question about one phase at one
  // point in time, not a permanent property of the journal, and the journal
  // itself is never edited, reset or pruned to answer it.
  //
  // Only phases this invocation would actually re-execute can be replayed, so
  // only those can block it. This filtering is invocation policy and stays here.
  const blocking = unresolvedPhases(journal).filter((phase) => {
    const meta = PHASES[phase];
    if (!meta || meta.replay !== "unknown") return false;
    if (phase < startPhase) return false;
    return components.indexOf(meta.label) !== -1;
  });

  if (blocking.length && policy === "refuse") {
    const named = blocking.map((p) => `${p} (${PHASES[p].label}, ${PHASES[p].effect})`).join(", ");
    releaseOwnLockOnFailure();
    emit("unknown-effect", {}, `an earlier run was interrupted inside phase ${named} and its external effect is unknown, so nothing was installed. Re-run with AIGENTRY_INSTALL_UNKNOWN_EFFECT=skip to leave it alone, or =replay to run it again.`);
    return 1;
  }

  const attempt = {
    attempt: journal.attempts.length + 1,
    run_id: runId,
    installer: args["--installer"] || "unknown",
    node: process.versions.node,
    started_at: nowIso(),
    ended_at: null,
    outcome: "running",
    profile: args["--profile"] || "",
    components,
    optional_components: splitCsv(args["--optional-components"]),
    resume: {
      requested: args["--resume-raw"] || "",
      start_phase: Number.isInteger(startPhase) ? startPhase : 0,
      resolved_from: args["--resolved-from"] || "none",
    },
    credentials: { registry_api_key: args["--registry-api-key-present"] === "true" ? "redacted" : "absent" },
    phases: [],
  };
  if (lockForced) attempt.lock_forced = true;
  if (blocking.length) attempt.unknown_effect_policy = policy;
  journal.attempts.push(attempt);
  writeJournal(dir, journal);

  // The journal now records this attempt, so the lock belongs to the run: the
  // installer's own trap releases it from here on. Drop ownership BEFORE
  // reporting ok, so nothing on the way out can take it back.
  ownsFreshLock = false;

  const skip = policy === "skip" ? blocking : [];
  emit("ok", { runId, attempt: attempt.attempt, skip: skip.join(",") || "-" },
    skip.length
      ? `recovery journal ready; phase ${skip.join(",")} left untouched (AIGENTRY_INSTALL_UNKNOWN_EFFECT=skip)`
      : "recovery journal ready");
  return 0;
}

function cmdPhaseBegin(args) {
  return mutateAttempt(args, (attempt, phase) => {
    const meta = PHASES[phase] || { label: "unknown", effect: "unknown", replay: "unknown" };
    const existing = phaseRecord(attempt, phase);
    const rec = existing || { phase };
    rec.label = meta.label;
    rec.effect = meta.effect;
    rec.replay = meta.replay;
    rec.status = "running";
    rec.started_at = nowIso();
    delete rec.ended_at;
    delete rec.exit_code;
    delete rec.signal;
    delete rec.degraded;
    delete rec.detail;
    if (!existing) attempt.phases.push(rec);
  });
}

function cmdPhaseEnd(args) {
  const status = args["--status"];
  if (PHASE_STATUS.indexOf(status) === -1) return fail(`--status must be one of ${PHASE_STATUS.join("|")}`);
  return mutateAttempt(args, (attempt, phase) => {
    const meta = PHASES[phase] || { label: "unknown", effect: "unknown", replay: "unknown" };
    const existing = phaseRecord(attempt, phase);
    const rec = existing || { phase, label: meta.label, effect: meta.effect, replay: meta.replay, started_at: nowIso() };
    rec.status = status;
    rec.ended_at = nowIso();
    if (args["--degraded"] === "1") rec.degraded = true;
    if (args["--exit-code"]) rec.exit_code = Number(args["--exit-code"]);
    if (args["--signal"]) rec.signal = args["--signal"];
    if (args["--detail"]) rec.detail = redactText(args["--detail"]);
    if (!existing) attempt.phases.push(rec);
  });
}

function cmdEndRun(args) {
  const outcome = args["--outcome"];
  if (RUN_OUTCOME.indexOf(outcome) === -1) return fail(`--outcome must be one of ${RUN_OUTCOME.join("|")}`);
  const dir = args["--dir"];
  const rc = mutateAttempt(args, (attempt) => {
    attempt.outcome = outcome;
    attempt.ended_at = nowIso();
    if (args["--exit-code"]) attempt.exit_code = Number(args["--exit-code"]);
  }, true);
  // The lock is this run's own temporary artifact: release it on every path,
  // success or failure, even if the journal update itself could not be made.
  if (args["--run"]) {
    try {
      const lockPath = path.join(dir, LOCK_NAME);
      const held = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (held && held.run_id === args["--run"]) fs.unlinkSync(lockPath);
    } catch (err) { /* absent, foreign or unreadable — never force-remove */ }
  }
  return rc;
}

// Shared read-modify-write for the three phase/run mutators.
function mutateAttempt(args, apply, allowPhaseless) {
  const dir = args["--dir"];
  const runId = args["--run"];
  const phase = allowPhaseless && args["--phase"] === undefined ? null : Number(args["--phase"]);
  if (!runId) return fail("--run is required");
  if (phase !== null && !Number.isInteger(phase)) return fail("--phase must be an integer");
  const read = readJournal(dir);
  if (read.status !== "ok") return fail(`${read.file} is ${read.status}; the phase record was not updated`);
  const attempt = findAttempt(read.journal, runId);
  if (!attempt) return fail(`run ${runId} is not in ${read.file}`);
  if (!Array.isArray(attempt.phases)) attempt.phases = [];
  apply(attempt, phase);
  writeJournal(dir, read.journal);
  return 0;
}

function cmdRead(args) {
  const read = readJournal(args["--dir"]);
  // `unresolved_phases` is additive and comes from the one shared fold, so a
  // reader never re-derives it. For a corrupt or unsupported record the honest
  // answer is `null` — unknown — never [], which would read as "nothing is
  // unresolved". Exits are unchanged and nothing is written: read is read-only.
  //
  // Same honesty for a phase still recorded `running`: this path deliberately
  // does not reclassify it the way begin-run does (that would be a write), so
  // the fold reports it as pending instead of dropping it. A reader therefore
  // cannot conclude "nothing is unresolved" from a journal begin-run would
  // refuse. The entry means "not proven resolved" — it is NOT a claim that the
  // writer died, and during a live install it is the expected answer for the
  // phase in flight (review RW-A).
  const unresolved = read.status === "ok" ? unresolvedPhases(read.journal)
    : read.status === "absent" ? []
      : null;
  process.stdout.write(`${JSON.stringify({
    status: read.status,
    reason: read.reason || null,
    unresolved_phases: unresolved,
    journal: read.journal,
  }, null, 2)}\n`);
  return read.status === "ok" || read.status === "absent" ? 0 : 1;
}

// ── install-state.json — redacted, atomic, 0600 ─────────────────────────────

// The state writer is fed a presence boolean, never the key itself (#1147 H1):
// a process that is never given the secret cannot record it.
const ST = (name) => process.env[`AIGENTRY_ST_${name}`] || "";
const stOrNull = (name) => ST(name) || null;
const stBool = (name) => ST(name) === "true";

function buildState() {
  return {
    generated_at: nowIso(),
    schema: "aigentry-devkit/install-state@1",
    profile: ST("PROFILE") || "core",
    manifest_path: ST("MANIFEST"),
    components: splitCsv(ST("COMPONENTS")),
    optional_components: splitCsv(ST("OPTIONAL_COMPONENTS")),
    journal_path: stOrNull("JOURNAL_PATH"),
    telepty: {
      version: stOrNull("TELEPTY_VERSION"),
      base_url: stOrNull("TELEPTY_BASE_URL"),
    },
    deliberation: {
      runtime_path: stOrNull("DELIBERATION_RUNTIME_PATH"),
      doctor_ok: stBool("DELIBERATION_DOCTOR_OK"),
    },
    brain: {
      selected: stBool("BRAIN_SELECTED"),
      package: stOrNull("BRAIN_PACKAGE"),
      profile_root: stOrNull("BRAIN_PROFILE_ROOT"),
      install_mode: stOrNull("BRAIN_INSTALL_MODE"),
      remote_url: stOrNull("BRAIN_REMOTE_URL"),
      project_id: stOrNull("BRAIN_PROJECT_ID"),
    },
    registry: {
      mode: stOrNull("REGISTRY_MODE"),
      api_url: stOrNull("REGISTRY_API_URL"),
      // Deliberately a boolean: the key itself is never passed to this process
      // and never written to disk here (env.sh, mode 600, is its only sink).
      api_key_present: stBool("REGISTRY_API_KEY_PRESENT"),
    },
    dustcraw: {
      selected: stBool("DUSTCRAW_SELECTED"),
      package: stOrNull("DUSTCRAW_PACKAGE"),
      preset: stOrNull("DUSTCRAW_PRESET"),
      config_path: stOrNull("DUSTCRAW_CONFIG_PATH"),
    },
  };
}

function cmdWriteState(args) {
  const file = args["--file"];
  if (!file) return fail("--file is required");
  const state = buildState();
  // Preserve blocks earlier phases already recorded (phase 8's orchestrator
  // block survives a Phase 7 rewrite on a resumed run).
  try {
    const prior = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    if (prior && typeof prior === "object" && !Array.isArray(prior) && prior.orchestrator) {
      state.orchestrator = prior.orchestrator;
    }
  } catch (err) { /* absent or corrupt — a full rewrite is this phase's job */ }
  atomicWrite(file, `${JSON.stringify(state, null, 2)}\n`);
  return 0;
}

// Phase 8's add-only update. A corrupt state file is preserved and reported,
// never silently reset to {} (which is what used to drop prior phases).
function cmdMergeOrchestrator(args) {
  const file = args["--file"];
  if (!file) return fail("--file is required");
  let state = {};
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    state = parsed;
  } catch (err) {
    if (err.code !== "ENOENT") {
      return fail(`${file} is not readable as JSON (${err.message}); it was left untouched and the orchestrator-role outcome was not recorded`);
    }
  }
  state.orchestrator = { status: args["--status"] || "skipped", repo_dir: args["--repo-dir"] || "" };
  atomicWrite(file, `${JSON.stringify(state, null, 2)}\n`);
  return 0;
}

// ── manifest-driven resume lookup (data only, never code) ────────────────────

// Replaces the Function()-based manifest_eval resume path (F5/CWE-94): the
// component name arrives as its own argv element and is looked up as data, so
// no caller input is ever turned into a program.
function cmdResumePhase(args) {
  const manifest = JSON.parse(fs.readFileSync(args["--manifest"], "utf8"));
  const name = args["--component"];
  const components = manifest && manifest.components;
  if (!components || typeof components !== "object" || !Object.prototype.hasOwnProperty.call(components, name)) return 1;
  const phase = components[name] && components[name].phase;
  if (!Number.isInteger(phase)) return 1;
  process.stdout.write(String(phase));
  return 0;
}

// ── misc ────────────────────────────────────────────────────────────────────

function splitCsv(value) {
  return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Journal detail strings come from the installer itself, but never record
// anything that looks like a bearer secret even so.
function redactText(text) {
  return String(text).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 500);
}

const COMMANDS = {
  "begin-run": { fn: cmdBeginRun, flags: ["--dir", "--installer", "--profile", "--components", "--optional-components", "--resume-raw", "--resolved-from", "--start-phase", "--force-unlock", "--unknown-effect", "--registry-api-key-present"] },
  "phase-begin": { fn: cmdPhaseBegin, flags: ["--dir", "--run", "--phase"] },
  "phase-end": { fn: cmdPhaseEnd, flags: ["--dir", "--run", "--phase", "--status", "--degraded", "--exit-code", "--signal", "--detail"] },
  "end-run": { fn: cmdEndRun, flags: ["--dir", "--run", "--outcome", "--exit-code"] },
  read: { fn: cmdRead, flags: ["--dir"] },
  "write-state": { fn: cmdWriteState, flags: ["--file"] },
  "merge-orchestrator": { fn: cmdMergeOrchestrator, flags: ["--file", "--status", "--repo-dir"] },
  "resume-phase": { fn: cmdResumePhase, flags: ["--manifest", "--component"] },
};

function main(argv) {
  const command = COMMANDS[argv[0]];
  if (!command) return fail(`unknown command ${argv[0] || "(none)"}; expected one of ${Object.keys(COMMANDS).join(", ")}`);
  const args = {};
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i];
    if (command.flags.indexOf(key) === -1 || key in args || i + 1 >= argv.length) {
      return fail(`${argv[0]}: invalid arguments`);
    }
    args[key] = argv[i + 1];
  }
  if (command.fn !== cmdResumePhase && !args["--dir"] && !args["--file"]) return fail(`${argv[0]}: --dir is required`);
  try {
    return command.fn(args);
  } catch (err) {
    return fail(`${argv[0]} failed: ${err.message}`);
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

// unresolvedPhases is the integration contract for a reader (#1145): one shared,
// pure definition of "what is still unresolved", so no consumer re-derives it.

// D1 configure-only persistence. No installer execution, phase replay, force
// unlock, credential input or separate journal. Existing fold remains sole
// recovery authority; a phaseless preference attempt cannot resolve a phase.
function validateSetupChoice(value) {
  const profiles = ["core", "orchestrator", "autoresearch-public", "curator-public", "ecosystem-full"];
  const keys = ["profile", "runtime", "outcome", "verification", "plan_digest", "catalogue_revision"];
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join() !== keys.sort().join() ||
      !profiles.includes(value.profile) || !["defer", "native-srt"].includes(value.runtime) ||
      value.outcome !== (value.runtime === "defer" ? "deferred" : "selected") ||
      value.verification !== "not-verified" || value.catalogue_revision !== 1 ||
      !/^[a-f0-9]{64}$/.test(value.plan_digest)) throw Error("invalid setup choice");
  return value;
}

function setupIdentity(file, directory, privateMode) {
  let s;
  try { s = fs.lstatSync(file); } catch (err) {
    if (err.code === "ENOENT") return null;
    throw Error("setup destination unreadable");
  }
  const uid = process.getuid();
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()) ||
      (s.uid !== uid && !(directory && !privateMode && s.uid === 0)) ||
      (privateMode ? (s.mode & 0o777) !== (directory ? DIR_MODE : FILE_MODE) : (s.mode & 0o022) !== 0) ||
      (!directory && (s.nlink !== 1 || s.size > 1024 * 1024))) {
    throw Error("unsafe setup destination ownership/type/mode/size");
  }
  return { dev: s.dev, ino: s.ino, uid: s.uid, mode: s.mode,
    ...(directory ? {} : { size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs }) };
}

function inspectSetupStorage(dir) {
  if (!["darwin", "linux"].includes(process.platform) || typeof process.getuid !== "function") {
    throw Error("setup persistence unavailable: native private storage proof required");
  }
  if (!path.isAbsolute(dir) || path.normalize(dir) !== dir) throw Error("unsafe setup destination");
  const ancestors = [];
  let cursor = path.parse(dir).root;
  for (const part of dir.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    ancestors.push({ path: cursor, identity: setupIdentity(cursor, true, cursor === dir) });
  }
  const journalFile = path.join(dir, JOURNAL_NAME);
  const journalIdentity = setupIdentity(journalFile, false, true);
  // State is not written by setup, but do not mask an unsafe/corrupt existing
  // installer state with a successful preference outcome.
  const stateIdentity = setupIdentity(path.join(dir, STATE_NAME), false, true);
  if (stateIdentity) {
    let state;
    try { state = JSON.parse(fs.readFileSync(path.join(dir, STATE_NAME), "utf8")); }
    catch (_) { throw Error("corrupt setup state; left untouched"); }
    if (!state || state.schema !== "aigentry-devkit/install-state@1") throw Error("unsupported setup state");
  }
  try { fs.lstatSync(path.join(dir, LOCK_NAME)); throw Error("setup journal locked; owner recovery required"); }
  catch (err) { if (err.code !== "ENOENT") throw err; }
  const read = readJournal(dir);
  if (!["ok", "absent"].includes(read.status)) throw Error("setup journal " + read.status + "; left untouched");
  if (read.journal) {
    if (Object.hasOwn(read.journal, "setup")) validateSetupChoice(read.journal.setup);
    for (const a of read.journal.attempts) {
      if (!a || typeof a !== "object" || Array.isArray(a) || !Array.isArray(a.phases)) throw Error("corrupt setup journal attempt");
      if (Object.hasOwn(a, "setup")) validateSetupChoice(a.setup);
      // Validate history before granting write authority; the shared fold still
      // owns recovery semantics. Minimal legacy phase/status records are valid.
      for (const rec of a.phases) {
        if (!rec || typeof rec !== "object" || Array.isArray(rec) ||
            !Number.isInteger(rec.phase) || !PHASE_STATUS.includes(rec.status) ||
            (Object.hasOwn(rec, "degraded") && typeof rec.degraded !== "boolean") ||
            (Object.hasOwn(rec, "exit_code") && !Number.isInteger(rec.exit_code)) ||
            ["label", "effect", "started_at", "ended_at", "signal", "detail"].some(key =>
              Object.hasOwn(rec, key) && typeof rec[key] !== "string") ||
            (Object.hasOwn(rec, "replay") && !["safe", "verified", "unknown"].includes(rec.replay))) {
          throw Error("corrupt setup journal phase; left untouched");
        }
      }
    }
  }
  return { ancestors, journalIdentity, stateIdentity, journal_status: read.status,
    attempts: read.journal ? read.journal.attempts.length : 0,
    unresolved: unresolvedPhases(read.journal), suggestion: read.journal ? read.journal.setup || null : null };
}

function saveSetupChoice(dir, choice, expectedStorage) {
  validateSetupChoice(choice);
  if (JSON.stringify(inspectSetupStorage(dir)) !== JSON.stringify(expectedStorage)) throw Error("stale setup storage");
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // The lock follows the existing writer's exclusive-create convention. Never
  // adopt another writer's lock or reclassify interrupted installer phases.
  const lock = path.join(dir, LOCK_NAME);
  const runId = crypto.randomUUID();
  const fd = fs.openSync(lock, "wx", FILE_MODE);
  try {
    fs.writeFileSync(fd, JSON.stringify({ run_id: runId, pid: process.pid, started_at: nowIso() }) + "\n");
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try {
    if (JSON.stringify(setupIdentity(path.join(dir, JOURNAL_NAME), false, true)) !== JSON.stringify(expectedStorage.journalIdentity)) {
      throw Error("stale setup journal");
    }
    const read = readJournal(dir);
    if (!["ok", "absent"].includes(read.status)) throw Error("setup journal changed");
    const journal = read.journal || { schema: SCHEMA, state_file: path.join(dir, STATE_NAME), attempts: [] };
    const record = { ...choice };
    journal.attempts.push({ attempt: journal.attempts.length + 1, run_id: runId,
      installer: "setup-configure-only", started_at: nowIso(), ended_at: nowIso(),
      outcome: "completed", phases: [], setup: record });
    journal.setup = record;
    // A library save must settle its caller's promise and run finally blocks.
    // Keep the inherited deliberate-exit seam confined to installer writers.
    writeJournal(dir, journal, false);
  } finally {
    try {
      if (JSON.parse(fs.readFileSync(lock, "utf8")).run_id === runId) fs.unlinkSync(lock);
    } catch (_) { /* preserve unknown/foreign lock */ }
  }
}

module.exports = { validateSetupChoice, inspectSetupStorage, saveSetupChoice, PHASES, SCHEMA, readJournal, unresolvedPhases, atomicWrite, JOURNAL_NAME, LOCK_NAME, STATE_NAME };
