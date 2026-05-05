const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { makeTeleptyShim, mkScope, runCli, sha256 } = require("./helpers");

function installClaude(scope) {
  const shim = makeTeleptyShim(scope);
  const result = runCli(["scaffold", "install-hooks", "claude", "--project", scope], {
    home: scope,
    pathPrefix: shim,
  });
  assert.equal(result.status, 0, result.stderr);
  return {
    shim,
    scriptPath: path.join(scope, ".claude", "hooks", "aigentry-context-ref-v1.sh"),
  };
}

function writePayload(filePath, body, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
  fs.chmodSync(filePath, mode);
}

function runHook(scriptPath, prompt, scope, shim) {
  return spawnSync("bash", [scriptPath], {
    input: prompt,
    env: { ...process.env, HOME: scope, PATH: `${shim}${path.delimiter}${process.env.PATH}` },
    encoding: "utf8",
  });
}

test("claude hook decodes absolute and home-relative conformance inputs", () => {
  const scope = mkScope();
  const { shim, scriptPath } = installClaude(scope);

  const absolutePath = path.join(scope, "absolute.md");
  writePayload(absolutePath, "absolute body\n");
  const absolutePrompt = `[context-ref] Read ${absolutePath} and use it as the source of truth for this task.\ninline`;
  const absolute = runHook(scriptPath, absolutePrompt, scope, shim);
  assert.equal(absolute.status, 0, absolute.stderr);
  const decodedAbsolute = JSON.parse(absolute.stdout);
  assert.equal(decodedAbsolute.aigentry_context_ref.ref_path, absolutePath);
  assert.equal(decodedAbsolute.aigentry_context_ref.ref_sha256, sha256("absolute body\n"));
  assert.equal(decodedAbsolute.aigentry_context_ref.inline_message, "inline");

  const homePath = path.join(scope, ".telepty", "shared", "home.md");
  writePayload(homePath, "home body\n");
  const homePrompt = "[context-ref] Read ~/.telepty/shared/home.md and use it as the source of truth for this task.";
  const home = runHook(scriptPath, homePrompt, scope, shim);
  assert.equal(home.status, 0, home.stderr);
  const decodedHome = JSON.parse(home.stdout);
  assert.equal(decodedHome.aigentry_context_ref.ref_path, homePath);
  assert.equal(decodedHome.aigentry_context_ref.ref_body, "home body\n");
});

test("claude hook fails open for five adversarial inputs", () => {
  const scope = mkScope();
  const { shim, scriptPath } = installClaude(scope);
  const wrongModePath = path.join(scope, "wrong-mode.md");
  writePayload(wrongModePath, "wrong mode\n", 0o644);

  const cases = [
    "plain prompt\nwithout directive",
    `[context-ref] Read ${path.join(scope, "payload.md")} without marker`,
    "[context-ref] Read relative.md and use it as the source of truth for this task.",
    `[context-ref] Read ${path.join(scope, "missing.md")} and use it as the source of truth for this task.`,
    `[context-ref] Read ${wrongModePath} and use it as the source of truth for this task.`,
  ];

  for (const prompt of cases) {
    const result = runHook(scriptPath, prompt, scope, shim);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, prompt);
  }
});
