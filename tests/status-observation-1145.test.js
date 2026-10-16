// `aigentry-devkit status` must report an OBSERVED module version (#1145 F2).
//
// Drives the real CLI — `node bin/aigentry-devkit.js status` — against inert
// fixtures: a private HOME/XDG/TMPDIR per row (mode 0700, umask 0077) and a PATH
// holding only fakes. A fake `telepty` prints the bytes and exit code the row
// chooses; every other adapter healthcheck command (npx, curl, aigentry-brain,
// aigentry-amplify, aigentry-bridge, dustcraw) is an inert logging fake, and
// npm/git/sudo/brew/launchctl/systemctl/open/cmux are refusing tripwires that
// must never be invoked. Every fake call is logged (state/calls.jsonl), so each
// row proves what `status` actually ran. Nothing reaches a real registry, global
// npm prefix, daemon, service manager or the user's config.
//
// Oracle: the Version column is derived only from the healthcheck's own stdout
// using the shipped identification rules of lib/telepty-version-policy.js
// (ASCII-trim, at most one leading `v`, exactly one stable X.Y.Z token, at most
// 1024 bytes). Anything else is `unknown`; the adapter's declared literal
// (telepty 0.1.45 at the reviewed HEAD) is never printed as a version.
//
// Platform scope: POSIX here. The CLI is cross-platform, but these rows build
// `/bin/sh` shims, so win32 runs them through the .cmd/.ps1 shims written below
// and is only measured natively on a Windows runner.
//
// Local override: AIGENTRY_TEST_KEEP=1 keeps the sandboxes for inspection.
//
// Run: node --test tests/status-observation-1145.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const CLI = path.join(REPO, "bin", "aigentry-devkit.js");
const MODULES_DIR = path.join(REPO, "config", "modules");

const IS_WIN = process.platform === "win32";
const RUN_TIMEOUT_MS = 60000;
const KEEP = process.env.AIGENTRY_TEST_KEEP === "1";

// Inert logging fakes for every command a tracked adapter healthcheck can reach.
const RECORDERS = ["telepty", "npx", "curl", "aigentry-brain", "aigentry-amplify", "aigentry-bridge", "dustcraw"];
// Nothing in `status` may touch these; invoking one is a test failure.
const FORBIDDEN = IS_WIN
  ? ["npm", "git", "sudo", "schtasks", "winget", "choco"]
  : ["npm", "git", "sudo", "brew", "launchctl", "systemctl", "open", "cmux", "apt-get"];

// Declared literals that must never be printed as an observed version.
function declaredVersions() {
  return fs.readdirSync(MODULES_DIR)
    .filter((f) => f.endsWith(".adapter.json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(MODULES_DIR, f), "utf8")))
    .map((a) => a.version)
    .filter((v) => typeof v === "string" && /^v?[0-9]+\.[0-9]+\.[0-9]+$/.test(v));
}

const FAKE_JS = String.raw`"use strict";
// Inert fake for task-1145 status tests. argv: <tool> ...args
// Where it reads and writes is not an input: the state directory is this
// script's own location plus the fixed leaf "state", and every file name below
// is a literal, so no argument or environment value can redirect a read or a
// write. argv carries the tool name and its arguments as data only and is
// never joined into a path.
const fs = require("fs");
const path = require("path");
const stateDir = path.join(__dirname, "state");
const tool = process.argv[2];
const args = process.argv.slice(3);
const st = (n) => path.join(stateDir, n);
const read = (n) => { try { return fs.readFileSync(st(n)); } catch (_) { return null; } };
const text = (n) => { const b = read(n); return b === null ? null : b.toString("utf8"); };
fs.appendFileSync(st("calls.jsonl"), JSON.stringify({ tool, args, pid: process.pid, t: Date.now() }) + "\n");
const forbidden = JSON.parse(text("forbidden.json") || "[]");
if (forbidden.includes(tool)) {
  fs.appendFileSync(st("forbidden.jsonl"), JSON.stringify({ tool, args }) + "\n");
  process.exitCode = 97;
} else if (tool === "telepty" && ["--version", "-v", "version"].includes(args[0])) {
  const raw = read("telepty.stdout");
  if (raw !== null) process.stdout.write(raw);
  const code = text("telepty.exitcode");
  process.exitCode = code ? Number(code) : 0;
}
`;

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// The shim passes the tool name only; the fake derives its own state dir.
function writeShims(dir, tool, sb) {
  if (IS_WIN) {
    fs.writeFileSync(path.join(dir, `${tool}.cmd`),
      `@echo off\r\n"${process.execPath}" "${sb.fakeJs}" ${tool} %*\r\nexit /b %ERRORLEVEL%\r\n`);
    fs.writeFileSync(path.join(dir, `${tool}.ps1`),
      `& ${psq(process.execPath)} ${psq(sb.fakeJs)} ${psq(tool)} @args\r\nexit $LASTEXITCODE\r\n`);
  } else {
    const p = path.join(dir, tool);
    fs.writeFileSync(p, `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(sb.fakeJs)} ${tool} "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
}

function mkSandbox(label) {
  const prev = process.umask(0o077);
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `st1145-${label.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 40)}-`));
    const sb = {
      root,
      home: path.join(root, "home"),
      xdg: path.join(root, "home", ".config"),
      tmp: path.join(root, "tmp"),
      fakebin: path.join(root, "fakebin"),
      state: path.join(root, "state"),
      fakeJs: path.join(root, "fake.js"),
    };
    for (const d of [sb.home, sb.xdg, sb.tmp, sb.fakebin, sb.state]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    fs.chmodSync(root, 0o700);
    fs.writeFileSync(sb.fakeJs, FAKE_JS);
    fs.writeFileSync(path.join(sb.state, "calls.jsonl"), "");
    fs.writeFileSync(path.join(sb.state, "forbidden.json"), JSON.stringify(FORBIDDEN));
    for (const t of [...RECORDERS, ...FORBIDDEN]) writeShims(sb.fakebin, t, sb);
    return sb;
  } finally {
    process.umask(prev);
  }
}

function installTelepty(sb, { stdout, exitCode }) {
  if (stdout !== undefined) fs.writeFileSync(path.join(sb.state, "telepty.stdout"), stdout);
  if (exitCode !== undefined) fs.writeFileSync(path.join(sb.state, "telepty.exitcode"), String(exitCode));
}

// Remove the fake telepty so the row measures a host without it on PATH.
function uninstallTelepty(sb) {
  for (const f of fs.readdirSync(sb.fakebin)) {
    if (/^telepty(\.cmd|\.ps1)?$/.test(f)) fs.unlinkSync(path.join(sb.fakebin, f));
  }
}

function baseEnv(sb) {
  const env = {
    HOME: sb.home,
    USERPROFILE: sb.home,
    XDG_CONFIG_HOME: sb.xdg,
    TMPDIR: sb.tmp,
    TMP: sb.tmp,
    TEMP: sb.tmp,
    LANG: "C",
    TERM: "dumb",
    USER: "fixture",
    LOGNAME: "fixture",
    AIGENTRY_LOGGER_DISABLED: "1",
    // Belt and braces: an npm escaping the tripwire could not reach a registry.
    npm_config_registry: "http://127.0.0.1:9/",
    npm_config_offline: "true",
  };
  if (IS_WIN) {
    const sys = process.env.SystemRoot || "C:\\Windows";
    for (const k of ["SystemRoot", "windir", "ComSpec", "PATHEXT", "SystemDrive"]) {
      if (process.env[k]) env[k] = process.env[k];
    }
    Object.assign(env, { USERPROFILE: sb.home, TEMP: sb.tmp, TMP: sb.tmp, USERNAME: "fixture" });
    // System32 only because win32 healthchecks go through cmd.exe (shell: true).
    env.PATH = [sb.fakebin, path.join(sys, "System32"), sys].join(";");
  } else {
    // Closed PATH: only the fakes. `status` spawns nothing but the healthcheck
    // commands, and the CLI itself is launched by absolute path.
    env.PATH = sb.fakebin;
  }
  return env;
}

function readCalls(sb) {
  const p = path.join(sb.state, "calls.jsonl");
  return (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// Snapshot every entry without following links. Only the fixture's deliberate
// append-only call log may change; its contents are checked separately below.
function fixtureTree(sb) {
  const entries = [];
  function visit(relative) {
    const file = path.join(sb.root, relative);
    const stat = fs.lstatSync(file);
    const entry = { path: relative, mode: stat.mode };
    if (stat.isDirectory()) {
      entry.type = "directory";
      entries.push(entry);
      for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
    } else {
      entry.type = stat.isSymbolicLink() ? "symlink" : "file";
      entry.bytes = stat.isSymbolicLink() ? fs.readlinkSync(file)
        : relative === path.join("state", "calls.jsonl") ? "fixture-call-log" : fs.readFileSync(file).toString("base64");
      entries.push(entry);
    }
  }
  visit("");
  return entries;
}

function runStatus(sb) {
  const before = fixtureTree(sb);
  const logBefore = fs.readFileSync(path.join(sb.state, "calls.jsonl"), "utf8");
  const r = spawnSync(process.execPath, [CLI, "status"], {
    cwd: sb.root,
    env: baseEnv(sb),
    encoding: "latin1",
    timeout: RUN_TIMEOUT_MS,
    windowsHide: true,
  });
  assert.deepEqual(fixtureTree(sb), before, "status must preserve the complete fixture tree and journal bytes");
  const logAfter = fs.readFileSync(path.join(sb.state, "calls.jsonl"), "utf8");
  assert.ok(logAfter.startsWith(logBefore), "fixture call log must remain append-only");
  const allowed = fs.readdirSync(MODULES_DIR).filter((f) => f.endsWith(".adapter.json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(MODULES_DIR, f), "utf8")).healthcheck?.command)
    .filter(Boolean).map((command) => command.split(/\s+/));
  for (const line of logAfter.slice(logBefore.length).split("\n").filter(Boolean)) {
    const call = JSON.parse(line);
    assert.ok(RECORDERS.includes(call.tool), "status invoked a forbidden executable");
    assert.ok(allowed.some(([tool, ...args]) => tool === call.tool && JSON.stringify(args) === JSON.stringify(call.args)),
      "status invoked an unexpected command or action");
  }
  const calls = readCalls(sb);
  const forbiddenPath = path.join(sb.state, "forbidden.jsonl");
  assert.equal(fs.existsSync(forbiddenPath), false, "status must not invoke any forbidden executable");
  return {
    code: r.status,
    signal: r.signal,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    calls,
    probes: calls.filter((c) => c.tool === "telepty" && ["--version", "-v", "version"].includes(c.args[0])),
    forbidden: fs.existsSync(forbiddenPath) ? fs.readFileSync(forbiddenPath, "utf8").split("\n").filter(Boolean) : [],
  };
}

// The `telepty` row of the status table: "telepty<pad>VERSION<pad>HEALTH".
function row(r, name) {
  const line = r.stdout.split(/\r?\n/).find((l) => new RegExp(`^${name}\\s`).test(l));
  if (!line) return null;
  const rest = line.slice(name.length).trim();
  const m = /^(\S+)\s+(\S+)$/.exec(rest);
  return m ? { version: m[1], health: m[2] } : { version: rest, health: "" };
}

function describe(r) {
  return [
    `exit=${r.code} signal=${r.signal}`,
    `probes=${JSON.stringify(r.probes.map((c) => c.args.join(" ")))}`,
    `forbidden=${JSON.stringify(r.forbidden)}`,
    `calls=${JSON.stringify(r.calls.map((c) => [c.tool, ...c.args].join(" ")))}`,
    "--- stdout ---",
    r.stdout.replace(/[^\x20-\x7e\n]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`),
    "--- stderr ---",
    r.stderr,
  ].join("\n");
}

const PAD = " ".repeat(2000);

const ROWS = [
  { id: "observed newer-compatible 0.8.9", stdout: "0.8.9\n", version: "0.8.9", health: "healthy" },
  { id: "observed exact pin 0.8.5", stdout: "0.8.5\n", version: "0.8.5", health: "healthy" },
  { id: "v-prefixed v0.8.7 normalizes", stdout: "v0.8.7\n", version: "0.8.7", health: "healthy" },
  { id: "numeric order 0.8.10", stdout: "0.8.10\n", version: "0.8.10", health: "healthy" },
  // status observes, it does not police: the range decision belongs to the installer.
  { id: "out-of-range 1.0.0 is still the observation", stdout: "1.0.0\n", version: "1.0.0", health: "healthy" },
  { id: "multi-token output -> unknown", stdout: "telepty 0.8.9\n", version: "unknown", health: "healthy" },
  { id: "prerelease -> unknown", stdout: "0.8.9-rc.1\n", version: "unknown", health: "healthy" },
  { id: "build metadata -> unknown", stdout: "0.8.9+build.7\n", version: "unknown", health: "healthy" },
  { id: "leading zero -> unknown", stdout: "0.08.9\n", version: "unknown", health: "healthy" },
  { id: "two versions on two lines -> unknown", stdout: "0.8.9\n0.8.6\n", version: "unknown", health: "healthy" },
  { id: "empty output -> unknown", stdout: "", version: "unknown", health: "healthy" },
  { id: "oversized output -> unknown", stdout: `0.8.9${PAD}EXTRA 9.9.9\n`, version: "unknown", health: "healthy" },
  { id: "nonzero exit -> unknown + unhealthy", stdout: "0.8.9\n", exitCode: 3, version: "unknown", health: "unhealthy" },
  { id: "absent telepty -> unknown + not-installed", absent: true, version: "unknown", health: "not-installed" },
];

for (const r of ROWS) {
  test(`status :: ${r.id}`, { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
    const sb = mkSandbox(r.id);
    try {
      if (r.absent) uninstallTelepty(sb);
      else installTelepty(sb, { stdout: r.stdout, exitCode: r.exitCode });
      const out = runStatus(sb);
      const d = describe(out);

      assert.equal(out.code, 0, `status must exit 0\n${d}`);
      assert.deepEqual(out.forbidden, [], `status invoked a forbidden tool\n${d}`);
      assert.equal(out.probes.length, r.absent ? 0 : 1, `exactly one telepty --version probe\n${d}`);

      const telepty = row(out, "telepty");
      assert.ok(telepty, `no telepty row in the status table\n${d}`);
      assert.equal(telepty.version, r.version, `Version column must be the observation\n${d}`);
      assert.equal(telepty.health, r.health, `Health column\n${d}`);

      // No declared adapter literal may ever be printed as a version.
      for (const declared of declaredVersions()) {
        assert.ok(!new RegExp(`(^|\\s)v?${declared.replace(/[.]/g, "\\.")}(\\s|$)`, "m").test(out.stdout)
          || declared === r.version,
          `status printed the declared literal ${declared}\n${d}`);
      }
      assert.ok(!out.stdout.includes("0.1.45"), `status printed the stale adapter pin 0.1.45\n${d}`);
    } finally {
      if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
    }
  });
}

test("status :: control bytes and injection payload in probe output -> unknown, inert", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("injection");
  const marker = path.join(sb.root, "pwned-1");
  try {
    installTelepty(sb, {
      stdout: `0.8.9 $(touch ${marker}) \`touch ${marker}\` ; touch ${marker} \u001b]0;pwned\u0007\b\r\u001b[38;5;199m\n`,
    });
    const out = runStatus(sb);
    const d = describe(out);

    assert.equal(out.code, 0, `status must exit 0\n${d}`);
    assert.ok(!fs.existsSync(marker), `injected command executed (created ${marker})\n${d}`);
    const telepty = row(out, "telepty");
    assert.ok(telepty, `no telepty row\n${d}`);
    assert.equal(telepty.version, "unknown", `payload must not be read as a version\n${d}`);
    for (const bad of ["\u0007", "\b", "\u001b]0;pwned", "\u001b[38;5;199m"]) {
      assert.ok(!out.stdout.includes(bad), `raw control sequence ${JSON.stringify(bad)} reached the output\n${d}`);
    }
    assert.ok(!/\r(?!\n)/.test(out.stdout), `bare carriage return reached the output\n${d}`);
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("status :: the observation uses the shipped identification rules, not a private copy", () => {
  const cli = fs.readFileSync(CLI, "utf8");
  assert.ok(/require\((?:"|')\.\.\/lib\/telepty-version-policy(?:"|')\)/.test(cli),
    "runStatus must identify versions through lib/telepty-version-policy.js (parseStable)");
  assert.ok(!/adapter\.version/.test(cli.slice(cli.indexOf("function runStatus"), cli.indexOf("function runInit"))),
    "runStatus must not read the adapter's declared version for display");
});

// The fake writes and reads only inside its own directory: its state location
// is derived from the script's own path, never received, so no argument can
// redirect a fixture read or write (#1145 phase 2 — the reported
// argv-to-filesystem flow is corrected at its origin, not suppressed). argv
// stays data: tool and args are recorded, never joined into a path.
test("fixture integrity :: the fake's state location is not an input", { timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("path-independence");
  try {
    const decoy = path.join(sb.root, "decoy");
    fs.mkdirSync(decoy, { recursive: true, mode: 0o700 });
    // A readable decoy forbidden.json would hijack the fake's control flow if
    // the state dir were an input; it must be ignored.
    fs.writeFileSync(path.join(decoy, "forbidden.json"), JSON.stringify(["telepty"]));
    const shaped = [decoy, path.join(decoy, "calls.jsonl"), `..${path.sep}..${path.sep}escape`];
    const r = spawnSync(process.execPath, [sb.fakeJs, ...shaped], {
      cwd: sb.root,
      env: { PATH: sb.fakebin, HOME: sb.home, TMPDIR: sb.tmp, LANG: "C" },
      encoding: "utf8",
      timeout: RUN_TIMEOUT_MS,
      windowsHide: true,
    });
    const d = `exit=${r.status} signal=${r.signal}\n${r.stdout}${r.stderr}`;
    assert.deepEqual(fs.readdirSync(decoy), ["forbidden.json"],
      `an argv value redirected a fixture write into ${decoy}\n${d}`);
    assert.ok(!fs.existsSync(path.join(sb.root, "escape")) && !fs.existsSync(path.join(os.tmpdir(), "escape")),
      `an argv value escaped the sandbox\n${d}`);
    const calls = readCalls(sb);
    assert.equal(calls.length, 1, `the call must be logged in the derived state dir\n${d}`);
    assert.equal(calls[0].tool, shaped[0], "argv must be recorded as data");
    assert.deepEqual(calls[0].args, shaped.slice(1), "argv must be recorded as data");
    assert.ok(!fs.existsSync(path.join(sb.state, "forbidden.jsonl")),
      `the decoy forbidden list was read from an argv path\n${d}`);
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("status :: fixture precondition: no real telepty or npm on the sandbox PATH", () => {
  const sb = mkSandbox("precondition");
  try {
    const env = baseEnv(sb);
    const found = (cmd) => {
      for (const dir of env.PATH.split(path.delimiter)) {
        const p = path.join(dir, cmd);
        if (fs.existsSync(p)) return p;
      }
      return null;
    };
    assert.equal(found(IS_WIN ? "telepty.cmd" : "telepty"), path.join(sb.fakebin, IS_WIN ? "telepty.cmd" : "telepty"),
      "telepty must resolve to the fake");
    assert.equal(found(IS_WIN ? "npm.cmd" : "npm"), path.join(sb.fakebin, IS_WIN ? "npm.cmd" : "npm"),
      "npm must resolve to the tripwire");
    uninstallTelepty(sb);
    assert.equal(found(IS_WIN ? "telepty.cmd" : "telepty"), null, "absent rows must have no telepty anywhere on PATH");
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

// ── #1147 recovery-journal reader states ───────────────────────────────────
//
// `status` must answer "what is still unresolved?" through the ONE shared fold
// exported by lib/install-state.js (readJournal + unresolvedPhases), never by
// re-deriving chronological folding of its own. So these rows build the journal
// with the REAL writer — begin-run / phase-begin / phase-end — and the subject
// is that original fold over real journal bytes, not a copied builder.
//
// Four reader states must stay distinguishable: absent, valid-and-resolved,
// valid-and-unresolved, and corrupt/unsupported. The last one is the dangerous
// one: `unresolved_phases` is `null` there, meaning UNKNOWN, and rendering it as
// zero/none/nothing-unresolved would tell a user the opposite of the truth.
//
// The state root is not invented here either: it is the installer's own
// ${XDG_CONFIG_HOME:-$HOME/.config}/aigentry-devkit, and baseEnv already points
// XDG_CONFIG_HOME at the sandbox, so the reader and the fixture agree by
// construction.
const JOURNAL_CLI = path.join(REPO, "lib", "install-state.js");

const stateDir = (sb) => path.join(sb.xdg, "aigentry-devkit");
const journalPath = (sb) => path.join(stateDir(sb), "install-journal.json");
const lockPath = (sb) => path.join(stateDir(sb), "install-journal.lock");

// The real writer. Returns the raw result so a row can assert a refusal too.
function writer(sb, ...args) {
  return spawnSync(process.execPath, [JOURNAL_CLI, ...args, "--dir", stateDir(sb)],
    { cwd: sb.root, env: baseEnv(sb), encoding: "utf8", timeout: RUN_TIMEOUT_MS, windowsHide: true });
}

function beginRun(sb, components, extra = []) {
  const r = writer(sb, "begin-run", "--installer", "install.sh", "--profile", "core",
    "--components", components, "--start-phase", "0", ...extra);
  assert.equal(r.status, 0, `begin-run must open an attempt: ${r.stdout}${r.stderr}`);
  return r.stdout.split("\t")[1];
}

// A phase left `running` with no terminal record: exactly what a SIGKILL leaves,
// since no handler can run. The lock goes with the dead process.
function seedRunningPhase(sb, phase, components) {
  const runId = beginRun(sb, components);
  assert.equal(writer(sb, "phase-begin", "--run", runId, "--phase", String(phase)).status, 0);
  fs.rmSync(lockPath(sb), { force: true });
  return runId;
}

function recoveryLine(stdout) {
  return stdout.split(/\r?\n/).find((l) => /^Recovery journal:/.test(l)) || null;
}

// Nothing in a read may be reported as a count of zero, as "none" or as
// "nothing unresolved" when the honest answer is "unknown".
function assertNotAVerdictOfZero(line, d) {
  for (const bad of [/\bnothing\b/i, /\bnone\b/i, /:\s*0\b/, /\b0 phases?\b/i, /\bno phase\b/i]) {
    assert.ok(!bad.test(line), `an UNKNOWN answer must not read as zero/none: ${JSON.stringify(line)}\n${d}`);
  }
}

test("status :: recovery — an absent journal reads as none recorded, not as a verdict", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("recovery-absent");
  try {
    installTelepty(sb, { stdout: "0.8.9\n" });
    assert.equal(fs.existsSync(journalPath(sb)), false, "precondition: no journal");
    const out = runStatus(sb);
    const d = describe(out);

    assert.equal(out.code, 0, `status must exit 0\n${d}`);
    const line = recoveryLine(out.stdout);
    assert.ok(line, `status must report the recovery journal state\n${d}`);
    assert.match(line, /none recorded/i, `an absent journal is "none recorded"\n${d}`);
    assert.ok(!/none has run here yet/i.test(out.stdout), "absence cannot prove no installation ran");
    // Absent must stay distinguishable from a journal that exists and is clean.
    assert.ok(!/^Recovery journal:\s*ok\b/.test(line), `absent must not be reported as ok\n${d}`);
    assert.deepEqual(out.forbidden, [], `status invoked a forbidden tool\n${d}`);
    // Reading must not create the state root or any file in it.
    assert.equal(fs.existsSync(journalPath(sb)), false, `status wrote a journal\n${d}`);
    assert.equal(fs.existsSync(lockPath(sb)), false, `status created a lock\n${d}`);
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("status :: recovery — a clean completion reads as resolved", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("recovery-resolved");
  try {
    installTelepty(sb, { stdout: "0.8.9\n" });
    const runId = beginRun(sb, "dustcraw");
    assert.equal(writer(sb, "phase-begin", "--run", runId, "--phase", "5").status, 0);
    assert.equal(writer(sb, "phase-end", "--run", runId, "--phase", "5", "--status", "completed").status, 0);

    const out = runStatus(sb);
    const d = describe(out);
    assert.equal(out.code, 0, `status must exit 0\n${d}`);
    const line = recoveryLine(out.stdout);
    assert.ok(line, `status must report the recovery journal state\n${d}`);
    assert.match(line, /^Recovery journal:\s*ok\b/, `a readable journal is ok\n${d}`);
    assert.ok(!/not proven resolved/i.test(line), `a clean completion must resolve the phase\n${d}`);
    assert.ok(!/\b5\b/.test(line), `phase 5 must not be named as unresolved\n${d}`);
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("status :: recovery — a phase still running is reported unresolved, never as nothing", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("recovery-running");
  try {
    installTelepty(sb, { stdout: "0.8.9\n" });
    seedRunningPhase(sb, 5, "dustcraw");
    const raw = fs.readFileSync(journalPath(sb));
    const before = fs.readdirSync(stateDir(sb)).sort();
    assert.equal(JSON.parse(raw.toString("utf8")).attempts[0].phases[0].status, "running",
      "precondition: the record is still `running` on disk");

    const out = runStatus(sb);
    const d = describe(out);
    assert.equal(out.code, 0, `status must exit 0\n${d}`);
    const line = recoveryLine(out.stdout);
    assert.ok(line, `status must report the recovery journal state\n${d}`);
    assert.match(line, /not proven resolved/i, `a running phase is not proven resolved\n${d}`);
    assert.match(line, /\b5\b/, `the unresolved phase must be named\n${d}`);
    assert.ok(!/no phase is left unresolved/i.test(line), `must not claim nothing is unresolved\n${d}`);

    // Read-only: not one byte of the journal, and no new file in the state root.
    assert.deepEqual(fs.readFileSync(journalPath(sb)), raw, `status rewrote the journal\n${d}`);
    assert.deepEqual(fs.readdirSync(stateDir(sb)).sort(), before, `status changed the state directory\n${d}`);
    assert.deepEqual(out.forbidden, [], `status invoked a forbidden tool\n${d}`);
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("status :: recovery — a degraded completion does not clear a prior unknown", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("recovery-degraded");
  try {
    installTelepty(sb, { stdout: "0.8.9\n" });
    // Interrupted phase 5 (global-npm+external-init, replay: unknown).
    seedRunningPhase(sb, 5, "dustcraw");
    // An ordinary run refuses and persists running -> unknown, releasing its own lock.
    const refused = writer(sb, "begin-run", "--installer", "install.sh", "--profile", "core",
      "--components", "dustcraw", "--start-phase", "0");
    assert.equal(refused.status, 1, `the unknown effect must be refused: ${refused.stdout}${refused.stderr}`);
    assert.equal(JSON.parse(fs.readFileSync(journalPath(sb), "utf8")).attempts[0].phases[0].status, "unknown",
      "precondition: the interrupted record is now unknown");
    // The user replays it explicitly, and it soft-fails: completed + degraded.
    const replayId = beginRun(sb, "dustcraw", ["--unknown-effect", "replay"]);
    assert.equal(writer(sb, "phase-end", "--run", replayId, "--phase", "5",
      "--status", "completed", "--degraded", "1", "--detail", "dustcraw init failed").status, 0);

    const out = runStatus(sb);
    const d = describe(out);
    assert.equal(out.code, 0, `status must exit 0\n${d}`);
    const line = recoveryLine(out.stdout);
    assert.ok(line, `status must report the recovery journal state\n${d}`);
    assert.match(line, /not proven resolved/i, `a degraded replay cannot answer the question\n${d}`);
    assert.match(line, /\b5\b/, `phase 5 must still be named\n${d}`);
    assert.ok(!/no phase is left unresolved/i.test(line), `must not claim nothing is unresolved\n${d}`);
    // The raw history is retained, degraded fact and all.
    const j = JSON.parse(fs.readFileSync(journalPath(sb), "utf8"));
    assert.equal(j.attempts[0].phases[0].status, "unknown", "the original unknown is preserved");
    assert.equal(j.attempts[1].phases.filter((p) => p.phase === 5)[0].degraded, true, "the degraded fact is preserved");
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

for (const row of [
  {
    id: "corrupt", expect: /^Recovery journal:\s*corrupt\b/,
    seed: (sb) => {
      const runId = beginRun(sb, "dustcraw");
      assert.equal(writer(sb, "phase-begin", "--run", runId, "--phase", "5").status, 0);
      const raw = fs.readFileSync(journalPath(sb));
      fs.writeFileSync(journalPath(sb), raw.subarray(0, 100)); // torn write
    },
  },
  {
    id: "unsupported", expect: /^Recovery journal:\s*unsupported\b/,
    seed: (sb) => {
      beginRun(sb, "dustcraw");
      const journal = JSON.parse(fs.readFileSync(journalPath(sb), "utf8"));
      journal.schema = "aigentry-devkit/install-journal@99";
      fs.writeFileSync(journalPath(sb), `${JSON.stringify(journal)}\n`);
    },
  },
]) {
  test(`status :: recovery — a ${row.id} journal reads as UNKNOWN, never as zero`, { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
    const sb = mkSandbox(`recovery-${row.id}`);
    try {
      installTelepty(sb, { stdout: "0.8.9\n" });
      row.seed(sb);
      const raw = fs.readFileSync(journalPath(sb));

      const out = runStatus(sb);
      const d = describe(out);
      assert.equal(out.code, 0, `status must keep its exit behaviour\n${d}`);
      const line = recoveryLine(out.stdout);
      assert.ok(line, `status must report the recovery journal state\n${d}`);
      assert.match(line, row.expect, `the ${row.id} state must be named\n${d}`);
      assert.match(line, /unknown/i, `an unreadable journal answers UNKNOWN\n${d}`);
      // The whole point: `unresolved_phases: null` may never read as "nothing".
      assertNotAVerdictOfZero(line, d);
      assert.ok(!/not proven resolved/i.test(line), `UNKNOWN is not a list of phases\n${d}`);
      // Preserved, never repaired or rewritten by a read.
      assert.deepEqual(fs.readFileSync(journalPath(sb)), raw, `status rewrote an unreadable journal\n${d}`);
      assert.deepEqual(out.forbidden, [], `status invoked a forbidden tool\n${d}`);
    } finally {
      if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
    }
  });
}

test("status :: recovery — the answer comes from the shared fold, not a private re-derivation", () => {
  const cli = fs.readFileSync(CLI, "utf8");
  assert.ok(/require\((?:"|')\.\.\/lib\/install-state(?:"|')\)/.test(cli),
    "status must read through lib/install-state.js (readJournal + unresolvedPhases)");
  assert.ok(/unresolvedPhases/.test(cli),
    "status must call the exported fold rather than name its own");
  // No second chronological fold: the CLI must not walk attempts/phases itself.
  assert.ok(!/\.attempts\b/.test(cli),
    "the CLI must not iterate journal attempts[] — that is the shared fold's job");
  // No second state root: the journal directory is the installer's own.
  const roots = [...cli.matchAll(/aigentry-devkit["']\s*,/g)].length
    + [...cli.matchAll(/["']aigentry-devkit["']/g)].length;
  assert.ok(roots > 0, "the CLI must derive the installer's state directory");
  assert.ok(/XDG_CONFIG_HOME/.test(cli), "the state root must come from the installer contract");
});

test("status :: recovery — a valid phaseless journal is recorded and resolved", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("recovery-empty");
  try {
    beginRun(sb, "");
    const journal = JSON.parse(fs.readFileSync(journalPath(sb), "utf8"));
    assert.deepEqual(journal.attempts[0].phases, [], "real writer produced no phase records");
    const out = runStatus(sb);
    assert.equal(out.code, 0, describe(out));
    assert.match(recoveryLine(out.stdout), /^Recovery journal: ok.*no phase is left unresolved/);
    assert.ok(!/none recorded/i.test(out.stdout), "recorded-empty differs from absent");
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("status :: recovery — a clean replay resolves an earlier unknown without erasing history", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("recovery-clean-replay");
  try {
    seedRunningPhase(sb, 5, "dustcraw");
    const refused = writer(sb, "begin-run", "--components", "dustcraw", "--start-phase", "0");
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    const replay = beginRun(sb, "dustcraw", ["--unknown-effect", "replay"]);
    assert.equal(writer(sb, "phase-begin", "--run", replay, "--phase", "5").status, 0);
    assert.equal(writer(sb, "phase-end", "--run", replay, "--phase", "5", "--status", "completed").status, 0);
    const journal = JSON.parse(fs.readFileSync(journalPath(sb), "utf8"));
    assert.equal(journal.attempts[0].phases[0].status, "unknown");
    assert.equal(journal.attempts[1].phases[0].status, "completed");
    const out = runStatus(sb);
    assert.equal(out.code, 0, describe(out));
    assert.match(recoveryLine(out.stdout), /^Recovery journal: ok.*no phase is left unresolved/);
    assert.ok(!/not proven resolved/.test(recoveryLine(out.stdout)));
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("status :: recovery — a pending safe phase does not imply unconditional replay refusal", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("recovery-safe");
  try {
    seedRunningPhase(sb, 1, "devkit-core");
    const out = runStatus(sb);
    assert.equal(out.code, 0, describe(out));
    assert.match(recoveryLine(out.stdout), /not proven resolved: 1 \(devkit-core\)/);
    assert.ok(!/installer refuses an ordinary re-run/i.test(out.stdout));
    assert.match(out.stdout, /Replay handling depends on each phase's policy/);
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});
