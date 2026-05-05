"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const { makeProject, readJson, runScaffold, stdoutLines } = require("./helper");

test("sentinel drift is corrected while unknown keys and UserPromptSubmit are preserved", () => {
  const { project } = makeProject("sentinel-drift");
  const settingsPath = path.join(project, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    permissions: {
      "x-aigentry-scaffold": "v1",
      allow: ["Bash(old *)"],
    },
    hooks: {
      "x-aigentry-scaffold": "v1",
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "old" }] }],
      Stop: [{ hooks: [{ type: "command", command: "old stop" }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "keep prompt hook" }] }],
    },
    env: { KEEP: "1" },
    mcpServers: { existing: { command: "true" } },
    model: "keep-model",
  }, null, 2) + "\n");

  const result = runScaffold(["--project", project, "--cli", "claude", "--no-auto-report-errors"]);

  assert.equal(result.status, 0, result.stderr);
  assert(stdoutLines(result).some((line) => line === `merge ${settingsPath}`));
  const settings = readJson(settingsPath);
  assert.deepEqual(settings.permissions, {
    "x-aigentry-scaffold": "v1",
    allow: ["Bash(aterm *)", "Bash(telepty *)"],
  });
  assert.deepEqual(settings.hooks, {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "keep prompt hook" }] }],
  });
  assert.deepEqual(settings.env, { KEEP: "1" });
  assert.deepEqual(settings.mcpServers, { existing: { command: "true" } });
  assert.equal(settings.model, "keep-model");
});
