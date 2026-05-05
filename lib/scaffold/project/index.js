"use strict";

const fs = require("fs");
const path = require("path");

const { registerClaudeMcp, registerGeminiMcp, registerCodexMcp } = require("../../bootstrap");
const { buildGenerationActions, resolveOrchestratorId, TEMPLATES_DIR, VALID_CLIS } = require("./generate");
const { buildClaudeSettings, mergeSettings, stableJson } = require("./merge");
const { emitAction, emitActions } = require("./stdout");
const { buildUninstallPlan } = require("./uninstall");

function makeError(message, exitCode, actions = []) {
  const error = new Error(message);
  error.exitCode = exitCode;
  error.actions = actions;
  return error;
}

function isAbsoluteNoWhitespace(value) {
  return path.isAbsolute(value) && !/\s/.test(path.resolve(value));
}

function backupPathFor(filePath) {
  return `${filePath}.bak.${new Date().toISOString()}`;
}

function parseProjectArgv(args, globalOptions = {}) {
  const opts = {
    cli: null,
    cwd: null,
    dryRun: Boolean(globalOptions.dryRun),
    backup: true,
    uninstall: false,
    templateDir: null,
    orchestratorSessionId: null,
    autoReportErrors: true,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const needValue = () => {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw makeError(`error: missing value for ${arg}`, 2);
      }
      i += 1;
      return value;
    };

    if (arg === "--project" || arg === "--cwd") {
      opts.cwd = needValue();
    } else if (arg === "--cli") {
      opts.cli = needValue();
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--backup") {
      opts.backup = true;
    } else if (arg === "--no-backup") {
      opts.backup = false;
    } else if (arg === "--template-dir") {
      opts.templateDir = needValue();
    } else if (arg === "--uninstall") {
      opts.uninstall = true;
      if (args[i + 1] === "project") i += 1;
    } else if (arg === "--orchestrator-session-id" || arg === "--orchestrator-session") {
      opts.orchestratorSessionId = needValue();
    } else if (arg === "--no-auto-report-errors" || arg === "--no-error-hooks") {
      opts.autoReportErrors = false;
    } else {
      throw makeError(`error: unknown scaffold flag: ${arg}`, 2);
    }
  }

  return opts;
}

function validateOptions(opts) {
  if (!opts.cli || !VALID_CLIS.includes(opts.cli)) {
    throw makeError(`error: --cli must be one of claude, codex, gemini (got: ${opts.cli || ""})`, 2);
  }
  if (!opts.cwd) {
    throw makeError("error: --cwd must be an absolute path (got: )", 2);
  }

  const targetDir = path.resolve(opts.cwd);
  if (!path.isAbsolute(opts.cwd)) {
    throw makeError(`error: --cwd must be an absolute path (got: ${opts.cwd})`, 2);
  }
  if (!isAbsoluteNoWhitespace(targetDir)) {
    throw makeError("error: cwd contains whitespace; not supported in v1", 2);
  }

  const templateDir = opts.templateDir ? path.resolve(opts.templateDir) : TEMPLATES_DIR;
  if (opts.templateDir) {
    try {
      const stat = fs.statSync(templateDir);
      if (!stat.isDirectory()) {
        throw new Error("not a directory");
      }
      fs.accessSync(templateDir, fs.constants.R_OK);
    } catch (_) {
      throw makeError(`error: --template-dir not found: ${templateDir}`, 3);
    }
  } else if (!fs.existsSync(templateDir)) {
    throw makeError("error: bundled templates missing - devkit install corrupt; reinstall @dmsdc-ai/aigentry-devkit", 4);
  }

  if (fs.existsSync(targetDir) && !fs.statSync(targetDir).isDirectory()) {
    throw makeError(`error: cwd inaccessible: ${targetDir}`, 3);
  }

  return {
    ...opts,
    targetDir,
    templateDir,
  };
}

function ensureProjectDir(targetDir) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (error) {
    throw makeError(`error: cwd inaccessible: ${targetDir} (errno=${error.code || "unknown"})`, 3);
  }
}

function settingsLocalNote(targetDir, stderr) {
  const localPath = path.join(targetDir, ".claude", "settings.local.json");
  if (fs.existsSync(localPath)) {
    stderr.write("info: existing settings.local.json detected; v1 writes settings.json (canonical per ADR 2026-05-05); settings.local.json is NOT modified.\n");
  }
}

function buildSettingsActions(config) {
  if (config.cli !== "claude") return [];

  const settingsPath = path.join(config.targetDir, ".claude", "settings.json");
  const incoming = buildClaudeSettings({
    orchestratorSessionId: config.orchestratorSessionId,
    autoReportErrors: config.autoReportErrors,
  });

  if (!fs.existsSync(settingsPath)) {
    return [{ verb: "create", path: settingsPath, content: stableJson(incoming) }];
  }

  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (_) {
    const actions = config.backup
      ? [{ verb: "backup", path: backupPathFor(settingsPath), original: settingsPath }]
      : [];
    throw makeError("error: existing .claude/settings.json malformed JSON; backup written; aborting", 4, actions);
  }

  const merged = mergeSettings(existing, incoming);
  const existingText = stableJson(existing);
  const mergedText = stableJson(merged);
  if (existingText === mergedText) {
    return [{ verb: "skip", path: settingsPath, reason: "unchanged" }];
  }

  const actions = [];
  if (config.backup) {
    actions.push({ verb: "backup", path: backupPathFor(settingsPath), original: settingsPath });
  }
  actions.push({ verb: "merge", path: settingsPath, content: mergedText });
  return actions;
}

function buildPlan(config, stderr) {
  if (config.uninstall) {
    return buildUninstallPlan({
      targetDir: config.targetDir,
      cli: config.cli,
      backup: config.backup,
      backupPathFor,
    });
  }

  settingsLocalNote(config.targetDir, stderr);
  let resolvedOrchestratorId = config.orchestratorSessionId;
  if (config.cli === "claude" && config.autoReportErrors) {
    resolvedOrchestratorId = resolveOrchestratorId(config.orchestratorSessionId);
    if (!resolvedOrchestratorId) {
      stderr.write("info: no orchestrator session id resolved; auto-report-error hooks omitted\n");
    }
  } else if (config.autoReportErrors) {
    resolvedOrchestratorId = resolveOrchestratorId(config.orchestratorSessionId);
  }

  const withResolved = { ...config, orchestratorSessionId: resolvedOrchestratorId };
  const settingsActions = buildSettingsActions(withResolved);
  return [
    ...buildGenerationActions(withResolved),
    ...settingsActions,
  ];
}

function executeAction(action) {
  if (action.verb === "skip" || action.verb === "noop") return;
  fs.mkdirSync(path.dirname(action.path), { recursive: true });

  if (action.verb === "backup") {
    fs.copyFileSync(action.original, action.path);
    return;
  }

  if (action.symlink) {
    fs.symlinkSync(action.symlink, action.path);
    return;
  }

  fs.writeFileSync(action.path, action.content);
}

function registerMcp(cli, stderr) {
  const registers = {
    claude: registerClaudeMcp,
    gemini: registerGeminiMcp,
    codex: registerCodexMcp,
  };
  const registerFn = registers[cli];
  if (!registerFn) return;
  try {
    registerFn();
  } catch (error) {
    stderr.write(`warn: ${cli} MCP registration failed: ${error.message}; continuing\n`);
  }
}

function scaffoldProject(opts = {}) {
  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;
  const emit = opts.emit !== false;
  const completed = [];

  let config;
  let actions;
  try {
    config = validateOptions({
      dryRun: false,
      backup: true,
      uninstall: false,
      templateDir: null,
      orchestratorSessionId: null,
      autoReportErrors: true,
      ...opts,
    });
    actions = buildPlan(config, stderr);
  } catch (error) {
    const errorActions = error.actions || [];
    if (!opts.dryRun) {
      for (const action of errorActions) {
        try {
          executeAction(action);
          completed.push(action);
          if (emit) emitAction(action, stdout);
        } catch (writeError) {
          stderr.write(`error: write failed: ${action.path} (${writeError.code || writeError.message})\n`);
          return { actions: completed, exitCode: 4 };
        }
      }
    }
    stderr.write(`${error.message}\n`);
    return { actions: completed, exitCode: error.exitCode || 4 };
  }

  if (config.dryRun) {
    if (emit) emitActions(actions, stdout);
    return { actions, exitCode: 0 };
  }

  try {
    ensureProjectDir(config.targetDir);
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return { actions: completed, exitCode: error.exitCode || 3 };
  }

  for (const action of actions) {
    try {
      executeAction(action);
      completed.push(action);
      if (emit) emitAction(action, stdout);
    } catch (error) {
      stderr.write(`error: write failed: ${action.path} (${error.code || error.message})\n`);
      return { actions: completed, exitCode: 4 };
    }
  }

  registerMcp(config.cli, stderr);
  return { actions: completed, exitCode: 0 };
}

function workspaceInitCompat(opts = {}) {
  const stderr = opts.stderr || process.stderr;
  stderr.write(`[alias] consider 'aigentry scaffold --project --cli <cli> --cwd <cwd>' (workspace-init form retained for compat)\n`);
  return scaffoldProject(opts);
}

function printScaffoldHelp(stream = process.stdout) {
  stream.write([
    "Usage:",
    "  aigentry scaffold --project <cwd> --cli <claude|codex|gemini> [--dry-run] [--backup|--no-backup] [--template-dir <path>] [--uninstall]",
    "",
  ].join("\n"));
}

module.exports = {
  parseProjectArgv,
  printScaffoldHelp,
  scaffoldProject,
  workspaceInitCompat,
};
