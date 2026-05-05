const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  atomicWriteFile,
  backupFile,
  parseJsonFile,
  scriptSha256,
  unifiedDiff,
} = require("./idempotent");

const cliName = "claude";
const templatePath = path.resolve(__dirname, "..", "..", "..", "templates", "scaffold", "hooks", "claude", "context-ref.sh");
const packagePath = path.resolve(__dirname, "..", "..", "..", "package.json");

function devkitVersion() {
  return JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
}

function parseSemver(text) {
  const match = String(text || "").match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

function probeTeleptyVersion() {
  const result = spawnSync("telepty", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const version = result.status === 0 ? parseSemver(result.stdout) : null;
  if (version) return { minTeleptyVersion: version, diagnostics: [] };
  return {
    minTeleptyVersion: "unknown",
    diagnostics: [{
      severity: "warn",
      message: "telepty CLI not found on PATH; install proceeds. Hook will fall-open until telepty is installed.",
    }],
  };
}

function targetPaths(scopePath) {
  return {
    settings: path.join(scopePath, ".claude", "settings.json"),
    script: path.join(scopePath, ".claude", "hooks", "aigentry-context-ref-v1.sh"),
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function desiredEntry(paths) {
  return {
    type: "command",
    command: `bash ${shellQuote(paths.script)}`,
    async: false,
  };
}

function renderScript(minTeleptyVersion) {
  const template = fs.readFileSync(templatePath, "utf8")
    .replace(/\{\{DEVKIT_VERSION\}\}/g, devkitVersion())
    .replace(/\{\{MIN_TELEPTY_VERSION\}\}/g, minTeleptyVersion);
  return scriptSha256.render(template, "SCRIPT_SHA256").rendered;
}

function isTargetEntry(entry) {
  return Boolean(entry && typeof entry.command === "string" && entry.command.includes("aigentry-context-ref-v1.sh"));
}

function ensureUserPromptHookContainer(settings) {
  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) settings.hooks = {};
  if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];
  if (settings.hooks.UserPromptSubmit.length === 0 || typeof settings.hooks.UserPromptSubmit[0] !== "object") {
    settings.hooks.UserPromptSubmit.unshift({ matcher: "", hooks: [] });
  }
  if (!Array.isArray(settings.hooks.UserPromptSubmit[0].hooks)) settings.hooks.UserPromptSubmit[0].hooks = [];
  if (!("matcher" in settings.hooks.UserPromptSubmit[0])) settings.hooks.UserPromptSubmit[0].matcher = "";
  return settings.hooks.UserPromptSubmit[0].hooks;
}

function upsertClaudeEntry(settings, entry) {
  if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) settings.hooks = {};
  if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];
  for (const item of settings.hooks.UserPromptSubmit) {
    if (!item || !Array.isArray(item.hooks)) continue;
    const index = item.hooks.findIndex(isTargetEntry);
    if (index !== -1) {
      if (JSON.stringify(item.hooks[index]) === JSON.stringify(entry)) return "noop";
      item.hooks[index] = entry;
      return "replaced";
    }
  }
  ensureUserPromptHookContainer(settings).push(entry);
  return "appended";
}

function removeClaudeEntry(settings) {
  if (!settings.hooks || !Array.isArray(settings.hooks.UserPromptSubmit)) return "noop";
  let removed = false;
  for (const item of settings.hooks.UserPromptSubmit) {
    if (!item || !Array.isArray(item.hooks)) continue;
    const before = item.hooks.length;
    item.hooks = item.hooks.filter((entry) => !isTargetEntry(entry));
    if (item.hooks.length !== before) removed = true;
  }
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter((item) => {
    if (!item || !Array.isArray(item.hooks)) return true;
    return item.hooks.length > 0 || item.matcher !== "";
  });
  if (settings.hooks.UserPromptSubmit.length === 0) delete settings.hooks.UserPromptSubmit;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return removed ? "removed" : "noop";
}

function loadSettings(settingsPath) {
  return parseJsonFile(settingsPath);
}

function renderSettingsText(value, indent) {
  if (Object.keys(value).length === 0) return "";
  return `${JSON.stringify(value, null, indent)}\n`;
}

function planSettingsInstall(settingsPath, entry) {
  const parsed = loadSettings(settingsPath);
  const oldText = parsed.exists ? fs.readFileSync(settingsPath, "utf8") : "";
  const action = upsertClaudeEntry(parsed.value, entry);
  const newText = renderSettingsText(parsed.value, parsed.indent);
  return {
    oldText,
    newText,
    action: action === "appended" ? (parsed.exists ? "updated" : "created") : action,
    exists: parsed.exists,
    indent: parsed.indent,
  };
}

function planSettingsUninstall(settingsPath) {
  const parsed = loadSettings(settingsPath);
  const oldText = parsed.exists ? fs.readFileSync(settingsPath, "utf8") : "";
  const action = removeClaudeEntry(parsed.value);
  const newText = renderSettingsText(parsed.value, parsed.indent);
  return {
    oldText,
    newText,
    action,
    exists: parsed.exists,
    indent: parsed.indent,
  };
}

function fileAction(exists, oldText, newText) {
  if (oldText === newText) return "noop";
  return exists ? "replaced" : "created";
}

function mapJsonParseError(error, settingsPath) {
  if (error.code !== "AIGENTRY_JSON_PARSE") throw error;
  const location = error.line && error.column ? ` at line ${error.line} col ${error.column}` : "";
  return {
    severity: "error",
    message: `${settingsPath}: malformed JSON${location}: ${error.message}. Fix manually or run with --force only after backing up.`,
  };
}

function install(scopePath, opts = {}) {
  const paths = targetPaths(scopePath);
  const telepty = probeTeleptyVersion();
  const scriptText = renderScript(telepty.minTeleptyVersion);
  let settingsPlan;
  try {
    settingsPlan = planSettingsInstall(paths.settings, desiredEntry(paths));
  } catch (error) {
    return {
      cli: cliName,
      scope: scopePath,
      action: opts.dryRun ? "dry-run" : "install",
      exitCode: 4,
      diagnostics: [mapJsonParseError(error, paths.settings)],
      files: [{ path: paths.settings, action: "error", backupPath: null }],
    };
  }

  const oldScriptText = fs.existsSync(paths.script) ? fs.readFileSync(paths.script, "utf8") : "";
  const scriptExists = fs.existsSync(paths.script);
  const scriptAction = fileAction(scriptExists, oldScriptText, scriptText);
  if (opts.dryRun) {
    return {
      cli: cliName,
      scope: scopePath,
      action: "dry-run",
      exitCode: 0,
      diagnostics: telepty.diagnostics,
      files: [
        { path: paths.script, action: scriptAction, backupPath: null, diff: unifiedDiff(oldScriptText, scriptText) },
        { path: paths.settings, action: settingsPlan.action, backupPath: null, diff: unifiedDiff(settingsPlan.oldText, settingsPlan.newText) },
      ],
    };
  }

  let scriptResult;
  try {
    scriptResult = scriptSha256.write(paths.script, fs.readFileSync(templatePath, "utf8")
      .replace(/\{\{DEVKIT_VERSION\}\}/g, devkitVersion())
      .replace(/\{\{MIN_TELEPTY_VERSION\}\}/g, telepty.minTeleptyVersion), "SCRIPT_SHA256", opts);
  } catch (error) {
    return {
      cli: cliName,
      scope: scopePath,
      action: "install",
      exitCode: 4,
      diagnostics: [{ severity: "error", message: error.message }],
      files: [{ path: paths.script, action: "error", backupPath: null }],
    };
  }

  let settingsAction = settingsPlan.action;
  let settingsBackupPath = null;
  if (settingsPlan.oldText !== settingsPlan.newText) {
    settingsBackupPath = backupFile(paths.settings, opts);
    atomicWriteFile(paths.settings, settingsPlan.newText, 0o644);
  } else {
    settingsAction = "noop";
  }

  return {
    cli: cliName,
    scope: scopePath,
    action: "install",
    exitCode: 0,
    diagnostics: telepty.diagnostics,
    files: [
      { path: paths.script, action: scriptResult.action, backupPath: scriptResult.backupPath },
      { path: paths.settings, action: settingsAction, backupPath: settingsBackupPath },
    ],
  };
}

function uninstall(scopePath, opts = {}) {
  const paths = targetPaths(scopePath);
  let settingsPlan;
  try {
    settingsPlan = planSettingsUninstall(paths.settings);
  } catch (error) {
    return {
      cli: cliName,
      scope: scopePath,
      action: opts.dryRun ? "dry-run" : "uninstall",
      exitCode: 4,
      diagnostics: [mapJsonParseError(error, paths.settings)],
      files: [{ path: paths.settings, action: "error", backupPath: null }],
    };
  }
  const oldScriptText = fs.existsSync(paths.script) ? fs.readFileSync(paths.script, "utf8") : "";
  const scriptAction = oldScriptText ? "removed" : "noop";
  if (opts.dryRun) {
    return {
      cli: cliName,
      scope: scopePath,
      action: "dry-run",
      exitCode: 0,
      diagnostics: [],
      files: [
        { path: paths.script, action: scriptAction, backupPath: null, diff: unifiedDiff(oldScriptText, "") },
        { path: paths.settings, action: settingsPlan.action, backupPath: null, diff: unifiedDiff(settingsPlan.oldText, settingsPlan.newText) },
      ],
    };
  }

  let settingsBackupPath = null;
  let settingsAction = settingsPlan.action;
  if (settingsPlan.oldText !== settingsPlan.newText) {
    settingsBackupPath = backupFile(paths.settings, opts);
    if (settingsPlan.newText === "") fs.unlinkSync(paths.settings);
    else atomicWriteFile(paths.settings, settingsPlan.newText, 0o644);
  } else {
    settingsAction = "noop";
  }

  let scriptBackupPath = null;
  if (fs.existsSync(paths.script)) {
    fs.unlinkSync(paths.script);
  }
  removeEmptyDir(path.dirname(paths.script));
  removeEmptyDir(path.dirname(paths.settings));

  return {
    cli: cliName,
    scope: scopePath,
    action: "uninstall",
    exitCode: 0,
    diagnostics: [],
    files: [
      { path: paths.script, action: scriptAction, backupPath: scriptBackupPath },
      { path: paths.settings, action: settingsAction, backupPath: settingsBackupPath },
    ],
  };
}

function removeEmptyDir(dirPath) {
  try {
    if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) fs.rmdirSync(dirPath);
  } catch (_) {}
}

function detect(scopePath) {
  const paths = targetPaths(scopePath);
  const issues = [];
  let installed = false;
  try {
    if (fs.existsSync(paths.settings)) {
      const settings = JSON.parse(fs.readFileSync(paths.settings, "utf8"));
      if (settings.hooks && Array.isArray(settings.hooks.UserPromptSubmit)) {
        installed = settings.hooks.UserPromptSubmit.some((item) => Array.isArray(item.hooks) && item.hooks.some(isTargetEntry));
      }
    }
  } catch (error) {
    issues.push({ path: paths.settings, severity: "error", message: "settings.json malformed" });
  }
  if (installed && !fs.existsSync(paths.script)) {
    issues.push({ path: paths.script, severity: "error", message: "settings entry present but script file missing" });
  }
  if (!installed && fs.existsSync(paths.script)) {
    issues.push({ path: paths.script, severity: "warn", message: "script file present but settings entry missing" });
  }
  const version = fs.existsSync(paths.script) && fs.readFileSync(paths.script, "utf8").includes("context-ref/v1") ? "v1" : null;
  return { installed, version, paths, issues };
}

function verify(scopePath) {
  const status = detect(scopePath);
  const issues = [...status.issues];
  if (fs.existsSync(status.paths.script)) {
    const scriptStatus = scriptSha256.detect(status.paths.script);
    if (!scriptStatus.headerMatchesFile) {
      issues.push({ path: status.paths.script, severity: "error", message: "script sha256 header mismatch" });
    }
    const mode = fs.statSync(status.paths.script).mode & 0o777;
    if (mode !== 0o755) {
      issues.push({ path: status.paths.script, severity: "error", message: "script file mode is not 0755" });
    }
  }
  return { valid: issues.length === 0, issues, paths: status.paths };
}

module.exports = {
  cliName,
  detect,
  install,
  uninstall,
  verify,
};
