"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const { makeProject, tempRoot, runScaffold } = require("./helper");

test("template-dir overrides bundled workspace templates", () => {
  const { project } = makeProject("template-override");
  const templateDir = tempRoot("templates");
  fs.writeFileSync(path.join(templateDir, "AGENTS.codex.md"), "# Custom Codex Template\n");
  fs.mkdirSync(path.join(templateDir, "bin"), { recursive: true });
  fs.writeFileSync(path.join(templateDir, "bin", "snyk-scan.sh"), "#!/usr/bin/env bash\n# stub\n");

  const result = runScaffold(["--project", project, "--cli", "codex", "--template-dir", templateDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), "# Custom Codex Template\n");
  assert.equal(fs.existsSync(path.join(project, ".claude")), false);
  assert.equal(fs.existsSync(path.join(project, "state", "task-queue.json")), true);
  assert.equal(fs.existsSync(path.join(project, "state", "lessons.json")), true);
});
