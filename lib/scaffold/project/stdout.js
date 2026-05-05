"use strict";

const VALID_VERBS = new Set(["create", "merge", "skip", "backup", "remove", "noop"]);

function formatAction(action) {
  if (!VALID_VERBS.has(action.verb)) {
    throw new Error(`invalid scaffold stdout verb: ${action.verb}`);
  }
  const reason = action.reason ? ` (${action.reason})` : "";
  return `${action.verb} ${action.path}${reason}`;
}

function emitAction(action, stream = process.stdout) {
  stream.write(`${formatAction(action)}\n`);
}

function emitActions(actions, stream = process.stdout) {
  for (const action of actions) {
    emitAction(action, stream);
  }
}

module.exports = { emitAction, emitActions, formatAction, VALID_VERBS };
