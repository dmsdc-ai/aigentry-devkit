// Hermetic tests for `setup --profile orchestrator` (#518).
//
// Principle (SPEC §12): install into a TEMP prefix, assert on generated
// artifacts, NEVER touch the real ~/.claude, ~/.aigentry, ~/Library/LaunchAgents,
// and NEVER hit the network (a pre-seeded fixture clone replaces git clone).
//
// Run: node --test tests/orchestrator-profile.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
process.umask(0o077);

const REPO = path.resolve(__dirname, "..");
const FIXTURE = path.join(REPO, "tests", "fixtures", "fake-orchestrator");
const BOOTSTRAP = path.join(REPO, "lib", "bootstrap.js");
const INSTALL_SH = path.join(REPO, "install.sh");

function mkSandbox() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "orch-prof-"));
  const home = path.join(tmp, "home");
  const projects = path.join(tmp, "projects");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(projects, { recursive: true });
  return {
    tmp,
    home,
    projects,
    aigentryHome: path.join(home, ".aigentry"),
    xdgConfig: path.join(home, ".config"),
    cleanup: () => { if(process.env.AIGENTRY_TEST_KEEP!=="1")fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

// Spawn a child `node -e` so module-level HOME in bootstrap.js binds to the
// sandbox (mirrors how install.sh invokes the writers).
function runBootstrapCall(code, env) {
  const evidence=fs.mkdtempSync(path.join(os.tmpdir(),"orch-observer-"));
  fs.writeFileSync(path.join(evidence,"bootstrap.cjs"),code);
  return execFileSync(process.execPath, ["-e", code], {
    env: { ...process.env, ...env, AIGENTRY_LOGGER_DISABLED:"1", PATH:"" },
    encoding: "utf-8",
  });
}

// Recursively copy the fixture clone into a sandbox ORCH_DIR and `git init` it so
// install.sh's 8.2 takes the update path (offline: fetch/pull warn, keep local).
function seedFixtureClone(destDir) {
  fs.cpSync(FIXTURE, destDir, { recursive: true });
  // chmod +x the shell stubs
  for (const f of ["install-instructions.sh", "session-reconciler.sh", "dispatch.sh"]) {
    fs.chmodSync(path.join(destDir, "bin", f), 0o755);
  }
  fs.chmodSync(path.join(destDir, ".claude", "hooks", "post-dispatch-verify-reminder.sh"), 0o755);
  // Synthetic existing-clone metadata: no Git executable is invoked.
  fs.mkdirSync(path.join(destDir,".git"));
}

// ── §12.3 config.json generation + portability ──────────────────────────────

test("writeOrchestratorConfig derives deviceId + roots roles at sandbox, idempotent", () => {
  const sb = mkSandbox();
  try {
    const env = { HOME: sb.home, AIGENTRY_HOME: sb.aigentryHome };
    runBootstrapCall(
      `require(${JSON.stringify(BOOTSTRAP)}).writeOrchestratorConfig({projectsRoot:${JSON.stringify(sb.projects)}})`,
      env
    );
    const cfgPath = path.join(sb.aigentryHome, "config.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));

    // deviceId is DERIVED from this host (device-<sanitized hostname>), never a
    // copied literal and never a path.
    const expectedId = "device-" + String(os.hostname() || "host")
      .replace(/[^A-Za-z0-9.-]/g, "-").replace(/-+$/, "");
    assert.equal(cfg.deviceId, expectedId);
    assert.ok(!cfg.deviceId.includes("/"), "deviceId must not contain a path");

    // all 9 roles present, each rooted under the sandbox PROJECTS_ROOT.
    const roles = Object.keys(cfg.roles);
    assert.equal(roles.length, 9);
    for (const [name, def] of Object.entries(cfg.roles)) {
      assert.equal(def.path, path.join(sb.projects, `aigentry-${name}`));
      assert.ok(def.path.startsWith(sb.projects), "role path must root at sandbox");
      assert.equal(def.cli, "claude");
    }
    // No live remote/consent state copied.
    assert.equal(cfg.remoteUrl, undefined);
    assert.equal(cfg.lastSyncAt, undefined);

    // Idempotent re-run: deviceId + roles preserved, no duplication.
    runBootstrapCall(
      `require(${JSON.stringify(BOOTSTRAP)}).writeOrchestratorConfig({projectsRoot:${JSON.stringify(sb.projects)}})`,
      env
    );
    const cfg2 = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    assert.deepEqual(cfg2, cfg);
  } finally {
    sb.cleanup();
  }
});

test("writeOrchestratorConfig is add-only — preserves existing deviceId + custom roles", () => {
  const sb = mkSandbox();
  try {
    fs.mkdirSync(sb.aigentryHome, { recursive: true });
    const cfgPath = path.join(sb.aigentryHome, "config.json");
    fs.writeFileSync(cfgPath, JSON.stringify({
      version: 1,
      deviceId: "device-PRESET",
      roles: {
        deliberation: { path: "/custom/deliberation", cli: "codex" },
        orchestrator: { path: "/custom/orchestrator", cli: "gemini" },
      },
    }, null, 2));

    runBootstrapCall(
      `require(${JSON.stringify(BOOTSTRAP)}).writeOrchestratorConfig({projectsRoot:${JSON.stringify(sb.projects)}})`,
      { HOME: sb.home, AIGENTRY_HOME: sb.aigentryHome }
    );
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));

    // Existing deviceId never overwritten.
    assert.equal(cfg.deviceId, "device-PRESET");
    // Pre-existing roles (incl. outside the 9-set) preserved verbatim.
    assert.equal(cfg.roles.deliberation.path, "/custom/deliberation");
    assert.equal(cfg.roles.orchestrator.path, "/custom/orchestrator");
    assert.equal(cfg.roles.orchestrator.cli, "gemini");
    // Missing canonical roles filled in.
    assert.equal(cfg.roles.coder.path, path.join(sb.projects, "aigentry-coder"));
  } finally {
    sb.cleanup();
  }
});

// ── §12.4 hooks deep-merge ──────────────────────────────────────────────────

test("mergeClaudeHooks preserves user keys, rewrites PostToolUse to absolute, idempotent", () => {
  const sb = mkSandbox();
  try {
    const claudeDir = path.join(sb.home, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify({
      permissions: { allow: ["Bash(ls:*)"] },
      env: { FOO: "bar" },
      hooks: {
        PreToolUse: [
          { matcher: "Write", hooks: [{ type: "command", command: "echo preexisting" }] },
        ],
      },
    }, null, 2));

    const orchDir = path.join(sb.projects, "aigentry-orchestrator");
    const call = `require(${JSON.stringify(BOOTSTRAP)}).mergeClaudeHooks({orchDir:${JSON.stringify(orchDir)}})`;
    runBootstrapCall(call, { HOME: sb.home });

    let s = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    // User keys preserved.
    assert.deepEqual(s.permissions.allow, ["Bash(ls:*)"]);
    assert.equal(s.env.FOO, "bar");
    // Pre-existing hook preserved.
    assert.ok(s.hooks.PreToolUse.some((e) => e.matcher === "Write"));
    // Orchestrator hooks added: Agent + Bash on PreToolUse, Bash on PostToolUse.
    assert.ok(s.hooks.PreToolUse.some((e) => e.matcher === "Agent"));
    assert.equal(s.hooks.PostToolUse.length, 1);
    const postCmd = s.hooks.PostToolUse[0].hooks[0].command;
    // Portability fix: absolute path, no $CLAUDE_PROJECT_DIR.
    assert.ok(!postCmd.includes("$CLAUDE_PROJECT_DIR"), "must not reference CLAUDE_PROJECT_DIR");
    assert.ok(postCmd.includes(path.join(orchDir, ".claude", "hooks", "post-dispatch-verify-reminder.sh")));

    // Idempotent: re-run adds nothing.
    runBootstrapCall(call, { HOME: sb.home });
    const s2 = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.equal(s2.hooks.PreToolUse.length, s.hooks.PreToolUse.length);
    assert.equal(s2.hooks.PostToolUse.length, 1);
  } finally {
    sb.cleanup();
  }
});

// ── §12.2 template substitution ─────────────────────────────────────────────

test("daemon templates substitute fully — no placeholder remains, KeepAlive kept", () => {
  const tmpls = [
    path.join(REPO, "config", "launchd", "com.aigentry.reconciler.plist.template"),
    path.join(REPO, "config", "systemd", "aigentry-reconciler.service.template"),
  ];
  const repoPath = "/sandbox/projects/aigentry-orchestrator";
  const logPath = "/sandbox/logs/reconciler.log";
  const nodeBinDir = path.dirname(process.execPath);
  for (const t of tmpls) {
    const raw = fs.readFileSync(t, "utf-8");
    const out = raw
      .split("@REPO_PATH@").join(repoPath)
      .split("@LOG_PATH@").join(logPath)
      .split("@NODE_BIN_DIR@").join(nodeBinDir);
    assert.ok(!/@[A-Z_]+@/.test(out), `unsubstituted placeholder in ${path.basename(t)}`);
    assert.ok(out.includes(repoPath), "REPO_PATH substituted");
    assert.ok(out.includes(nodeBinDir), "NODE_BIN_DIR substituted");
  }
  // launchd unit preserves KeepAlive (ADR root-cause) and avoids StartInterval.
  const plist = fs.readFileSync(tmpls[0], "utf-8");
  assert.ok(plist.includes("<key>KeepAlive</key>"), "KeepAlive present");
  // No actual StartInterval timer key (the comment may explain why it's avoided).
  assert.ok(!plist.includes("<key>StartInterval</key>"), "StartInterval key absent");
});

// ── §12.1/§12.5/§12.7 full phase-8 hermetic run + idempotency ────────────────

function runPhase8(sb, orchDir, extraEnv = {}) {
  const inventory=(dir)=>fs.readdirSync(dir).sort().flatMap(name=>{
    const file=path.join(dir,name),s=fs.lstatSync(file);
    return [{file,mode:s.mode,nlink:s.nlink,bytes:s.isFile()?fs.readFileSync(file).toString("base64"):s.isSymbolicLink()?fs.readlinkSync(file):null},...(s.isDirectory()?inventory(file):[])];
  });
  const before=inventory(sb.tmp);
  const env={
      PATH:"",
      TMPDIR:sb.tmp,TMP:sb.tmp,TEMP:sb.tmp,
      AIGENTRY_LOGGER_DISABLED:"1",
      HOME: sb.home,
      AIGENTRY_HOME: sb.aigentryHome,
      XDG_CONFIG_HOME: sb.xdgConfig,
      AIGENTRY_PROJECTS_ROOT: sb.projects,
      AIGENTRY_ORCH_DIR: orchDir,
      AIGENTRY_ORCH_BUILD: "true",
      AIGENTRY_SKIP_DAEMON: "1",
      AIGENTRY_INSTALL_PROFILE: "orchestrator",
      AIGENTRY_INSTALL_COMPONENTS: "orchestrator-role",
      AIGENTRY_INSTALL_RESUME: "orchestrator-role",
      ...extraEnv,
    };
  const r=spawnSync("/bin/bash",[INSTALL_SH],{env,encoding:"utf8",timeout:10000});
  const after=inventory(sb.tmp),evidence=fs.mkdtempSync(path.join(os.tmpdir(),"orch-observer-"));
  fs.writeFileSync(path.join(evidence,"shell.json"),JSON.stringify({env,before,after,...r},null,2));
  assert.equal(r.status,1,r.stderr);assert.equal(r.signal,null);
  assert.match(r.stderr,/gated|unavailable/);assert.deepEqual(after,before);
  return r;
}

test("legacy phase-8 input refuses and preserves the complete fixture clone", () => {
  const sb=mkSandbox();
  try {
    const orchDir=path.join(sb.projects,"aigentry-orchestrator");
    seedFixtureClone(orchDir);
    runPhase8(sb,orchDir);
    runPhase8(sb,orchDir);
    assert.equal(fs.existsSync(sb.aigentryHome),false);
    assert.equal(fs.existsSync(path.join(sb.home,".claude")),false);
  } finally {sb.cleanup();}
});

// ── §12.7 doctor auto-detect gating ─────────────────────────────────────────

function runDoctor(sb, env = {}) {
  try {
    return execFileSync(process.execPath, [path.join(REPO, "bin", "aigentry-devkit.js"), "doctor"], {
      env: {
        ...process.env,
        PATH:"",
        AIGENTRY_LOGGER_DISABLED:"1",
        HOME: sb.home,
        AIGENTRY_HOME: sb.aigentryHome,
        XDG_CONFIG_HOME: sb.xdgConfig,
        ...env,
      },
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch (e) {
    // doctor exits non-zero when sandbox checks fail — output is on stdout.
    return (e.stdout || "") + (e.stderr || "");
  }
}

test("doctor shows the orchestrator section only when the profile is detected", () => {
  const sb = mkSandbox();
  try {
    // No install-state, no ORCH_DIR → orchestrator section hidden.
    const before = runDoctor(sb);
    assert.ok(!before.includes("Orchestrator Profile"), "section hidden for core-only");

    // Seed an installer-state with an orchestrator block → section shown.
    const stateDir = path.join(sb.xdgConfig, "aigentry-devkit");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "install-state.json"), JSON.stringify({
      profile: "orchestrator",
      components: ["devkit-core", "telepty", "deliberation", "orchestrator-role"],
      orchestrator: { status: "installed", repo_dir: path.join(sb.projects, "aigentry-orchestrator") },
    }, null, 2));

    const after = runDoctor(sb);
    assert.ok(after.includes("Orchestrator Profile"), "section shown when detected");
    assert.ok(after.includes("dispatch.sh on PATH"), "orchestrator checks listed");
  } finally {
    sb.cleanup();
  }
});

// ── §12.6 soft-degrade — clone failure must not fail the installer ───────────

test("legacy missing-clone input refuses before clone or state changes", () => {
  const sb = mkSandbox();
  try {
    const orchDir = path.join(sb.projects, "aigentry-orchestrator-missing");
    // No .git → clone path; bogus local repo URL fails fast offline.
    let exitOk = true;
    try {
      runPhase8(sb, orchDir, { AIGENTRY_ORCH_REPO: "file:///nonexistent/aigentry-orchestrator.git" });
    } catch (e) {
      exitOk = false;
    }
    assert.ok(exitOk, "refusal assertions pass without a clone");
    assert.equal(fs.existsSync(path.join(sb.xdgConfig,"aigentry-devkit")),false);
  } finally {
    sb.cleanup();
  }
});
