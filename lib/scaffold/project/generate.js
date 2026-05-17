"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const VALID_CLIS = ["claude", "codex", "gemini"];
const TEMPLATES_DIR = path.join(__dirname, "..", "..", "..", "templates", "workspace");

function makeError(message, exitCode = 4) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

function readJsonIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
  } catch (_) {
    return null;
  }
  return null;
}

function detectProjectType(dir) {
  if (fs.existsSync(path.join(dir, "Cargo.toml"))) {
    return { type: "rust", buildCmd: "make app", testCmd: "cargo test" };
  }
  if (fs.existsSync(path.join(dir, "package.json"))) {
    return { type: "node", buildCmd: "npm run build", testCmd: "npm test" };
  }
  if (
    fs.existsSync(path.join(dir, "pyproject.toml")) ||
    fs.existsSync(path.join(dir, "setup.py")) ||
    fs.existsSync(path.join(dir, "requirements.txt"))
  ) {
    return { type: "python", buildCmd: "echo 'no build step'", testCmd: "python -m pytest" };
  }

  const home = process.env.HOME || process.env.USERPROFILE || "";
  for (const configPath of [
    path.join(home, ".config", "aterm", "aterm.json"),
    path.join(home, ".aterm", "aterm.json"),
  ]) {
    const cfg = readJsonIfExists(configPath);
    if (cfg && cfg.sawp) {
      return {
        type: "custom",
        buildCmd: cfg.sawp.buildCmd || "echo 'no build configured'",
        testCmd: cfg.sawp.testCmd || "echo 'no test configured'",
      };
    }
  }

  return { type: "unknown", buildCmd: "echo 'no build configured'", testCmd: "echo 'no test configured'" };
}

function resolveOrchestratorId(explicitId) {
  if (explicitId) return explicitId;
  if (process.env.ATERM_ORCHESTRATOR_SESSION) return process.env.ATERM_ORCHESTRATOR_SESSION;

  const home = process.env.HOME || process.env.USERPROFILE || "";
  for (const configPath of [
    path.join(home, ".config", "aterm", "aterm.json"),
    path.join(home, ".aterm", "aterm.json"),
  ]) {
    const cfg = readJsonIfExists(configPath);
    if (cfg && cfg.orchestrator && cfg.orchestrator.session_id) {
      return cfg.orchestrator.session_id;
    }
  }

  try {
    const result = spawnSync("aterm", ["list", "--json"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && result.stdout) {
      const sessions = JSON.parse(result.stdout);
      const orch = (Array.isArray(sessions) ? sessions : []).find((session) => {
        return String(session.name || session.id || "").toLowerCase().includes("orchestrator");
      });
      if (orch) return orch.name || orch.id;
    }
  } catch (_) {
    // aterm is optional for project scaffolding.
  }

  return null;
}

function buildStateFiles() {
  return {
    "task-queue.json": JSON.stringify({
      _schema: "aigentry task queue v1",
      _usage: "AI assistant manages tasks here. / AI 어시스턴트가 여기서 태스크를 관리합니다.",
      tasks: [],
      completed: [],
    }, null, 2) + "\n",
    "lessons.json": JSON.stringify({
      _schema: "aigentry lessons v1",
      _usage: "AI assistant saves learnings here. / AI 어시스턴트가 교훈을 여기에 저장합니다.",
      _meta: { updated: "" },
    }, null, 2) + "\n",
  };
}

function buildReportingRules(cli) {
  if (cli === "codex") {
    return "\n# Reporting\n\n" +
      "Report when done: `aterm inject orchestrator \"REPORT: {files} | {summary} | {result}\"`\n" +
      "If stuck 3x: `aterm inject orchestrator \"STUCK: {error}\"`\n" +
      "Never idle without reporting.\n";
  }

  let rules = "\n## Mandatory Reporting / 필수 보고\n\n";
  rules += "Report to orchestrator on EVERY task completion. No exceptions.\n\n";
  rules += "```\n";
  rules += "# Internal (aterm)\n";
  rules += "aterm inject orchestrator \"REPORT: {modified files} | {change summary} | {build result} | {remaining issues}\"\n";
  rules += "# External (telepty)\n";
  rules += "telepty inject --from $TELEPTY_SESSION_ID orchestrator \"REPORT: ...\"\n";
  rules += "```\n\n";
  rules += "- NEVER idle or exit without reporting. / 보고 없이 대기/종료 금지.\n";
  rules += "- Include LESSONS in every report. / 모든 보고에 교훈 포함.\n";
  rules += "- 3 consecutive failures -> report STUCK with full error. / 3회 연속 실패 -> STUCK 보고.\n";
  rules += "- Evidence only - no \"should work\" or \"probably fixed\". / 증거만 - \"아마 됐을 것\" 금지.\n";
  return rules;
}

function readTemplate(templateDir, filename) {
  const filePath = path.join(templateDir, filename);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_) {
    throw makeError(`error: bundled templates missing - devkit install corrupt; reinstall @dmsdc-ai/aigentry-devkit`);
  }
}

function renderAgents({ cli, targetDir, templateDir, workspaceName, orchestratorSessionId }) {
  const sourceName = cli === "codex" ? "AGENTS.codex.md" : "AGENTS.md";
  let content = readTemplate(templateDir, sourceName);

  if (cli !== "codex") {
    const projectType = detectProjectType(targetDir);
    content = content
      .replace(/\{\{BUILD_CMD\}\}/g, projectType.buildCmd)
      .replace(/\{\{TEST_CMD\}\}/g, projectType.testCmd);
  }

  if (workspaceName === "orchestrator") {
    content += "\n" + readTemplate(templateDir, "AGENTS.orchestrator.md");
  } else {
    if (cli !== "codex") {
      content += "\n## Role: Worker / 역할: 워커\n\n";
      content += "- Execute tasks delegated by orchestrator. / 오케스트레이터가 위임한 작업을 수행합니다.\n";
      content += "- Focus on your project folder. Do not modify other projects. / 현재 프로젝트 폴더에만 집중하고 다른 프로젝트는 수정하지 않습니다.\n";
    }
    if (orchestratorSessionId) {
      content += buildReportingRules(cli);
    }
  }

  return content;
}

function createOrSkipFile(filePath, content, mode) {
  if (fs.existsSync(filePath)) {
    return { verb: "skip", path: filePath, reason: "exists" };
  }
  const action = { verb: "create", path: filePath, content };
  if (mode != null) action.mode = mode;
  return action;
}

function buildStateActions(targetDir) {
  const actions = [];
  const stateDir = path.join(targetDir, "state");
  const workspaceName = path.basename(targetDir);
  const stateFiles = buildStateFiles();

  if (workspaceName === "orchestrator") {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const dataDir = path.join(home, ".aigentry", "data");
    for (const [filename, content] of Object.entries(stateFiles)) {
      const globalPath = path.join(dataDir, filename);
      if (!fs.existsSync(globalPath)) {
        actions.push({ verb: "create", path: globalPath, content });
      }
    }
    for (const filename of Object.keys(stateFiles)) {
      const linkPath = path.join(stateDir, filename);
      const globalPath = path.join(dataDir, filename);
      if (fs.existsSync(linkPath)) {
        actions.push({ verb: "skip", path: linkPath, reason: "exists" });
      } else {
        actions.push({ verb: "create", path: linkPath, symlink: globalPath });
      }
    }
    return actions;
  }

  for (const [filename, content] of Object.entries(stateFiles)) {
    actions.push(createOrSkipFile(path.join(stateDir, filename), content));
  }
  return actions;
}

function buildGenerationActions({ targetDir, cli, templateDir, orchestratorSessionId }) {
  const workspaceName = path.basename(targetDir);
  const actions = [];

  actions.push(createOrSkipFile(
    path.join(targetDir, "AGENTS.md"),
    renderAgents({ cli, targetDir, templateDir, workspaceName, orchestratorSessionId })
  ));

  if (cli === "claude" || cli === "gemini") {
    const filename = cli === "claude" ? "CLAUDE.md" : "GEMINI.md";
    const content = readTemplate(templateDir, filename)
      .replace(/\{\{WORKSPACE_NAME\}\}/g, workspaceName);
    actions.push(createOrSkipFile(path.join(targetDir, filename), content));
  }

  actions.push(createOrSkipFile(
    path.join(targetDir, "bin", "snyk-scan.sh"),
    readTemplate(templateDir, path.join("bin", "snyk-scan.sh")),
    0o755,
  ));

  actions.push(...buildStateActions(targetDir));
  return actions;
}

module.exports = {
  TEMPLATES_DIR,
  VALID_CLIS,
  buildGenerationActions,
  buildReportingRules,
  buildStateFiles,
  detectProjectType,
  resolveOrchestratorId,
};
