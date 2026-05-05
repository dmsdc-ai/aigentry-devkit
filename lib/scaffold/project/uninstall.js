"use strict";

const fs = require("fs");
const path = require("path");

const { stableJson } = require("./merge");
const { isManagedBlock, removeMarkdownScaffoldBlock, stripOwnedHookKeys } = require("./sentinel");

function makeError(message, exitCode, actions = []) {
  const error = new Error(message);
  error.exitCode = exitCode;
  error.actions = actions;
  return error;
}

function targetFiles(targetDir, cli) {
  const files = [path.join(targetDir, "AGENTS.md")];
  if (cli === "claude") files.push(path.join(targetDir, "CLAUDE.md"));
  if (cli === "gemini") files.push(path.join(targetDir, "GEMINI.md"));
  files.push(path.join(targetDir, "state", "task-queue.json"));
  files.push(path.join(targetDir, "state", "lessons.json"));
  return files;
}

function removeSettingsBlocks(existing) {
  const result = JSON.parse(JSON.stringify(existing || {}));
  let changed = false;

  if (isManagedBlock(result.permissions)) {
    delete result.permissions;
    changed = true;
  }

  if (isManagedBlock(result.hooks)) {
    const preserved = stripOwnedHookKeys(result.hooks);
    if (Object.keys(preserved).length > 0) {
      result.hooks = preserved;
    } else {
      delete result.hooks;
    }
    changed = true;
  }

  return { changed, settings: result };
}

function buildUninstallPlan({ targetDir, cli, backupPathFor, backup }) {
  const actions = [];

  if (cli === "claude") {
    const settingsPath = path.join(targetDir, ".claude", "settings.json");
    if (!fs.existsSync(settingsPath)) {
      actions.push({ verb: "noop", path: settingsPath, reason: "absent" });
    } else {
      let existing;
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      } catch (_) {
        if (!backup) {
          throw makeError("error: --no-backup forbidden when uninstalling from malformed settings.json", 2);
        }
        const backupAction = { verb: "backup", path: backupPathFor(settingsPath), original: settingsPath };
        throw makeError("error: existing .claude/settings.json malformed JSON; backup written; aborting", 4, [backupAction]);
      }

      const removed = removeSettingsBlocks(existing);
      if (!removed.changed) {
        actions.push({ verb: "noop", path: settingsPath, reason: "no sentinel block to remove" });
      } else {
        if (backup) actions.push({ verb: "backup", path: backupPathFor(settingsPath), original: settingsPath });
        actions.push({ verb: "remove", path: settingsPath, reason: "sentinel block", content: stableJson(removed.settings) });
      }
    }
  }

  for (const filePath of targetFiles(targetDir, cli)) {
    if (!fs.existsSync(filePath)) {
      actions.push({ verb: "noop", path: filePath, reason: "absent" });
      continue;
    }
    if (filePath.endsWith(".md")) {
      const raw = fs.readFileSync(filePath, "utf8");
      const removed = removeMarkdownScaffoldBlock(raw);
      if (removed.removed) {
        if (backup) actions.push({ verb: "backup", path: backupPathFor(filePath), original: filePath });
        actions.push({ verb: "remove", path: filePath, reason: "sentinel block", content: removed.content });
      } else {
        actions.push({ verb: "noop", path: filePath, reason: "no sentinel block to remove" });
      }
    } else {
      actions.push({ verb: "noop", path: filePath, reason: "no sentinel block to remove" });
    }
  }
  return actions;
}

module.exports = { buildUninstallPlan, removeSettingsBlocks };
