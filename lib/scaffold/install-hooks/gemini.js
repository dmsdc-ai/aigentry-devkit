const path = require("path");

const cliName = "gemini";
const deferredMessage = "Gemini receiver is deferred by spec section 4.3.0 pending dustcraw validation of Gemini CLI hook schema.";

function targetPaths(scopePath) {
  return {
    settings: path.join(scopePath, ".gemini", "settings.json"),
    script: path.join(scopePath, ".gemini", "hooks", "aigentry-context-ref-v1.js"),
  };
}

function skippedResult(scopePath, action) {
  const paths = targetPaths(scopePath);
  return {
    cli: cliName,
    scope: scopePath,
    action,
    exitCode: 0,
    diagnostics: [{ severity: "info", message: deferredMessage }],
    files: [
      { path: paths.settings, action: "skipped", backupPath: null },
      { path: paths.script, action: "skipped", backupPath: null },
    ],
  };
}

function detect(scopePath) {
  return {
    installed: false,
    version: null,
    paths: targetPaths(scopePath),
    issues: [{ path: targetPaths(scopePath).settings, severity: "info", message: deferredMessage }],
  };
}

function install(scopePath, opts = {}) {
  return skippedResult(scopePath, opts.dryRun ? "dry-run" : "install");
}

function uninstall(scopePath, opts = {}) {
  return skippedResult(scopePath, opts.dryRun ? "dry-run" : "uninstall");
}

function verify(scopePath) {
  return { valid: true, issues: detect(scopePath).issues, paths: targetPaths(scopePath) };
}

module.exports = {
  cliName,
  detect,
  install,
  uninstall,
  verify,
};
