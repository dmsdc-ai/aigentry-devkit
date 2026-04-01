"use strict";

const fs = require("fs");
const path = require("path");

const VALID_CLIS = ["claude", "codex", "gemini"];

const TEMPLATES_DIR = path.join(__dirname, "..", "templates", "workspace");

const STATE_FILES = {
  "task-queue.json": JSON.stringify({
    _schema: "aigentry task queue v1",
    _usage: "AI assistant manages tasks here.",
    tasks: [],
    completed: [],
  }, null, 2),
  "lessons.json": JSON.stringify({
    _schema: "aigentry lessons v1",
    _usage: "AI assistant saves learnings here.",
    _meta: { updated: "" },
  }, null, 2),
};

/**
 * Initialize a workspace for an AI CLI session.
 *
 * @param {object} opts
 * @param {string} opts.cli - Target CLI: claude | codex | gemini
 * @param {string} opts.cwd - Workspace directory path
 * @returns {{ created: string[], skipped: string[] }}
 */
function workspaceInit({ cli, cwd }) {
  if (!cli || !VALID_CLIS.includes(cli)) {
    process.stderr.write(`Error: --cli must be one of: ${VALID_CLIS.join(", ")}\n`);
    process.exit(1);
  }
  if (!cwd) {
    process.stderr.write("Error: --cwd is required\n");
    process.exit(1);
  }

  const targetDir = path.resolve(cwd);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const workspaceName = path.basename(targetDir);
  const created = [];
  const skipped = [];

  // 1. AGENTS.md
  const agentsDest = path.join(targetDir, "AGENTS.md");
  if (!fs.existsSync(agentsDest)) {
    const agentsSrc = path.join(TEMPLATES_DIR, "AGENTS.md");
    fs.copyFileSync(agentsSrc, agentsDest);
    created.push("AGENTS.md");
  } else {
    skipped.push("AGENTS.md");
  }

  // 2. CLI-specific MD file
  const cliMdMap = {
    claude: "CLAUDE.md",
    codex: "AGENTS.md",  // Codex uses AGENTS.md only
    gemini: "GEMINI.md",
  };

  if (cli !== "codex") {
    const mdFilename = cliMdMap[cli];
    const mdDest = path.join(targetDir, mdFilename);
    if (!fs.existsSync(mdDest)) {
      const mdSrc = path.join(TEMPLATES_DIR, mdFilename);
      const template = fs.readFileSync(mdSrc, "utf-8");
      const content = template.replace(/\{\{WORKSPACE_NAME\}\}/g, workspaceName);
      fs.writeFileSync(mdDest, content);
      created.push(mdFilename);
    } else {
      skipped.push(mdFilename);
    }
  }

  // 3. state/ directory with task-queue.json and lessons.json
  const stateDir = path.join(targetDir, "state");
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
    created.push("state/");
  }

  for (const [filename, content] of Object.entries(STATE_FILES)) {
    const filePath = path.join(stateDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content + "\n");
      created.push(`state/${filename}`);
    } else {
      skipped.push(`state/${filename}`);
    }
  }

  // Output summary
  process.stdout.write(`[devkit] workspace-init: ${targetDir}\n`);
  process.stdout.write(`  cli: ${cli}\n`);
  if (created.length > 0) {
    process.stdout.write(`  created: ${created.join(", ")}\n`);
  }
  if (skipped.length > 0) {
    process.stdout.write(`  skipped (already exist): ${skipped.join(", ")}\n`);
  }

  // 4. /init suggestion
  process.stdout.write("\n[devkit] Workspace initialized. Run /init in your CLI to analyze this codebase.\n");

  return { created, skipped };
}

module.exports = { workspaceInit };
