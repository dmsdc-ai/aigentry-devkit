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
const { execFileSync } = require("child_process");

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
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

// Spawn a child `node -e` so module-level HOME in bootstrap.js binds to the
// sandbox (mirrors how install.sh invokes the writers).
function runBootstrapCall(code, env) {
  return execFileSync(process.execPath, ["-e", code], {
    env: { ...process.env, ...env },
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
  execFileSync("git", ["init", "-q"], { cwd: destDir });
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
  return execFileSync("bash", [INSTALL_SH], {
    env: {
      ...process.env,
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
    },
    encoding: "utf-8",
    stdio: "pipe",
  });
}

test("phase-8 hermetic install generates all artifacts and is idempotent", () => {
  const sb = mkSandbox();
  try {
    const orchDir = path.join(sb.projects, "aigentry-orchestrator");
    seedFixtureClone(orchDir);

    // First run — must complete (exit 0) without touching the real home.
    runPhase8(sb, orchDir);

    // Instruction tree (load-bearing file).
    assert.ok(
      fs.existsSync(path.join(sb.aigentryHome, "instructions", "roles", "orchestrator.md")),
      "instruction tree written"
    );

    // dispatch.sh PATH-linked into the sandbox bin dir.
    const dispatchLink = path.join(sb.home, ".local", "bin", "dispatch.sh");
    assert.ok(fs.existsSync(dispatchLink), "dispatch.sh linked onto PATH");

    // §8.5 re-point. The loop at install.sh:950 is driven by the adapter's
    // DECLARED list, and the devkit currently declares none: #613 A2 made
    // open-session.sh an orchestrator-owned real file (it owns its runtime spawn
    // entrypoint) and #614 did the same for tq-*.sh and trust-*.sh, so all five
    // were removed from self_symlink_repoint and §8.5 is a forward-compatibility
    // no-op until a future self-symlink is declared. Assert that declared
    // contract rather than the pre-#613 behaviour: whatever the adapter declares
    // must be re-pointed into THIS devkit's bin/, and whatever it does not
    // declare must be left exactly as the clone shipped it.
    const adapter = JSON.parse(fs.readFileSync(
      path.join(REPO, "config", "modules", "orchestrator-role.adapter.json"), "utf-8"));
    const declaredRepoint = adapter["x-git-install"].self_symlink_repoint;
    assert.ok(Array.isArray(declaredRepoint), "self_symlink_repoint must be a declared list");
    // Vacuous while the declaration is empty — that is the honest consequence of
    // the product's own declaration, and it starts asserting again by itself the
    // moment a self-symlink is re-declared.
    for (const name of declaredRepoint) {
      const repointed = path.join(orchDir, "bin", name);
      assert.ok(fs.lstatSync(repointed).isSymbolicLink(), `${name} is re-pointed as a symlink`);
      assert.equal(fs.readlinkSync(repointed), path.join(REPO, "bin", name));
      assert.ok(fs.existsSync(fs.readlinkSync(repointed)), `re-point target exists (not dangling): ${name}`);
    }
    // Discriminating negative for the undeclared names: the devkit still SHIPS
    // bin/open-session.sh, so a stray re-point would succeed if §8.5 made one.
    // Requiring its absence in the clone is what catches a silent return of the
    // pre-#613 behaviour instead of letting it pass unnoticed.
    for (const name of ["open-session.sh"].filter((n) => !declaredRepoint.includes(n))) {
      assert.ok(fs.existsSync(path.join(REPO, "bin", name)),
        `the devkit still ships bin/${name}, so an undeclared re-point would succeed`);
      assert.equal(fs.existsSync(path.join(orchDir, "bin", name)), false,
        `${name} is orchestrator-owned and undeclared: phase 8 must not create it in the clone`);
    }
    // The clone's own bin entries stay orchestrator-owned real files: not
    // replaced by symlinks into the devkit, and byte-identical to the fixture.
    for (const name of ["dispatch.sh", "session-reconciler.sh", "install-instructions.sh"]) {
      const inClone = path.join(orchDir, "bin", name);
      assert.equal(fs.lstatSync(inClone).isSymbolicLink(), false,
        `${name} must stay an orchestrator-owned real file`);
      assert.deepEqual(fs.readFileSync(inClone), fs.readFileSync(path.join(FIXTURE, "bin", name)),
        `${name} must be left as the clone shipped it`);
    }

    // config.json generated, parameterized at sandbox.
    const cfg = JSON.parse(fs.readFileSync(path.join(sb.aigentryHome, "config.json"), "utf-8"));
    assert.ok(cfg.roles.orchestrator.path.startsWith(sb.projects));
    assert.ok(cfg.deviceId.startsWith("device-"));

    // hooks merged; PostToolUse absolute AND the target file exists post-clone.
    const settings = JSON.parse(fs.readFileSync(path.join(sb.home, ".claude", "settings.json"), "utf-8"));
    const postCmd = settings.hooks.PostToolUse[0].hooks[0].command;
    assert.ok(!postCmd.includes("$CLAUDE_PROJECT_DIR"));
    const hookFile = path.join(orchDir, ".claude", "hooks", "post-dispatch-verify-reminder.sh");
    assert.ok(postCmd.includes(hookFile), "PostToolUse points at clone hook");
    assert.ok(fs.existsSync(hookFile), "rewritten hook target exists post-clone");

    // Daemon unit GENERATED (not loaded) — platform-specific.
    if (process.platform === "darwin") {
      const plist = fs.readFileSync(path.join(sb.home, "Library", "LaunchAgents", "com.aigentry.reconciler.plist"), "utf-8");
      assert.ok(!/@[A-Z_]+@/.test(plist), "no placeholder left in generated plist");
      assert.ok(plist.includes(orchDir), "plist points at sandbox ORCH_DIR");
      assert.ok(plist.includes("<key>KeepAlive</key>"));
    } else if (process.platform === "linux") {
      const svcPath = path.join(sb.xdgConfig, "systemd", "user", "aigentry-reconciler.service");
      if (fs.existsSync(svcPath)) {
        const svc = fs.readFileSync(svcPath, "utf-8");
        assert.ok(!/@[A-Z_]+@/.test(svc));
        assert.ok(svc.includes(orchDir));
      }
    }

    // installer-state records the outcome.
    const state = JSON.parse(fs.readFileSync(path.join(sb.xdgConfig, "aigentry-devkit", "install-state.json"), "utf-8"));
    assert.equal(state.orchestrator.status, "installed");
    assert.equal(state.orchestrator.repo_dir, orchDir);

    // Second run — idempotent: still exit 0, no duplicate hooks.
    runPhase8(sb, orchDir);
    const settings2 = JSON.parse(fs.readFileSync(path.join(sb.home, ".claude", "settings.json"), "utf-8"));
    assert.equal(settings2.hooks.PostToolUse.length, 1);
    assert.equal(settings2.hooks.PreToolUse.filter((e) => e.matcher === "Agent").length, 1);
  } finally {
    sb.cleanup();
  }
});

// ── §12.7 doctor auto-detect gating ─────────────────────────────────────────

function runDoctor(sb, env = {}) {
  try {
    return execFileSync(process.execPath, [path.join(REPO, "bin", "aigentry-devkit.js"), "doctor"], {
      env: {
        ...process.env,
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

test("phase-8 soft-degrades when the clone target is absent and repo unreachable", () => {
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
    assert.ok(exitOk, "installer still exits 0 on clone failure (soft policy)");

    const state = JSON.parse(fs.readFileSync(path.join(sb.xdgConfig, "aigentry-devkit", "install-state.json"), "utf-8"));
    assert.ok(["degraded", "skipped"].includes(state.orchestrator.status), `degraded/skipped, got ${state.orchestrator.status}`);
  } finally {
    sb.cleanup();
  }
});
