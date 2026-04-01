"use strict";

// breakdown.js — reads a task from state/task-queue.json and generates
// a structured subtask breakdown JSON for parallel session assignment.

const fs = require("fs");
const path = require("path");

function splitDescription(name) {
  if (name.includes(";")) return name.split(";").map((s) => s.trim()).filter(Boolean);
  if (name.includes(" + ")) return name.split(" + ").map((s) => s.trim()).filter(Boolean);
  if (name.includes(" and ")) return name.split(" and ").map((s) => s.trim()).filter(Boolean);
  return [name.trim()];
}

function runBreakdown({ taskId, cwd } = {}) {
  const root = cwd || process.cwd();
  const queuePath = path.join(root, "state", "task-queue.json");

  if (!fs.existsSync(queuePath)) {
    process.stderr.write(`Error: task-queue.json not found at ${queuePath}\n`);
    process.exit(1);
  }

  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  } catch (err) {
    process.stderr.write(`Error: failed to parse task-queue.json: ${err.message}\n`);
    process.exit(1);
  }

  const allTasks = [].concat(queue.tasks || [], queue.completed || []);
  const task = allTasks.find((t) => t.id === taskId);

  if (!task) {
    process.stderr.write(`Error: task with id ${taskId} not found\n`);
    process.exit(1);
  }

  const parts = splitDescription(task.name);
  const subtasks = parts.map((desc, i) => ({
    id: `${task.id}.${i + 1}`,
    desc,
    suggested_session: "",
    files: [],
  }));

  const result = {
    parent_id: task.id,
    parent_name: task.name,
    subtasks,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

module.exports = { runBreakdown };
