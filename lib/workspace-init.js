"use strict";

const fs = require("fs");
const path = require("path");

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

  if (incoming.hooks && incoming.hooks.PostToolUse) {
    if (!result.hooks) result.hooks = {};
    if (!result.hooks.PostToolUse) result.hooks.PostToolUse = [];
    for (const newEntry of incoming.hooks.PostToolUse) {
      const exists = result.hooks.PostToolUse.some(
        (e) => e.matcher === newEntry.matcher &&
          e.hooks && e.hooks.length > 0 &&
          e.hooks[0].command && e.hooks[0].command.includes("CLAUDE_TOOL_EXIT_CODE")
      );
      if (!exists) {
        result.hooks.PostToolUse.push(newEntry);
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

  // Resolve orchestrator session ID if not explicitly provided
  if (!orchestratorSessionId) {
    orchestratorSessionId = resolveOrchestratorId();
  }

  const created = [];
  const skipped = [];

  // 1. AGENTS.md (with role-specific rules)
  const agentsDest = path.join(targetDir, "AGENTS.md");
  if (!fs.existsSync(agentsDest)) {
    const agentsSrc = path.join(TEMPLATES_DIR, "AGENTS.md");
    let agentsContent = fs.readFileSync(agentsSrc, "utf-8");

    if (workspaceName === "orchestrator") {
      agentsContent += "\n## Role: Orchestrator / 역할: 오케스트레이터\n\n";
      agentsContent += "- You are a conductor. Do NOT write code directly. / 오케스트레이터는 직접 코드를 작성하지 않습니다.\n";
      agentsContent += "- Delegate to other sessions: `aterm inject <session> 'task'`. / 다른 세션에 작업을 위임합니다.\n";
      agentsContent += "- List sessions with `aterm list`. / `aterm list` 로 세션을 확인합니다.\n";
      agentsContent += "- If no worker sessions exist, ask the user to create them. / 워커 세션이 없으면 사용자에게 생성을 요청합니다.\n";
      agentsContent += "- Always request completion reports. / 완료 보고를 항상 요청합니다.\n";
      agentsContent += "- Track progress with `aterm tasks`. / 진행 상황은 `aterm tasks` 로 관리합니다.\n";
    } else {
      agentsContent += "\n## Role: Worker / 역할: 워커\n\n";
      agentsContent += "- Execute tasks delegated by orchestrator. / 오케스트레이터가 위임한 작업을 수행합니다.\n";
      agentsContent += "- Report completion (if orchestrator exists): `aterm inject \"$ATERM_ORCHESTRATOR_SESSION\" 'REPORT: done'`. / 오케스트레이터가 있으면 완료 후 보고합니다.\n";
      agentsContent += "- Focus on your project folder. Do not modify other projects. / 현재 프로젝트 폴더에만 집중하고 다른 프로젝트는 수정하지 않습니다.\n";
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

  for (const [filename, content] of Object.entries(buildStateFiles())) {
    const filePath = path.join(stateDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content + "\n");
      created.push(`state/${filename}`);
    } else {
      skipped.push(`state/${filename}`);
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
                command: `if [ "$CLAUDE_TOOL_EXIT_CODE" != "0" ] && [ -n "$TELEPTY_SESSION_ID" ] && [ -n "$ATERM_ORCHESTRATOR_SESSION" ]; then telepty inject --from "$TELEPTY_SESSION_ID" "$ATERM_ORCHESTRATOR_SESSION" "[BUILD ERROR] session: $TELEPTY_SESSION_ID | exit_code: $CLAUDE_TOOL_EXIT_CODE" 2>/dev/null; fi`,
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

  // Output summary
  process.stdout.write(`${t(lang, "[devkit] 워크스페이스 초기화", "[devkit] workspace-init")}: ${targetDir}\n`);
  process.stdout.write(`  cli: ${cli}\n`);
  if (created.length > 0) {
    process.stdout.write(`  ${t(lang, "생성됨", "created")}: ${created.join(", ")}\n`);
  }
  if (skipped.length > 0) {
    process.stdout.write(`  ${t(lang, "건너뜀(이미 존재)", "skipped (already exist)")}: ${skipped.join(", ")}\n`);
  }

  // 5. /init suggestion
  process.stdout.write(`\n${t(lang, "[devkit] 워크스페이스 초기화 완료. 이 코드베이스를 분석하려면 CLI에서 /init 을 실행하세요.", "[devkit] Workspace initialized. Run /init in your CLI to analyze this codebase.")}\n`);

  // 6. INJECT signal for aterm — aterm reads this and writes '/init\n' to PTY
  process.stdout.write("INJECT:/init\n");

  return { created, skipped };
}

module.exports = { workspaceInit };
