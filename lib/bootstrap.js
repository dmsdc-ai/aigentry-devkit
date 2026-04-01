#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

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

// ── Main Bootstrap ──

function bootstrap(options = {}) {
  const { silent = false } = options;
  const log = silent ? () => {} : (msg) => process.stdout.write(msg + "\n");
  const results = { dirs: 0, files: 0, mcp: [], skipped: [] };

  log("aigentry bootstrap -- provisioning ~/.aigentry/");
  log("");

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

  return results;
}

// ── CLI Entry Point ──

if (require.main === module) {
  bootstrap();
}

module.exports = { bootstrap };
