"use strict";

const assert = require("assert");
const fs = require("fs");
const test = require("node:test");

const { makeProject, runScaffold } = require("./helper");

test("unknown cli exits 2 before writing", () => {
  const { project } = makeProject("unknown-cli");
  const result = runScaffold(["--project", project, "--cli", "llama"]);

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /error: --cli must be one of claude, codex, gemini \(got: llama\)/);
  assert.equal(fs.readdirSync(project).length, 0);
});
