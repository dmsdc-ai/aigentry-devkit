const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeTeleptyShim, mkScope, runCli } = require("./helpers");

test("--all aggregates mixed failure exit code while continuing later CLIs", () => {
  const scope = mkScope();
  const shim = makeTeleptyShim(scope);
  const claudeDir = path.join(scope, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "settings.json"), "{ malformed json\n");

  const result = runCli(["scaffold", "install-hooks", "all", "--project", scope], {
    home: scope,
    pathPrefix: shim,
  });
  assert.equal(result.status, 4);
  assert.match(result.stderr, /malformed JSON/);
  assert.match(result.stdout, /error .+\.claude\/settings\.json/);
  assert.match(result.stdout, /created .+AGENTS\.md/);
  assert.match(result.stdout, /skipped .+\.gemini\/settings\.json/);
  assert.equal(fs.existsSync(path.join(scope, "AGENTS.md")), true);
});
