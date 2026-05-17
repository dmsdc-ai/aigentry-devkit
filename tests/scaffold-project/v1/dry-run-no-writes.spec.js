"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const { assertMachineLines, makeHome, makeProject, runScaffold } = require("./helper");

test("dry-run emits the plan without project or HOME writes", () => {
  const { project } = makeProject("dry-run");
  const home = makeHome("dry-run");
  const result = runScaffold(["--project", project, "--cli", "claude", "--no-auto-report-errors", "--dry-run"], { home });

  assert.equal(result.status, 0, result.stderr);
  const lines = assertMachineLines(result);
  assert.deepEqual(lines, [
    `create ${path.join(project, "AGENTS.md")}`,
    `create ${path.join(project, "CLAUDE.md")}`,
    `create ${path.join(project, "bin", "snyk-scan.sh")}`,
    `create ${path.join(project, "state", "task-queue.json")}`,
    `create ${path.join(project, "state", "lessons.json")}`,
    `create ${path.join(project, ".claude", "settings.json")}`,
  ]);
  assert.deepEqual(fs.readdirSync(project), []);
  assert.deepEqual(fs.readdirSync(home), []);
});
