#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
// δ2 (#440) — telemetry emit wrapper. Fire-and-forget; failures swallowed
// internally so bootstrap is never blocked by a logger transport hiccup.
const { emitInstallEvent } = require("./logger-emit.js");

const HOME = process.env.HOME || process.env.USERPROFILE || "";
const AIGENTRY_HOME = path.join(HOME, ".aigentry");

// ── Directory Structure ──

const DIRS = [
  "",                     // ~/.aigentry/
  "config",               // aterm.json, sessions.json (managed by aterm)
  "data",                 // task-queue.json, lessons.json
  "brain",                // brain data
  "telepty/shared",       // telepty shared data
  "cache/search",         // search cache
  "logs",                 // logs
];

// ── Sample Data Files ──

const DATA_FILES = {
  "data/task-queue.json": JSON.stringify({
    _schema: "aigentry task queue v1",
    _usage: "AI assistant manages tasks here. Use brain MCP tools or edit directly.",
    tasks: [],
    completed: [],
  }, null, 2),

  "data/lessons.json": JSON.stringify({
    _schema: "aigentry lessons v1",
    _usage: "AI assistant saves learnings here. invariants=rules to keep, failed=approaches that didnt work.",
    _meta: { updated: "" },
  }, null, 2),
};

// ── MCP Registration ──

function registerClaudeMcp() {
  const mcpPath = path.join(HOME, ".claude", ".mcp.json");
  const brainEntry = {
    command: "npx",
    args: ["-y", "@dmsdc-ai/aigentry-brain@latest", "mcp"],
  };

  let config = {};
  if (fs.existsSync(mcpPath)) {
    try {
      config = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    } catch (_) {
      config = {};
    }
  }

  if (!config.mcpServers) config.mcpServers = {};
  if (config.mcpServers["aigentry-brain"]) return false; // already registered

  config.mcpServers["aigentry-brain"] = brainEntry;

  const dir = path.dirname(mcpPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n");
  return true;
}

function registerGeminiMcp() {
  const settingsPath = path.join(HOME, ".gemini", "settings.json");
  const brainEntry = {
    command: "npx",
    args: ["-y", "@dmsdc-ai/aigentry-brain@latest", "mcp"],
  };

  let config = {};
  if (fs.existsSync(settingsPath)) {
    try {
      config = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch (_) {
      config = {};
    }
  }

  if (!config.mcpServers) config.mcpServers = {};
  if (config.mcpServers["aigentry-brain"]) return false;

  config.mcpServers["aigentry-brain"] = brainEntry;

  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(config, null, 2) + "\n");
  return true;
}

function registerCodexMcp() {
  const configPath = path.join(HOME, ".codex", "config.toml");

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      if (content.includes("aigentry-brain")) return false;
    } catch (_) {}
  }

  // Codex config.toml MCP format
  const entry = `
# aigentry-brain MCP server
[mcp_servers.aigentry-brain]
command = "npx"
args = ["-y", "@dmsdc-ai/aigentry-brain@latest", "mcp"]
`;

  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(configPath)) {
    fs.appendFileSync(configPath, entry);
  } else {
    fs.writeFileSync(configPath, entry.trimStart());
  }
  return true;
}

// ── Orchestrator profile writers (#518) ──
//
// generate-not-copy + deep-merge add-only. Both honor $AIGENTRY_HOME / $HOME so
// they are hermetically testable (temp prefix) and never clobber a user's live
// config. Machine-specific values (deviceId, role paths) are DERIVED from the
// install host, never copied from a reference machine.

// Canonical 9-role enum — keep in sync with the orchestrator's
// install-instructions.sh ROLES SSOT.
const ORCHESTRATOR_ROLES = [
  "orchestrator", "architect", "coder", "tester", "builder",
  "analyst", "researcher", "reviewer", "logger",
];

function deriveDeviceId() {
  const host = String(os.hostname() || "host").replace(/[^A-Za-z0-9.-]/g, "-").replace(/-+$/, "");
  return `device-${host || "host"}`;
}

// writeOrchestratorConfig({ projectsRoot, deviceId, roles }) → deep-merges the
// orchestrator role→path map into ~/.aigentry/config.json (add-only). Preserves
// an existing non-null deviceId and any existing roles (incl. roles outside the
// 9-role set); only fills in missing canonical roles. Idempotent.
function writeOrchestratorConfig(options = {}) {
  const aigentryHome = process.env.AIGENTRY_HOME || path.join(HOME, ".aigentry");
  const cfgPath = path.join(aigentryHome, "config.json");
  const projectsRoot = options.projectsRoot || path.join(HOME, "projects");
  const roleNames = Array.isArray(options.roles) && options.roles.length
    ? options.roles
    : ORCHESTRATOR_ROLES;

  let cfg = {};
  if (fs.existsSync(cfgPath)) {
    try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")); } catch (_) { cfg = {}; }
  }
  if (typeof cfg !== "object" || cfg === null) cfg = {};

  if (cfg.version == null) cfg.version = 1;
  // deviceId: derive only when absent — NEVER overwrite an existing one and
  // NEVER copy a reference machine's id.
  if (!cfg.deviceId) cfg.deviceId = options.deviceId || deriveDeviceId();
  if (typeof cfg.roles !== "object" || cfg.roles === null) cfg.roles = {};

  let rolesAdded = 0;
  for (const role of roleNames) {
    if (cfg.roles[role]) continue; // add-only: preserve existing role mappings
    cfg.roles[role] = {
      path: path.join(projectsRoot, `aigentry-${role}`),
      cli: "claude",
      cli_flags: "--permission-mode bypassPermissions",
    };
    rolesAdded++;
  }

  if (!fs.existsSync(aigentryHome)) fs.mkdirSync(aigentryHome, { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  return { path: cfgPath, deviceId: cfg.deviceId, rolesAdded };
}

// mergeClaudeHooks({ orchDir }) → deep-merges the orchestrator's PreToolUse /
// PostToolUse hooks into ~/.claude/settings.json. The PostToolUse command is
// rewritten from the orchestrator's project-relative $CLAUDE_PROJECT_DIR form to
// the absolute installed path so it resolves from any cwd. Dedupes by
// matcher + normalized command → re-runs are no-ops. Preserves all other keys.
function mergeClaudeHooks(options = {}) {
  const orchDir = options.orchDir || "";
  const settingsPath = path.join(HOME, ".claude", "settings.json");

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8")); } catch (_) { settings = {}; }
  }
  if (typeof settings !== "object" || settings === null) settings = {};
  if (typeof settings.hooks !== "object" || settings.hooks === null) settings.hooks = {};

  // Portability fix (§7.2): rewrite $CLAUDE_PROJECT_DIR → absolute clone path.
  const postCmd = `bash "${path.join(orchDir, ".claude", "hooks", "post-dispatch-verify-reminder.sh")}"`;

  const preToolUse = [
    {
      matcher: "Agent",
      hooks: [{
        type: "command",
        command: "echo 'CHECKLIST: (1) 직접수행금지-위임했는가? (2) 파일별세션분리? (3) 보고MANDATORY? (4) lessons포함? (5) 범용/크로스블로킹없음? (6) 증거기반? (7) 영어inject?'",
      }],
    },
    {
      matcher: "Bash",
      hooks: [{
        type: "command",
        command: "echo 'ORCHESTRATOR: telepty inject 시 (1) --ref + --submit + --from (2) MANDATORY 보고 (3) [SAWP] envelope 포함 확인. SAWP 빠뜨리면 rule 17 위반'",
      }],
    },
  ];
  const postToolUse = [
    { matcher: "Bash", hooks: [{ type: "command", command: postCmd }] },
  ];

  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  let hooksAdded = 0;

  const mergeEvent = (eventName, entries) => {
    if (!Array.isArray(settings.hooks[eventName])) settings.hooks[eventName] = [];
    const existing = settings.hooks[eventName];
    for (const entry of entries) {
      const entryCmds = (entry.hooks || []).map((h) => norm(h.command));
      const isDup = existing.some((e) =>
        e && e.matcher === entry.matcher &&
        Array.isArray(e.hooks) &&
        e.hooks.some((h) => entryCmds.includes(norm(h.command)))
      );
      if (!isDup) { existing.push(entry); hooksAdded++; }
    }
  };

  mergeEvent("PreToolUse", preToolUse);
  mergeEvent("PostToolUse", postToolUse);

  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return { path: settingsPath, hooksAdded };
}

// ── Main Bootstrap ──

function bootstrap(options = {}) {
  const { silent = false } = options;
  const log = silent ? () => {} : (msg) => process.stdout.write(msg + "\n");
  const results = { dirs: 0, files: 0, mcp: [], skipped: [] };

  log("aigentry bootstrap -- provisioning ~/.aigentry/");
  log("");
  emitInstallEvent("install_phase", { phase: "start", aigentry_home: AIGENTRY_HOME });

  // 1. Create directory structure
  for (const dir of DIRS) {
    const fullPath = path.join(AIGENTRY_HOME, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      log(`  Created: ~/.aigentry/${dir || ""}`);
      results.dirs++;
    } else {
      results.skipped.push(`dir:${dir || "root"}`);
    }
  }

  // 2. Copy CONSTITUTION.md
  const constitutionDest = path.join(AIGENTRY_HOME, "CONSTITUTION.md");
  if (!fs.existsSync(constitutionDest)) {
    const constitutionSrc = path.join(__dirname, "..", "templates", "CONSTITUTION.md");
    if (fs.existsSync(constitutionSrc)) {
      fs.copyFileSync(constitutionSrc, constitutionDest);
      log("  Installed: CONSTITUTION.md");
      results.files++;
    } else {
      log("  CONSTITUTION.md template not found (skipped)");
    }
  } else {
    results.skipped.push("CONSTITUTION.md");
  }

  // 3. Create sample data files
  for (const [relPath, content] of Object.entries(DATA_FILES)) {
    const fullPath = path.join(AIGENTRY_HOME, relPath);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, content + "\n");
      log(`  Created: ~/.aigentry/${relPath}`);
      results.files++;
    } else {
      results.skipped.push(relPath);
    }
  }

  // 4. Register MCP configs
  log("");
  log("  MCP registration:");

  try {
    if (registerClaudeMcp()) {
      log("    Claude (~/.claude/.mcp.json): registered");
      results.mcp.push("claude");
    } else {
      log("    Claude: already registered");
    }
  } catch (e) {
    log(`    Claude: ${e.message}`);
  }

  try {
    if (registerGeminiMcp()) {
      log("    Gemini (~/.gemini/settings.json): registered");
      results.mcp.push("gemini");
    } else {
      log("    Gemini: already registered");
    }
  } catch (e) {
    log(`    Gemini: ${e.message}`);
  }

  try {
    if (registerCodexMcp()) {
      log("    Codex (~/.codex/config.toml): registered");
      results.mcp.push("codex");
    } else {
      log("    Codex: already registered");
    }
  } catch (e) {
    log(`    Codex: ${e.message}`);
  }

  // Summary
  log("");
  const total = results.dirs + results.files + results.mcp.length;
  if (total > 0) {
    log(`Bootstrap complete: ${results.dirs} dirs, ${results.files} files, ${results.mcp.length} MCP registrations`);
  } else {
    log("Bootstrap complete: everything already provisioned");
  }
  if (results.skipped.length > 0) {
    log(`   (${results.skipped.length} items skipped -- already exist)`);
  }

  emitInstallEvent("install_done", {
    dirs: results.dirs,
    files: results.files,
    mcp: results.mcp,
    skipped_count: results.skipped.length,
  });
  return results;
}

// ── CLI Entry Point ──

if (require.main === module) {
  bootstrap();
}

module.exports = {
  bootstrap,
  registerClaudeMcp,
  registerGeminiMcp,
  registerCodexMcp,
  writeOrchestratorConfig,
  mergeClaudeHooks,
  deriveDeviceId,
};
