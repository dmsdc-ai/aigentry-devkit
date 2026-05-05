"use strict";

const {
  DISCRIMINATOR_KEY,
  clone,
  isManagedBlock,
  isPlainObject,
  stripOwnedHookKeys,
  withDiscriminator,
} = require("./sentinel");

const PERMISSIONS_ALLOW = ["Bash(aterm *)", "Bash(telepty *)"];

function stableJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function buildClaudeHooks(orchestratorSessionId) {
  return {
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

function buildClaudeSettings({ orchestratorSessionId, autoReportErrors = true }) {
  const settings = {
    permissions: withDiscriminator({
      allow: PERMISSIONS_ALLOW.slice(),
    }),
  };

  if (autoReportErrors && orchestratorSessionId) {
    settings.hooks = withDiscriminator(buildClaudeHooks(orchestratorSessionId));
  }

  return settings;
}

function mergeAllow(existingAllow, incomingAllow) {
  if (!Array.isArray(existingAllow)) {
    return existingAllow === undefined ? incomingAllow.slice() : existingAllow;
  }
  const merged = existingAllow.slice();
  for (const entry of incomingAllow) {
    if (!merged.includes(entry)) {
      merged.push(entry);
    }
  }
  return merged;
}

function mergeHookEntries(existingEntries, incomingEntries) {
  if (!Array.isArray(existingEntries)) {
    return existingEntries === undefined ? clone(incomingEntries) : existingEntries;
  }
  const merged = clone(existingEntries);
  for (const newEntry of incomingEntries || []) {
    const cmdStr = newEntry && newEntry.hooks && newEntry.hooks[0] && newEntry.hooks[0].command;
    const exists = merged.some((entry) => {
      return entry && entry.hooks && entry.hooks[0] && entry.hooks[0].command === cmdStr;
    });
    if (!exists) {
      merged.push(clone(newEntry));
    }
  }
  return merged;
}

function mergePermissions(result, incoming) {
  if (!incoming.permissions) return;

  if (!Object.prototype.hasOwnProperty.call(result, "permissions")) {
    result.permissions = clone(incoming.permissions);
    return;
  }

  const existing = result.permissions;
  if (isManagedBlock(existing)) {
    result.permissions = clone(incoming.permissions);
    return;
  }

  if (!isPlainObject(existing)) return;
  const merged = clone(existing);
  merged.allow = mergeAllow(merged.allow, incoming.permissions.allow || []);
  result.permissions = merged;
}

function mergeHooks(result, incoming) {
  const hasExisting = Object.prototype.hasOwnProperty.call(result, "hooks");
  const incomingHooks = incoming.hooks;

  if (!incomingHooks) {
    if (hasExisting && isManagedBlock(result.hooks)) {
      const preserved = stripOwnedHookKeys(result.hooks);
      if (Object.keys(preserved).length > 0) {
        result.hooks = preserved;
      } else {
        delete result.hooks;
      }
    }
    return;
  }

  if (!hasExisting) {
    result.hooks = clone(incomingHooks);
    return;
  }

  const existing = result.hooks;
  if (isManagedBlock(existing)) {
    const preserved = stripOwnedHookKeys(existing);
    result.hooks = {
      [DISCRIMINATOR_KEY]: incomingHooks[DISCRIMINATOR_KEY],
      PostToolUse: clone(incomingHooks.PostToolUse || []),
      Stop: clone(incomingHooks.Stop || []),
      ...preserved,
    };
    return;
  }

  if (!isPlainObject(existing)) return;
  const merged = clone(existing);
  for (const hookType of ["PostToolUse", "Stop"]) {
    if (!incomingHooks[hookType]) continue;
    merged[hookType] = mergeHookEntries(merged[hookType], incomingHooks[hookType]);
  }
  result.hooks = merged;
}

function mergeSettings(existing, incoming) {
  const result = clone(existing || {});
  mergePermissions(result, incoming);
  mergeHooks(result, incoming);
  return result;
}

module.exports = {
  PERMISSIONS_ALLOW,
  buildClaudeSettings,
  mergeSettings,
  stableJson,
};
