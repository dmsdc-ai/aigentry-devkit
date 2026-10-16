// Durable recovery-journal regressions for the real installer (#1147 F6/F7/F8).
//
// Drives `bash install.sh` itself against inert fixtures: a private HOME/XDG/TMP
// per run at mode 0700 with umask 0077, and fake npm/npx/curl/tmux/claude/
// telepty/dustcraw/aigentry-brain first on PATH plus refusing sentinels (exit
// 97) for git/brew/sudo/launchctl/systemctl/apt-get/dnf/yum/pacman/docker/open/
// direnv. Every fake call is logged to state/calls.jsonl, so each row proves
// what the installer did and that no real operation ran. Nothing touches the
// real npm registry, global prefix, daemon, launchd/systemd, services or the
// user's config, and no fake stands in for a missing required product source.
// Credentials are synthetic markers; no host credential is read or migrated.
//
// Coverage (one row or more each): every mutating phase fails independently,
// positive completion, repeated resume, unknown-effect refusal, interrupted
// write, concurrent writer, malformed state, same-byte existing data and
// cleanup observations.
//
// Platform scope (documented, not a blanket skip): `install.sh` is a POSIX
// caller, so these rows run on linux/darwin. On win32 the equivalent is
// install.ps1, whose own recovery rows need a native Windows runner — recorded
// as required CI, never as a local pass.
//
// Run: node --test tests/installer-recovery-1147.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const INSTALL_SH = path.join(REPO, "install.sh");
const JOURNAL_CLI = path.join(REPO, "lib", "install-state.js");

const IS_WIN = process.platform === "win32";
const SKIP_SH = IS_WIN ? "install.sh is a POSIX caller; install.ps1 covers win32 (needs a native runner)" : false;
const RUN_TIMEOUT_MS = 180000;
const KEEP = process.env.AIGENTRY_TEST_KEEP === "1";
const SYNTHETIC_KEY = "SYNTHETIC-ONLY-aigentry-1147-not-a-real-key";

// Private fixture files must not be group/world readable.
process.umask(0o077);

const RECORDERS = ["npm", "npx", "curl", "tmux", "claude", "telepty", "dustcraw", "aigentry-brain"];
const FORBIDDEN = ["git", "brew", "sudo", "launchctl", "systemctl", "apt-get", "dnf", "yum", "pacman", "docker", "open", "direnv"];

// ── inert fake actuator ─────────────────────────────────────────────────────

const FAKE_JS = String.raw`"use strict";
// Inert fake for the #1147 recovery tests. argv: <stateDir> <tool> ...args
// Never performs a real action: it records the call and returns a modelled exit
// code. A tool listed in forbidden.json records the breach and exits 97.
const fs = require("fs");
const path = require("path");
const stateDir = process.argv[2];
const tool = process.argv[3];
const args = process.argv.slice(4);
const st = (n) => path.join(stateDir, n);
const text = (n) => { try { return fs.readFileSync(st(n), "utf8"); } catch (_) { return null; } };
const log = (extra) => fs.appendFileSync(st("calls.jsonl"),
  JSON.stringify(Object.assign({ tool, args, pid: process.pid, t: Date.now() }, extra || {})) + "\n");

const forbidden = JSON.parse(text("forbidden.json") || "[]");
if (forbidden.includes(tool)) {
  log({ forbidden: true });
  process.exitCode = 97;
} else {
  log();
  // exit.<tool> models a failing actuator for one phase at a time.
  const code = text("exit." + tool);
  if (tool === "telepty" && ["--version", "-v", "version"].includes(args[0])) {
    const v = text("telepty.version");
    if (v !== null) process.stdout.write(v + "\n");
  }
  process.exitCode = code ? Number(code.trim()) : 0;
}
`;

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function mkSandbox(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rec1147-${label.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 36)}-`));
  fs.chmodSync(root, 0o700);
  const sb = {
    root,
    home: path.join(root, "home"),
    xdg: path.join(root, "home", ".config"),
    tmp: path.join(root, "tmp"),
    fakebin: path.join(root, "fakebin"),
    state: path.join(root, "state"),
    fakeJs: path.join(root, "fake.js"),
    log: path.join(root, "run.log"),
  };
  sb.stateDir = path.join(sb.xdg, "aigentry-devkit");
  sb.journal = path.join(sb.stateDir, "install-journal.json");
  sb.lock = path.join(sb.stateDir, "install-journal.lock");
  sb.stateFile = path.join(sb.stateDir, "install-state.json");
  for (const d of [sb.home, sb.xdg, sb.tmp, sb.fakebin, sb.state]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(sb.fakeJs, FAKE_JS);
  fs.writeFileSync(path.join(sb.state, "calls.jsonl"), "");
  fs.writeFileSync(path.join(sb.state, "forbidden.json"), JSON.stringify(FORBIDDEN));
  sb.tools = new Set();
  for (const t of [...RECORDERS, ...FORBIDDEN]) addTool(sb, t);
  // The pinned runtime: `node` must resolve to this very interpreter.
  writeShim(sb, "node", process.execPath);
  sb.cleanup = () => { if (!KEEP) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); };
  return sb;
}

function writeShim(sb, name, target) {
  const p = path.join(sb.fakebin, name);
  fs.writeFileSync(p, `#!/bin/sh\nexec ${sq(target)} "$@"\n`);
  fs.chmodSync(p, 0o700);
}

function addTool(sb, tool) {
  const p = path.join(sb.fakebin, tool);
  fs.writeFileSync(p, `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(sb.fakeJs)} ${sq(sb.state)} ${tool} "$@"\n`);
  fs.chmodSync(p, 0o700);
  sb.tools.add(tool);
}

function dropTool(sb, tool) {
  fs.rmSync(path.join(sb.fakebin, tool), { force: true });
  sb.tools.delete(tool);
}

// Model one actuator failing, which is how a phase is made to fail on its own.
function failTool(sb, tool, code = 1) {
  fs.writeFileSync(path.join(sb.state, `exit.${tool}`), String(code));
}

// Phase 8 uses git by design, so for those rows git stops being a sentinel and
// becomes an inert recorder with a modelled exit code. It still never reaches a
// network or a real repository: the fake only appends to calls.jsonl.
function allowTool(sb, tool, code) {
  fs.writeFileSync(path.join(sb.state, "forbidden.json"), JSON.stringify(FORBIDDEN.filter((t) => t !== tool)));
  addTool(sb, tool);
  if (code !== undefined) failTool(sb, tool, code);
}

function calls(sb) {
  const p = path.join(sb.state, "calls.jsonl");
  return (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function runInstaller(sb, opts = {}) {
  const env = {
    HOME: sb.home,
    XDG_CONFIG_HOME: sb.xdg,
    TMPDIR: sb.tmp,
    PATH: [sb.fakebin, "/usr/bin", "/bin"].join(path.delimiter),
    LANG: "C",
    TERM: "dumb",
    USER: "fixture",
    LOGNAME: "fixture",
    AIGENTRY_LOGGER_DISABLED: "1",
    // Unreachable endpoints: a real npm/curl escaping the fakes could not phone home.
    AIGENTRY_TELEPTY_URL: "http://127.0.0.1:9",
    npm_config_registry: "http://127.0.0.1:9/",
    npm_config_offline: "true",
    AIGENTRY_INSTALL_COMPONENTS: opts.components === undefined ? "devkit-core" : opts.components,
    // Nothing may prompt: every interactive knob is pre-filled.
    AIGENTRY_BRAIN_PROJECT_ID: "fixture",
    AIGENTRY_BRAIN_INSTALL_MODE: "local",
    AIGENTRY_DUSTCRAW_PRESET: "tech-business",
    AIGENTRY_DUSTCRAW_RUN_DEMO: "no",
    AIGENTRY_DUSTCRAW_ENABLE_SERVICE: "no",
    AIGENTRY_REGISTRY_MODE: "skip",
    AIGENTRY_SKIP_DAEMON: "1",
    ...(opts.env || {}),
  };
  if (opts.resume !== undefined) env.AIGENTRY_INSTALL_RESUME = String(opts.resume);
  const r = spawnSync("/bin/bash", [INSTALL_SH], {
    cwd: sb.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: RUN_TIMEOUT_MS,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  fs.writeFileSync(sb.log, out);
  return { code: r.status, signal: r.signal, out, plain: out.replace(/\x1b\[[0-9;]*m/g, "") };
}

// ── journal readers ─────────────────────────────────────────────────────────

function journal(sb) {
  assert.ok(fs.existsSync(sb.journal), `no journal at ${sb.journal}`);
  return JSON.parse(fs.readFileSync(sb.journal, "utf8"));
}
const lastAttempt = (sb) => { const j = journal(sb); return j.attempts[j.attempts.length - 1]; };
const phaseOf = (attempt, n) => attempt.phases.filter((p) => p.phase === n)[0] || null;
const modeOf = (p) => (fs.statSync(p).mode & 0o777).toString(8);

function describe(sb, r) {
  let summary = "ABSENT";
  if (fs.existsSync(sb.journal)) {
    try {
      summary = JSON.stringify(journal(sb).attempts.map((a) => [a.attempt, a.outcome,
        a.phases.map((p) => `${p.phase}:${p.status}${p.degraded ? "+degraded" : ""}`).join(" ")]));
    } catch (err) {
      summary = `UNPARSEABLE(${fs.statSync(sb.journal).size} bytes)`;
    }
  }
  return [
    `exit=${r.code} signal=${r.signal}`,
    `journal=${summary}`,
    `calls=${JSON.stringify(calls(sb).map((c) => `${c.tool} ${c.args.join(" ")}`))}`,
    r.plain.split("\n").slice(-25).join("\n"),
  ].join("\n");
}

// Every row asserts this: no sentinel tool was ever reached.
function assertNoRealActuator(sb, r) {
  const breached = calls(sb).filter((c) => c.forbidden);
  assert.deepEqual(breached.map((c) => c.tool), [], `a refusing sentinel was reached\n${describe(sb, r)}`);
}

// Phase 8 must only ever look inside the sandbox.
function orchEnv(sb) {
  return {
    AIGENTRY_PROJECTS_ROOT: path.join(sb.root, "projects"),
    AIGENTRY_ORCH_DIR: path.join(sb.root, "projects", "aigentry-orchestrator"),
    AIGENTRY_ORCH_BUILD: "true",
    AIGENTRY_HOME: path.join(sb.home, ".aigentry"),
  };
}

function hashTree(dir) {
  const h = crypto.createHash("sha256");
  const walk = (p, rel) => {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) {
      for (const n of fs.readdirSync(p).sort()) walk(path.join(p, n), `${rel}/${n}`);
    } else if (st.isSymbolicLink()) {
      h.update(`L ${rel} ${fs.readlinkSync(p)}\n`);
    } else {
      h.update(`F ${rel} ${(st.mode & 0o777).toString(8)} `);
      h.update(fs.readFileSync(p));
      h.update("\n");
    }
  };
  if (fs.existsSync(dir)) walk(dir, "");
  return h.digest("hex");
}

// ── 1. every mutating phase fails independently ─────────────────────────────

// Phase 1 is made to fail by a destination this user cannot write into, which
// is a local, sandbox-owned condition — no actuator and no privilege involved.
test("phase 1 failure is recorded before the installer dies", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("phase1-fail");
  try {
    const skills = path.join(sb.home, ".claude", "skills");
    fs.mkdirSync(skills, { recursive: true });
    fs.chmodSync(skills, 0o500);
    const r = runInstaller(sb, { components: "devkit-core" });
    fs.chmodSync(skills, 0o700);
    const d = describe(sb, r);

    assert.notEqual(r.code, 0, `phase 1 must fail this row\n${d}`);
    const a = lastAttempt(sb);
    assert.equal(phaseOf(a, 0).status, "completed", d);
    assert.equal(phaseOf(a, 1).status, "failed", `phase 1 must be recorded failed, not absent\n${d}`);
    assert.equal(phaseOf(a, 1).exit_code, r.code, d);
    assert.equal(a.outcome, "failed", d);
    // Later phases were never entered: absence, not a false "completed".
    assert.equal(phaseOf(a, 7), null, `phase 7 must have no record\n${d}`);
    assertNoRealActuator(sb, r);
  } finally { sb.cleanup(); }
});

test("phase 2 failure is recorded after phase 1 already mutated HOME", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("phase2-fail");
  try {
    dropTool(sb, "telepty");       // absent telepty -> the policy decides "install"
    failTool(sb, "npm", 1);        // ... and npm fails
    const r = runInstaller(sb, { components: "devkit-core,telepty" });
    const d = describe(sb, r);

    assert.notEqual(r.code, 0, d);
    assert.ok(r.plain.includes("npm install -g"), `phase 2 must have reached npm\n${d}`);
    // The exact F6 reproduction: phase 1 really did write into HOME.
    assert.ok(fs.readdirSync(path.join(sb.home, ".claude", "skills")).length > 0, `phase 1 mutated HOME\n${d}`);
    const a = lastAttempt(sb);
    assert.equal(phaseOf(a, 1).status, "completed", d);
    assert.equal(phaseOf(a, 2).status, "failed", `the mutated-but-failed phase must be recorded\n${d}`);
    assert.equal(a.outcome, "failed", d);
    assert.equal(modeOf(sb.journal), "600", `journal must not be group/world readable\n${d}`);
    assertNoRealActuator(sb, r);
  } finally { sb.cleanup(); }
});

test("phase 3 failure is recorded and stops the run", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("phase3-fail");
  try {
    failTool(sb, "npx", 1);
    const r = runInstaller(sb, { components: "deliberation", resume: 3 });
    const d = describe(sb, r);

    assert.notEqual(r.code, 0, d);
    const a = lastAttempt(sb);
    assert.equal(phaseOf(a, 3).status, "failed", d);
    assert.equal(phaseOf(a, 3).replay, "unknown", `phase 3 is an unobservable external effect\n${d}`);
    assert.equal(phaseOf(a, 7), null, `phase 7 must not be recorded on a failed run\n${d}`);
    assertNoRealActuator(sb, r);
  } finally { sb.cleanup(); }
});

// Phases 4/5/6 are soft by design (warn + continue). They must be recorded as
// completed-but-degraded, never as a clean completion.
for (const row of [
  { phase: 4, components: "brain", tool: "npm", needle: "aigentry-brain install failed" },
  { phase: 5, components: "dustcraw", tool: "dustcraw", needle: "dustcraw init failed" },
]) {
  test(`phase ${row.phase} soft failure is recorded as degraded`, { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
    const sb = mkSandbox(`phase${row.phase}-degraded`);
    try {
      failTool(sb, row.tool, 1);
      const r = runInstaller(sb, { components: row.components, resume: row.phase });
      const d = describe(sb, r);

      assert.equal(r.code, 0, `soft policy keeps the installer alive\n${d}`);
      assert.ok(r.plain.includes(row.needle), `expected the soft failure to be reported\n${d}`);
      const a = lastAttempt(sb);
      const p = phaseOf(a, row.phase);
      assert.equal(p.status, "completed", d);
      assert.equal(p.degraded, true, `a soft failure must not read as a clean completion\n${d}`);
      assert.ok(p.detail && p.detail.length > 0, `the reason must be recorded\n${d}`);
      assert.equal(a.outcome, "completed", d);
      assertNoRealActuator(sb, r);
    } finally { sb.cleanup(); }
  });
}

test("phase 6 records a degraded registry wiring without storing the key", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("phase6-degraded");
  try {
    failTool(sb, "curl", 1); // the smoke test fails
    const r = runInstaller(sb, {
      components: "registry-wiring",
      resume: 6,
      env: { AIGENTRY_REGISTRY_MODE: "cloud", AIGENTRY_API_URL: "http://127.0.0.1:9", AIGENTRY_API_KEY: SYNTHETIC_KEY },
    });
    const d = describe(sb, r);

    assert.equal(r.code, 0, d);
    const a = lastAttempt(sb);
    assert.equal(phaseOf(a, 6).status, "completed", d);
    assert.equal(phaseOf(a, 6).degraded, true, d);
    assert.equal(phaseOf(a, 6).replay, "unknown", `tenant bootstrap must be classed unreplayable\n${d}`);
    // Redaction: a marker, never the payload — in the journal or the state file.
    assert.equal(a.credentials.registry_api_key, "redacted", d);
    assert.ok(!fs.readFileSync(sb.journal, "utf8").includes(SYNTHETIC_KEY), `the journal must not contain the key\n${d}`);
    assert.ok(!fs.readFileSync(sb.stateFile, "utf8").includes(SYNTHETIC_KEY), `install-state must not contain the key\n${d}`);
    const state = JSON.parse(fs.readFileSync(sb.stateFile, "utf8"));
    assert.equal(state.registry.api_key_present, true, `presence is recorded instead\n${d}`);
    assert.equal(state.registry.api_key, undefined, `the plaintext field must be gone\n${d}`);
    assertNoRealActuator(sb, r);
  } finally { sb.cleanup(); }
});

// ── 2. positive completion ──────────────────────────────────────────────────

test("a completed run records every selected phase and nothing else", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("positive");
  try {
    const r = runInstaller(sb, { components: "devkit-core" });
    const d = describe(sb, r);

    assert.equal(r.code, 0, d);
    const a = lastAttempt(sb);
    assert.equal(a.outcome, "completed", d);
    assert.deepEqual(a.phases.map((p) => [p.phase, p.status]), [[0, "completed"], [1, "completed"], [7, "completed"]],
      `only the selected phases may be recorded\n${d}`);
    assert.equal(a.installer, "install.sh", d);
    assert.equal(a.node, process.versions.node, `the record must name the runtime that ran\n${d}`);
    assert.equal(modeOf(sb.stateFile), "600", d);
    assert.equal(modeOf(sb.journal), "600", d);
    assert.equal(modeOf(sb.stateDir), "700", d);
    // The state file still carries what its existing readers rely on.
    const state = JSON.parse(fs.readFileSync(sb.stateFile, "utf8"));
    assert.deepEqual(state.components, ["devkit-core"], d);
    assert.equal(state.profile, "core", d);
    assert.equal(state.journal_path, sb.journal, `the state file points at the journal\n${d}`);
    assertNoRealActuator(sb, r);
  } finally { sb.cleanup(); }
});

// ── 3. repeated resume ──────────────────────────────────────────────────────

test("resuming after a failure appends an attempt and keeps the earlier one", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("repeated-resume");
  try {
    failTool(sb, "npx", 1);
    const first = runInstaller(sb, { components: "deliberation", resume: 3 });
    assert.notEqual(first.code, 0, describe(sb, first));
    const firstAttempt = JSON.stringify(journal(sb).attempts[0]);

    // Same cause fixed, resumed by NAME this time (the F5 lookup path).
    fs.rmSync(path.join(sb.state, "exit.npx"));
    const second = runInstaller(sb, { components: "deliberation", resume: "deliberation", env: { AIGENTRY_INSTALL_UNKNOWN_EFFECT: "replay" } });
    const d = describe(sb, second);
    assert.equal(second.code, 0, d);

    const j = journal(sb);
    assert.equal(j.attempts.length, 2, `each attempt is its own record\n${d}`);
    assert.equal(JSON.stringify(j.attempts[0]), firstAttempt, `the earlier attempt must be preserved verbatim\n${d}`);
    assert.equal(j.attempts[1].attempt, 2, d);
    assert.equal(j.attempts[1].resume.requested, "deliberation", d);
    assert.equal(j.attempts[1].resume.start_phase, 3, `named resume resolves to the manifest phase\n${d}`);
    assert.equal(j.attempts[1].resume.resolved_from, "component", d);
    assert.equal(phaseOf(j.attempts[1], 3).status, "completed", d);
    // A third, clean run is still possible: nothing is left locked.
    assert.ok(!fs.existsSync(sb.lock), `the lock must be released\n${d}`);
    assertNoRealActuator(sb, second);
  } finally { sb.cleanup(); }
});

// ── 4. unknown-effect refusal ───────────────────────────────────────────────

// A SIGKILL cannot run any handler, so the phase stays `running` on disk. The
// next run must reclassify it unknown and refuse to replay an effect it cannot
// observe — not silently redo a tenant bootstrap or an external init.
function seedInterrupted(sb, phase, components) {
  const begin = spawnSync(process.execPath, [JOURNAL_CLI, "begin-run", "--dir", sb.stateDir,
    "--installer", "install.sh", "--profile", "core", "--components", components, "--start-phase", "0"], { encoding: "utf8" });
  assert.equal(begin.status, 0, begin.stderr);
  const runId = begin.stdout.split("\t")[1];
  assert.equal(spawnSync(process.execPath, [JOURNAL_CLI, "phase-begin", "--dir", sb.stateDir,
    "--run", runId, "--phase", String(phase)], { encoding: "utf8" }).status, 0);
  fs.rmSync(sb.lock, { force: true }); // the killed process left no handler to run
  return runId;
}

test("an interrupted unknown-effect phase is refused, not replayed", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("unknown-refuse");
  try {
    seedInterrupted(sb, 6, "registry-wiring");
    const r = runInstaller(sb, { components: "registry-wiring", resume: 6, env: { AIGENTRY_REGISTRY_MODE: "cloud" } });
    const d = describe(sb, r);

    assert.notEqual(r.code, 0, `an unknown external effect must stop the run\n${d}`);
    assert.ok(/interrupted inside phase 6/.test(r.plain), `the refusal must name the phase\n${d}`);
    assert.ok(/AIGENTRY_INSTALL_UNKNOWN_EFFECT/.test(r.plain), `the refusal must name the escape\n${d}`);
    assert.deepEqual(calls(sb), [], `nothing may run before the refusal\n${d}`);
    assert.ok(!fs.existsSync(sb.lock), `a refusal must not leave the lock behind\n${d}`);
    // The interrupted record is reclassified, kept, and never deleted.
    const a = journal(sb).attempts[0];
    assert.equal(phaseOf(a, 6).status, "unknown", d);
    assert.equal(a.outcome, "unknown", d);
  } finally { sb.cleanup(); }
});

test("=skip leaves the unknown phase alone, =replay re-runs it", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("unknown-skip");
  try {
    seedInterrupted(sb, 5, "dustcraw");
    const skipped = runInstaller(sb, { components: "dustcraw", resume: 5, env: { AIGENTRY_INSTALL_UNKNOWN_EFFECT: "skip" } });
    let d = describe(sb, skipped);
    assert.equal(skipped.code, 0, d);
    assert.deepEqual(calls(sb).filter((c) => c.tool === "npm"), [], `=skip must not re-install dustcraw\n${d}`);
    assert.equal(phaseOf(lastAttempt(sb), 5), null, `the skipped phase runs nothing in this attempt\n${d}`);
    assert.equal(journal(sb).attempts[0].phases[0].status, "unknown", `the unknown record stays unknown\n${d}`);

    const replayed = runInstaller(sb, { components: "dustcraw", resume: 5, env: { AIGENTRY_INSTALL_UNKNOWN_EFFECT: "replay" } });
    d = describe(sb, replayed);
    assert.equal(replayed.code, 0, d);
    assert.equal(phaseOf(lastAttempt(sb), 5).status, "completed", `=replay really re-runs the phase\n${d}`);
    assert.ok(calls(sb).some((c) => c.tool === "npm"), `=replay reaches the actuator\n${d}`);
    assertNoRealActuator(sb, replayed);
  } finally { sb.cleanup(); }
});

test("a replay-safe interrupted phase does not need an acknowledgement", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("unknown-safe");
  try {
    seedInterrupted(sb, 1, "devkit-core"); // local, existence-guarded copies
    const r = runInstaller(sb, { components: "devkit-core" });
    const d = describe(sb, r);
    assert.equal(r.code, 0, `a replay-safe phase must not block the run\n${d}`);
    assert.equal(phaseOf(lastAttempt(sb), 1).status, "completed", d);
  } finally { sb.cleanup(); }
});

// ── 5. interrupted write ────────────────────────────────────────────────────

test("a crash between write and rename leaves the previous record intact", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("interrupted-write");
  try {
    const first = runInstaller(sb, { components: "devkit-core" });
    assert.equal(first.code, 0, describe(sb, first));
    const beforeBytes = fs.readFileSync(sb.journal);

    // The bounded test seam: die exactly between the temp write and the rename.
    const crashed = runInstaller(sb, { components: "devkit-core", env: { AIGENTRY_INSTALL_JOURNAL_CRASH: "before-rename" } });
    const d = describe(sb, crashed);
    assert.notEqual(crashed.code, 0, `the crashed write must not report success\n${d}`);

    // The live file is byte-identical and still valid: rename is atomic.
    assert.deepEqual(fs.readFileSync(sb.journal), beforeBytes, `the live journal was modified by a torn write\n${d}`);
    assert.equal(journal(sb).attempts.length, 1, d);
    const temps = fs.readdirSync(sb.stateDir).filter((n) => n.startsWith("install-journal.json.tmp-"));
    assert.equal(temps.length, 1, `the unfinished temp file is the only residue: ${JSON.stringify(temps)}\n${d}`);

    // The next run sweeps its own residue and proceeds (the lock the crashed run
    // could not release is the documented explicit-unlock path).
    const next = runInstaller(sb, { components: "devkit-core", env: { AIGENTRY_INSTALL_FORCE_UNLOCK: "1" } });
    assert.equal(next.code, 0, describe(sb, next));
    assert.deepEqual(fs.readdirSync(sb.stateDir).filter((n) => n.includes(".tmp-")), [], `temp residue must be swept`);
    assert.equal(lastAttempt(sb).lock_forced, true, `forcing the lock must be recorded`);
  } finally { sb.cleanup(); }
});

test("a corrupt journal is preserved and refused, never read as absent", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("corrupt-journal");
  try {
    const first = runInstaller(sb, { components: "devkit-core" });
    assert.equal(first.code, 0, describe(sb, first));
    // Truncate it the way an interrupted non-atomic write used to.
    const torn = fs.readFileSync(sb.journal).subarray(0, 120);
    fs.writeFileSync(sb.journal, torn);

    const r = runInstaller(sb, { components: "devkit-core" });
    const d = describe(sb, r);
    assert.notEqual(r.code, 0, `a torn record must not be treated as "nothing installed"\n${d}`);
    assert.ok(/is corrupt/.test(r.plain), `the refusal must say what is wrong\n${d}`);
    assert.deepEqual(fs.readFileSync(sb.journal), torn, `the corrupt bytes must be preserved for inspection\n${d}`);
    assert.deepEqual(calls(sb), [], `nothing may run after the refusal\n${d}`);
  } finally { sb.cleanup(); }
});

test("a journal from a newer schema is refused rather than rewritten", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("future-schema");
  try {
    fs.mkdirSync(sb.stateDir, { recursive: true });
    const future = `${JSON.stringify({ schema: "aigentry-devkit/install-journal@99", attempts: [] }, null, 2)}\n`;
    fs.writeFileSync(sb.journal, future);
    const r = runInstaller(sb, { components: "devkit-core" });
    const d = describe(sb, r);
    assert.notEqual(r.code, 0, d);
    assert.ok(/unsupported|newer/.test(r.plain), `the refusal must explain the schema\n${d}`);
    assert.equal(fs.readFileSync(sb.journal, "utf8"), future, `a future record must be left alone\n${d}`);
  } finally { sb.cleanup(); }
});

// Unit-level crash points: the two remaining transaction boundaries.
test("the writer's transaction boundaries behave as declared", () => {
  const sb = mkSandbox("crash-unit");
  try {
    const begin = (crash) => spawnSync(process.execPath, [JOURNAL_CLI, "begin-run", "--dir", sb.stateDir,
      "--installer", "install.sh", "--components", "devkit-core", "--start-phase", "0"],
      { encoding: "utf8", env: { ...process.env, ...(crash ? { AIGENTRY_INSTALL_JOURNAL_CRASH: crash } : {}) } });

    // after-tmp-write: nothing is visible at the live path yet.
    const a = begin("after-tmp-write");
    assert.equal(a.status, 70, a.stderr);
    assert.equal(fs.existsSync(sb.journal), false, "no live file may exist before the rename");
    fs.rmSync(sb.lock, { force: true });
    for (const n of fs.readdirSync(sb.stateDir)) fs.rmSync(path.join(sb.stateDir, n), { force: true });

    // after-rename: the record is complete and parseable.
    const b = begin("after-rename");
    assert.equal(b.status, 70, b.stderr);
    const j = JSON.parse(fs.readFileSync(sb.journal, "utf8"));
    assert.equal(j.schema, "aigentry-devkit/install-journal@1");
    assert.equal(j.attempts.length, 1);
    assert.equal(modeOf(sb.journal), "600");
  } finally { sb.cleanup(); }
});

// ── 6. concurrent writer ────────────────────────────────────────────────────

test("a second writer is refused while a lock is held, and the override is recorded", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("concurrent");
  try {
    fs.mkdirSync(sb.stateDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(sb.lock, `${JSON.stringify({ run_id: "other-installer", pid: 999999 })}\n`);

    const blocked = runInstaller(sb, { components: "devkit-core" });
    let d = describe(sb, blocked);
    assert.notEqual(blocked.code, 0, `a possibly-live second writer must be refused\n${d}`);
    assert.ok(/another aigentry-devkit installer may be running/.test(blocked.plain), d);
    assert.deepEqual(calls(sb), [], `nothing may run while refused\n${d}`);
    assert.ok(fs.existsSync(sb.lock), `the other writer's lock must not be stolen\n${d}`);
    assert.equal(fs.existsSync(sb.journal), false, `no record is written for a refused run\n${d}`);

    const forced = runInstaller(sb, { components: "devkit-core", env: { AIGENTRY_INSTALL_FORCE_UNLOCK: "1" } });
    d = describe(sb, forced);
    assert.equal(forced.code, 0, d);
    assert.equal(lastAttempt(sb).lock_forced, true, `the override must be auditable\n${d}`);
    assert.ok(!fs.existsSync(sb.lock), `a completed run releases the lock\n${d}`);
    assertNoRealActuator(sb, forced);
  } finally { sb.cleanup(); }
});

// ── 7. malformed install-state (phase 8's add-only update) ──────────────────

test("phase 8 preserves a malformed install-state instead of resetting it", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("malformed-state");
  try {
    allowTool(sb, "git", 1); // inert git: the clone fails without touching a network
    fs.mkdirSync(sb.stateDir, { recursive: true, mode: 0o700 });
    const malformed = '{"profile":"core","components":["devkit-core"],';
    fs.writeFileSync(sb.stateFile, malformed);

    const r = runInstaller(sb, { components: "orchestrator-role", resume: "orchestrator-role", env: orchEnv(sb) });
    const d = describe(sb, r);
    assert.equal(r.code, 0, `phase 8 keeps its soft policy\n${d}`);
    assert.ok(/could not record the orchestrator-role outcome|not readable as JSON/.test(r.plain),
      `the failure must be reported, not swallowed\n${d}`);
    assert.equal(fs.readFileSync(sb.stateFile, "utf8"), malformed, `the unparseable bytes must survive\n${d}`);
    assert.equal(phaseOf(lastAttempt(sb), 8).status, "completed", d);
    assertNoRealActuator(sb, r);
  } finally { sb.cleanup(); }
});

test("phase 8 still records its outcome into a healthy install-state", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("state-merge");
  try {
    allowTool(sb, "git", 1);
    const r = runInstaller(sb, { components: "orchestrator-role", resume: "orchestrator-role", env: orchEnv(sb) });
    const d = describe(sb, r);
    assert.equal(r.code, 0, d);
    const state = JSON.parse(fs.readFileSync(sb.stateFile, "utf8"));
    // The soft-degrade outcome of an unreachable clone, recorded under the key
    // tests/orchestrator-profile.test.js already relies on.
    assert.equal(state.orchestrator.status, "degraded", `the existing orchestrator contract is kept\n${d}`);
    assert.equal(state.orchestrator.repo_dir, path.join(sb.root, "projects", "aigentry-orchestrator"), d);
    assert.ok(calls(sb).some((c) => c.tool === "git"), `the inert git fake is what ran\n${d}`);
    assert.equal(modeOf(sb.stateFile), "600", d);
  } finally { sb.cleanup(); }
});

test("a later phase 7 rewrite keeps the orchestrator block a previous phase wrote", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("state-preserve");
  try {
    allowTool(sb, "git", 1);
    const eight = runInstaller(sb, { components: "orchestrator-role", resume: "orchestrator-role", env: orchEnv(sb) });
    assert.equal(eight.code, 0, describe(sb, eight));
    const seven = runInstaller(sb, { components: "devkit-core" });
    const d = describe(sb, seven);
    assert.equal(seven.code, 0, d);
    const state = JSON.parse(fs.readFileSync(sb.stateFile, "utf8"));
    assert.ok(state.orchestrator, `phase 7 must not drop an earlier phase's record\n${d}`);
    assert.deepEqual(state.components, ["devkit-core"], d);
  } finally { sb.cleanup(); }
});

// ── 8. same-byte existing data ──────────────────────────────────────────────

test("a re-run leaves pre-existing user data byte-identical", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("same-byte");
  try {
    // Pre-existing settings, a hand-edited skill and an unrelated file.
    const claude = path.join(sb.home, ".claude");
    fs.mkdirSync(path.join(claude, "skills", "deliberation"), { recursive: true });
    fs.writeFileSync(path.join(claude, "settings.json"), '{"mine":true}\n');
    fs.writeFileSync(path.join(claude, "skills", "deliberation", "SKILL.md"), "# hand edited\n");
    fs.mkdirSync(path.join(sb.home, "unrelated"), { recursive: true });
    fs.writeFileSync(path.join(sb.home, "unrelated", "keep.txt"), "do not touch\n");

    const first = runInstaller(sb, { components: "devkit-core" });
    assert.equal(first.code, 0, describe(sb, first));
    const settings = fs.readFileSync(path.join(claude, "settings.json"));
    const edited = fs.readFileSync(path.join(claude, "skills", "deliberation", "SKILL.md"));
    const unrelated = hashTree(path.join(sb.home, "unrelated"));
    const skillsTree = hashTree(path.join(claude, "skills"));

    const second = runInstaller(sb, { components: "devkit-core" });
    const d = describe(sb, second);
    assert.equal(second.code, 0, `a re-run must stay idempotent\n${d}`);
    assert.deepEqual(fs.readFileSync(path.join(claude, "settings.json")), settings, `settings.json was rewritten\n${d}`);
    assert.deepEqual(fs.readFileSync(path.join(claude, "skills", "deliberation", "SKILL.md")), edited, `a hand-edited skill was overwritten without --force\n${d}`);
    assert.equal(hashTree(path.join(sb.home, "unrelated")), unrelated, `unrelated user data was touched\n${d}`);
    assert.equal(hashTree(path.join(claude, "skills")), skillsTree, `the skills tree changed on a no-op re-run\n${d}`);
    assert.equal(journal(sb).attempts.length, 2, `both attempts are recorded\n${d}`);
    assert.equal(journal(sb).attempts[0].outcome, "completed", `the first attempt is preserved\n${d}`);
    assertNoRealActuator(sb, second);
  } finally { sb.cleanup(); }
});

// ── 9. cleanup observations ─────────────────────────────────────────────────

for (const row of [
  { id: "success", failInit: false },
  { id: "failure", failInit: true },
]) {
  test(`the credential-bearing temp config is removed on the ${row.id} path`, { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
    const sb = mkSandbox(`cleanup-${row.id}`);
    try {
      if (row.failInit) failTool(sb, "dustcraw", 1);
      const r = runInstaller(sb, {
        components: "dustcraw",
        resume: 5,
        env: { AIGENTRY_API_KEY: SYNTHETIC_KEY, AIGENTRY_API_URL: "http://127.0.0.1:9" },
      });
      const d = describe(sb, r);
      assert.equal(r.code, 0, d);

      // It really was created and handed to dustcraw init ...
      const init = calls(sb).filter((c) => c.tool === "dustcraw" && c.args[0] === "init");
      assert.equal(init.length, 1, `dustcraw init must have run\n${d}`);
      const cfgPath = init[0].args[init[0].args.indexOf("--config") + 1];
      assert.ok(cfgPath && cfgPath.startsWith(sb.tmp), `the config must live in the private TMPDIR: ${cfgPath}\n${d}`);
      // ... and it is gone afterwards, on both paths.
      assert.equal(fs.existsSync(cfgPath), false, `the credential-bearing temp file survived\n${d}`);
      assert.deepEqual(fs.readdirSync(sb.tmp).filter((n) => n.startsWith("dustcraw-config.")), [],
        `no dustcraw config may remain in TMPDIR\n${d}`);
      // No stale pointer to a deleted credential file is recorded either.
      assert.equal(JSON.parse(fs.readFileSync(sb.stateFile, "utf8")).dustcraw.config_path, null, d);
      // Run-owned artifacts are released.
      assert.ok(!fs.existsSync(sb.lock), `the lock must be released\n${d}`);
      assert.deepEqual(fs.readdirSync(sb.stateDir).filter((n) => n.includes(".tmp-")), [], `no temp residue\n${d}`);
      assertNoRealActuator(sb, r);
    } finally { sb.cleanup(); }
  });
}

// ── fixture preconditions (the rows above only mean something if these hold) ──

test("fixture precondition: the installer resolves only fakes and the pinned node", { skip: SKIP_SH, timeout: 60000 }, () => {
  const sb = mkSandbox("precondition");
  try {
    const probe = spawnSync("/bin/bash", ["-c", "command -v npm; command -v node; command -v telepty; command -v git"], {
      env: { HOME: sb.home, PATH: [sb.fakebin, "/usr/bin", "/bin"].join(path.delimiter) },
      encoding: "utf8", timeout: 30000,
    });
    const lines = probe.stdout.trim().split("\n");
    assert.equal(lines[0], path.join(sb.fakebin, "npm"), `npm must resolve into the fixture: ${probe.stdout}`);
    assert.equal(lines[1], path.join(sb.fakebin, "node"));
    assert.equal(lines[2], path.join(sb.fakebin, "telepty"));
    assert.equal(lines[3], path.join(sb.fakebin, "git"), "git must resolve to the refusing sentinel");
    // The pinned node is this interpreter, not whatever is on the host PATH.
    const v = spawnSync(path.join(sb.fakebin, "node"), ["-p", "process.version"], { encoding: "utf8" });
    assert.equal(v.stdout.trim(), process.version);
    for (const dir of ["/usr/bin", "/bin"]) {
      assert.ok(!fs.existsSync(path.join(dir, "telepty")), `${dir}/telepty would defeat these rows`);
      assert.ok(!fs.existsSync(path.join(dir, "dustcraw")), `${dir}/dustcraw would defeat these rows`);
    }
  } finally { sb.cleanup(); }
});

test("design guard: the journal writer uses no lock syscall, signal or host PID probe", () => {
  const lib = fs.readFileSync(JOURNAL_CLI, "utf8");
  const sh = fs.readFileSync(INSTALL_SH, "utf8");
  // Code only: these constructs are discussed in the comments on purpose.
  const libCode = lib.replace(/^\s*\/\/.*$/gm, "");
  const shCode = sh.replace(/^\s*#.*$/gm, "");
  assert.ok(!/\bflock\b/.test(libCode) && !/\bflock\b/.test(shCode), "flock is not allowed");
  assert.ok(!/process\.kill/.test(libCode), "the writer must not signal or probe a PID it does not own");
  assert.ok(!/(^|[\s;&|(])kill\s/m.test(shCode), "direct signal (kill) is not allowed in install.sh");
  // The crash seam must stay a bounded enum whose only effect is exiting.
  assert.ok(/CRASH_POINTS = \["after-tmp-write", "before-rename", "after-rename"\]/.test(lib), "crash points must stay a fixed enum");
  assert.equal((libCode.match(/AIGENTRY_INSTALL_JOURNAL_CRASH/g) || []).length, 1, "the seam is read in exactly one place");
  // F5: no code construction anywhere on the installer's input paths.
  assert.ok(!/\bFunction\s*\(/.test(shCode), "install.sh must not construct code");
  assert.ok(!/\beval\b/.test(libCode), "the journal writer must not eval");
});
