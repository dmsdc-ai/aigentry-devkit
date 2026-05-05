"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const { assertMachineLines, makeProject, readJson, runScaffold, stdoutLines } = require("./helper");

test("uninstall removes scaffold-managed settings blocks and leaves unsentinelled markdown alone", () => {
  const { project } = makeProject("uninstall");
  const create = runScaffold(["--project", project, "--cli", "claude", "--no-auto-report-errors"]);
  assert.equal(create.status, 0, create.stderr);

  const result = runScaffold(["--project", project, "--cli", "claude", "--uninstall"]);
  assert.equal(result.status, 0, result.stderr);
  assertMachineLines(result);
  const lines = stdoutLines(result);
  assert.equal(lines[0].startsWith(`backup ${path.join(project, ".claude", "settings.json")}.bak.`), true);
  assert.deepEqual(lines.slice(1), [
    `remove ${path.join(project, ".claude", "settings.json")} (sentinel block)`,
    `noop ${path.join(project, "AGENTS.md")} (no sentinel block to remove)`,
    `noop ${path.join(project, "CLAUDE.md")} (no sentinel block to remove)`,
    `noop ${path.join(project, "state", "task-queue.json")} (no sentinel block to remove)`,
    `noop ${path.join(project, "state", "lessons.json")} (no sentinel block to remove)`,
  ]);
  assert.deepEqual(readJson(path.join(project, ".claude", "settings.json")), {});
  assert.equal(fs.existsSync(path.join(project, "AGENTS.md")), true);
});
