"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const { assertMachineLines, makeProject, runScaffold, stdoutLines } = require("./helper");

test("malformed settings writes a backup then exits 4 without partial scaffold writes", () => {
  const { project } = makeProject("malformed");
  const claudeDir = path.join(project, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, "settings.json");
  fs.writeFileSync(settingsPath, "{ bad json\n");

  const result = runScaffold(["--project", project, "--cli", "claude", "--no-auto-report-errors"]);

  assert.equal(result.status, 4);
  assertMachineLines(result);
  const lines = stdoutLines(result);
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^backup ${settingsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.bak\\.`));
  const backupPath = lines[0].slice("backup ".length);
  assert.equal(fs.readFileSync(backupPath, "utf8"), "{ bad json\n");
  assert.match(result.stderr, /error: existing \.claude\/settings\.json malformed JSON; backup written; aborting/);
  assert.equal(fs.existsSync(path.join(project, "AGENTS.md")), false);
});

test("--no-backup cannot uninstall malformed settings", () => {
  const { project } = makeProject("malformed-uninstall");
  const claudeDir = path.join(project, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, "settings.json"), "{ bad json\n");

  const result = runScaffold(["--project", project, "--cli", "claude", "--uninstall", "--no-backup"]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /error: --no-backup forbidden when uninstalling from malformed settings\.json/);
});
