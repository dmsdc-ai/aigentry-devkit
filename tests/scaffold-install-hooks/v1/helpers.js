const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const cliPath = path.join(repoRoot, "bin", "aigentry-devkit.js");

function mkScope() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aigentry-hooks-"));
}

function makeTeleptyShim(root, version = "0.4.0") {
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const shimPath = path.join(binDir, "telepty");
  fs.writeFileSync(shimPath, `#!/usr/bin/env sh\nif [ "$1" = "--version" ]; then\n  echo "telepty ${version}"\n  exit 0\nfi\nexit 0\n`);
  fs.chmodSync(shimPath, 0o755);
  return binDir;
}

function runCli(args, { cwd, home, pathPrefix } = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: cwd || repoRoot,
    env: {
      ...process.env,
      HOME: home || mkScope(),
      PATH: pathPrefix ? `${pathPrefix}${path.delimiter}${process.env.PATH}` : process.env.PATH,
    },
    encoding: "utf8",
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

module.exports = {
  countMatches,
  makeTeleptyShim,
  mkScope,
  repoRoot,
  runCli,
  sha256,
};
