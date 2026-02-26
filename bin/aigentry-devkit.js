#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const HOME = process.env.HOME || process.env.USERPROFILE || "";

function printHelp() {
  const text = [
    "aigentry-devkit CLI",
    "",
    "Usage:",
    "  aigentry-devkit setup [--force]    Install/setup aigentry-devkit",
    "  aigentry-devkit install [--force]   Alias for setup",
    "  aigentry-devkit doctor              Diagnose installation health",
    "  aigentry-devkit update [--force]    Update to latest version",
    "  aigentry-devkit --help              Show this help",
    "",
    "Examples:",
    "  npx @dmsdc-ai/aigentry-devkit setup",
    "  npx @dmsdc-ai/aigentry-devkit doctor",
    "  npx @dmsdc-ai/aigentry-devkit update",
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

function runDoctor() {
  const checks = [
    {
      name: "Node.js 18+",
      test: () => {
        const v = process.versions.node.split(".").map(Number);
        return v[0] >= 18;
      },
      fix: "Node.js 18+ 설치: https://nodejs.org/",
    },
    {
      name: "MCP Server 파일",
      test: () => fs.existsSync(path.join(HOME, ".local", "lib", "mcp-deliberation", "index.js")),
      fix: "npx @dmsdc-ai/aigentry-devkit setup 실행",
    },
    {
      name: "MCP 등록 (.mcp.json)",
      test: () => {
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(HOME, ".claude", ".mcp.json"), "utf-8"));
          return !!cfg.mcpServers?.deliberation;
        } catch { return false; }
      },
      fix: "npx @dmsdc-ai/aigentry-devkit setup 실행",
    },
    {
      name: "Skills 심볼릭 링크",
      test: () => {
        const skillsDir = path.join(HOME, ".claude", "skills");
        return fs.existsSync(path.join(skillsDir, "deliberation")) ||
               fs.existsSync(path.join(skillsDir, "clipboard-image"));
      },
      fix: "npx @dmsdc-ai/aigentry-devkit setup 실행",
    },
    {
      name: "tmux",
      test: () => commandExists("tmux"),
      fix: process.platform === "darwin"
        ? "brew install tmux"
        : process.platform === "win32"
        ? "선택사항 — Windows Terminal 사용 시 불필요"
        : "apt install tmux",
    },
    {
      name: "Chrome (CDP용)",
      test: () => {
        if (process.platform === "darwin") {
          return fs.existsSync("/Applications/Google Chrome.app");
        }
        return commandExists("google-chrome") || commandExists("chromium-browser") || commandExists("chrome");
      },
      fix: "Chrome 설치 (브라우저 LLM 자동화에 필요, 선택사항)",
    },
  ];

  console.log("🔍 aigentry-devkit Doctor\n");
  let allPassed = true;
  for (const check of checks) {
    let ok = false;
    try { ok = check.test(); } catch { ok = false; }
    const icon = ok ? "✅" : "❌";
    console.log(`  ${icon} ${check.name}`);
    if (!ok) {
      console.log(`     → ${check.fix}`);
      allPassed = false;
    }
  }
  console.log(allPassed ? "\n✅ 모든 검사 통과!" : "\n⚠️ 일부 항목 수정 필요");
  process.exit(allPassed ? 0 : 1);
}

function runUpdate(flags) {
  console.log("📦 aigentry-devkit 업데이트 중...\n");
  const npmResult = spawnSync("npm", ["install", "-g", "@dmsdc-ai/aigentry-devkit@latest"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (npmResult.status !== 0) {
    console.error("\n❌ npm 업데이트 실패. 수동으로 실행하세요:");
    console.error("  npm install -g @dmsdc-ai/aigentry-devkit@latest");
    process.exit(1);
  }
  console.log("\n✅ 패키지 업데이트 완료. 설정 재적용 중...\n");
  flags.add("--force");
  runInstall(flags);
}

// ── CLI Entry Point ──

const argv = process.argv.slice(2);
let command = "setup";
if (argv.length > 0 && !argv[0].startsWith("-")) {
  command = argv.shift();
}
const flags = new Set(argv);

if (command === "help" || flags.has("--help") || flags.has("-h")) {
  printHelp();
  process.exit(0);
}

switch (command) {
  case "install":
  case "setup":
    runInstall(flags);
    break;
  case "doctor":
    runDoctor();
    break;
  case "update":
    runUpdate(flags);
    break;
  default:
    process.stderr.write(`Unknown command: ${command}\n\n`);
    printHelp();
    process.exit(1);
}
