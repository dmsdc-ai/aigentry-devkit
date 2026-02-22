#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");

function printHelp() {
  const text = [
    "aigentry-devkit CLI",
    "",
    "Usage:",
    "  aigentry-devkit install [--force]",
    "  aigentry-devkit --help",
    "",
    "Examples:",
    "  npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install",
    "  npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit install --force",
  ].join("\n");
  process.stdout.write(`${text}\n`);
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], { stdio: "ignore" });
  return result.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`Failed to run "${command}": ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status == null ? 1 : result.status);
}

function runInstall(flags) {
  const force = flags.has("--force") || flags.has("-f");

  if (process.platform === "win32") {
    const scriptPath = path.join(rootDir, "install.ps1");
    if (!fs.existsSync(scriptPath)) {
      process.stderr.write(`Missing installer: ${scriptPath}\n`);
      process.exit(1);
    }

    const shell = ["pwsh.exe", "pwsh", "powershell.exe", "powershell"].find(commandExists);
    if (!shell) {
      process.stderr.write("PowerShell not found. Install PowerShell and retry.\n");
      process.exit(1);
    }

    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath];
    if (force) args.push("-Force");
    run(shell, args);
    return;
  }

  const scriptPath = path.join(rootDir, "install.sh");
  if (!fs.existsSync(scriptPath)) {
    process.stderr.write(`Missing installer: ${scriptPath}\n`);
    process.exit(1);
  }
  if (!commandExists("bash")) {
    process.stderr.write("bash not found. Install bash and retry.\n");
    process.exit(1);
  }

  const args = [scriptPath];
  if (force) args.push("--force");
  run("bash", args);
}

const argv = process.argv.slice(2);
let command = "install";
if (argv.length > 0 && !argv[0].startsWith("-")) {
  command = argv.shift();
}
const flags = new Set(argv);

if (command === "help" || flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}

if (command !== "install") {
  process.stderr.write(`Unknown command: ${command}\n\n`);
  printHelp();
  process.exit(1);
}

runInstall(flags);
