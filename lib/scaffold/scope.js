"use strict";

const fs = require("fs");
const path = require("path");

function diagnostic(cli, severity, message) {
  return { severity, message, cli };
}

function resolveScope(parsed, env = process.env, cwd = process.cwd()) {
  if (parsed.global && parsed.project) {
    return {
      exitCode: 3,
      diagnostic: diagnostic(parsed.cli || "install-hooks", "error", "--global and --project are mutually exclusive"),
    };
  }
  const scope = parsed.global ? (env.HOME || env.USERPROFILE) : path.resolve(cwd, parsed.project || ".");
  if (!scope) {
    return {
      exitCode: 3,
      diagnostic: diagnostic(parsed.cli || "install-hooks", "error", "HOME is not set for --global scope"),
    };
  }
  try {
    const stat = fs.statSync(scope);
    if (!stat.isDirectory()) throw new Error("not-directory");
    fs.accessSync(scope, fs.constants.W_OK);
  } catch (_) {
    return {
      exitCode: 3,
      diagnostic: diagnostic(parsed.cli || "install-hooks", "error", `project path '${scope}' not found or not a directory`),
    };
  }
  return { scope };
}

module.exports = { resolveScope };
