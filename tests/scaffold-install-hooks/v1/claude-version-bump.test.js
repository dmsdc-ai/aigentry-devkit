const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeTeleptyShim, mkScope, runCli } = require("./helpers");
const { scriptSha256 } = require("../../../lib/scaffold/idempotent");

function renderWithDevkitVersion(scriptText, version) {
  const withPlaceholder = scriptText
    .replace(/^# context-ref-installer\/v1 sha256=[0-9a-f]{64}$/m, "# context-ref-installer/v1 sha256={{SCRIPT_SHA256}}")
    .replace(/^# devkit version: .+$/m, `# devkit version: ${version}`);
  return scriptSha256.render(withPlaceholder, "SCRIPT_SHA256").rendered;
}

test("claude version bump replaces a valid older managed script", () => {
  const scope = mkScope();
  const shim = makeTeleptyShim(scope);
  const first = runCli(["scaffold", "install-hooks", "claude", "--project", scope], {
    home: scope,
    pathPrefix: shim,
  });
  assert.equal(first.status, 0, first.stderr);

  const scriptPath = path.join(scope, ".claude", "hooks", "aigentry-context-ref-v1.sh");
  const current = fs.readFileSync(scriptPath, "utf8");
  fs.writeFileSync(scriptPath, renderWithDevkitVersion(current, "0.0.20"), { mode: 0o755 });
  fs.chmodSync(scriptPath, 0o755);
  assert.match(fs.readFileSync(scriptPath, "utf8"), /^# devkit version: 0\.0\.20$/m);

  const bumped = runCli(["scaffold", "install-hooks", "claude", "--project", scope], {
    home: scope,
    pathPrefix: shim,
  });
  assert.equal(bumped.status, 0, bumped.stderr);
  assert.match(bumped.stdout, /replaced .+aigentry-context-ref-v1\.sh/);
  assert.match(fs.readFileSync(scriptPath, "utf8"), /^# devkit version: 0\.0\.21$/m);

  const backups = fs.readdirSync(path.dirname(scriptPath)).filter((name) => name.startsWith("aigentry-context-ref-v1.sh.bak."));
  assert.equal(backups.length, 1);
});
