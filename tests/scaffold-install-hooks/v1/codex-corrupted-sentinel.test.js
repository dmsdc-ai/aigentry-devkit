const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { countMatches, mkScope, runCli } = require("./helpers");

test("codex refuses corrupted sentinel without force and recovers with force", () => {
  const scope = mkScope();
  const agentsPath = path.join(scope, "AGENTS.md");
  fs.writeFileSync(agentsPath, "# Existing\n\n<!-- BEGIN aigentry context-ref/v1 -->\n");

  const refused = runCli(["scaffold", "install-hooks", "codex", "--project", scope], { home: scope });
  assert.equal(refused.status, 4);
  assert.match(refused.stderr, /BEGIN sentinel without END/);
  assert.equal(fs.readFileSync(agentsPath, "utf8"), "# Existing\n\n<!-- BEGIN aigentry context-ref/v1 -->\n");

  const forced = runCli(["scaffold", "install-hooks", "codex", "--project", scope, "--force"], { home: scope });
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /replaced .+AGENTS\.md/);

  const text = fs.readFileSync(agentsPath, "utf8");
  assert.match(text, /^# Existing/m);
  assert.equal(countMatches(text, /<!-- BEGIN aigentry context-ref\/v1 -->/g), 1);
  assert.equal(countMatches(text, /<!-- END aigentry context-ref\/v1 -->/g), 1);

  const backups = fs.readdirSync(scope).filter((name) => name.startsWith("AGENTS.md.bak."));
  assert.equal(backups.length, 1);
});
