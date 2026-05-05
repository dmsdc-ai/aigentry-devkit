"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const { assertMachineLines, makeProject, runScaffold } = require("./helper");

test("reapply is idempotent and does not rewrite unchanged files", () => {
  const { project } = makeProject("reapply");
  const args = ["--project", project, "--cli", "claude", "--no-auto-report-errors"];

  const first = runScaffold(args);
  assert.equal(first.status, 0, first.stderr);

  const files = [
    "AGENTS.md",
    "CLAUDE.md",
    path.join("state", "task-queue.json"),
    path.join("state", "lessons.json"),
    path.join(".claude", "settings.json"),
  ].map((rel) => path.join(project, rel));
  const before = new Map(files.map((file) => [file, {
    text: fs.readFileSync(file, "utf8"),
    mtimeMs: fs.statSync(file).mtimeMs,
  }]));

  const second = runScaffold(args);
  assert.equal(second.status, 0, second.stderr);
  const lines = assertMachineLines(second);
  assert.deepEqual(lines, [
    `skip ${path.join(project, "AGENTS.md")} (exists)`,
    `skip ${path.join(project, "CLAUDE.md")} (exists)`,
    `skip ${path.join(project, "state", "task-queue.json")} (exists)`,
    `skip ${path.join(project, "state", "lessons.json")} (exists)`,
    `skip ${path.join(project, ".claude", "settings.json")} (unchanged)`,
  ]);
  for (const file of files) {
    assert.equal(fs.readFileSync(file, "utf8"), before.get(file).text);
    assert.equal(fs.statSync(file).mtimeMs, before.get(file).mtimeMs);
  }
});
