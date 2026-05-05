"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const { makeProject, runScaffold } = require("./helper");

test("scaffold runs non-interactively with closed stdin", () => {
  const { project } = makeProject("non-interactive");
  const result = runScaffold(["--project", project, "--cli", "gemini"], {
    input: "",
    timeout: 2000,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(project, "AGENTS.md")), true);
  assert.equal(fs.existsSync(path.join(project, "GEMINI.md")), true);
});
