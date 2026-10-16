// Exact phase/component selection in the real installers (#1147 F5/F9).
//
// Two defects, two very different acceptance bars:
//
//   F5 (POSIX, measured here): `AIGENTRY_INSTALL_RESUME` used to be interpolated
//   into a `Function()` expression, so a crafted value executed arbitrary JS in
//   the installer's own Node process and *then* printed "Unknown resume target"
//   as if nothing had happened. The rows below run the real `install.sh` with
//   such values and assert both halves: the refusal AND that no side effect
//   happened. Valid named and numeric resume must keep working unchanged.
//
//   F9 (Windows, NOT measured here): `install.ps1` wrote
//   `if (Should-RunPhase N -and (Test-ComponentSelected "x"))`, which parses in
//   command mode and hands `-and` plus the selection result to a non-advanced
//   one-parameter function that discards them — leaving the component filter
//   inert for phases 1, 3, 4, 5 and 6. The `pwsh`/`ps51` rows are the
//   discriminating reproduction and they run ONLY on a native Windows runner.
//   On any other host they report NOTRUN. A local pass here is NOT native
//   acceptance for F9; `install.sh` is the parity oracle, and the source-shape
//   guard at the bottom is a regression lock, not evidence about PowerShell
//   semantics.
//
// Fixtures are inert: private HOME/XDG/TMP per run at mode 0700 with umask 0077,
// fake npm/npx/curl/tmux/claude/telepty/dustcraw/aigentry-brain first on PATH,
// refusing sentinels (exit 97) for git/brew/sudo/launchctl/systemctl/apt-get/
// dnf/yum/pacman/docker/open/direnv/schtasks/winget/choco/scoop, and every call
// logged to state/calls.jsonl. No real registry, global prefix, daemon, service
// or user config is involved, and credentials are synthetic markers only.
//
// Run: node --test tests/installer-selection-1213.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const INSTALL_SH = path.join(REPO, "install.sh");
const INSTALL_PS1 = path.join(REPO, "install.ps1");
const MANIFEST = path.join(REPO, "config", "installer-manifest.json");

const IS_WIN = process.platform === "win32";
const RUN_TIMEOUT_MS = 180000;
const KEEP = process.env.AIGENTRY_TEST_KEEP === "1";

process.umask(0o077);

const RECORDERS = ["npm", "npx", "curl", "tmux", "claude", "telepty", "dustcraw", "aigentry-brain"];
const FORBIDDEN = IS_WIN
  ? ["git", "brew", "winget", "choco", "scoop", "schtasks", "sudo"]
  : ["git", "brew", "sudo", "launchctl", "systemctl", "apt-get", "dnf", "yum", "pacman", "docker", "open", "direnv"];

const BRAIN_PKG = "@dmsdc-ai/aigentry-brain";
const DUSTCRAW_PKG = "@dmsdc-ai/aigentry-dustcraw";
const TELEPTY_PKG = "@dmsdc-ai/aigentry-telepty";

function which(cmd) {
  const exts = IS_WIN ? (process.env.PATHEXT || ".EXE;.CMD").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      try {
        const p = path.join(dir, cmd + ext);
        if (fs.statSync(p).isFile()) return p;
      } catch (err) { /* next */ }
    }
  }
  return null;
}

const PWSH = IS_WIN ? which("pwsh") : null;
const WINPS = IS_WIN
  ? which("powershell") || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  : null;

// NOTRUN, never a pass: on a non-Windows host the PowerShell rows are reported
// as not run. On win32 a missing shell FAILS the row instead of skipping it.
const NOTRUN_PS = "NOTRUN — F9 needs a native Windows PowerShell runner; a non-Windows pass would not be acceptance";
const SKIP = {
  sh: IS_WIN ? "install.sh is a POSIX caller" : false,
  pwsh: IS_WIN ? false : NOTRUN_PS,
  ps51: IS_WIN ? false : NOTRUN_PS,
};

function requireShell(caller) {
  if (caller === "pwsh" && !PWSH) assert.fail("pwsh not found on this Windows runner (required, not skippable)");
  if (caller === "ps51" && !WINPS) assert.fail("powershell.exe not found on this Windows runner (required, not skippable)");
}

// ── inert fake actuator ─────────────────────────────────────────────────────

const FAKE_JS = String.raw`"use strict";
// Inert fake for the #1147 selection tests. argv: <tool> ...args
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
  process.exitCode = 0;
}
`;

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Each shim passes the tool name and the caller's arguments only. None passes
// the state directory: the fake derives that from its own location, so no argv
// can redirect it.
function writeTool(sb, tool) {
  if (IS_WIN) {
    fs.writeFileSync(path.join(sb.fakebin, `${tool}.cmd`),
      `@echo off\r\n"${process.execPath}" "${sb.fakeJs}" ${tool} %*\r\nexit /b %ERRORLEVEL%\r\n`);
    fs.writeFileSync(path.join(sb.fakebin, `${tool}.ps1`),
      `& ${psq(process.execPath)} ${psq(sb.fakeJs)} ${psq(tool)} @args\r\nexit $LASTEXITCODE\r\n`);
  } else {
    const p = path.join(sb.fakebin, tool);
    fs.writeFileSync(p, `#!/bin/sh\nexec ${sq(process.execPath)} ${sq(sb.fakeJs)} ${tool} "$@"\n`);
    fs.chmodSync(p, 0o700);
  }
}

function mkSandbox(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sel1147-${label.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 36)}-`));
  fs.chmodSync(root, 0o700);
  const sb = {
    root,
    home: path.join(root, "home"),
    xdg: path.join(root, "home", ".config"),
    tmp: path.join(root, "tmp"),
    fakebin: path.join(root, "fakebin"),
    state: path.join(root, "state"),
    fakeJs: path.join(root, "fake.js"),
  };
  sb.stateDir = path.join(sb.xdg, "aigentry-devkit");
  sb.journal = path.join(sb.stateDir, "install-journal.json");
  for (const d of [sb.home, sb.xdg, sb.tmp, sb.fakebin, sb.state]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(sb.fakeJs, FAKE_JS);
  fs.writeFileSync(path.join(sb.state, "calls.jsonl"), "");
  fs.writeFileSync(path.join(sb.state, "forbidden.json"), JSON.stringify(FORBIDDEN));
  // The closed vocabulary the fake validates against: exactly the tools this
  // fixture installs a shim for. Written by the fixture, never by a caller.
  fs.writeFileSync(path.join(sb.state, "tools.json"), JSON.stringify([...RECORDERS, ...FORBIDDEN]));
  fs.writeFileSync(path.join(sb.state, "telepty.version"), "0.8.5");
  for (const t of [...RECORDERS, ...FORBIDDEN]) writeTool(sb, t);
  if (!IS_WIN) {
    const p = path.join(sb.fakebin, "node");
    fs.writeFileSync(p, `#!/bin/sh\nexec ${sq(process.execPath)} "$@"\n`);
    fs.chmodSync(p, 0o700);
  }
  sb.cleanup = () => { if (!KEEP) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); };
  return sb;
}

function calls(sb) {
  const p = path.join(sb.state, "calls.jsonl");
  return (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function baseEnv(sb) {
  const env = {
    HOME: sb.home,
    XDG_CONFIG_HOME: sb.xdg,
    TMPDIR: sb.tmp,
    LANG: "C",
    TERM: "dumb",
    USER: "fixture",
    LOGNAME: "fixture",
    AIGENTRY_LOGGER_DISABLED: "1",
    AIGENTRY_TELEPTY_URL: "http://127.0.0.1:9",
    npm_config_registry: "http://127.0.0.1:9/",
    npm_config_offline: "true",
    // Nothing may prompt, so an unselected phase that wrongly runs still cannot
    // block: it reveals itself through its calls instead.
    AIGENTRY_BRAIN_PROJECT_ID: "fixture",
    AIGENTRY_BRAIN_INSTALL_MODE: "local",
    AIGENTRY_DUSTCRAW_PRESET: "tech-business",
    AIGENTRY_DUSTCRAW_RUN_DEMO: "no",
    AIGENTRY_DUSTCRAW_ENABLE_SERVICE: "no",
    AIGENTRY_REGISTRY_MODE: "skip",
    AIGENTRY_SKIP_DAEMON: "1",
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
    const dirs = [sb.fakebin, path.dirname(process.execPath)];
    if (PWSH) dirs.push(path.dirname(PWSH));
    dirs.push(path.join(sys, "System32"), sys, path.join(sys, "System32", "WindowsPowerShell", "v1.0"));
    env.PATH = dirs.join(";");
  } else {
    env.PATH = [sb.fakebin, "/usr/bin", "/bin"].join(":");
  }
  return env;
}

function run(caller, sb, opts = {}) {
  const env = { ...baseEnv(sb), ...(opts.env || {}) };
  if (opts.components !== undefined) env.AIGENTRY_INSTALL_COMPONENTS = opts.components;
  if (opts.resume !== undefined) env.AIGENTRY_INSTALL_RESUME = String(opts.resume);
  const cmd = caller === "sh" ? "/bin/bash" : caller === "pwsh" ? PWSH : WINPS;
  const args = caller === "sh" ? [INSTALL_SH] : ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INSTALL_PS1];
  const r = spawnSync(cmd, args, {
    cwd: sb.root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: RUN_TIMEOUT_MS, windowsHide: true,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  return { code: r.status, signal: r.signal, out, plain: out.replace(/\x1b\[[0-9;]*m/g, "") };
}

function describe(sb, r) {
  return [
    `exit=${r.code} signal=${r.signal}`,
    `calls=${JSON.stringify(calls(sb).map((c) => `${c.tool} ${c.args.join(" ")}`))}`,
    `journal=${fs.existsSync(sb.journal) ? JSON.stringify(JSON.parse(fs.readFileSync(sb.journal, "utf8")).attempts.map((a) => a.phases.map((p) => `${p.phase}:${p.status}`).join(" "))) : "ABSENT"}`,
    r.plain.split(/\r?\n/).slice(-25).join("\n"),
  ].join("\n");
}

const npmInstalls = (sb, pkg) => calls(sb).filter((c) => c.tool === "npm"
  && c.args.some((a) => a === pkg || a.startsWith(`${pkg}@`)));
const recordedPhases = (sb) => {
  if (!fs.existsSync(sb.journal)) return null;
  const j = JSON.parse(fs.readFileSync(sb.journal, "utf8"));
  return j.attempts[j.attempts.length - 1].phases.map((p) => p.phase);
};
// Phase 1's own observable effect in HOME.
const phase1Wrote = (sb) => fs.existsSync(path.join(sb.home, ".claude", "hud", "simple-status.sh"))
  || (fs.existsSync(path.join(sb.home, ".claude", "skills")) && fs.readdirSync(path.join(sb.home, ".claude", "skills")).length > 0);

function assertNoRealActuator(sb, r) {
  assert.deepEqual(calls(sb).filter((c) => c.forbidden).map((c) => c.tool), [],
    `a refusing sentinel was reached\n${describe(sb, r)}`);
}

// ── the discriminating selection matrix (identical assertions per caller) ────
//
// Every row starts at phase 1, so NOTHING is held back by the resume cursor:
// the only thing that may keep an unselected phase from running is the
// component filter itself. That is exactly what F9 breaks on Windows.

// Each phase has one unmistakable observable: phase 1 writes into HOME, phase 2
// starts the daemon, phase 3 runs npx twice (install + doctor), phases 4/5 run
// `npm install -g` for their own package. telepty is pre-installed at the
// manifest pin, so the shipped #1213 policy keeps it and phase 2 legitimately
// makes no npm call — the daemon start is what proves the phase ran.
const ROWS = [
  {
    id: "only telepty selected",
    components: "telepty",
    expect: { phases: [0, 2, 7], daemon: 1, brain: 0, dustcraw: 0, npx: 0, phase1: false },
  },
  {
    id: "only devkit-core selected",
    components: "devkit-core",
    expect: { phases: [0, 1, 7], daemon: 0, brain: 0, dustcraw: 0, npx: 0, phase1: true },
  },
  {
    id: "an unknown component selects nothing",
    components: "not-a-component",
    expect: { phases: [0, 7], daemon: 0, brain: 0, dustcraw: 0, npx: 0, phase1: false },
  },
  {
    id: "the three default components select exactly phases 1-3",
    components: "devkit-core,telepty,deliberation",
    expect: { phases: [0, 1, 2, 3, 7], daemon: 1, brain: 0, dustcraw: 0, npx: 2, phase1: true },
  },
  {
    id: "optional components run only when asked for",
    components: "brain,dustcraw",
    expect: { phases: [0, 4, 5, 7], daemon: 0, brain: 1, dustcraw: 1, npx: 0, phase1: false },
  },
];

for (const row of ROWS) {
  for (const caller of ["sh", "pwsh", "ps51"]) {
    test(`${caller} :: ${row.id}`, { skip: SKIP[caller], timeout: RUN_TIMEOUT_MS }, () => {
      requireShell(caller);
      const sb = mkSandbox(`${caller}-${row.id}`);
      try {
        const r = run(caller, sb, { components: row.components, resume: 1 });
        const d = describe(sb, r);
        assert.equal(r.code, 0, `the run must complete\n${d}`);

        // An unselected component must execute nothing at all.
        assert.equal(npmInstalls(sb, BRAIN_PKG).length, row.expect.brain, `brain npm -g calls\n${d}`);
        assert.equal(npmInstalls(sb, DUSTCRAW_PKG).length, row.expect.dustcraw, `dustcraw npm -g calls\n${d}`);
        assert.equal(calls(sb).filter((c) => c.tool === "telepty" && c.args[0] === "daemon").length,
          row.expect.daemon, `telepty daemon starts\n${d}`);
        // The shipped #1213 decision is untouched: a telepty already at the pin
        // is kept, so no row may re-install it.
        assert.equal(npmInstalls(sb, TELEPTY_PKG).length, 0, `a kept telepty must never be re-installed\n${d}`);
        assert.equal(calls(sb).filter((c) => c.tool === "npx").length, row.expect.npx, `deliberation npx calls\n${d}`);
        assert.equal(phase1Wrote(sb), row.expect.phase1, `phase 1 writes into HOME\n${d}`);
        // The durable record agrees with what actually ran.
        assert.deepEqual(recordedPhases(sb), row.expect.phases, `recorded phases\n${d}`);
        assertNoRealActuator(sb, r);
      } finally { sb.cleanup(); }
    });
  }
}

// ── F5: the resume target is data, never a program ──────────────────────────

// Each payload is a real exploit attempt against the old
// `manifest.components['<target>'] && …` string interpolation. `touched` is the
// side effect the old code performed before printing its refusal.
const INJECTIONS = [
  { id: "comma-operator write", payload: (m) => `x',(require("fs").writeFileSync(${JSON.stringify(m)},"pwned")),'y` },
  { id: "bracket close + write", payload: (m) => `devkit-core'] && require("fs").writeFileSync(${JSON.stringify(m)},"pwned") || manifest.components['devkit-core` },
  { id: "process exit", payload: () => `x',(process.exit(0)),'y` },
  { id: "prototype walk", payload: () => `__proto__` },
  { id: "constructor walk", payload: () => `constructor` },
];

for (const inj of INJECTIONS) {
  test(`sh :: resume target injection is refused without executing it (${inj.id})`, { skip: SKIP.sh, timeout: RUN_TIMEOUT_MS }, () => {
    const sb = mkSandbox(`inject-${inj.id}`);
    try {
      const marker = path.join(sb.root, "PWNED");
      const r = run("sh", sb, { components: "devkit-core", resume: inj.payload(marker) });
      const d = describe(sb, r);

      assert.notEqual(r.code, 0, `an unknown resume target must refuse\n${d}`);
      assert.ok(/Unknown resume target/.test(r.plain), `the refusal message is preserved\n${d}`);
      // The whole point of F5: the refusal must be the ONLY thing that happened.
      assert.equal(fs.existsSync(marker), false, `the payload executed: ${marker}\n${d}`);
      assert.deepEqual(calls(sb), [], `nothing may run before the refusal\n${d}`);
      assert.equal(phase1Wrote(sb), false, `no phase may run on a refused target\n${d}`);
      assert.equal(fs.existsSync(sb.journal), false, `a refused target must not open a journal\n${d}`);
    } finally { sb.cleanup(); }
  });
}

test("sh :: valid named and numeric resume targets still resolve to the manifest phase", { skip: SKIP.sh, timeout: RUN_TIMEOUT_MS }, () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  // Every named component in the shipped manifest, plus its numeric twin.
  for (const [name, def] of Object.entries(manifest.components)) {
    const sb = mkSandbox(`resume-${name}`);
    try {
      for (const target of [name, String(def.phase)]) {
        const r = run("sh", sb, { components: "", resume: target });
        const d = describe(sb, r);
        assert.equal(r.code, 0, `resume=${target} must be accepted\n${d}`);
        assert.ok(r.plain.includes(`Resume target: ${target} (starting at phase ${def.phase})`),
          `resume=${target} must resolve to phase ${def.phase}\n${d}`);
      }
    } finally { sb.cleanup(); }
  }
});

test("sh :: an unknown-but-harmless resume target is still refused the same way", { skip: SKIP.sh, timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("resume-unknown");
  try {
    const r = run("sh", sb, { components: "devkit-core", resume: "no-such-component" });
    const d = describe(sb, r);
    assert.notEqual(r.code, 0, d);
    assert.ok(/Unknown resume target: no-such-component/.test(r.plain), d);
  } finally { sb.cleanup(); }
});

// ── source-shape regression lock (NOT native acceptance for F9) ─────────────

// Same fixture-state contract as tests/installer-recovery-1147.test.js: the
// fake's private state is structural, not nominated by its caller.
test("fixture control: no caller argv can move the fake's reads or writes", { skip: SKIP.sh }, () => {
  const sb = mkSandbox("fixture-control");
  try {
    const decoy = path.join(sb.root, "decoy-state");
    const runFake = (...argv) => spawnSync(process.execPath, [sb.fakeJs, ...argv], {
      cwd: sb.root,
      env: { PATH: process.env.PATH, HOME: sb.home, TMPDIR: sb.tmp },
      encoding: "utf8",
      timeout: 30000,
    });

    // A tool outside the fixture vocabulary — including a traversal-shaped name
    // and the old "state directory first" argv shape — is refused inert.
    for (const argv of [["not-a-fixture-tool"], ["../../../../decoy-state"], [decoy, "npm", "install"]]) {
      const r = runFake(...argv);
      assert.equal(r.status, 98, `must be refused: ${JSON.stringify(argv)} -> ${r.stderr}`);
    }
    assert.equal(fs.existsSync(decoy), false, "the decoy state directory was never created");
    assert.deepEqual(calls(sb), [], "nothing may be logged for refused calls");

    // A legitimate tool records into the fixed private state; args stay data.
    const ok = runFake("npm", "--prefix", decoy, "install", "-g", "pkg");
    assert.equal(ok.status, 0, `a fixture tool must still work: ${ok.stderr}`);
    assert.equal(fs.existsSync(decoy), false, "an argv that looks like a path must stay data");
    assert.deepEqual(calls(sb).map((c) => [c.tool, c.args]),
      [["npm", ["--prefix", decoy, "install", "-g", "pkg"]]], "tool and args preserved as data");

    // The tripwire still fires through the same fixed state.
    assert.equal(runFake("git", "clone", "https://example.invalid/x.git").status, 97, "sentinel must trip");
    assert.equal(calls(sb).filter((c) => c.forbidden).length, 1, "the breach is recorded");

    // The vocabulary is exactly the installed shim set.
    const vocabulary = JSON.parse(fs.readFileSync(path.join(sb.state, "tools.json"), "utf8"));
    const shimmed = fs.readdirSync(sb.fakebin).filter((n) => n !== "node");
    assert.deepEqual([...shimmed].sort(), [...vocabulary].sort(),
      "every shim must be in the vocabulary and vice versa");
  } finally { sb.cleanup(); }
});

test("install.ps1 parenthesises every phase guard (source shape, not a PowerShell measurement)", () => {
  const ps = fs.readFileSync(INSTALL_PS1, "utf8");
  // `Should-RunPhase N -and (...)` parses in command mode: `-and` and the
  // selection result become extra positional arguments that a non-advanced
  // one-parameter function silently discards, so the filter goes inert.
  const bad = ps.split(/\r?\n/)
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /Should-RunPhase\s+\d+\s+-/.test(line));
  assert.deepEqual(bad, [], `unparenthesised phase guard(s): ${JSON.stringify(bad)}`);

  // Each guarded phase still pairs its number with its component.
  for (const [phase, component] of [[1, "devkit-core"], [2, "telepty"], [3, "deliberation"], [4, "brain"], [5, "dustcraw"], [6, "registry-wiring"]]) {
    assert.ok(ps.includes(`if ((Should-RunPhase ${phase}) -and (Test-ComponentSelected "${component}"))`),
      `phase ${phase} must be guarded by (Should-RunPhase ${phase}) -and (Test-ComponentSelected "${component}")`);
  }
});

test("both installers gate every optional phase on the same component names", () => {
  const sh = fs.readFileSync(INSTALL_SH, "utf8");
  const ps = fs.readFileSync(INSTALL_PS1, "utf8");
  for (const [phase, component] of [[1, "devkit-core"], [2, "telepty"], [3, "deliberation"], [4, "brain"], [5, "dustcraw"], [6, "registry-wiring"]]) {
    assert.ok(sh.includes(`should_run_phase ${phase} && component_selected "${component}"`),
      `install.sh phase ${phase} guard`);
    assert.ok(ps.includes(`(Should-RunPhase ${phase}) -and (Test-ComponentSelected "${component}")`),
      `install.ps1 phase ${phase} guard`);
  }
  // The manifest is the one place that maps a component to its phase number.
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  for (const [phase, component] of [[1, "devkit-core"], [2, "telepty"], [3, "deliberation"], [4, "brain"], [5, "dustcraw"], [6, "registry-wiring"]]) {
    assert.equal(manifest.components[component].phase, phase, `manifest phase for ${component}`);
  }
});

// What a native Windows CI leg must still do for F9 (recorded, not claimed):
// run this file on windows-latest so the `pwsh` and `ps51` rows above execute
// instead of reporting NOTRUN. Until then F9's correction is source-shape
// reviewed and POSIX-parity tested only.
test("the PowerShell rows report NOTRUN off Windows instead of passing", () => {
  if (IS_WIN) {
    assert.equal(SKIP.pwsh, false, "on win32 the PowerShell rows must run");
    assert.equal(SKIP.ps51, false, "on win32 the PowerShell rows must run");
  } else {
    assert.equal(SKIP.pwsh, NOTRUN_PS, "off win32 the PowerShell rows must be NOTRUN");
    assert.equal(SKIP.ps51, NOTRUN_PS, "off win32 the PowerShell rows must be NOTRUN");
    assert.equal(SKIP.sh, false, "install.sh rows are the POSIX parity oracle and do run here");
  }
});
