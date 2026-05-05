const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "bin", "aigentry-devkit.js");

function mkScope() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aigentry-hooks-"));
}

function makeTeleptyShim(root, version = "0.4.0") {
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const shimPath = path.join(binDir, "telepty");
  fs.writeFileSync(shimPath, `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then\n  echo "telepty ${version}"\n  exit 0\nfi\nexit 0\n`);
  fs.chmodSync(shimPath, 0o755);
  return binDir;
}

function runCli(args, { cwd, home, pathPrefix } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: cwd || repoRoot,
    env: {
      ...process.env,
      HOME: home || mkScope(),
      PATH: pathPrefix ? `${pathPrefix}${path.delimiter}${process.env.PATH}` : process.env.PATH,
    },
    encoding: "utf8",
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function testJsonNamedKey() {
  function parts(keyPath) {
    return keyPath.split(".").filter(Boolean);
  }
  function keyFor(part) {
    return /^\d+$/.test(part) ? Number(part) : part;
  }
  function getAtPath(root, keyPath) {
    let current = root;
    for (const part of parts(keyPath)) {
      if (current == null) return undefined;
      current = current[keyFor(part)];
    }
    return current;
  }
  function ensureArrayAtPath(root, keyPath) {
    const keyParts = parts(keyPath);
    let current = root;
    for (let i = 0; i < keyParts.length; i += 1) {
      const key = keyFor(keyParts[i]);
      if (i === keyParts.length - 1) {
        if (!Array.isArray(current[key])) current[key] = [];
        return current[key];
      }
      const nextKey = keyFor(keyParts[i + 1]);
      const desired = typeof nextKey === "number" ? [] : {};
      if (current[key] == null || typeof current[key] !== "object") current[key] = desired;
      current = current[key];
    }
    return current;
  }
  function read(filePath) {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : {};
  }
  return {
    detect(filePath, keyPath, predicate) {
      const target = getAtPath(read(filePath), keyPath);
      if (!Array.isArray(target)) return { present: false, entryIndex: null, entry: null };
      const entryIndex = target.findIndex(predicate);
      if (entryIndex === -1) return { present: false, entryIndex: null, entry: null };
      return { present: true, entryIndex, entry: target[entryIndex] };
    },
    upsert(filePath, keyPath, predicate, entry) {
      const value = read(filePath);
      const target = ensureArrayAtPath(value, keyPath);
      const entryIndex = target.findIndex(predicate);
      if (entryIndex === -1) {
        target.push(entry);
        fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
        return { action: "appended" };
      }
      if (JSON.stringify(target[entryIndex]) === JSON.stringify(entry)) return { action: "noop" };
      target[entryIndex] = entry;
      fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
      return { action: "replaced" };
    },
  };
}

function assertClaudeSettings(scope) {
  const settingsPath = path.join(scope, ".claude", "settings.json");
  const settings = readJson(settingsPath);
  const hooks = settings.hooks.UserPromptSubmit[0].hooks;
  const entry = hooks.find((hook) => hook.command.includes("aigentry-context-ref-v1.sh"));
  assert.equal(entry.type, "command");
  assert.equal(entry.async, false);
  assert.match(entry.command, /^bash '.+aigentry-context-ref-v1\.sh'$/);
  return { settingsPath, entry };
}

test("idempotency", () => {
  const {
    markdownSentinel,
    scriptSha256,
  } = require("../../../lib/scaffold/idempotent");
  const jsonNamedKey = testJsonNamedKey();
  const scope = mkScope();

  const markdownPath = path.join(scope, "AGENTS.md");
  fs.writeFileSync(markdownPath, "# Existing\n");
  const begin = "<!-- BEGIN aigentry context-ref/v1 -->";
  const end = "<!-- END aigentry context-ref/v1 -->";
  const first = markdownSentinel.upsert(markdownPath, begin, end, "\nbody\n", { backup: false });
  const second = markdownSentinel.upsert(markdownPath, begin, end, "\nbody\n", { backup: false });
  assert.equal(first.action, "inserted");
  assert.equal(second.action, "noop");
  assert.equal(markdownSentinel.detect(markdownPath, begin, end).present, true);

  const jsonPath = path.join(scope, "settings.json");
  const keyPath = "hooks.UserPromptSubmit.0.hooks";
  const predicate = (entry) => entry.command && entry.command.includes("aigentry-context-ref-v1.sh");
  const entry = { type: "command", command: "bash '/tmp/aigentry-context-ref-v1.sh'", async: false };
  assert.equal(jsonNamedKey.upsert(jsonPath, keyPath, predicate, entry, { backup: false }).action, "appended");
  assert.equal(jsonNamedKey.upsert(jsonPath, keyPath, predicate, entry, { backup: false }).action, "noop");
  assert.equal(jsonNamedKey.detect(jsonPath, keyPath, predicate).present, true);

  const scriptPath = path.join(scope, "hook.sh");
  const body = [
    "#!/usr/bin/env bash",
    "# context-ref-installer/v1 sha256={{SCRIPT_SHA256}}",
    "printf 'ok\\n'",
    "",
  ].join("\n");
  const written = scriptSha256.write(scriptPath, body, "SCRIPT_SHA256", { force: false, backup: false });
  const rewritten = scriptSha256.write(scriptPath, body, "SCRIPT_SHA256", { force: false, backup: false });
  assert.equal(written.action, "created");
  assert.equal(rewritten.action, "noop");
  assert.equal(scriptSha256.detect(scriptPath).headerMatchesFile, true);
});

test("claude-fresh", () => {
  const scope = mkScope();
  const shim = makeTeleptyShim(scope);
  const result = runCli(["scaffold", "install-hooks", "claude", "--project", scope], {
    home: scope,
    pathPrefix: shim,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /created .+aigentry-context-ref-v1\.sh/);
  assert.match(result.stdout, /created .+settings\.json/);

  assertClaudeSettings(scope);
  const scriptPath = path.join(scope, ".claude", "hooks", "aigentry-context-ref-v1.sh");
  const script = fs.readFileSync(scriptPath, "utf8");
  assert.match(script, /^# context-ref-installer\/v1 sha256=[0-9a-f]{64}$/m);
  assert.match(script, /^# min telepty version: 0\.4\.0$/m);

  const payloadPath = path.join(scope, "payload.md");
  fs.writeFileSync(payloadPath, "authoritative payload\n");
  fs.chmodSync(payloadPath, 0o600);
  const prompt = `[context-ref] Read ${payloadPath} and use it as the source of truth for this task.\ninline note`;
  const hook = spawnSync("bash", [scriptPath], {
    input: prompt,
    env: { ...process.env, HOME: scope, PATH: `${shim}${path.delimiter}${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.equal(hook.status, 0, hook.stderr);
  const decoded = JSON.parse(hook.stdout);
  assert.equal(decoded.additionalContext, "authoritative payload\n");
  assert.deepEqual(Object.keys(decoded.aigentry_context_ref).sort(), [
    "decoded_at",
    "inline_message",
    "ref_body",
    "ref_path",
    "ref_sha256",
    "version",
  ]);
  assert.equal(decoded.aigentry_context_ref.version, "context-ref/v1");
  assert.equal(decoded.aigentry_context_ref.ref_path, payloadPath);
  assert.equal(decoded.aigentry_context_ref.ref_sha256, sha256("authoritative payload\n"));
  assert.equal(decoded.aigentry_context_ref.inline_message, "inline note");

  makeTeleptyShim(scope, "0.3.0");
  const downgraded = spawnSync("bash", [scriptPath], {
    input: prompt,
    env: { ...process.env, HOME: scope, PATH: `${shim}${path.delimiter}${process.env.PATH}` },
    encoding: "utf8",
  });
  assert.equal(downgraded.status, 0, downgraded.stderr);
  assert.equal(downgraded.stdout, prompt);
  assert.match(downgraded.stderr, /older than required 0\.4\.0; pass-through/);
});

test("claude-reapply", () => {
  const scope = mkScope();
  const shim = makeTeleptyShim(scope);
  assert.equal(runCli(["scaffold", "install-hooks", "claude", "--project", scope], { home: scope, pathPrefix: shim }).status, 0);
  const settingsPath = path.join(scope, ".claude", "settings.json");
  const scriptPath = path.join(scope, ".claude", "hooks", "aigentry-context-ref-v1.sh");
  const before = [fs.readFileSync(settingsPath, "utf8"), fs.readFileSync(scriptPath, "utf8")];
  const result = runCli(["scaffold", "install-hooks", "claude", "--project", scope], { home: scope, pathPrefix: shim });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /noop .+settings\.json/);
  assert.match(result.stdout, /noop .+aigentry-context-ref-v1\.sh/);
  assert.deepEqual([fs.readFileSync(settingsPath, "utf8"), fs.readFileSync(scriptPath, "utf8")], before);
});

test("claude-uninstall", () => {
  const scope = mkScope();
  const shim = makeTeleptyShim(scope);
  assert.equal(runCli(["scaffold", "install-hooks", "claude", "--project", scope], { home: scope, pathPrefix: shim }).status, 0);
  const result = runCli(["scaffold", "install-hooks", "claude", "--project", scope, "--uninstall"], {
    home: scope,
    pathPrefix: shim,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /removed .+aigentry-context-ref-v1\.sh/);
  assert.equal(fs.existsSync(path.join(scope, ".claude", "hooks", "aigentry-context-ref-v1.sh")), false);
  const settingsPath = path.join(scope, ".claude", "settings.json");
  if (fs.existsSync(settingsPath)) {
    const settingsText = fs.readFileSync(settingsPath, "utf8");
    assert.equal(settingsText.includes("aigentry-context-ref-v1.sh"), false);
  }
});

test("codex-fresh", () => {
  const scope = mkScope();
  const agentsPath = path.join(scope, "AGENTS.md");
  fs.writeFileSync(agentsPath, "# Existing\n");
  const result = runCli(["scaffold", "install-hooks", "codex", "--project", scope], { home: scope });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /updated .+AGENTS\.md/);
  const text = fs.readFileSync(agentsPath, "utf8");
  assert.match(text, /^# Existing/m);
  assert.match(text, /<!-- BEGIN aigentry context-ref\/v1 -->/);
  assert.match(text, /literal prefix\n`\[context-ref\] Read <path-token> and use it as the source of truth for this task\.`/);
  assert.match(text, /<!-- END aigentry context-ref\/v1 -->/);
});

test("codex-reapply", () => {
  const scope = mkScope();
  assert.equal(runCli(["scaffold", "install-hooks", "codex", "--project", scope], { home: scope }).status, 0);
  const agentsPath = path.join(scope, "AGENTS.md");
  const before = fs.readFileSync(agentsPath, "utf8");
  const result = runCli(["scaffold", "install-hooks", "codex", "--project", scope], { home: scope });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /noop .+AGENTS\.md/);
  assert.equal(fs.readFileSync(agentsPath, "utf8"), before);
});

test("codex-uninstall", () => {
  const scope = mkScope();
  const agentsPath = path.join(scope, "AGENTS.md");
  fs.writeFileSync(agentsPath, "# Existing\n");
  assert.equal(runCli(["scaffold", "install-hooks", "codex", "--project", scope], { home: scope }).status, 0);
  const result = runCli(["scaffold", "install-hooks", "codex", "--project", scope, "--uninstall"], { home: scope });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /removed .+AGENTS\.md/);
  const text = fs.readFileSync(agentsPath, "utf8");
  assert.equal(text.includes("BEGIN aigentry context-ref/v1"), false);
  assert.match(text, /^# Existing/m);
});

test("gemini-deferred", { skip: "Gemini hook framework blocked by spec section 4.3.0 dustcraw research precondition" }, () => {});

test("all-fanout", () => {
  const scope = mkScope();
  const shim = makeTeleptyShim(scope);
  const result = runCli(["scaffold", "install-hooks", "all", "--project", scope], {
    home: scope,
    pathPrefix: shim,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(scope, ".claude", "settings.json")), true);
  assert.equal(fs.existsSync(path.join(scope, "AGENTS.md")), true);
  assert.equal(fs.existsSync(path.join(scope, ".gemini", "settings.json")), false);
  assert.match(result.stdout, /skipped .+\.gemini\/settings\.json/);
});

test("dry-run", () => {
  const scope = mkScope();
  const shim = makeTeleptyShim(scope);
  const result = runCli(["scaffold", "install-hooks", "claude", "--project", scope, "--dry-run"], {
    home: scope,
    pathPrefix: shim,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /=== .+aigentry-context-ref-v1\.sh ===/);
  assert.match(result.stdout, /\[dry-run\] 2 files would change; 0 unchanged\./);
  assert.equal(fs.existsSync(path.join(scope, ".claude")), false);
});

test("manifest-version", () => {
  const scope = mkScope();
  const shim = makeTeleptyShim(scope);
  const install = runCli(["scaffold", "install-hooks", "claude", "--project", scope], {
    home: scope,
    pathPrefix: shim,
  });
  assert.equal(install.status, 0, install.stderr);
  const script = fs.readFileSync(path.join(scope, ".claude", "hooks", "aigentry-context-ref-v1.sh"), "utf8");
  assert.match(script, /^# context-ref-installer\/v1 sha256=[0-9a-f]{64}$/m);
  assert.match(script, /^# context-ref\/v1 - devkit-installed hook for \[context-ref\] inject protocol$/m);
  assert.match(script, /telepty --version/);
  assert.match(script, /pass-through/);

  const help = runCli(["scaffold", "install-hooks", "--help"], { home: scope });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:\n  aigentry scaffold install-hooks <cli>/);
  assert.match(help.stdout, /Exit codes:/);
  assert.match(help.stdout, /\[context-ref\/v1\] ADR section 3\.1\.2/);
});
