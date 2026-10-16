// Caller regressions for the telepty install-version decision (#1213).
//
// Drives the REAL callers — `bash install.sh`, `install.ps1` (pwsh and Windows
// PowerShell 5.1), `aigentry-devkit setup` and `aigentry-devkit update` — against
// inert fixtures: a synthetic HOME/XDG/TMP per run and fake npm/npx/telepty/curl/
// tmux/claude (plus refusing sentinels for git/brew/sudo/launchctl/systemctl/...)
// first on PATH. Every fake call is logged (state/calls.jsonl) so each row proves
// what the installer did and that no real operation ran. Nothing touches the real
// registry, global npm prefix, daemon, launchd/systemd or the user's config.
//
// Platform scope (documented, not a blanket skip):
//   - install.sh rows run on POSIX (ubuntu/macos). win32 setup goes through
//     install.ps1, so the same rows run there through pwsh and powershell.exe.
//   - install.ps1 rows run natively on windows-latest only (its paths are
//     backslash-joined; it is not a POSIX caller). A missing PowerShell on win32
//     FAILS the row instead of skipping it.
//   - On Node < 20 (CI Node 18 leg) every row expects the telepty engine refusal:
//     nonzero exit before any telepty npm call, daemon start or health probe. The
//     runtime is the real one; nothing fakes process.versions.
//
// install.ps1 notes (SOURCE-ONLY, to be confirmed by Windows CI):
//   - `Should-RunPhase N -and (Test-ComponentSelected ...)` passes `-and` as an
//     argument, so phases 3-6 may run regardless of AIGENTRY_INSTALL_COMPONENTS.
//     The fixture pre-fills their existing env knobs (no prompts) and the fake npm
//     absorbs their installs; assertions only count telepty npm calls.
//   - Rows start at AIGENTRY_INSTALL_RESUME=2 so Phase 1 never writes into the
//     runner's real profile. Phase 7 still writes install-state under XDG_CONFIG_HOME.
//   - The summary (`$((if ...))`) may throw after Phase 7, so pwsh success rows
//     prove completion of Phase 2 by health + install-state, and a dedicated row
//     asserts the full-run exit code.
//
// Local overrides: AIGENTRY_TEST_BASH=<bash> (the bash used for `bash install.sh`),
// AIGENTRY_TEST_KEEP=1 (keep sandboxes under os.tmpdir() for inspection).
//
// Run: node --test tests/install-telepty-version.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const INSTALL_SH = path.join(REPO, "install.sh");
const INSTALL_PS1 = path.join(REPO, "install.ps1");
const CLI = path.join(REPO, "bin", "aigentry-devkit.js");
const MANIFEST = path.join(REPO, "config", "installer-manifest.json");
const POLICY_REL = "lib/telepty-version-policy.js";

const PKG = "@dmsdc-ai/aigentry-telepty";
const PIN = "0.8.5";
const MIN = "0.8.5";
const MAX = "0.9.0";
const NODE_MIN = "20.0.0";
const SPEC = `${PKG}@${PIN}`;

const IS_WIN = process.platform === "win32";
const RUN_TIMEOUT_MS = 240000;
const HANG_MS = 120000; // a hanging `telepty --version` exits by itself after this
const HANG_BUDGET_MS = 90000; // the installer must give up well before that
const LATE_HANG_MS = 20000; // lateHang rows: a --version after the first one hangs this long
const KEEP = process.env.AIGENTRY_TEST_KEEP === "1";

const RECORDERS = ["npm", "npx", "curl", "tmux", "claude"];
const FORBIDDEN = IS_WIN
  ? ["git", "brew", "winget", "choco", "scoop", "schtasks", "sudo"]
  : ["git", "brew", "sudo", "launchctl", "systemctl", "apt-get", "dnf", "yum", "pacman", "open", "cmux", "direnv"];

function cmpVer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}
const RUNTIME_OK = cmpVer(process.versions.node, NODE_MIN) >= 0;

function which(cmd) {
  const exts = IS_WIN ? (process.env.PATHEXT || ".EXE;.CMD").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch (_) { /* next */ }
    }
  }
  return null;
}

const REAL_BASH = IS_WIN ? null : process.env.AIGENTRY_TEST_BASH || which("bash");
const PWSH = IS_WIN ? which("pwsh") : null;
const WINPS = IS_WIN
  ? which("powershell") || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : null;

// ── manifest fixtures (one place knows where the bounds live) ───────────────

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}
function setPin(m, v) {
  m.components.telepty.install.version = v;
  m.compatibility.telepty.target = v;
}
function setBound(m, key, v) {
  // key: minimum | maximum_exclusive | node_minimum
  if (v === undefined) delete m.compatibility.telepty[key];
  else m.compatibility.telepty[key] = v;
}

// ── fake commands ───────────────────────────────────────────────────────────

const FAKE_JS = String.raw`"use strict";
// Inert fake for task-1213 installer tests. argv: <tool> ...args.
// All paths are fixed relative to this emitted program, never argv or env.
const fs = require("fs");
const path = require("path");
const stateDir = path.join(__dirname, "state");
const tool = process.argv[2];
const args = process.argv.slice(3);
const PKG = "@dmsdc-ai/aigentry-telepty";
const tools = ["npm", "npx", "curl", "tmux", "claude", "telepty", "git", "brew", "sudo", "launchctl", "systemctl", "apt-get", "dnf", "yum", "pacman", "open", "cmux", "direnv", "winget", "choco", "scoop", "schtasks"];
const leaves = ["calls.jsonl", "forbidden.json", "npm.mode", "registry.latest", "npm.wrong", "telepty.version", "telepty.stdout", "telepty.exitcode", "telepty.hang", "telepty.hang-late", "transitions.log"];
if (!tools.includes(tool) || (tool === "npm" &&
    !(args.length === 3 && ["install", "i", "add"].includes(args[0]) &&
      ["-g", "--global"].includes(args[1]) && (args[2] === PKG || args[2].startsWith(PKG + "@"))))) process.exit(98);
function check(file, directory, optional = false) {
  let s;
  try { s = fs.lstatSync(file); } catch (err) { if (optional && err.code === "ENOENT") return; throw err; }
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1) ||
      fs.realpathSync(file) !== path.resolve(file)) throw Error("unsafe fixture path");
}
const st = (n) => { if (!leaves.includes(n)) throw Error("unknown fixture leaf"); return path.join(stateDir, n); };
const read = (n) => { try { return fs.readFileSync(st(n)); } catch (_) { return null; } };
const text = (n) => { const b = read(n); return b === null ? null : b.toString("utf8"); };
function log(extra) {
  fs.appendFileSync(st("calls.jsonl"), JSON.stringify(Object.assign({ tool, args, pid: process.pid, t: Date.now() }, extra || {})) + "\n");
}
try {
check(__dirname, true);
check(stateDir, true);
for (const name of leaves) check(st(name), false, true);
const gb = path.join(__dirname, "globalbin");
const shims = path.join(stateDir, "shims");
const shimNames = process.platform === "win32" ? ["telepty.cmd", "telepty.ps1"] : ["telepty"];
if (tool === "npm") {
  check(gb, true); check(shims, true);
  for (const name of shimNames) { check(path.join(shims, name), false); check(path.join(gb, name), false, true); }
}
const forbidden = JSON.parse(text("forbidden.json") || "[]");
if (forbidden.includes(tool)) {
  log({ forbidden: true });
  process.exitCode = 97;
} else if (tool === "npm") {
  log();
  const mode = (text("npm.mode") || "ok").trim();
  const isInstall = ["install", "i", "add"].includes(args[0]) && args.some((a) => a === "-g" || a === "--global");
  const spec = args.find((a) => a === PKG || a.startsWith(PKG + "@"));
  if (mode === "offline") {
    process.stderr.write("npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/ failed, reason: getaddrinfo ENOTFOUND\n");
    process.exitCode = 1;
  } else if (isInstall && spec && mode !== "noop") {
    let ver = spec === PKG ? "" : spec.slice(PKG.length + 1);
    if (ver === "" || ver === "latest") ver = (text("registry.latest") || "0.9.4").trim();
    if (mode === "wrong") ver = text("npm.wrong").trim();
    const before = text("telepty.version");
    fs.writeFileSync(st("telepty.version"), ver);
    for (const f of ["telepty.stdout", "telepty.exitcode", "telepty.hang"]) { try { fs.unlinkSync(st(f)); } catch (_) {} }
    for (const f of shimNames) {
      fs.copyFileSync(path.join(shims, f), path.join(gb, f));
      if (process.platform !== "win32") fs.chmodSync(path.join(gb, f), 0o755);
    }
    fs.appendFileSync(st("transitions.log"), "telepty " + (before === null ? "ABSENT" : before) + " -> " + ver + " (spec=" + spec + ")\n");
  }
} else if (tool === "telepty") {
  log();
  if (["--version", "-v", "version"].includes(args[0])) {
    const hang = text("telepty.hang");
    // telepty.hang-late: only the first --version answers; any later one hangs.
    const late = text("telepty.hang-late");
    const nth = late ? text("calls.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      .filter((c) => c.tool === "telepty" && ["--version", "-v", "version"].includes(c.args[0])).length : 0;
    if (hang || nth > 1) {
      setTimeout(() => {}, Number(hang || late));
    } else {
      const raw = read("telepty.stdout");
      process.stdout.write(raw !== null ? raw : Buffer.from((text("telepty.version") || "") + "\n"));
      const code = text("telepty.exitcode");
      process.exitCode = code ? Number(code) : 0;
    }
  }
} else {
  log();
}
} catch (_) { process.stderr.write("fixture: unsafe or unavailable owned layout\n"); process.exitCode = 98; }
`;

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `tpv-${label.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 40)}-`));
  const sb = {
    root,
    home: path.join(root, "home"),
    xdg: path.join(root, "home", ".config"),
    tmp: path.join(root, "tmp"),
    fakebin: path.join(root, "fakebin"),
    globalbin: path.join(root, "globalbin"),
    state: path.join(root, "state"),
    shims: path.join(root, "state", "shims"),
    fakeJs: path.join(root, "fake.js"),
    log: path.join(root, "run.log"),
  };
  for (const d of [sb.home, sb.xdg, sb.tmp, sb.fakebin, sb.globalbin, sb.shims]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(sb.fakeJs, FAKE_JS);
  fs.writeFileSync(path.join(sb.state, "calls.jsonl"), "");
  fs.writeFileSync(path.join(sb.state, "forbidden.json"), JSON.stringify(FORBIDDEN));
  for (const t of [...RECORDERS, ...FORBIDDEN]) writeShims(sb.fakebin, t, sb);
  writeShims(sb.shims, "telepty", sb);
  if (!IS_WIN) {
    for (const [name, target] of [["node", process.execPath], ["bash", REAL_BASH]]) {
      const p = path.join(sb.fakebin, name);
      fs.writeFileSync(p, `#!/bin/sh\nexec ${sq(target)} "$@"\n`);
      fs.chmodSync(p, 0o755);
    }
  }
  return sb;
}

function installTelepty(sb, { version, stdout, exitCode, hang }) {
  fs.writeFileSync(path.join(sb.state, "telepty.version"), version);
  if (stdout !== undefined) fs.writeFileSync(path.join(sb.state, "telepty.stdout"), stdout);
  if (exitCode !== undefined) fs.writeFileSync(path.join(sb.state, "telepty.exitcode"), String(exitCode));
  if (hang) fs.writeFileSync(path.join(sb.state, "telepty.hang"), String(HANG_MS));
  for (const f of fs.readdirSync(sb.shims)) {
    fs.copyFileSync(path.join(sb.shims, f), path.join(sb.globalbin, f));
    if (!IS_WIN) fs.chmodSync(path.join(sb.globalbin, f), 0o755);
  }
}

// Fingerprint of the "installed telepty": global bin entries + modeled version bytes.
function installedFingerprint(sb) {
  const h = crypto.createHash("sha256");
  for (const f of fs.readdirSync(sb.globalbin).sort()) {
    h.update(f);
    h.update(fs.readFileSync(path.join(sb.globalbin, f)));
  }
  for (const f of ["telepty.version", "telepty.stdout", "telepty.exitcode"]) {
    const p = path.join(sb.state, f);
    h.update(`${f}:${fs.existsSync(p) ? fs.readFileSync(p).toString("base64") : "-"}`);
  }
  return h.digest("hex");
}

function installedVersion(sb) {
  const has = fs.readdirSync(sb.globalbin).some((f) => /^telepty(\.cmd|\.ps1)?$/.test(f));
  if (!has) return "ABSENT";
  return fs.readFileSync(path.join(sb.state, "telepty.version"), "utf8");
}

function baseEnv(sb, health) {
  const env = {
    HOME: sb.home,
    XDG_CONFIG_HOME: sb.xdg,
    TMPDIR: sb.tmp,
    LANG: "C",
    TERM: "dumb",
    USER: "fixture",
    LOGNAME: "fixture",
    AIGENTRY_LOGGER_DISABLED: "1",
    AIGENTRY_TELEPTY_URL: health ? health.url : "http://127.0.0.1:9",
    // Belt and braces: a real npm escaping the fakes could not reach a registry.
    npm_config_registry: "http://127.0.0.1:9/",
    npm_config_offline: "true",
    // install.ps1 phases 4-6 may run despite the component filter (see header);
    // pre-fill their existing knobs so nothing prompts.
    AIGENTRY_BRAIN_PROJECT_ID: "fixture",
    AIGENTRY_DUSTCRAW_PRESET: "tech-business",
    AIGENTRY_DUSTCRAW_RUN_DEMO: "no",
    AIGENTRY_DUSTCRAW_ENABLE_SERVICE: "no",
    AIGENTRY_REGISTRY_MODE: "skip",
  };
  if (IS_WIN) {
    const sys = process.env.SystemRoot || "C:\\Windows";
    for (const k of ["SystemRoot", "windir", "ComSpec", "PATHEXT", "SystemDrive", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "OS"]) {
      if (process.env[k]) env[k] = process.env[k];
    }
    Object.assign(env, {
      USERPROFILE: sb.home,
      APPDATA: path.join(sb.home, "AppData", "Roaming"),
      LOCALAPPDATA: path.join(sb.home, "AppData", "Local"),
      TEMP: sb.tmp,
      TMP: sb.tmp,
      USERNAME: "fixture",
    });
    const dirs = [...(sb.extraPath ? [sb.extraPath] : []), sb.fakebin, sb.globalbin, path.dirname(process.execPath)];
    if (PWSH) dirs.push(path.dirname(PWSH));
    dirs.push(path.join(sys, "System32"), sys, path.join(sys, "System32", "Wbem"), path.join(sys, "System32", "WindowsPowerShell", "v1.0"));
    env.PATH = dirs.join(";");
  } else {
    env.PATH = [...(sb.extraPath ? [sb.extraPath] : []), sb.fakebin, sb.globalbin, "/usr/bin", "/bin"].join(":");
  }
  return env;
}

// Loopback-only stand-in for the telepty daemon's /api/meta (install.ps1 polls
// $AIGENTRY_TELEPTY_URL with Invoke-RestMethod; install.sh's curl is faked).
function startHealthServer() {
  return new Promise((resolve, reject) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push(req.url);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ version: "fixture" }));
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function killTree(pid) {
  if (IS_WIN) spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
  else {
    try { process.kill(-pid, "SIGKILL"); } catch (_) { /* gone */ }
  }
}

function readCalls(sb) {
  // Calls made through the extra PATH entry's telepty (own state dir) count too, tagged extra.
  return [[sb.state, false], ...(sb.extraStates || []).map((s) => [s, true])].flatMap(([dir, extra]) => {
    const p = path.join(dir, "calls.jsonl");
    return (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "")
      .split("\n").filter(Boolean).map((l) => Object.assign(JSON.parse(l), extra ? { extra } : {}));
  });
}

function readState(sb) {
  const p = path.join(sb.xdg, "aigentry-devkit", "install-state.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

const norm = (v) => (Array.isArray(v) ? v.join(" ") : v == null ? v : String(v)).trim().replace(/^v/, "");

function writeManifest(sb, manifest) {
  const p = path.join(sb.root, "installer-manifest.fixture.json");
  if (manifest === "malformed") fs.writeFileSync(p, fs.readFileSync(MANIFEST, "utf8").slice(0, 200));
  else {
    const m = readManifest();
    manifest(m, sb);
    fs.writeFileSync(p, JSON.stringify(m, null, 2));
  }
  return p;
}


// D1 CLI effects oracle: all fixture bytes/types/modes except harness stdout.
function cliTree(root, log) {
  const out = [];
  function walk(p) {
    if (p === log) return;
    const st = fs.lstatSync(p);
    out.push([path.relative(root,p), st.mode, st.isSymbolicLink() ? fs.readlinkSync(p) : st.isFile() ? fs.readFileSync(p).toString("base64") : null]);
    if (st.isDirectory()) for (const f of fs.readdirSync(p).sort()) walk(path.join(p,f));
  }
  walk(root); return out;
}

async function runCaller(caller, sb, row) {
  const health = IS_WIN ? await startHealthServer() : null;
  const env = { ...baseEnv(sb, health), ...(row.env || {}) };
  const manifestPath = row.manifest ? writeManifest(sb, row.manifest) : null;
  let cmd;
  let args;
  if (caller === "sh") {
    cmd = path.join(sb.fakebin, "bash");
    args = [INSTALL_SH];
    env.AIGENTRY_INSTALL_COMPONENTS = row.components || "telepty";
    if (manifestPath) env.AIGENTRY_INSTALL_MANIFEST = manifestPath;
  } else if (caller === "pwsh" || caller === "ps51") {
    cmd = caller === "pwsh" ? PWSH : WINPS;
    args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INSTALL_PS1];
    env.AIGENTRY_INSTALL_COMPONENTS = row.components || "telepty";
    env.AIGENTRY_INSTALL_RESUME = "2";
    if (manifestPath) env.AIGENTRY_INSTALL_MANIFEST = manifestPath;
  } else {
    cmd = process.execPath;
    args = [CLI, caller === "cli-update" ? "update" : "setup"];
    if (caller === "cli-setup") args.push("--profile", "core");
    if (manifestPath) args.push("--manifest", manifestPath);
    if (IS_WIN) args.push("--resume", "telepty");
  }

  const before = { fingerprint: installedFingerprint(sb), version: installedVersion(sb) };
  const cliBefore = caller.startsWith("cli-") ? cliTree(sb.root, sb.log) : null;
  const out = fs.openSync(sb.log, "w");
  const t0 = Date.now();
  let child;
  const code = await new Promise((resolve) => {
    child = spawn(cmd, args, { cwd: sb.root, env, stdio: ["ignore", out, out], detached: !IS_WIN, windowsHide: true });
    const timer = setTimeout(() => { killTree(child.pid); resolve("timeout"); }, RUN_TIMEOUT_MS);
    child.on("exit", (c, s) => { clearTimeout(timer); resolve(c === null ? `signal:${s}` : c); });
    child.on("error", (e) => { clearTimeout(timer); resolve(`error:${e.message}`); });
  });
  const elapsed = Date.now() - t0;
  fs.closeSync(out);

  // Any fake still running after the installer exited was leaked by it.
  const calls = readCalls(sb);
  const deadline = Date.now() + 3000;
  let alive = [];
  do {
    alive = [...new Set(calls.map((c) => c.pid))].filter(isAlive);
    if (alive.length) await new Promise((r) => setTimeout(r, 200));
  } while (alive.length && Date.now() < deadline);
  const leaked = calls.filter((c) => alive.includes(c.pid));
  for (const pid of alive) { try { process.kill(pid, "SIGKILL"); } catch (_) { /* gone */ } }
  if (!IS_WIN) killTree(child.pid);
  if (health) await health.close();

  const output = fs.readFileSync(sb.log, "utf8");
  const teleptyNpm = calls.filter((c) => c.tool === "npm" && c.args.some((a) => a === PKG || a.startsWith(`${PKG}@`)));
  return {
    caller,
    cliBefore,
    cliAfter: caller.startsWith("cli-") ? cliTree(sb.root, sb.log) : null,
    code,
    elapsed,
    output,
    calls,
    leaked,
    before,
    after: { fingerprint: installedFingerprint(sb), version: installedVersion(sb) },
    specs: teleptyNpm.map((c) => c.args.find((a) => a === PKG || a.startsWith(`${PKG}@`))),
    teleptyNpm,
    npmAll: calls.filter((c) => c.tool === "npm"),
    daemon: calls.filter((c) => c.tool === "telepty" && c.args[0] === "daemon"),
    health: health
      ? health.requests.filter((u) => u.includes("/api/meta"))
      : calls.filter((c) => c.tool === "curl" && c.args.some((a) => a.includes("/api/meta"))),
    forbidden: calls.filter((c) => c.forbidden),
    state: readState(sb),
  };
}

function describe(r) {
  const tail = r.output.split(/\r?\n/).slice(-40).join("\n");
  return [
    `caller=${r.caller} exit=${r.code} elapsed=${r.elapsed}ms`,
    `telepty npm specs=${JSON.stringify(r.specs)} all npm=${JSON.stringify(r.npmAll.map((c) => c.args.join(" ")))}`,
    `daemon=${r.daemon.length} health=${r.health.length} forbidden=${JSON.stringify(r.forbidden)}`,
    `installed before=${JSON.stringify(r.before.version)} after=${JSON.stringify(r.after.version)}`,
    `state.telepty=${JSON.stringify(r.state && r.state.telepty)}`,
    `leaked=${JSON.stringify(r.leaked.map((c) => [c.tool, c.args]))}`,
    `telepty calls=${JSON.stringify(r.calls.filter((c) => c.tool === "telepty").map((c) => `${c.extra ? "extra:" : ""}${c.args.join(" ")}`))}`,
    "--- output tail ---",
    tail,
  ].join("\n");
}

function afterPhase2(output) {
  const i = output.indexOf("Phase 2");
  return i >= 0 ? output.slice(i) : output;
}

function effective(row) {
  // Manifest validation precedes the runtime gate: an invalid manifest is a config refusal on any Node.
  if (!RUNTIME_OK && !row.runtimeIndependent && !row.expect.config) return { kind: "refuse", npmSpecs: [], runtime: true };
  return { npmSpecs: [], ...row.expect };
}

function assertOutcome(r, row, sb) {
  const e = effective(row);
  const d = describe(r);
  const isPs = r.caller === "pwsh" || r.caller === "ps51" || (IS_WIN && r.caller.startsWith("cli-"));

  // Global invariants: inert run, no latest fallback, no leaked process, no raw control bytes.
  assert.deepEqual(r.forbidden, [], `forbidden tool invoked\n${d}`);
  assert.ok(!r.specs.some((s) => s === PKG || s.endsWith("@latest") || s.endsWith("@")), `latest/unpinned telepty spec\n${d}`);
  assert.deepEqual(r.leaked, [], `installer left a fake process running\n${d}`);
  assert.notEqual(r.code, "timeout", `installer did not finish in ${RUN_TIMEOUT_MS}ms\n${d}`);
  if (row.injected) {
    // Exactly the bytes the fake injected; nothing the shells/hosts emit themselves.
    for (const bad of ["\u0007", "\b", "\u001b]0;pwned", "\u001b[38;5;199m"]) {
      assert.ok(!r.output.includes(bad), `raw control sequence ${JSON.stringify(bad)} reached the output\n${d}`);
    }
    assert.ok(!/\r(?!\n)/.test(r.output), `bare carriage return reached the output\n${d}`);
  }
  for (const m of row.markers ? row.markers(sb) : []) {
    assert.ok(!fs.existsSync(m), `injected command executed (created ${m})\n${d}`);
  }

  if (e.kind === "untouched") {
    // telepty not selected: Phase 2 must not run at all (no probe decision, npm, daemon or runtime gate).
    if (!isPs) assert.equal(r.code, 0, `expected success without telepty\n${d}`);
    assert.ok(!r.output.includes("Phase 2"), `Phase 2 ran although telepty was not selected\n${d}`);
    assert.deepEqual(r.specs, [], `telepty npm call although not selected\n${d}`);
    assert.equal(r.daemon.length, 0, `daemon started although telepty was not selected\n${d}`);
    assert.equal(r.health.length, 0, `health probed although telepty was not selected\n${d}`);
    assert.equal(r.after.fingerprint, r.before.fingerprint, `installed telepty bytes changed\n${d}`);
    return;
  }

  if (e.kind === "refuse") {
    assert.notEqual(r.code, 0, `expected a nonzero refusal\n${d}`);
    assert.deepEqual(r.specs, e.npmSpecs, `unexpected telepty npm calls\n${d}`);
    assert.equal(r.daemon.length, 0, `daemon started after a refusal\n${d}`);
    assert.equal(r.health.length, 0, `health probed after a refusal\n${d}`);
    if (e.npmSpecs.length === 0) {
      assert.equal(r.after.fingerprint, r.before.fingerprint, `installed telepty bytes changed\n${d}`);
    }
    if (e.after !== undefined) assert.equal(r.after.version, e.after, `installed version after\n${d}`);
    if (r.state && r.state.telepty && r.state.telepty.version != null && norm(r.before.version) !== PIN) {
      assert.notEqual(norm(r.state.telepty.version), PIN, `pin recorded as observed version\n${d}`);
    }
    const tail = afterPhase2(r.output);
    if (e.runtime) assert.ok(/node/i.test(tail), `runtime refusal should name Node\n${d}`);
    if (e.config) {
      // Policy/CLI name the installer manifest; install.ps1 fails earlier in its own ConvertFrom-Json.
      assert.ok(/installer manifest|ConvertFrom-Json/i.test(tail), `config refusal should name the installer manifest\n${d}`);
      assert.ok(!/Node\.js \S+ is not supported/.test(tail), `config refusal must precede the runtime gate\n${d}`);
    }
    for (const s of e.outputIncludes || []) assert.ok(tail.includes(s), `output should mention ${s}\n${d}`);
    return;
  }

  // keep / install / upgrade: success through the health gate, truthful state.
  if (!isPs) assert.equal(r.code, 0, `expected success\n${d}`);
  if (e.kind === "keep") {
    assert.deepEqual(r.specs, [], `npm called for a compatible install\n${d}`);
    assert.equal(r.after.fingerprint, r.before.fingerprint, `installed telepty bytes changed\n${d}`);
  } else {
    assert.deepEqual(r.specs, [e.spec || SPEC], `expected exactly one exact-pin npm install\n${d}`);
    assert.equal(r.after.version, e.after || PIN, `installed version after\n${d}`);
  }
  assert.ok(r.daemon.length >= 1, `daemon not started after a compatible outcome\n${d}`);
  assert.ok(r.health.length >= 1, `health not probed after a compatible outcome\n${d}`);
  assert.ok(r.state && r.state.telepty, `install-state not written (run did not complete Phase 7)\n${d}`);
  const observed = e.observed || (e.kind === "keep" ? norm(r.before.version) : norm(r.after.version));
  assert.equal(norm(r.state.telepty.version), observed, `install-state must record the observed version\n${d}`);
}

// ── rows ─────────────────────────────────────────────────────────────────────

const ALL_PS = ["pwsh", "ps51"];
const markerPaths = (sb) => [1, 2, 3, 4, 5, 6].map((i) => path.join(sb.root, `pwned-${i}`));
function payload(sb) {
  const [m1, m2, m3, m4, m5, m6] = markerPaths(sb);
  const shell = IS_WIN
    ? `$(New-Item -ItemType File -Path ${psq(m1)}) ; New-Item -ItemType File -Path ${psq(m3)} & echo x > "${m4}" | echo y > "${m5}" %COMSPEC%`
    : `$(touch ${sq(m1)}) \`touch ${sq(m2)}\` ; touch ${sq(m3)} & echo x > ${sq(m4)} | echo y > ${sq(m5)}`;
  const js = `'); require('fs').writeFileSync(${JSON.stringify(m6)}, 'x'); ('`;
  return `${PIN} ${shell} ${js} \u001b]0;pwned\u0007\b\b\r\u001b[38;5;199m\n`;
}

const ROWS = [
  // version states, shipped manifest
  { id: "absent -> install exact pin", callers: ["sh", ...ALL_PS, "cli-setup"], installed: null, expect: { kind: "install" } },
  { id: "older 0.1.45 -> upgrade to exact pin", callers: ["sh", ...ALL_PS, "cli-setup"], installed: "0.1.45", expect: { kind: "upgrade" } },
  { id: "older 0.8.4 -> upgrade to exact pin", callers: ["sh", "pwsh"], installed: "0.8.4", expect: { kind: "upgrade" } },
  { id: "equal 0.8.5 -> keep, no npm", callers: ["sh", ...ALL_PS, "cli-setup"], installed: PIN, expect: { kind: "keep" } },
  { id: "newer-compatible 0.8.9 -> keep, observed 0.8.9", callers: ["sh", ...ALL_PS, "cli-setup", "cli-update"], installed: "0.8.9", expect: { kind: "keep", observed: "0.8.9" } },
  { id: "v-prefixed v0.8.7 -> keep", callers: ["sh", "pwsh"], installed: "v0.8.7", expect: { kind: "keep", observed: "0.8.7" } },
  { id: "numeric order 0.8.10 -> keep", callers: ["sh", "pwsh"], installed: "0.8.10", expect: { kind: "keep", observed: "0.8.10" } },
  { id: "incompatible 0.9.0 -> refuse, keep bytes", callers: ["sh", "pwsh"], installed: "0.9.0", expect: { kind: "refuse", outputIncludes: ["0.9.0"] } },
  { id: "incompatible 1.0.0 -> refuse, keep bytes", callers: ["sh", ...ALL_PS, "cli-setup"], installed: "1.0.0", expect: { kind: "refuse", outputIncludes: ["1.0.0"] } },
  { id: "numeric order 0.10.0 -> refuse", callers: ["sh", "pwsh"], installed: "0.10.0", expect: { kind: "refuse" } },
  { id: "malformed version -> refuse", callers: ["sh", ...ALL_PS], installed: "not-a-version", expect: { kind: "refuse" } },
  { id: "prerelease 0.8.5-beta.1 -> refuse", callers: ["sh", "pwsh"], installed: "0.8.5-beta.1", expect: { kind: "refuse" } },
  { id: "build metadata 0.8.5+build.7 -> refuse", callers: ["sh", "pwsh"], installed: "0.8.5+build.7", expect: { kind: "refuse" } },
  { id: "multi-token 'telepty 0.8.5' -> refuse", callers: ["sh", "pwsh"], installed: "telepty 0.8.5", expect: { kind: "refuse" } },
  { id: "two versions on two lines -> refuse", callers: ["sh", "pwsh"], installed: "0.8.5", stdout: "0.8.5\n0.8.6\n", expect: { kind: "refuse" } },
  { id: "empty --version output -> refuse", callers: ["sh", "pwsh"], installed: "", stdout: "", expect: { kind: "refuse" } },
  { id: "probe exits nonzero -> refuse", callers: ["sh", "pwsh"], installed: PIN, probeExit: 3, expect: { kind: "refuse" } },
  { id: "probe hangs -> bounded refusal", callers: ["sh", "pwsh"], installed: PIN, hang: true, expect: { kind: "refuse" } },
  { id: "control chars + injection in probe output -> refuse, inert", callers: ["sh", ...ALL_PS], installed: PIN, stdout: payload, injected: true, markers: markerPaths, expect: { kind: "refuse" } },
  // offline / npm failures
  { id: "offline + equal -> keep without npm", callers: ["sh", "pwsh"], installed: PIN, npm: "offline", expect: { kind: "keep" } },
  { id: "offline + newer-compatible -> keep without npm", callers: ["sh", "pwsh"], installed: "0.8.9", npm: "offline", expect: { kind: "keep", observed: "0.8.9" } },
  { id: "offline + absent -> one exact attempt, nonzero", callers: ["sh", "pwsh"], installed: null, npm: "offline", expect: { kind: "refuse", npmSpecs: [SPEC], after: "ABSENT" } },
  { id: "offline + older -> one exact attempt, nonzero, untouched", callers: ["sh", "pwsh"], installed: "0.1.45", npm: "offline", expect: { kind: "refuse", npmSpecs: [SPEC], after: "0.1.45" } },
  { id: "npm exits 0 but no telepty -> nonzero", callers: ["sh", "pwsh"], installed: null, npm: "noop", expect: { kind: "refuse", npmSpecs: [SPEC], after: "ABSENT" } },
  { id: "npm yields incompatible 0.9.3 -> nonzero, pin not recorded", callers: ["sh", "pwsh"], installed: null, npm: "wrong", wrong: "0.9.3", expect: { kind: "refuse", npmSpecs: [SPEC], after: "0.9.3" } },
  { id: "npm yields compatible 0.8.7 -> success, observed 0.8.7 not the pin", callers: ["sh", "pwsh"], installed: null, npm: "wrong", wrong: "0.8.7", expect: { kind: "install", after: "0.8.7", observed: "0.8.7" } },
  // no explicit-pin channel, no implicit downgrade
  { id: "AIGENTRY_TELEPTY_VERSION is not a downgrade channel", callers: ["sh", "pwsh", "cli-setup"], installed: "0.8.9", env: { AIGENTRY_TELEPTY_VERSION: "0.1.45" }, expect: { kind: "keep", observed: "0.8.9" } },
  { id: "custom pin 0.8.7 keeps newer 0.8.9", callers: ["sh", "pwsh"], installed: "0.8.9", manifest: (m) => setPin(m, "0.8.7"), expect: { kind: "keep", observed: "0.8.9" } },
  { id: "custom pin 0.8.7 keeps in-range older 0.8.6", callers: ["sh"], installed: "0.8.6", manifest: (m) => setPin(m, "0.8.7"), expect: { kind: "keep", observed: "0.8.6" } },
  { id: "raised minimum 0.8.7 upgrades 0.8.6 to exact 0.8.7", callers: ["sh", "pwsh"], installed: "0.8.6", manifest: (m) => { setPin(m, "0.8.7"); setBound(m, "minimum", "0.8.7"); }, expect: { kind: "upgrade", spec: `${PKG}@0.8.7`, after: "0.8.7" } },
  // configuration errors: refuse before npm, never @latest
  { id: "manifest without install.version (absent) -> refuse, no npm", callers: ["sh", ...ALL_PS, "cli-setup"], installed: null, manifest: (m) => { delete m.components.telepty.install.version; }, expect: { kind: "refuse", config: true } },
  { id: "manifest without install.version (installed) -> refuse, no npm", callers: ["sh", "pwsh"], installed: PIN, manifest: (m) => { delete m.components.telepty.install.version; }, expect: { kind: "refuse", config: true } },
  { id: "pin 'latest' -> refuse", callers: ["sh", "pwsh"], installed: null, manifest: (m) => setPin(m, "latest"), expect: { kind: "refuse", config: true } },
  { id: "pin '^0.8.5' -> refuse", callers: ["sh"], installed: null, manifest: (m) => setPin(m, "^0.8.5"), expect: { kind: "refuse", config: true } },
  { id: "prerelease pin -> refuse", callers: ["sh"], installed: null, manifest: (m) => setPin(m, "0.8.5-rc.1"), expect: { kind: "refuse", config: true } },
  {
    id: "pin with command substitution -> refuse, inert",
    callers: ["sh", "pwsh"],
    installed: null,
    manifest: (m, sb) => setPin(m, IS_WIN
      ? `0.8.5$(New-Item -ItemType File -Path ${psq(markerPaths(sb)[0])})`
      : `0.8.5$(touch ${markerPaths(sb)[0]});touch ${markerPaths(sb)[1]}`),
    markers: markerPaths,
    expect: { kind: "refuse", config: true },
  },
  { id: "missing minimum -> refuse", callers: ["sh", "pwsh"], installed: PIN, manifest: (m) => setBound(m, "minimum", undefined), expect: { kind: "refuse", config: true } },
  { id: "missing maximum_exclusive -> refuse", callers: ["sh", "pwsh"], installed: PIN, manifest: (m) => setBound(m, "maximum_exclusive", undefined), expect: { kind: "refuse", config: true } },
  { id: "missing node_minimum -> refuse", callers: ["sh", "pwsh"], installed: PIN, manifest: (m) => setBound(m, "node_minimum", undefined), expect: { kind: "refuse", config: true } },
  { id: "malformed maximum_exclusive '0.9' -> refuse", callers: ["sh"], installed: PIN, manifest: (m) => setBound(m, "maximum_exclusive", "0.9"), expect: { kind: "refuse", config: true } },
  { id: "pin above maximum_exclusive -> refuse", callers: ["sh", "pwsh"], installed: null, manifest: (m) => setPin(m, "0.9.1"), expect: { kind: "refuse", config: true } },
  { id: "pin below minimum -> refuse", callers: ["sh"], installed: null, manifest: (m) => setPin(m, "0.8.4"), expect: { kind: "refuse", config: true } },
  { id: "unparseable manifest -> refuse, no npm", callers: ["sh", "pwsh", "cli-setup"], installed: PIN, manifest: "malformed", expect: { kind: "refuse", config: true } },
  // runtime gate driven by config (the real runtime is never faked)
  { id: "node_minimum above this runtime -> refuse before npm", callers: ["sh", ...ALL_PS, "cli-setup"], installed: null, manifest: (m) => setBound(m, "node_minimum", "99.0.0"), expect: { kind: "refuse", outputIncludes: ["99.0.0"] } },
  // phase-2 additions from candidate measurement (#1213 phase 2)
  { id: "version, >1024 bytes of padding, then a second token -> refuse", callers: ["sh", "pwsh"], installed: PIN, stdout: `${PIN}${" ".repeat(2000)}EXTRA-TOKEN 9.9.9\n`, expect: { kind: "refuse" } },
  // Only a component filter keeps Phase 2 out; install.ps1's `Should-RunPhase 2 -and (...)` is measured here natively.
  { id: "telepty not selected -> Phase 2 untouched (also on Node < 20)", callers: ["sh", "pwsh"], installed: PIN, components: "deliberation", runtimeIndependent: true, manifest: (m) => setBound(m, "node_minimum", "99.0.0"), expect: { kind: "untouched" } },
  // R2b: the bounded policy probe is the only --version; the summary reuses its observation.
  { id: "fast first probe, any later --version hangs -> keep 0.8.9, no late probe", callers: ["sh", "pwsh"], installed: "0.8.9", lateHang: true, expect: { kind: "keep", observed: "0.8.9" } },
  { id: "npm yields 0.8.7, any later --version hangs -> no late probe, observed 0.8.7", callers: ["sh", "pwsh"], installed: null, npm: "wrong", wrong: "0.8.7", lateHang: true, expect: { kind: "install", after: "0.8.7", observed: "0.8.7" } },
  // An existing telepty the policy does not search must not read as absent: refuse, no npm.
  { id: "telepty 0.9.0 only in a relative PATH entry -> refuse, no npm", callers: ["sh", "pwsh"], installed: null, extraBin: { relative: true, version: "0.9.0" }, expect: { kind: "refuse" } },
  { id: "control: telepty 0.9.0 in the same dir as an absolute PATH entry -> refuse", callers: ["sh", "pwsh"], installed: null, extraBin: { relative: false, version: "0.9.0" }, expect: { kind: "refuse", outputIncludes: ["0.9.0"] } },
  { id: "control: empty relative PATH entry, truly absent -> install exact pin", callers: ["sh", "pwsh"], installed: null, extraBin: { relative: true, version: null }, expect: { kind: "install" } },
  { id: "telepty 0.9.0 only in a literal ~/relbin PATH entry -> refuse, no npm", callers: ["sh"], installed: null, extraBin: { tilde: true, version: "0.9.0" }, expect: { kind: "refuse" } },
  { id: "telepty 0.9.0 only as telepty.ps1 (no .cmd) -> refuse, no npm", callers: ["pwsh"], installed: null, extraBin: { relative: false, version: "0.9.0", ps1Only: true }, expect: { kind: "refuse" } },
];

const SKIP = {
  sh: IS_WIN ? "install.sh is the POSIX caller; win32 setup runs install.ps1 (pwsh/ps51 rows)" : false,
  pwsh: IS_WIN ? false : "install.ps1 runs natively on windows-latest only",
  ps51: IS_WIN ? false : "install.ps1 runs natively on windows-latest only",
  "cli-setup": false,
  "cli-update": false,
};

function requireShell(caller) {
  if (caller === "sh") assert.ok(REAL_BASH, "bash not found on PATH");
  if (caller === "pwsh") assert.ok(PWSH && fs.existsSync(PWSH), "pwsh not found: the native Windows fixture cannot run");
  if (caller === "ps51") assert.ok(WINPS && fs.existsSync(WINPS), "powershell.exe not found: the native Windows fixture cannot run");
  if (caller.startsWith("cli-") && IS_WIN) assert.ok(PWSH || WINPS, "no PowerShell for the win32 CLI caller");
}

function prepare(sb, row) {
  if (row.installed !== null) {
    installTelepty(sb, {
      version: row.installed,
      stdout: typeof row.stdout === "function" ? row.stdout(sb) : row.stdout,
      exitCode: row.probeExit,
      hang: row.hang,
    });
  }
  if (row.npm) fs.writeFileSync(path.join(sb.state, "npm.mode"), row.npm);
  if (row.wrong) fs.writeFileSync(path.join(sb.state, "npm.wrong"), row.wrong);
  if (row.lateHang) fs.writeFileSync(path.join(sb.state, "telepty.hang-late"), String(LATE_HANG_MS));
  if (row.extraBin) {
    // A second telepty first on PATH, with its own modeled version; npm never touches it.
    const dir = path.join(row.extraBin.tilde ? sb.home : sb.root, "relbin");
    const extraRoot = path.join(sb.root, "relfixture");
    const state = path.join(extraRoot, "state");
    const fakeJs = path.join(extraRoot, "fake.js");
    fs.mkdirSync(dir);
    fs.mkdirSync(state, { recursive: true });
    fs.writeFileSync(fakeJs, FAKE_JS);
    if (row.extraBin.version !== null) {
      fs.writeFileSync(path.join(state, "telepty.version"), row.extraBin.version);
      writeShims(dir, "telepty", { fakeJs, state });
      if (row.extraBin.ps1Only) fs.unlinkSync(path.join(dir, "telepty.cmd"));
    }
    sb.extraStates = [state];
    // tilde: a literal "~/relbin" entry, which bash (non-POSIX mode) expands with HOME during command search.
    sb.extraPath = row.extraBin.tilde ? "~/relbin" : row.extraBin.relative ? "relbin" : dir;
  }
}

for (const row of ROWS) {
  for (const caller of row.callers) {
    test(`${caller} :: ${row.id}`, { skip: SKIP[caller], timeout: RUN_TIMEOUT_MS + 60000 }, async () => {
      requireShell(caller);
      const sb = mkSandbox(`${caller}-${row.id}`);
      try {
        prepare(sb, row);
        if (caller === "sh" && row.extraBin && row.extraBin.version !== null) {
          // Fixture precondition: the user's shell really resolves the extra telepty from the run cwd.
          const pre = spawnSync(path.join(sb.fakebin, "bash"), ["-c", "command -v telepty"],
            { cwd: sb.root, env: baseEnv(sb, null), encoding: "utf8", timeout: 30000 });
          assert.equal(path.resolve(sb.root, pre.stdout.trim()), path.join(row.extraBin.tilde ? sb.home : sb.root, "relbin", "telepty"), `extra telepty not resolvable: ${pre.stdout}`);
        }
        const r = await runCaller(caller, sb, row);
        if (row.hang) {
          assert.ok(r.elapsed < HANG_BUDGET_MS, `probe not bounded: ${r.elapsed}ms (fake hangs ${HANG_MS}ms)\n${describe(r)}`);
        }
        if (row.lateHang && RUNTIME_OK) {
          const probes = r.calls.filter((c) => c.tool === "telepty" && c.args[0] === "--version");
          assert.equal(probes.length, 1, `telepty --version ran again after the bounded policy probe\n${describe(r)}`);
          assert.ok(r.elapsed < LATE_HANG_MS, `installer waited on a late probe: ${r.elapsed}ms\n${describe(r)}`);
          assert.ok(r.output.split(/\r?\n/).some((l) => l.trim() === `telepty:    ${row.expect.observed}`),
            `summary must print the verified observation ${row.expect.observed}\n${describe(r)}`);
        }
        if (caller.startsWith("cli-")) {
          assert.equal(r.code, 1, describe(r));
          assert.match(r.output, /D1 .*unavailable|unsupported or duplicate setup option/, describe(r));
          assert.deepEqual(r.calls, [], "D1 CLI must not invoke npm, runtime, daemon or health tools");
          assert.deepEqual(r.health, [], "D1 CLI must not probe health");
          assert.deepEqual(r.after, r.before, "installed bytes/version remain unchanged");
          assert.deepEqual(r.cliAfter, r.cliBefore, "complete fixture tree remains unchanged");
          assert.equal(r.state, null, "D1 CLI must not write legacy Phase 7 state");
          if (caller === "cli-update") assert.equal(r.npmAll.length, 0, "no npm@latest self-update");
        } else {
          assertOutcome(r, row, sb);
        }
      } finally {
        if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
      }
    });
  }
}

// ── whole-run and fixture preconditions ─────────────────────────────────────

test("pwsh :: full install.ps1 run exits 0 when telepty is kept", { skip: SKIP.pwsh, timeout: RUN_TIMEOUT_MS + 60000 }, async () => {
  requireShell("pwsh");
  const sb = mkSandbox("pwsh-full-run");
  try {
    installTelepty(sb, { version: PIN });
    const r = await runCaller("pwsh", sb, { env: {} });
    const d = describe(r);
    if (RUNTIME_OK) {
      assert.deepEqual(r.specs, [], d);
      assert.equal(r.code, 0, `install.ps1 must complete with exit 0\n${d}`);
    } else {
      assert.notEqual(r.code, 0, d);
    }
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

for (const caller of ["pwsh", "ps51"]) {
  test(`${caller} :: fixture precondition: npm and telepty resolve to the fakes`, { skip: SKIP[caller], timeout: 120000 }, () => {
    requireShell(caller);
    const sb = mkSandbox(`${caller}-precondition`);
    try {
      installTelepty(sb, { version: PIN });
      const r = spawnSync(caller === "pwsh" ? PWSH : WINPS,
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "(Get-Command npm).Source; (Get-Command telepty).Source; (Get-Command node).Source"],
        { env: baseEnv(sb, null), encoding: "utf8", timeout: 100000, windowsHide: true });
      const lines = String(r.stdout).split(/\r?\n/).filter(Boolean);
      assert.equal(r.status, 0, `${r.stderr}`);
      // TEMP may be an 8.3 alias (C:\Users\RUNNER~1) while Get-Command reports the long path; compare canonical paths.
      const inDir = (file, dir) => path.dirname(fs.realpathSync.native(file)).toLowerCase() === fs.realpathSync.native(dir).toLowerCase();
      assert.ok(inDir(lines[0], sb.fakebin), `npm resolves to ${lines[0]}, not into ${sb.fakebin}`);
      assert.ok(inDir(lines[1], sb.globalbin), `telepty resolves to ${lines[1]}, not into ${sb.globalbin}`);
      assert.equal(path.dirname(lines[2]).toLowerCase(), path.dirname(process.execPath).toLowerCase(), `node resolves to ${lines[2]}`);
    } finally {
      if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
    }
  });
}

test("sh :: fixture precondition: no real telepty/npm reachable on the sandbox PATH", { skip: SKIP.sh }, () => {
  for (const dir of ["/usr/bin", "/bin"]) {
    assert.ok(!fs.existsSync(path.join(dir, "telepty")), `${dir}/telepty would defeat the absent rows`);
  }
  const sb = mkSandbox("sh-precondition");
  try {
    const r = spawnSync(path.join(sb.fakebin, "bash"), ["-c", "command -v npm; command -v telepty || echo none; command -v node"],
      { env: baseEnv(sb, null), encoding: "utf8", timeout: 30000 });
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines[0], path.join(sb.fakebin, "npm"));
    assert.equal(lines[1], "none");
    assert.equal(lines[2], path.join(sb.fakebin, "node"));
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

// ── design guards (static, cheap) ───────────────────────────────────────────

test("both installers route the decision through the one shared policy module", () => {
  assert.ok(fs.existsSync(path.join(REPO, POLICY_REL)), `${POLICY_REL} missing`);
  const sh = fs.readFileSync(INSTALL_SH, "utf8");
  const ps = fs.readFileSync(INSTALL_PS1, "utf8");
  assert.ok(sh.includes("telepty-version-policy"), "install.sh does not call the policy module");
  assert.ok(ps.includes("telepty-version-policy"), "install.ps1 does not call the policy module");
});

test("install.sh adds no uname branch, flock or direct signal", () => {
  const sh = fs.readFileSync(INSTALL_SH, "utf8");
  assert.ok((sh.match(/\buname\b/g) || []).length <= 1, "new uname use: route OS checks through bin/lib/platform.sh");
  assert.ok(!/\bflock\b/.test(sh), "flock is not allowed");
  assert.ok(!/(^|[\s;&|(])kill\s/m.test(sh), "direct signal (kill) is not allowed");
});

test("fixture security :: caller paths and unknown operands refuse without effects", () => {
  const sb = mkSandbox("security-operands");
  try {
    const before = cliTree(sb.root, sb.log);
    for (const args of [[sb.state, "npm", "install", "-g", SPEC], ["../../escape"],
      ["unknown-tool"], ["npm", "install", "--prefix", sb.home, SPEC]]) {
      const r = spawnSync(process.execPath, [sb.fakeJs, ...args], { encoding: "utf8", timeout: 10000 });
      assert.equal(r.status, 98, r.stderr);
      assert.deepEqual(cliTree(sb.root, sb.log), before, "refused operands must not even append a call log");
    }
  } finally { if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test("fixture security :: allowed npm and version operations retain modeled behavior", () => {
  const sb = mkSandbox("security-allowed");
  try {
    const run = (...args) => spawnSync(process.execPath, [sb.fakeJs, ...args], { encoding: "utf8", timeout: 10000 });
    const installed = run("npm", "install", "-g", SPEC);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(installedVersion(sb), PIN);
    const version = run("telepty", "--version");
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), PIN);
    assert.deepEqual(readCalls(sb).map(c => c.tool), ["npm", "telepty"]);
    const sentinel = run("git", "clone", "https://example.invalid/unused");
    assert.equal(sentinel.status, 97);
    assert.equal(readCalls(sb).at(-1).forbidden, true);
  } finally { if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true }); }
});

test("fixture security :: symlink and hardlink sinks refuse before writes", () => {
  for (const kind of ["state-link", "log-link", "log-hardlink", "shim-link", "destination-link"]) {
    const sb = mkSandbox("security-" + kind);
    try {
      const decoy = path.join(sb.root, "decoy");
      fs.mkdirSync(decoy);
      const target = path.join(decoy, "untouched");
      fs.writeFileSync(target, "preserve");
      if (kind === "state-link") {
        fs.renameSync(sb.state, path.join(sb.root, "original-state"));
        fs.symlinkSync(path.join(sb.root, "original-state"), sb.state, "junction");
      } else if (kind === "shim-link") {
        fs.rmSync(sb.shims, { recursive: true });
        fs.symlinkSync(decoy, sb.shims, "junction");
      } else if (kind === "destination-link") {
        fs.rmdirSync(sb.globalbin);
        fs.symlinkSync(decoy, sb.globalbin, "junction");
      } else {
        const log = path.join(sb.state, "calls.jsonl");
        fs.unlinkSync(log);
        if (kind === "log-hardlink") fs.linkSync(target, log); else fs.symlinkSync(target, log);
      }
      const before = cliTree(sb.root, sb.log);
      const r = spawnSync(process.execPath, [sb.fakeJs, "npm", "install", "-g", SPEC], { encoding: "utf8", timeout: 10000 });
      assert.equal(r.status, 98, r.stderr);
      assert.deepEqual(cliTree(sb.root, sb.log), before);
    } finally { if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true }); }
  }
});
