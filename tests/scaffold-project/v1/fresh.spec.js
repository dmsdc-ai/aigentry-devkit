"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const {
  assertMachineLines,
  expectedLegacyAgents,
  expectedStateFile,
  makeProject,
  readJson,
  runScaffold,
} = require("./helper");

test("fresh claude scaffold creates the project matrix and preserves golden template output", () => {
  const { project } = makeProject("fresh");
  const result = runScaffold(["--project", project, "--cli", "claude", "--no-auto-report-errors"]);

  assert.equal(result.status, 0, result.stderr);
  const lines = assertMachineLines(result);
  assert.deepEqual(lines, [
    `create ${path.join(project, "AGENTS.md")}`,
    `create ${path.join(project, "CLAUDE.md")}`,
    `create ${path.join(project, "state", "task-queue.json")}`,
    `create ${path.join(project, "state", "lessons.json")}`,
    `create ${path.join(project, ".claude", "settings.json")}`,
  ]);

  assert.equal(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), expectedLegacyAgents(project));
  assert.equal(
    fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8"),
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "templates", "workspace", "CLAUDE.md"), "utf8")
      .replace(/\{\{WORKSPACE_NAME\}\}/g, path.basename(project))
  );
  assert.equal(fs.readFileSync(path.join(project, "state", "task-queue.json"), "utf8"), expectedStateFile("task-queue.json"));
  assert.equal(fs.readFileSync(path.join(project, "state", "lessons.json"), "utf8"), expectedStateFile("lessons.json"));

  const settings = readJson(path.join(project, ".claude", "settings.json"));
  assert.deepEqual(settings, {
    permissions: {
      "x-aigentry-scaffold": "v1",
      allow: ["Bash(aterm *)", "Bash(telepty *)"],
    },
  });
  assert.equal(fs.existsSync(path.join(project, ".claude", "settings.local.json")), false);
});
