"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BIN = path.join(ROOT, "bin", "aigentry-devkit.js");

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aigentry-${prefix}-`));
}

function makeProject(prefix, name = "workspace") {
  const root = tempRoot(prefix);
  const project = path.join(root, name);
  fs.mkdirSync(project, { recursive: true });
  return { root, project };
}

function makeHome(prefix) {
  const home = tempRoot(`${prefix}-home`);
  return home;
}

function runDevkit(command, args, options = {}) {
  const home = options.home || makeHome("scaffold");
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    ATERM_ORCHESTRATOR_SESSION: "",
    // δ2 (#440) — scaffold tests verify no HOME writes; telemetry emit
    // would create ~/.aigentry/telemetry/. Disable for the subprocess.
    AIGENTRY_LOGGER_DISABLED: "1",
    ...options.env,
  };
  return spawnSync(process.execPath, [BIN, command, ...args], {
    cwd: ROOT,
    env,
    input: options.input === undefined ? "" : options.input,
    encoding: "utf8",
    timeout: options.timeout || 10000,
  });
}

function runScaffold(args, options = {}) {
  return runDevkit("scaffold", args, options);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function stdoutLines(result) {
  return result.stdout.trim() ? result.stdout.trim().split("\n") : [];
}

function assertMachineLines(result) {
  const lines = stdoutLines(result);
  for (const line of lines) {
    assert.match(line, /^(create|merge|skip|backup|remove|noop) \/[^ ]+(?: \([^)]+\))?$/);
  }
  return lines;
}

function expectedLegacyAgents(projectDir) {
  const template = fs.readFileSync(path.join(ROOT, "templates", "workspace", "AGENTS.md"), "utf8");
  return template
    .replace(/\{\{BUILD_CMD\}\}/g, "echo 'no build configured'")
    .replace(/\{\{TEST_CMD\}\}/g, "echo 'no test configured'") +
    "\n## Role: Worker / 역할: 워커\n\n" +
    "- Execute tasks delegated by orchestrator. / 오케스트레이터가 위임한 작업을 수행합니다.\n" +
    "- Focus on your project folder. Do not modify other projects. / 현재 프로젝트 폴더에만 집중하고 다른 프로젝트는 수정하지 않습니다.\n";
}

function expectedStateFile(name) {
  if (name === "task-queue.json") {
    return JSON.stringify({
      _schema: "aigentry task queue v1",
      _usage: "AI assistant manages tasks here. / AI 어시스턴트가 여기서 태스크를 관리합니다.",
      tasks: [],
      completed: [],
    }, null, 2) + "\n";
  }
  if (name === "lessons.json") {
    return JSON.stringify({
      _schema: "aigentry lessons v1",
      _usage: "AI assistant saves learnings here. / AI 어시스턴트가 교훈을 여기에 저장합니다.",
      _meta: { updated: "" },
    }, null, 2) + "\n";
  }
  throw new Error(`unknown state file: ${name}`);
}

module.exports = {
  ROOT,
  assertMachineLines,
  expectedLegacyAgents,
  expectedStateFile,
  makeHome,
  makeProject,
  readJson,
  runDevkit,
  runScaffold,
  stdoutLines,
  tempRoot,
};
