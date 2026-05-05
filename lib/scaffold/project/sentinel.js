"use strict";

const DISCRIMINATOR_KEY = "x-aigentry-scaffold";
const DISCRIMINATOR_VALUE = "v1";
const OWNED_HOOK_KEYS = new Set(["PostToolUse", "Stop"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isManagedBlock(value) {
  return isPlainObject(value) && value[DISCRIMINATOR_KEY] === DISCRIMINATOR_VALUE;
}

function withDiscriminator(fields) {
  return {
    [DISCRIMINATOR_KEY]: DISCRIMINATOR_VALUE,
    ...fields,
  };
}

function stripOwnedHookKeys(hooks) {
  const result = {};
  for (const [key, value] of Object.entries(hooks || {})) {
    if (key === DISCRIMINATOR_KEY || OWNED_HOOK_KEYS.has(key)) continue;
    result[key] = clone(value);
  }
  return result;
}

function removeMarkdownScaffoldBlock(content) {
  const pattern = /\n?<!-- BEGIN aigentry scaffold\/v1[\s\S]*?<!-- END aigentry scaffold\/v1 -->\n?/g;
  let removed = false;
  const next = content.replace(pattern, (match) => {
    removed = true;
    return match.startsWith("\n") ? "\n" : "";
  });
  return { content: next, removed };
}

module.exports = {
  DISCRIMINATOR_KEY,
  DISCRIMINATOR_VALUE,
  OWNED_HOOK_KEYS,
  clone,
  isManagedBlock,
  isPlainObject,
  removeMarkdownScaffoldBlock,
  stripOwnedHookKeys,
  withDiscriminator,
};
