// Hermetic tests for the post-compaction snapshot restore (#1204): the
// SessionStart(compact) entry mergeClaudeHooks adds to ~/.claude/settings.json,
// and hooks/post-compact-restore.sh itself. Temp HOME / temp workspaces only.
//
// Run: node --test tests/post-compact-restore.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const BOOTSTRAP = path.join(REPO, "lib", "bootstrap.js");
const RESTORE_SH = path.join(REPO, "hooks", "post-compact-restore.sh");
const HEADER = /^CONTEXT SNAPSHOT restored after compact — (.+) \(written (.+)\)\. Read it, then continue the work it describes\.$/;

function mkTmp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-compact-"));
  return { tmp, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// Child process so module-level HOME in bootstrap.js binds to the sandbox.
function mergeClaudeHooks(home, orchDir) {
  execFileSync(process.execPath, ["-e",
    `require(${JSON.stringify(BOOTSTRAP)}).mergeClaudeHooks({orchDir:${JSON.stringify(orchDir)}})`,
  ], { env: { ...process.env, HOME: home }, encoding: "utf-8" });
}

function runRestore({ cwd, env = {} }) {
  const base = { ...process.env };
  delete base.CLAUDE_PROJECT_DIR;
  delete base.GROK_WORKSPACE_ROOT;
  return execFileSync("bash", [RESTORE_SH], { cwd, env: { ...base, ...env }, encoding: "utf-8" });
}

test("mergeClaudeHooks adds SessionStart(compact) restore once, preserving existing entries", () => {
  const { tmp, cleanup } = mkTmp();
  try {
    const home = path.join(tmp, "home");
    const settingsPath = path.join(home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: { SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] }] },
    }, null, 2));
    const orchDir = path.join(tmp, "aigentry-orchestrator");

    mergeClaudeHooks(home, orchDir);
    const s = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.ok(s.hooks.SessionStart.some((e) => e.matcher === "startup"), "pre-existing entry kept");
    const compact = s.hooks.SessionStart.filter((e) => e.matcher === "compact");
    assert.equal(compact.length, 1);
    assert.equal(compact[0].hooks.length, 1);
    assert.equal(compact[0].hooks[0].type, "command");
    assert.equal(compact[0].hooks[0].command, `bash "${RESTORE_SH}"`);
    assert.ok(fs.existsSync(RESTORE_SH), "hook target ships in the devkit");

    // Re-run adds nothing (whole file unchanged).
    mergeClaudeHooks(home, orchDir);
    const s2 = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    assert.deepEqual(s2, s);
  } finally {
    cleanup();
  }
});

test("restore prints header + snapshot from CLAUDE_PROJECT_DIR", () => {
  const { tmp, cleanup } = mkTmp();
  try {
    const snap = path.join(tmp, ".context-snapshot.md");
    fs.writeFileSync(snap, "# Context Snapshot\n- task 1204\n");
    const out = runRestore({ cwd: os.tmpdir(), env: { CLAUDE_PROJECT_DIR: tmp } });
    const lines = out.split("\n");
    const m = HEADER.exec(lines[0]);
    assert.ok(m, `header line: ${lines[0]}`);
    assert.equal(m[1], snap);
    assert.match(m[2], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} /);
    assert.equal(lines[1], "");
    assert.equal(lines.slice(2).join("\n"), "# Context Snapshot\n- task 1204\n");
  } finally {
    cleanup();
  }
});

test("restore is silent when the project ships its own session-start-compact hook", () => {
  const { tmp, cleanup } = mkTmp();
  try {
    fs.writeFileSync(path.join(tmp, ".context-snapshot.md"), "snapshot\n");
    fs.mkdirSync(path.join(tmp, ".claude", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".claude", "hooks", "session-start-compact.sh"), "#!/bin/sh\n");
    assert.equal(runRestore({ cwd: os.tmpdir(), env: { CLAUDE_PROJECT_DIR: tmp } }), "");
  } finally {
    cleanup();
  }
});

test("restore is silent without a snapshot", () => {
  const { tmp, cleanup } = mkTmp();
  try {
    assert.equal(runRestore({ cwd: tmp, env: { CLAUDE_PROJECT_DIR: tmp } }), "");
  } finally {
    cleanup();
  }
});

test("restore falls back to GROK_WORKSPACE_ROOT, then $PWD", () => {
  const { tmp, cleanup } = mkTmp();
  try {
    const ws = path.join(tmp, "ws");
    const cwd = path.join(tmp, "cwd");
    fs.mkdirSync(ws);
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(ws, ".context-snapshot.md"), "from grok workspace\n");
    fs.writeFileSync(path.join(cwd, ".context-snapshot.md"), "from pwd\n");
    const viaGrok = runRestore({ cwd, env: { GROK_WORKSPACE_ROOT: ws } });
    assert.ok(viaGrok.endsWith("\nfrom grok workspace\n"), viaGrok);
    const viaPwd = runRestore({ cwd });
    assert.ok(viaPwd.endsWith("\nfrom pwd\n"), viaPwd);
    // bash resolves $PWD physically here (the inherited PWD names another dir).
    assert.equal(HEADER.exec(viaPwd.split("\n")[0])[1], path.join(fs.realpathSync(cwd), ".context-snapshot.md"));
  } finally {
    cleanup();
  }
});

test("restore is bounded to 400 lines / 32 KiB of snapshot", () => {
  const { tmp, cleanup } = mkTmp();
  try {
    const snap = path.join(tmp, ".context-snapshot.md");
    fs.writeFileSync(snap, Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n") + "\n");
    const byLines = runRestore({ cwd: tmp, env: { CLAUDE_PROJECT_DIR: tmp } }).split("\n").slice(2);
    assert.equal(byLines.filter((l) => l.startsWith("line ")).length, 400);

    fs.writeFileSync(snap, "x".repeat(40 * 1024));
    const body = runRestore({ cwd: tmp, env: { CLAUDE_PROJECT_DIR: tmp } }).split("\n").slice(2).join("\n");
    assert.equal(Buffer.byteLength(body), 32768);
  } finally {
    cleanup();
  }
});
