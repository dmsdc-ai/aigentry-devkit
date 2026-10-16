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
// Credentials are synthetic markers generated at runtime; no host credential is
// read or migrated.
//
// Fixture hardening (#1147 phase 2): the fake actuator derives its private
// state directory from its own location, never from argv/env/cwd, every
// filename it touches is a literal, and a tool outside the fixture's closed
// vocabulary is refused inert. A dedicated fixture-control row proves an
// unrelated argv cannot redirect the fake's reads or writes.
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
// Generated fresh per run from node:crypto, so this file contains no literal
// secret-shaped string at all. The anti-leak assertions below check this exact
// value, so they get strictly stronger: a different random marker every run
// cannot be accidentally satisfied by a pre-existing byte sequence on disk.
const SYNTHETIC_KEY = `SYNTHETIC-ONLY-1147-${crypto.randomBytes(24).toString("hex")}`;

// Private fixture files must not be group/world readable.
process.umask(0o077);

const RECORDERS = ["npm", "npx", "curl", "tmux", "claude", "telepty", "dustcraw", "aigentry-brain"];
const FORBIDDEN = ["git", "brew", "sudo", "launchctl", "systemctl", "apt-get", "dnf", "yum", "pacman", "docker", "open", "direnv"];

// ── inert fake actuator ─────────────────────────────────────────────────────

const FAKE_JS = String.raw`"use strict";
// Inert fake for the #1147 recovery tests. argv: <tool> ...args
//
// The private state directory is NOT taken from argv, env or cwd: it is the
// fixed "state" sibling of this very script, so no caller argument can move a
// read or a write outside the fixture. Every filename below is a literal — none
// is concatenated from a caller-supplied value. The tool name is still
// caller-supplied, so it is checked against the closed vocabulary the fixture
// itself wrote into the private state, and anything else is refused inert with
// exit 98 before anything caller-named is read and before any write. (The two
// fixed, fixture-written files tools.json and forbidden.json are read first —
// that is where the vocabulary and the tripwire list come from.)
//
// Never performs a real action: it records the call and returns a modelled exit
// code. A tool listed in forbidden.json records the breach and exits 97.
const fs = require("fs");
const path = require("path");
const STATE_DIR = path.join(__dirname, "state");
const st = (n) => path.join(STATE_DIR, n);
const text = (n) => { try { return fs.readFileSync(st(n), "utf8"); } catch (_) { return null; } };
const tool = process.argv[2];
const args = process.argv.slice(3);
const log = (extra) => fs.appendFileSync(st("calls.jsonl"),
  JSON.stringify(Object.assign({ tool, args, pid: process.pid, t: Date.now() }, extra || {})) + "\n");

const vocabulary = JSON.parse(text("tools.json") || "[]");
const forbidden = JSON.parse(text("forbidden.json") || "[]");
if (!vocabulary.includes(tool)) {
  process.stderr.write("fake: refusing a tool outside the fixture vocabulary\n");
  process.exitCode = 98;
} else if (forbidden.includes(tool)) {
  log({ forbidden: true });
  process.exitCode = 97;
} else {
  log();
  if (tool === "telepty" && ["--version", "-v", "version"].includes(args[0])) {
    const v = text("telepty.version");
    if (v !== null) process.stdout.write(v + "\n");
  }
  // exits.json models a failing actuator for one phase at a time. It is a map
  // keyed by the already-validated tool name, so no path is derived from argv.
  const exits = JSON.parse(text("exits.json") || "{}");
  process.exitCode = Object.prototype.hasOwnProperty.call(exits, tool) ? Number(exits[tool]) : 0;
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
  // The closed vocabulary the fake validates against: exactly the tools this
  // fixture installs a shim for. Written by the fixture, never by a caller.
  fs.writeFileSync(path.join(sb.state, "tools.json"), JSON.stringify([...RECORDERS, ...FORBIDDEN]));
  fs.writeFileSync(path.join(sb.state, "exits.json"), "{}");
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

// The shim passes the tool name and the caller's arguments only. It does NOT
// pass the state directory: the fake derives that from its own location, so no
// argv can redirect it.
function addTool(sb, tool) {
  const p = path.join(sb.fakebin, tool);
  fs.writeFileSync(p, `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(sb.fakeJs)} ${tool} "$@"\n`);
  fs.chmodSync(p, 0o700);
  sb.tools.add(tool);
}

function dropTool(sb, tool) {
  fs.rmSync(path.join(sb.fakebin, tool), { force: true });
  sb.tools.delete(tool);
}

// Model one actuator failing, which is how a phase is made to fail on its own.
// Kept in one map file keyed by tool name, so the fixture never builds a path
// out of a tool name.
function exitsPath(sb) {
  return path.join(sb.state, "exits.json");
}
function failTool(sb, tool, code = 1) {
  const exits = JSON.parse(fs.readFileSync(exitsPath(sb), "utf8"));
  exits[tool] = code;
  fs.writeFileSync(exitsPath(sb), JSON.stringify(exits));
}
function unfailTool(sb, tool) {
  const exits = JSON.parse(fs.readFileSync(exitsPath(sb), "utf8"));
  delete exits[tool];
  fs.writeFileSync(exitsPath(sb), JSON.stringify(exits));
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
    PATH: opts.path || [sb.fakebin, "/usr/bin", "/bin"].join(path.delimiter),
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

// Coreutils the installer legitimately needs. Symlinked one by one into the
// sandbox so a row can run with a PATH that contains NOTHING else — which is
// the only hermetic way to make a prerequisite such as git genuinely absent
// without ever exposing the host's real git to a fixture.
const COREUTILS = ["mkdir", "cp", "rm", "ln", "chmod", "ls", "wc", "tr", "grep", "sed",
  "basename", "dirname", "uname", "mktemp", "hostname", "id", "sleep", "cat"];

function curatedPath(sb) {
  const dir = path.join(sb.root, "coreutils");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const c of COREUTILS) {
    let target = null;
    for (const d of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
      const p = path.join(d, c);
      if (fs.existsSync(p)) { target = p; break; }
    }
    assert.ok(target, `coreutil ${c} not found on this host`);
    fs.symlinkSync(target, path.join(dir, c));
  }
  assert.equal(fs.existsSync(path.join(dir, "git")), false, "the curated PATH must not contain git");
  return [sb.fakebin, dir].join(path.delimiter);
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
    unfailTool(sb, "npx");
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
  // A refusal here means the journal would not even open a new attempt — e.g. an
  // earlier unknown for this phase is still unresolved. Surface both streams.
  assert.equal(begin.status, 0, `seeding an interrupted phase ${phase} was refused:\n${begin.stdout}${begin.stderr}`);
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

// ── 4b. supersession: a resolved unknown must stop blocking (review R1) ─────
//
// An unknown effect is a question about one phase at one point in time, not a
// permanent property of the journal. Once a later run has actually completed
// that phase, the question is answered and an ordinary run must proceed — while
// a replay that did NOT land, or a fresh interruption, must still block. The
// journal stays immutable: resolution is folded chronologically at read time,
// never by editing, deleting or force-bypassing a record.

test("an unknown effect resolved by a successful replay stops blocking later runs", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("supersede-resolved");
  try {
    seedInterrupted(sb, 3, "deliberation");

    // Ordinary run refuses while the question is open.
    const blocked = runInstaller(sb, { components: "deliberation", resume: 3 });
    assert.notEqual(blocked.code, 0, `must refuse while unresolved\n${describe(sb, blocked)}`);

    // The user answers it once, explicitly.
    const replayed = runInstaller(sb, { components: "deliberation", resume: 3, env: { AIGENTRY_INSTALL_UNKNOWN_EFFECT: "replay" } });
    let d = describe(sb, replayed);
    assert.equal(replayed.code, 0, `the replay must land\n${d}`);
    assert.equal(phaseOf(lastAttempt(sb), 3).status, "completed", `the replay completed phase 3\n${d}`);

    // ... and from then on an ORDINARY run proceeds: no override, no edit.
    const ordinary = runInstaller(sb, { components: "deliberation", resume: 3 });
    d = describe(sb, ordinary);
    assert.equal(ordinary.code, 0, `a resolved unknown must not block forever\n${d}`);
    assert.ok(!/interrupted inside phase/.test(ordinary.plain), `no stale refusal\n${d}`);
    assert.equal(phaseOf(lastAttempt(sb), 3).status, "completed", d);

    // History is immutable: the original unknown record is still there.
    const j = journal(sb);
    assert.equal(j.attempts.length, 3, `every attempt is still recorded\n${d}`);
    assert.equal(phaseOf(j.attempts[0], 3).status, "unknown", `the original unknown is preserved verbatim\n${d}`);
    assert.equal(j.schema, "aigentry-devkit/install-journal@1", `no schema reset\n${d}`);
    assertNoRealActuator(sb, ordinary);
  } finally { sb.cleanup(); }
});

test("negative control: a replay that failed does not resolve the unknown", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("supersede-replay-failed");
  try {
    seedInterrupted(sb, 3, "deliberation");
    failTool(sb, "npx", 1); // the replay itself cannot land

    const replayed = runInstaller(sb, { components: "deliberation", resume: 3, env: { AIGENTRY_INSTALL_UNKNOWN_EFFECT: "replay" } });
    let d = describe(sb, replayed);
    assert.notEqual(replayed.code, 0, `the replay must fail this row\n${d}`);
    assert.equal(phaseOf(lastAttempt(sb), 3).status, "failed", `a failed replay is recorded failed\n${d}`);

    // The question is still open, so an ordinary run must still refuse.
    const ordinary = runInstaller(sb, { components: "deliberation", resume: 3 });
    d = describe(sb, ordinary);
    assert.notEqual(ordinary.code, 0, `a failed replay must not clear the unknown\n${d}`);
    assert.ok(/interrupted inside phase 3/.test(ordinary.plain), `the refusal must still name phase 3\n${d}`);
  } finally { sb.cleanup(); }
});

test("negative control: a fresh interruption re-blocks an already-resolved phase", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("supersede-reblocked");
  try {
    seedInterrupted(sb, 3, "deliberation");
    const replayed = runInstaller(sb, { components: "deliberation", resume: 3, env: { AIGENTRY_INSTALL_UNKNOWN_EFFECT: "replay" } });
    assert.equal(replayed.code, 0, describe(sb, replayed));

    // A new run is interrupted inside the same phase all over again.
    seedInterrupted(sb, 3, "deliberation");

    // calls.jsonl is cumulative across runs in one sandbox, so compare against a
    // snapshot taken after the replay rather than against empty.
    const before = calls(sb).length;
    const ordinary = runInstaller(sb, { components: "deliberation", resume: 3 });
    const d = describe(sb, ordinary);
    assert.notEqual(ordinary.code, 0, `the newer unknown must block again\n${d}`);
    assert.ok(/interrupted inside phase 3/.test(ordinary.plain), `the refusal must name phase 3\n${d}`);
    assert.equal(calls(sb).length, before, `nothing new may run after the refusal\n${d}`);
    // History: the resolved unknown, its replay and the fresh unknown all stand.
    const j = journal(sb);
    assert.deepEqual(j.attempts.map((a) => a.outcome), ["unknown", "completed", "unknown"], d);
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

    // The crashed run released the lock it owned (review RW2: process.exit runs
    // no catch or finally, but it does run the exit hook), so the next ORDINARY
    // run needs no override — it just proceeds and sweeps its own residue.
    assert.equal(fs.existsSync(sb.lock), false, `the deliberate-exit path must release its own lock\n${d}`);
    const next = runInstaller(sb, { components: "devkit-core" });
    assert.equal(next.code, 0, `an ordinary re-run must not need a force-unlock\n${describe(sb, next)}`);
    assert.deepEqual(fs.readdirSync(sb.stateDir).filter((n) => n.includes(".tmp-")), [], `temp residue must be swept`);
    assert.equal(lastAttempt(sb).lock_forced, undefined, `no force was needed, so none may be recorded`);
    // Forcing is still recorded when it IS used — see the concurrent-writer row.
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

// ── 5b. the shared fold is exported and exposed (review RW1) ───────────────
//
// #1145's CLI reader has to answer "what is still unresolved?". If the fold lives
// only inside begin-run, that reader must re-derive it and will reproduce the
// exact phase-3 defect one layer up. So the fold is ONE exported pure function
// and `read` exposes its result as an additive field.

test("unresolvedPhases is exported, pure, and folds chronologically", () => {
  const lib = require(JOURNAL_CLI);
  assert.equal(typeof lib.unresolvedPhases, "function", "the fold must be exported for the reader");

  const j = (phases) => ({ schema: "aigentry-devkit/install-journal@1", attempts: phases.map((ps, i) => ({ attempt: i + 1, phases: ps })) });
  const rec = (phase, status) => ({ phase, status });

  // chronological folding, exactly as begin-run does it
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")]])), [3], "an unknown is unresolved");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")], [rec(3, "completed")]])), [],
    "a later completed supersedes an earlier unknown");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")], [rec(3, "failed")]])), [3],
    "a failed replay does not clear the unknown");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")], [rec(3, "completed")], [rec(3, "unknown")]])), [3],
    "a fresh unknown re-blocks");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")], [rec(3, "completed")], [rec(3, "unknown")], [rec(3, "completed")]])), [],
    "and can be resolved again");

  // deterministic: ascending, de-duplicated
  assert.deepEqual(lib.unresolvedPhases(j([[rec(6, "unknown"), rec(3, "unknown")], [rec(6, "unknown")]])), [3, 6],
    "ascending and de-duplicated");

  // NO selection filter leaks in: phase 1 is replay-safe and phase 7 is not an
  // optional component, but both are still reported as unresolved facts.
  assert.deepEqual(lib.unresolvedPhases(j([[rec(1, "unknown"), rec(7, "unknown")]])), [1, 7],
    "the generic fold must not apply begin-run's replay/cursor/component policy");

  // total: never throws on a shape a reader did not expect
  for (const bad of [null, undefined, {}, { attempts: null }, { attempts: {} }, { attempts: [null] }, { attempts: [{}] }, { attempts: [{ phases: [null, { phase: "x", status: "unknown" }] }] }]) {
    assert.deepEqual(lib.unresolvedPhases(bad), [], `must tolerate ${JSON.stringify(bad)}`);
  }

  // pure: the same input twice, and no mutation of the caller's object
  const input = j([[rec(3, "unknown")], [rec(5, "unknown")]]);
  const snapshot = JSON.stringify(input);
  assert.deepEqual(lib.unresolvedPhases(input), [3, 5]);
  assert.deepEqual(lib.unresolvedPhases(input), [3, 5]);
  assert.equal(JSON.stringify(input), snapshot, "the fold must not mutate its input");
});

test("read exposes unresolved_phases additively and stays honest when it cannot know", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("read-unresolved");
  const readCmd = () => {
    const r = spawnSync(process.execPath, [JOURNAL_CLI, "read", "--dir", sb.stateDir], { encoding: "utf8" });
    return { status: r.status, out: r.stdout, json: (() => { try { return JSON.parse(r.stdout); } catch (e) { return null; } })() };
  };
  try {
    // absent: there is genuinely no journal, so [] is honest and the exit stays 0.
    let r = readCmd();
    assert.equal(r.status, 0, r.out);
    assert.equal(r.json.status, "absent", r.out);
    assert.deepEqual(r.json.unresolved_phases, [], "absent means nothing unresolved");

    // ok with an interrupted phase: reported unresolved.
    seedInterrupted(sb, 3, "deliberation");
    runInstaller(sb, { components: "deliberation", resume: 3 }); // refused; reclassifies running -> unknown
    r = readCmd();
    assert.equal(r.status, 0, r.out);
    assert.equal(r.json.status, "ok", r.out);
    assert.deepEqual(r.json.unresolved_phases, [3], `read must report phase 3 unresolved\n${r.out}`);
    // the additive field does not displace the existing ones
    assert.ok(r.json.journal && Array.isArray(r.json.journal.attempts), "journal is still returned");
    assert.equal(r.json.reason, null, "reason is still returned");

    // after a successful replay: read reports RESOLVED while the raw history
    // still contains the unknown record (the journal stays the history).
    const replayed = runInstaller(sb, { components: "deliberation", resume: 3, env: { AIGENTRY_INSTALL_UNKNOWN_EFFECT: "replay" } });
    assert.equal(replayed.code, 0, describe(sb, replayed));
    r = readCmd();
    assert.deepEqual(r.json.unresolved_phases, [], `a resolved unknown must read as resolved\n${r.out}`);
    assert.equal(r.json.journal.attempts[0].phases.filter((x) => x.phase === 3)[0].status, "unknown",
      "the raw history must still carry the original unknown");

    // corrupt: the answer is UNKNOWN, never "nothing unresolved".
    fs.writeFileSync(sb.journal, fs.readFileSync(sb.journal).subarray(0, 100));
    r = readCmd();
    assert.equal(r.status, 1, `a corrupt journal keeps its non-zero exit\n${r.out}`);
    assert.equal(r.json.status, "corrupt", r.out);
    assert.equal(r.json.unresolved_phases, null, "a corrupt read must not claim nothing is unresolved");

    // unsupported: same honesty.
    fs.writeFileSync(sb.journal, `${JSON.stringify({ schema: "aigentry-devkit/install-journal@99", attempts: [] })}\n`);
    r = readCmd();
    assert.equal(r.status, 1, r.out);
    assert.equal(r.json.status, "unsupported", r.out);
    assert.equal(r.json.unresolved_phases, null, "an unsupported read must not claim nothing is unresolved");

    // read never rewrites the journal
    const before = fs.readFileSync(sb.journal);
    readCmd();
    assert.deepEqual(fs.readFileSync(sb.journal), before, "read must stay read-only");
  } finally { sb.cleanup(); }
});

// ── 5b-ii. the fold is honest about pending and about degraded replays ──────
//
// RW-A. `running` is a normal, durable on-disk state: it is written before the
// first mutation of every phase and it is exactly what survives a SIGKILL.
// begin-run reclassifies it to `unknown` and persists that BEFORE it folds,
// while `read` is read-only and folds the raw journal — so a fold that ignores
// `running` tells a reader "nothing is unresolved" about the very bytes the next
// begin-run refuses. `unresolved_phases` means "effects not proven resolved",
// never "the writing process is alive", so a `running` record contributes a
// PENDING unresolved effect, including while an installer really is running. The
// live-versus-interrupted ambiguity is not decidable from the journal and is not
// guessed here: a conservative false "pending" is acceptable, a false "nothing
// unresolved" is not. No clock, no PID probe, no liveness inference.
//
// RW-B. The journal has no trustworthy per-effect completion bit, so a
// `completed` record carrying `degraded: true` cannot prove the unknown external
// effect landed, and must not clear a pre-existing unknown/running effect — the
// same reason a `failed` replay does not clear it. A CLEAN completion still
// clears, so nothing blocks forever, and a degraded completion on its own must
// never fabricate an unresolved effect that no record claims.
test("the fold reports running as pending and refuses to clear on a degraded completion", () => {
  const lib = require(JOURNAL_CLI);
  const j = (phases) => ({ schema: "aigentry-devkit/install-journal@1", attempts: phases.map((ps, i) => ({ attempt: i + 1, phases: ps })) });
  const rec = (phase, status, extra) => Object.assign({ phase, status }, extra || {});

  // RW-A: pending, and the same answer begin-run would give after reclassifying.
  assert.deepEqual(lib.unresolvedPhases(j([[rec(6, "running")]])), [6],
    "a running record is an effect not proven resolved, so it is pending");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(6, "running")], [rec(6, "completed")]])), [],
    "a later clean completion clears a pending running");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")], [rec(3, "completed")], [rec(3, "running")]])), [3],
    "a fresh running reopens an already-resolved phase");

  // RW-B: a degraded completion neither clears nor fabricates.
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")], [rec(3, "completed", { degraded: true })]])), [3],
    "a degraded completion must not clear an unresolved unknown");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "running")], [rec(3, "completed", { degraded: true })]])), [3],
    "a degraded completion must not clear a pending running either");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(5, "completed", { degraded: true })]])), [],
    "a degraded completion with no preceding unresolved record must not fabricate one");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")], [rec(3, "completed", { degraded: true })], [rec(3, "completed")]])), [],
    "a later clean completion still answers the question");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")], [rec(3, "completed", { degraded: false })]])), [],
    "only degraded === true withholds the supersession");

  // the rules this correction must not disturb
  assert.deepEqual(lib.unresolvedPhases(j([[rec(3, "unknown")], [rec(3, "failed")]])), [3],
    "a failed replay still retains the unknown");
  assert.deepEqual(lib.unresolvedPhases(j([[rec(6, "running"), rec(3, "unknown")], [rec(6, "running")]])), [3, 6],
    "still ascending and de-duplicated across statuses");
  const input = j([[rec(6, "running")], [rec(5, "completed", { degraded: true })]]);
  const snapshot = JSON.stringify(input);
  assert.deepEqual(lib.unresolvedPhases(input), [6]);
  assert.equal(JSON.stringify(input), snapshot, "the fold must still not mutate its input");
});

test("read reports an interrupted phase as pending before any begin-run reclassifies it", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("read-pending-running");
  try {
    // Exactly the SIGKILL state: a running record and no handler ever ran. No
    // begin-run has seen it yet, so nothing has reclassified it to unknown.
    seedInterrupted(sb, 6, "registry-wiring");
    const raw = fs.readFileSync(sb.journal);
    assert.equal(phaseOf(JSON.parse(raw.toString("utf8")).attempts[0], 6).status, "running",
      "precondition: the interrupted record is still `running` on disk");

    const r = spawnSync(process.execPath, [JOURNAL_CLI, "read", "--dir", sb.stateDir], { encoding: "utf8" });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, "ok", r.stdout);
    assert.deepEqual(out.unresolved_phases, [6],
      `read must not answer "nothing is unresolved" about a journal begin-run will refuse\n${r.stdout}`);

    // read stays read-only: not one byte changed, the record is still `running`.
    assert.deepEqual(fs.readFileSync(sb.journal), raw, "read must not reclassify or rewrite the journal");

    // ... and the two consumers of the one fold now agree about the same bytes.
    const ordinary = runInstaller(sb, { components: "registry-wiring", resume: 6, env: { AIGENTRY_REGISTRY_MODE: "cloud" } });
    const d = describe(sb, ordinary);
    assert.notEqual(ordinary.code, 0, `begin-run must still refuse the unknown effect\n${d}`);
    assert.ok(/interrupted inside phase 6/.test(ordinary.plain), `the refusal must still name phase 6\n${d}`);
    assert.equal(phaseOf(journal(sb).attempts[0], 6).status, "unknown", `begin-run still persists the reclassification\n${d}`);
  } finally { sb.cleanup(); }
});

test("a degraded replay does not clear the unknown effect it could not resolve", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("degraded-replay-retains");
  try {
    seedInterrupted(sb, 5, "dustcraw");
    const blocked = runInstaller(sb, { components: "dustcraw", resume: 5 });
    assert.notEqual(blocked.code, 0, `must refuse while the question is open\n${describe(sb, blocked)}`);

    // The user answers it explicitly, but `dustcraw init` — the external-init
    // half of phase 5's effect, i.e. the exact reason the phase is classed
    // unreplayable — fails. install.sh's soft policy (phase_degraded) still
    // records `completed --degraded 1`, so the replay demonstrably did not land.
    failTool(sb, "dustcraw", 1);
    const replayed = runInstaller(sb, { components: "dustcraw", resume: 5, env: { AIGENTRY_INSTALL_UNKNOWN_EFFECT: "replay" } });
    let d = describe(sb, replayed);
    const degradedRec = phaseOf(lastAttempt(sb), 5);
    assert.equal(degradedRec.status, "completed", `the soft policy records completed, not failed\n${d}`);
    assert.equal(degradedRec.degraded, true, `and marks the record degraded\n${d}`);
    assert.equal(degradedRec.replay, "unknown", `phase 5 is the unreplayable class\n${d}`);

    // So an ORDINARY run must still refuse: the duplicate-external-effect
    // protection may not switch itself off on a soft failure.
    const ordinary = runInstaller(sb, { components: "dustcraw", resume: 5 });
    d = describe(sb, ordinary);
    assert.notEqual(ordinary.code, 0, `a degraded replay must not clear the unknown\n${d}`);
    assert.ok(/interrupted inside phase 5/.test(ordinary.plain), `the refusal must still name phase 5\n${d}`);

    // Control on the identical path: once the replay really lands clean, the
    // question is answered and an ordinary run proceeds. Nothing blocks forever.
    unfailTool(sb, "dustcraw");
    const clean = runInstaller(sb, { components: "dustcraw", resume: 5, env: { AIGENTRY_INSTALL_UNKNOWN_EFFECT: "replay" } });
    d = describe(sb, clean);
    assert.equal(clean.code, 0, `the clean replay must land\n${d}`);
    const cleanRec = phaseOf(lastAttempt(sb), 5);
    assert.equal(cleanRec.status, "completed", d);
    assert.equal(cleanRec.degraded, undefined, `a clean completion carries no degraded flag\n${d}`);
    const after = runInstaller(sb, { components: "dustcraw", resume: 5 });
    d = describe(sb, after);
    assert.equal(after.code, 0, `a clean completion must still clear the unknown\n${d}`);
    assert.ok(!/interrupted inside phase/.test(after.plain), `no stale refusal after a clean replay\n${d}`);

    // History is immutable throughout: every record still stands as written.
    const statuses = journal(sb).attempts.map((a) => (phaseOf(a, 5) || {}).status);
    assert.deepEqual(statuses, ["unknown", "completed", "completed", "completed"],
      `every phase-5 record is preserved verbatim\n${d}`);
    assert.equal(journal(sb).attempts[1].phases.filter((p) => p.phase === 5)[0].degraded, true,
      `the degraded fact is preserved, not rewritten\n${d}`);
    assertNoRealActuator(sb, after);
  } finally { sb.cleanup(); }
});

// ── 5c. a failed begin-run must not orphan its own lock (review RW2) ────────
//
// Real filesystem failure, not a simulation: the state directory is sized so
// that install-journal.lock (20-char name) fits inside the path limit while the
// writer's install-journal.json.tmp-<pid>-<12 hex> does not, so atomicWrite's
// real openSync raises a real ENAMETOOLONG.
//
// The limit is MEASURED, never assumed, so this holds on a 1024- and a
// 4096-byte PATH_MAX alike. The earlier version instead *hoped* to land in the
// window: it extended the path in 100-char steps until mkdir failed, which
// leaves the deepest directory anywhere in a 101-char band below the ceiling,
// and then appended one component needing both `len+1+20 <= ceiling` and
// `len+1+43 > ceiling` — a ~23-char window. Whenever the coarse step overshot
// (deepest > ceiling-23), every single-component candidate was already past the
// window and the row died in its own precondition with nothing measured. So:
// measure the ceiling first, then construct a directory of exactly the length
// the oracle needs.
function mkWriteFailingStateDir(sb) {
  const LOCK = "install-journal.lock";
  // The name that must fail is written by the CHILD begin-run process, whose pid
  // may be shorter than this test's, so probing with our own pid can tune the
  // window too loosely. Probe with the SHORTEST form the writer can produce — a
  // 1-digit pid and the fixed 12 hex chars of crypto.randomBytes(6) — because
  // every real temp name is at least this long, so if this one cannot be created
  // neither can any of them.
  const TMP_SHORTEST = `install-journal.json.tmp-0-${"0".repeat(12)}`;
  assert.ok(TMP_SHORTEST.length > LOCK.length, "the oracle needs the temp name to be the longer one");

  // Try to create and remove `name` in `dir`: null on success, else the errno.
  const probe = (dir, name) => {
    const p = path.join(dir, name);
    try { fs.writeFileSync(p, "x"); fs.unlinkSync(p); return null; }
    catch (err) { return err.code || String(err.message); }
  };

  // 1. Descend in coarse steps until the filesystem refuses, remembering every
  //    directory we actually created so we can back off to a precise one.
  const chain = [path.join(sb.root, "deep")];
  fs.mkdirSync(chain[0], { recursive: true });
  for (;;) {
    const next = path.join(chain[chain.length - 1], "d".repeat(100));
    try { fs.mkdirSync(next); chain.push(next); } catch (err) { break; }
  }
  const deepest = chain[chain.length - 1];

  // 2. MEASURE the ceiling: the longest filename still creatable in `deepest`.
  //    Monotone (a longer path never succeeds where a shorter one failed), so a
  //    binary search is exact rather than a sampled guess.
  let lo = 0;
  let hi = 255; // NAME_MAX; the search tells us which limit actually binds
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (probe(deepest, "n".repeat(mid)) === null) lo = mid; else hi = mid - 1;
  }
  assert.ok(lo >= 1, `no filename fits in the deepest directory (len ${deepest.length}); cannot measure the path ceiling`);
  assert.ok(lo < 255, `NAME_MAX, not PATH_MAX, is binding here (deepest len ${deepest.length}, longest name ${lo}); the coarse descent did not reach the path ceiling`);
  const ceiling = deepest.length + 1 + lo; // longest creatable file path, measured

  // 3. Size the state directory exactly: the lock path lands ON the ceiling and
  //    the shortest possible temp path lands beyond it.
  const target = ceiling - 1 - LOCK.length;
  const parent = chain.filter((d) => d.length + 2 <= target).pop();
  assert.ok(parent, `no created ancestor is short enough for a ${target}-char state directory (ceiling ${ceiling})`);
  const padLen = target - parent.length - 1;
  assert.ok(padLen >= 1 && padLen <= 255, `the single component would be ${padLen} chars, outside NAME_MAX (target ${target}, parent ${parent.length}, ceiling ${ceiling})`);
  const dir = path.join(parent, "d".repeat(padLen));
  try { fs.mkdirSync(dir); } catch (err) {
    if (err.code !== "EEXIST") assert.fail(`could not create the ${target}-char state directory (ceiling ${ceiling}, errno ${err.code})`);
  }
  assert.equal(dir.length, target, "the constructed state directory must be exactly the measured length");

  // 4. VERIFY the oracle by measurement before handing the directory over: the
  //    lock name must really fit, and the shortest real temp name must really
  //    fail, with exactly ENAMETOOLONG and not some unrelated errno.
  const lockCode = probe(dir, LOCK);
  const tmpCode = probe(dir, TMP_SHORTEST);
  assert.equal(lockCode, null,
    `the ${LOCK.length}-char lock name must fit in the state directory (measured ceiling ${ceiling}, dir ${dir.length}, errno ${lockCode})`);
  assert.equal(tmpCode, "ENAMETOOLONG",
    `the ${TMP_SHORTEST.length}-char journal temp name must fail with ENAMETOOLONG (measured ceiling ${ceiling}, dir ${dir.length}, got ${tmpCode})`);
  return dir;
}

test("a begin-run whose journal write really fails releases its own lock", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("owned-lock-write-failure");
  try {
    const dir = mkWriteFailingStateDir(sb);
    const lock = path.join(dir, "install-journal.lock");
    const begin = (...extra) => spawnSync(process.execPath, [JOURNAL_CLI, "begin-run", "--dir", dir,
      "--installer", "install.sh", "--profile", "core", "--components", "deliberation", "--start-phase", "0", ...extra],
      { encoding: "utf8" });

    // The write genuinely fails ...
    const first = begin();
    assert.notEqual(first.status, 0, "the failing write must be reported");
    assert.match(`${first.stderr}`, /ENAMETOOLONG/, `expected a real write failure\n${first.stderr}`);
    assert.equal(fs.existsSync(path.join(dir, "install-journal.json")), false, "no journal was written");

    // ... and the lock this invocation created is gone, so the next ordinary run
    // is NOT falsely refused as locked.
    assert.equal(fs.existsSync(lock), false, "a failed begin-run must release its own lock");
    const second = begin();
    assert.notEqual(second.status, 0, "the second run still hits the same real write failure");
    assert.ok(!second.stdout.startsWith("locked"), `the second run must not be falsely refused as locked\n${second.stdout}`);
    assert.match(`${second.stderr}`, /ENAMETOOLONG/, "the second failure is the write, not the lock");
  } finally { sb.cleanup(); }
});

test("the deliberate crash seam also releases the lock it owns, and a foreign lock is never touched", { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("owned-lock-crash-seam");
  try {
    const begin = (env, ...extra) => spawnSync(process.execPath, [JOURNAL_CLI, "begin-run", "--dir", sb.stateDir,
      "--installer", "install.sh", "--profile", "core", "--components", "deliberation", "--start-phase", "0", ...extra],
      { encoding: "utf8", env: { ...process.env, ...env } });

    // process.exit(70) runs no catch/finally, but the exit hook still fires.
    const crashed = begin({ AIGENTRY_INSTALL_JOURNAL_CRASH: "before-rename" });
    assert.equal(crashed.status, 70, `${crashed.stdout}${crashed.stderr}`);
    assert.equal(fs.existsSync(sb.journal), false, "nothing was renamed into place");
    assert.equal(fs.existsSync(sb.lock), false, "the deliberate-exit path must release its own lock");

    // An ordinary run now succeeds and KEEPS its lock: ownership was handed over.
    const ok = begin({});
    assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
    assert.equal(fs.existsSync(sb.lock), true, "a successful begin-run keeps the lock for the installer");
    const handed = fs.readFileSync(sb.lock, "utf8");

    // A FOREIGN lock must never be released by a failing run: the crash seam
    // cannot acquire it, refuses as locked, and leaves the bytes untouched.
    const foreign = begin({ AIGENTRY_INSTALL_JOURNAL_CRASH: "before-rename" });
    assert.notEqual(foreign.status, 0, "a held lock must still refuse");
    assert.ok(foreign.stdout.startsWith("locked"), `expected a locked refusal\n${foreign.stdout}`);
    assert.equal(fs.readFileSync(sb.lock, "utf8"), handed, "a foreign lock must be left byte-identical");

    // A forced takeover that then dies deliberately is NOT auto-released: it was
    // adopted, not exclusively created. Documented as safe-over-convenient.
    const forcedCrash = begin({ AIGENTRY_INSTALL_JOURNAL_CRASH: "before-rename" }, "--force-unlock", "1");
    assert.equal(forcedCrash.status, 70, `${forcedCrash.stdout}${forcedCrash.stderr}`);
    assert.equal(fs.existsSync(sb.lock), true, "an adopted (forced) lock is not auto-released");
    assert.notEqual(fs.readFileSync(sb.lock, "utf8"), handed, "the forced run did adopt it");
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
    // The orchestrator setup degraded (clone failed) AND its outcome could not
    // be recorded, so the journal must not read as a clean completion.
    assert.equal(phaseOf(lastAttempt(sb), 8).degraded, true, `a degraded phase 8 must be recorded degraded\n${d}`);
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
    // Both durable records agree about the same attempt (review R3).
    assertOrchestratorRecordsAgree(sb, d);
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

// ── 7b. phase 8 degradation is recorded consistently (review R3) ────────────
//
// The contract: whenever install-state's orchestrator status is not "installed",
// the journal's phase-8 record MUST be marked degraded. The journal may also be
// degraded while the status is "installed" (a soft warning during an otherwise
// successful setup) — that is extra detail, not a contradiction. What must never
// happen is the journal reading as a clean completion while the product record
// says the setup degraded or was skipped.
function assertOrchestratorRecordsAgree(sb, d) {
  const state = JSON.parse(fs.readFileSync(sb.stateFile, "utf8"));
  const rec = phaseOf(lastAttempt(sb), 8);
  assert.ok(rec, `phase 8 must have a journal record\n${d}`);
  const status = state.orchestrator && state.orchestrator.status;
  if (status !== "installed") {
    assert.equal(rec.degraded, true,
      `install-state says orchestrator="${status}" but the journal records a clean phase 8\n${d}`);
    assert.ok(rec.detail && rec.detail.length > 0, `the degradation reason must be recorded\n${d}`);
  }
  if (!rec.degraded) {
    assert.equal(status, "installed",
      `the journal records a clean phase 8 but install-state says orchestrator="${status}"\n${d}`);
  }
}

for (const row of [
  {
    id: "clone failure",
    setup: (sb) => allowTool(sb, "git", 1),
    status: "degraded",
    needle: /orchestrator clone failed/,
  },
  {
    id: "missing prerequisite",
    // git genuinely absent — not merely un-shimmed. The run uses a curated PATH
    // of vetted coreutils only, so the host's real git is unreachable and phase
    // 8 cannot even start: a degradation of the component this attempt asked
    // for. Proves the "skipped" branch routes through phase_degraded too.
    setup: (sb) => { dropTool(sb, "git"); return { path: curatedPath(sb) }; },
    status: "skipped",
    needle: /orchestrator-role skipped \(need git\+node\+npm\)/,
  },
]) {
  test(`phase 8 ${row.id} is degraded in BOTH durable records`, { skip: SKIP_SH, timeout: RUN_TIMEOUT_MS }, () => {
    const sb = mkSandbox(`phase8-${row.id}`);
    try {
      const extra = row.setup(sb) || {};
      const r = runInstaller(sb, { components: "orchestrator-role", resume: "orchestrator-role", env: orchEnv(sb), ...extra });
      const d = describe(sb, r);

      // Operation semantics and exit policy are unchanged: phase 8 stays soft.
      assert.equal(r.code, 0, `phase 8 keeps its soft policy\n${d}`);
      assert.ok(row.needle.test(r.plain), `expected the degradation to be reported\n${d}`);

      const state = JSON.parse(fs.readFileSync(sb.stateFile, "utf8"));
      assert.equal(state.orchestrator.status, row.status, `existing status semantics preserved\n${d}`);

      const rec = phaseOf(lastAttempt(sb), 8);
      assert.equal(rec.status, "completed", `the phase still completes under soft policy\n${d}`);
      assert.equal(rec.degraded, true, `the journal must not read as a clean completion\n${d}`);
      assert.ok(rec.detail && rec.detail.length > 0, `the reason must be recorded\n${d}`);
      assertOrchestratorRecordsAgree(sb, d);

      // No real git, service or network was involved either way.
      assertNoRealActuator(sb, r);
      assert.deepEqual(calls(sb).filter((c) => ["launchctl", "systemctl", "curl"].includes(c.tool)), [],
        `no service or network tool may run\n${d}`);
    } finally { sb.cleanup(); }
  });
}

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

// The fake's state location is structural, not negotiable by its caller. Under
// the previous argv shape the state directory WAS argv[2], so a caller could
// point the fake's reads and writes at a directory of its choosing; these rows
// are what makes that impossible rather than merely unlikely.
test("fixture control: no caller argv can move the fake's reads or writes", () => {
  const sb = mkSandbox("fixture-control");
  try {
    const decoy = path.join(sb.root, "decoy-state");
    const runFake = (...argv) => spawnSync(process.execPath, [sb.fakeJs, ...argv], {
      cwd: sb.root,
      env: { PATH: process.env.PATH, HOME: sb.home, TMPDIR: sb.tmp },
      encoding: "utf8",
      timeout: 30000,
    });
    const untouched = hashTree(sb.root);

    // A tool outside the fixture vocabulary is refused inert: no log, no write.
    const unknown = runFake("not-a-fixture-tool");
    assert.equal(unknown.status, 98, `unknown tool must be refused: ${unknown.stderr}`);
    assert.equal(hashTree(sb.root), untouched, "a refused tool must not write anything");

    // A traversal-shaped tool name is just an unknown tool — it never reaches a
    // filename, because no filename is built from the tool name any more.
    const traversal = runFake("../../../../decoy-state");
    assert.equal(traversal.status, 98, "a traversal-shaped tool name must be refused");
    assert.equal(hashTree(sb.root), untouched, "a refused tool must not write anything");

    // The OLD argv shape: a state directory in argv[2]. It is now read as a tool
    // name and refused, so the caller cannot nominate the state directory.
    const asStateDir = runFake(decoy, "npm", "install", "-g", "pkg");
    assert.equal(asStateDir.status, 98, "a path in the tool position is not a tool");
    assert.equal(fs.existsSync(decoy), false, "the decoy state directory was never created");
    assert.equal(hashTree(sb.root), untouched, "a refused call must not write anything");
    assert.deepEqual(calls(sb), [], "nothing may be logged for refused calls");

    // A legitimate tool records into the FIXED private state even when its own
    // arguments look exactly like a redirect target: args stay data.
    const ok = runFake("npm", "--prefix", decoy, "install", "-g", "pkg");
    assert.equal(ok.status, 0, `a fixture tool must still work: ${ok.stderr}`);
    assert.equal(fs.existsSync(decoy), false, "an argv that looks like a path must stay data");
    const logged = calls(sb);
    assert.equal(logged.length, 1, "the call landed in the fixed private state");
    assert.equal(logged[0].tool, "npm");
    assert.deepEqual(logged[0].args, ["--prefix", decoy, "install", "-g", "pkg"],
      "tool and args are preserved as data");
    // calls.jsonl is the ONLY thing that changed anywhere under the sandbox.
    const expected = hashTree(sb.root);
    fs.writeFileSync(path.join(sb.state, "calls.jsonl"), "");
    assert.notEqual(expected, untouched, "the fixture control must actually observe a change");
    assert.equal(hashTree(sb.root), untouched, "only the fixed calls.jsonl was written");

    // The tripwire still fires through the same fixed state.
    const sentinel = runFake("git", "clone", "https://example.invalid/x.git");
    assert.equal(sentinel.status, 97, "a refusing sentinel must still trip");
    assert.equal(calls(sb).filter((c) => c.forbidden).length, 1, "the breach is recorded");
  } finally { sb.cleanup(); }
});

test("fixture control: the fake's vocabulary covers exactly the installed shims", { skip: SKIP_SH }, () => {
  const sb = mkSandbox("vocabulary");
  try {
    const vocabulary = JSON.parse(fs.readFileSync(path.join(sb.state, "tools.json"), "utf8"));
    const shimmed = fs.readdirSync(sb.fakebin).filter((n) => n !== "node");
    assert.deepEqual([...shimmed].sort(), [...vocabulary].sort(),
      "every shim must be in the vocabulary and vice versa, or a real tool could slip through");
    // `node` is deliberately not a fake: it is the pinned interpreter itself.
    assert.equal(fs.readFileSync(path.join(sb.fakebin, "node"), "utf8").includes(process.execPath), true);
    assert.equal(vocabulary.includes("node"), false, "node is not a fake actuator");
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
  // Precise claim (review R2): the manifest/resume code-construction sink is
  // gone. This is NOT a blanket "install.sh is eval-free" assertion — the Phase
  // 8.3 adapter build at install.sh:922 still uses `eval "$build_cmd"` on the
  // adapter's declared build field. That is pre-existing at the base, out of
  // this writer's scope, and deliberately not asserted against here.
  assert.ok(!/\bFunction\s*\(/.test(shCode),
    "install.sh must not build a program from the manifest/resume path (Function())");
  assert.ok(!/\beval\b/.test(libCode), "the journal writer must not eval");
});

test("configure-only shared writer preserves unresolved history and refuses stale identity", () => {
  const sb=mkSandbox("setup-shared-writer");
  try {
    const shared=require("../lib/install-state");
    fs.mkdirSync(sb.stateDir,{recursive:true,mode:0o700});
    const prior={schema:shared.SCHEMA,attempts:[{run_id:"prior",outcome:"running",phases:[{phase:5,status:"running"}]}]};
    fs.writeFileSync(sb.journal,JSON.stringify(prior),{mode:0o600});
    const observed=shared.inspectSetupStorage(sb.stateDir);
    const choice={profile:"core",runtime:"native-srt",outcome:"selected",verification:"not-verified",catalogue_revision:1,plan_digest:"b".repeat(64)};
    shared.saveSetupChoice(sb.stateDir,choice,observed);
    const after=journal(sb);
    assert.deepEqual(after.attempts[0],prior.attempts[0]);
    assert.deepEqual(shared.unresolvedPhases(after),[5]);
    assert.throws(()=>shared.saveSetupChoice(sb.stateDir,choice,observed),/stale/);
    assert.equal(fs.existsSync(sb.lock),false);
    assert.equal(fs.existsSync(sb.stateFile),false,"no second state journal");
    assert.throws(()=>shared.validateSetupChoice({...choice,token:"synthetic"}),/invalid/);
  } finally {sb.cleanup();}
});
