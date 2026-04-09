"use strict";

const fs = require("fs");
const path = require("path");

const { registerClaudeMcp, registerGeminiMcp, registerCodexMcp } = require("./bootstrap");

const VALID_CLIS = ["claude", "codex", "gemini"];

function deepMergeSettings(existing, incoming) {
  const result = JSON.parse(JSON.stringify(existing));

  if (incoming.permissions && incoming.permissions.allow) {
    if (!result.permissions) result.permissions = {};
    if (!result.permissions.allow) result.permissions.allow = [];
    for (const perm of incoming.permissions.allow) {
      if (!result.permissions.allow.includes(perm)) {
        result.permissions.allow.push(perm);
      }
    }
  }

  if (incoming.hooks) {
    if (!result.hooks) result.hooks = {};
    for (const hookType of ["PostToolUse", "Stop"]) {
      if (!incoming.hooks[hookType]) continue;
      if (!result.hooks[hookType]) result.hooks[hookType] = [];
      for (const newEntry of incoming.hooks[hookType]) {
        const cmdStr = (newEntry.hooks && newEntry.hooks[0] && newEntry.hooks[0].command) || "";
        const exists = result.hooks[hookType].some(
          (e) => e.hooks && e.hooks[0] && e.hooks[0].command && e.hooks[0].command === cmdStr
        );
        if (!exists) {
          result.hooks[hookType].push(newEntry);
        }
      }
    }
  }

  return result;
}

const TEMPLATES_DIR = path.join(__dirname, "..", "templates", "workspace");

function detectLanguage() {
  const raw = (
    process.env.ATERM_UI_LANG ||
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    Intl.DateTimeFormat().resolvedOptions().locale ||
    ""
  ).toLowerCase();
  return raw.startsWith("ko") ? "ko" : "en";
}

function t(lang, ko, en) {
  return lang === "ko" ? ko : en;
}

function resolveOrchestratorId() {
  // 1. Environment variable
  if (process.env.ATERM_ORCHESTRATOR_SESSION) {
    return process.env.ATERM_ORCHESTRATOR_SESSION;
  }

  // 2. aterm.json config: orchestrator.session_id
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const configPaths = [
    path.join(home, ".config", "aterm", "aterm.json"),
    path.join(home, ".aterm", "aterm.json"),
  ];
  for (const cp of configPaths) {
    try {
      if (fs.existsSync(cp)) {
        const cfg = JSON.parse(fs.readFileSync(cp, "utf-8"));
        if (cfg.orchestrator && cfg.orchestrator.session_id) {
          return cfg.orchestrator.session_id;
        }
      }
    } catch (_) { /* ignore config read errors */ }
  }

  // 3. Auto-detect: first session with "orchestrator" in name
  try {
    const { spawnSync } = require("child_process");
    const r = spawnSync("aterm", ["list", "--json"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.status === 0 && r.stdout) {
      const sessions = JSON.parse(r.stdout);
      const orch = (Array.isArray(sessions) ? sessions : []).find(
        (s) => (s.name || s.id || "").toLowerCase().includes("orchestrator")
      );
      if (orch) return orch.name || orch.id;
    }
  } catch (_) { /* aterm not available */ }

  return null;
}

function detectProjectType(dir) {
  // Rust
  if (fs.existsSync(path.join(dir, "Cargo.toml"))) {
    return { type: "rust", buildCmd: "make app", testCmd: "cargo test" };
  }
  // Node
  if (fs.existsSync(path.join(dir, "package.json"))) {
    return { type: "node", buildCmd: "npm run build", testCmd: "npm test" };
  }
  // Python
  if (fs.existsSync(path.join(dir, "pyproject.toml")) ||
      fs.existsSync(path.join(dir, "setup.py")) ||
      fs.existsSync(path.join(dir, "requirements.txt"))) {
    return { type: "python", buildCmd: "echo 'no build step'", testCmd: "python -m pytest" };
  }
  // Custom from aterm.json
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const configPaths = [
    path.join(home, ".config", "aterm", "aterm.json"),
    path.join(home, ".aterm", "aterm.json"),
  ];
  for (const cp of configPaths) {
    try {
      if (fs.existsSync(cp)) {
        const cfg = JSON.parse(fs.readFileSync(cp, "utf-8"));
        if (cfg.sawp) {
          return {
            type: "custom",
            buildCmd: cfg.sawp.buildCmd || "echo 'no build configured'",
            testCmd: cfg.sawp.testCmd || "echo 'no test configured'",
          };
        }
      }
    } catch (_) { /* ignore config read errors */ }
  }
  return { type: "unknown", buildCmd: "echo 'no build configured'", testCmd: "echo 'no test configured'" };
}

function buildStateFiles() {
  return {
    "task-queue.json": JSON.stringify({
      _schema: "aigentry task queue v1",
      _usage: "AI assistant manages tasks here. / AI 어시스턴트가 여기서 태스크를 관리합니다.",
      tasks: [],
      completed: [],
    }, null, 2),
    "lessons.json": JSON.stringify({
      _schema: "aigentry lessons v1",
      _usage: "AI assistant saves learnings here. / AI 어시스턴트가 교훈을 여기에 저장합니다.",
      _meta: { updated: "" },
    }, null, 2),
  };
}

function buildReportingRules(cli, orchestratorId) {
  if (cli === "codex") {
    // Codex: concise, 3 lines max
    return "\n# Reporting\n\n" +
      `Report when done: \`aterm inject orchestrator "REPORT: {files} | {summary} | {result}"\`\n` +
      `If stuck 3x: \`aterm inject orchestrator "STUCK: {error}"\`\n` +
      "Never idle without reporting.\n";
  }

  // Claude / Gemini: full reporting rules
  let rules = "\n## Mandatory Reporting / 필수 보고\n\n";
  rules += "Report to orchestrator on EVERY task completion. No exceptions.\n\n";
  rules += "```\n";
  rules += "# Internal (aterm)\n";
  rules += `aterm inject orchestrator "REPORT: {modified files} | {change summary} | {build result} | {remaining issues}"\n`;
  rules += "# External (telepty)\n";
  rules += `telepty inject --from $TELEPTY_SESSION_ID orchestrator "REPORT: ..."\n`;
  rules += "```\n\n";
  rules += "- NEVER idle or exit without reporting. / 보고 없이 대기/종료 금지.\n";
  rules += "- Include LESSONS in every report. / 모든 보고에 교훈 포함.\n";
  rules += "- 3 consecutive failures → report STUCK with full error. / 3회 연속 실패 → STUCK 보고.\n";
  rules += "- Evidence only — no \"should work\" or \"probably fixed\". / 증거만 — \"아마 됐을 것\" 금지.\n";

  return rules;
}

/**
 * Initialize a workspace for an AI CLI session.
 *
 * @param {object} opts
 * @param {string} opts.cli - Target CLI: claude | codex | gemini
 * @param {string} opts.cwd - Workspace directory path
 * @param {string} [opts.orchestratorSessionId] - Session ID for error reporting
 * @param {boolean} [opts.autoReportErrors] - Whether to add PostToolUse error hooks
 * @returns {{ created: string[], skipped: string[] }}
 */
function workspaceInit({ cli, cwd, orchestratorSessionId, autoReportErrors = true }) {
  const lang = detectLanguage();

  if (!cli || !VALID_CLIS.includes(cli)) {
    process.stderr.write(`${t(lang, "오류", "Error")}: ${t(lang, `--cli 는 다음 중 하나여야 합니다: ${VALID_CLIS.join(", ")}`, `--cli must be one of: ${VALID_CLIS.join(", ")}`)}\n`);
    process.exit(1);
  }
  if (!cwd) {
    process.stderr.write(`${t(lang, "오류", "Error")}: ${t(lang, "--cwd 가 필요합니다", "--cwd is required")}\n`);
    process.exit(1);
  }

  const targetDir = path.resolve(cwd);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const workspaceName = path.basename(targetDir);
  const isOrchestrator = workspaceName === "orchestrator";

  // Resolve orchestrator session ID if not explicitly provided
  if (!orchestratorSessionId) {
    orchestratorSessionId = resolveOrchestratorId();
  }

  const created = [];
  const skipped = [];

  // 1. AGENTS.md (with role-specific + CLI-specific rules)
  const agentsDest = path.join(targetDir, "AGENTS.md");
  if (!fs.existsSync(agentsDest)) {
    // Codex: use brief template. Claude/Gemini: use full template.
    const agentsSrc = cli === "codex"
      ? path.join(TEMPLATES_DIR, "AGENTS.codex.md")
      : path.join(TEMPLATES_DIR, "AGENTS.md");
    let agentsContent = fs.readFileSync(agentsSrc, "utf-8");

    // Replace SAWP build/test commands (full template only)
    if (cli !== "codex") {
      const projectType = detectProjectType(targetDir);
      agentsContent = agentsContent
        .replace(/\{\{BUILD_CMD\}\}/g, projectType.buildCmd)
        .replace(/\{\{TEST_CMD\}\}/g, projectType.testCmd);
    }

    if (isOrchestrator) {
      const orchTemplatePath = path.join(TEMPLATES_DIR, "AGENTS.orchestrator.md");
      agentsContent += "\n" + fs.readFileSync(orchTemplatePath, "utf-8");
    } else {
      // Worker role block
      if (cli !== "codex") {
        agentsContent += "\n## Role: Worker / 역할: 워커\n\n";
        agentsContent += "- Execute tasks delegated by orchestrator. / 오케스트레이터가 위임한 작업을 수행합니다.\n";
        agentsContent += "- Focus on your project folder. Do not modify other projects. / 현재 프로젝트 폴더에만 집중하고 다른 프로젝트는 수정하지 않습니다.\n";
      }

      // CLI-specific reporting (only when orchestrator detected)
      if (orchestratorSessionId) {
        agentsContent += buildReportingRules(cli, orchestratorSessionId);
      }
    }

    fs.writeFileSync(agentsDest, agentsContent);
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

  if (isOrchestrator) {
    // Orchestrator: symlink state files to global ~/.aigentry/data/
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const dataDir = path.join(home, ".aigentry", "data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const stateFiles = buildStateFiles();
    for (const [filename, content] of Object.entries(stateFiles)) {
      const globalPath = path.join(dataDir, filename);
      if (!fs.existsSync(globalPath)) {
        fs.writeFileSync(globalPath, content + "\n");
      }
    }
    for (const filename of Object.keys(stateFiles)) {
      const linkPath = path.join(stateDir, filename);
      const globalPath = path.join(dataDir, filename);
      if (!fs.existsSync(linkPath)) {
        fs.symlinkSync(globalPath, linkPath);
        created.push(`state/${filename} -> ~/.aigentry/data/${filename}`);
      } else {
        skipped.push(`state/${filename}`);
      }
    }
  } else {
    for (const [filename, content] of Object.entries(buildStateFiles())) {
      const filePath = path.join(stateDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content + "\n");
        created.push(`state/${filename}`);
      } else {
        skipped.push(`state/${filename}`);
      }
    }
  }

  // 4. CLI environment setup
  if (cli === "claude") {
    const claudeDir = path.join(targetDir, ".claude");
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    const settingsPath = path.join(claudeDir, "settings.local.json");

    const newSettings = {
      permissions: {
        allow: ["Bash(aterm *)", "Bash(telepty *)"],
      },
    };

    if (autoReportErrors && orchestratorSessionId) {
      newSettings.hooks = {
        PostToolUse: [
          {
            matcher: "Bash",
            hooks: [
              {
                type: "command",
                command: `_ORCH="\${ATERM_ORCHESTRATOR_SESSION:-${orchestratorSessionId}}"; if [ -n "$CLAUDE_TOOL_EXIT_CODE" ] && [ "$CLAUDE_TOOL_EXIT_CODE" != "0" ] && [ -n "$TELEPTY_SESSION_ID" ] && [ -n "$_ORCH" ]; then _LF="/tmp/.aigentry-berr-\${TELEPTY_SESSION_ID}"; _NOW=$(date +%s); _LAST=$(cat "$_LF" 2>/dev/null || echo 0); if [ $((_NOW - _LAST)) -lt 10 ]; then exit 0; fi; echo "$_NOW" > "$_LF"; telepty inject --from "$TELEPTY_SESSION_ID" "$_ORCH" "[BUILD ERROR] session: $TELEPTY_SESSION_ID | exit_code: $CLAUDE_TOOL_EXIT_CODE" 2>/dev/null; fi`,
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: `_ORCH="\${ATERM_ORCHESTRATOR_SESSION:-${orchestratorSessionId}}"; if [ -n "$TELEPTY_SESSION_ID" ] && [ -n "$_ORCH" ]; then telepty inject --from "$TELEPTY_SESSION_ID" "$_ORCH" "[SESSION_IDLE] session: $TELEPTY_SESSION_ID stopped responding" 2>/dev/null; fi`,
              },
            ],
          },
        ],
      };
    }

    if (!fs.existsSync(settingsPath)) {
      fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2) + "\n");
      created.push(".claude/settings.local.json");
    } else {
      const existing = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      const merged = deepMergeSettings(existing, newSettings);
      fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
      created.push(".claude/settings.local.json (updated)");
    }
  }

  // 5. MCP registration (brain MCP server)
  const mcpRegisters = { claude: registerClaudeMcp, gemini: registerGeminiMcp, codex: registerCodexMcp };
  const registerFn = mcpRegisters[cli];
  if (registerFn) {
    try {
      if (registerFn()) {
        created.push(`mcp:aigentry-brain (${cli})`);
      } else {
        skipped.push(`mcp:aigentry-brain (${cli})`);
      }
    } catch (_) { /* ignore MCP registration errors */ }
  }

  // Output summary
  process.stdout.write(`${t(lang, "[devkit] 워크스페이스 초기화", "[devkit] workspace-init")}: ${targetDir}\n`);
  process.stdout.write(`  cli: ${cli}\n`);
  if (created.length > 0) {
    process.stdout.write(`  ${t(lang, "생성됨", "created")}: ${created.join(", ")}\n`);
  }
  if (skipped.length > 0) {
    process.stdout.write(`  ${t(lang, "건너뜀(이미 존재)", "skipped (already exist)")}: ${skipped.join(", ")}\n`);
  }

  process.stdout.write(`\n${t(lang, "[devkit] 워크스페이스 초기화 완료.", "[devkit] Workspace initialized.")}\n`);

  return { created, skipped };
}

module.exports = { workspaceInit };
