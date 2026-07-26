#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { workspaceInit, scaffoldProject, parseProjectArgv, printScaffoldHelp } = require("../lib/workspace-init");
// δ2 (#440) — telemetry emit wrapper. Fire-and-forget; failures swallowed
// internally so the CLI is never blocked by a logger transport hiccup.
const { emitModuleEvent } = require("../lib/logger-emit");

const rootDir = path.resolve(__dirname, "..");
const HOME = process.env.HOME || process.env.USERPROFILE || "";
const defaultManifestPath = path.join(rootDir, "config", "installer-manifest.json");


function resolveFullPath(cmd) {
  const result = spawnSync("which", [cmd], { stdio: "pipe", timeout: 3000 });
  if (result.status === 0 && result.stdout) {
    return result.stdout.toString().trim();
  }
  return cmd;
}

function printHelp() {
  const text = [
    "aigentry-devkit CLI",
    "",
    "Usage:",
    "  aigentry-devkit setup [options]     Install/setup aigentry-devkit",
    "  aigentry-devkit install [options]   Alias for setup",
    "  aigentry-devkit profiles            List installer profiles from manifest",
    "  aigentry-devkit doctor              Diagnose installation health",
    "    --skills                          Only check installed skills against the devkit SSOT (drift guard)",
    "  aigentry-devkit repair-gemini-mcp   Re-run canonical Gemini MCP registration for deliberation",
    "  aigentry-devkit update [options]    Update to latest version",
    "  aigentry-devkit status              Show health status of all modules",
    "  aigentry-devkit init                Initialize ~/.config/aigentry/ config directory",
    "  aigentry-devkit workspace-init      Initialize workspace for AI CLI session",
    "    --cli <claude|codex|gemini>       Target CLI (required)",
    "    --cwd <path>                      Workspace directory (required)",
    "  aigentry scaffold --project <cwd>   Scaffold project files for an AI CLI session",
    "    --cli <claude|codex|gemini>       Target CLI (required)",
    "    --dry-run                         Emit planned actions without writing",
    "    --backup|--no-backup              Backup merge/uninstall targets (default: backup)",
    "  aigentry scaffold install-hooks <cli>  Install [context-ref/v1] receiver hooks",
    "  aigentry-devkit breakdown            Decompose task into sub-tasks for parallel assignment",
    "    --task-id <id>                     Task ID from task-queue.json (required)",
    "    --cwd <path>                       Workspace directory (default: cwd)",
    "  aigentry-devkit bootstrap           Provision ~/.aigentry/ structure and MCP configs",
    "  aigentry-devkit --help              Show this help",
    "",
    "Install Options:",
    "  --force, -f              Reinstall existing files",
    "  --profile <name>         Installer profile (default: core)",
    "  --manifest <path>        Installer manifest path",
    "  --resume <target>        Resume from phase number or component name",
    "  --dry-run                Print resolved install plan and exit",
    "",
    "Examples:",
    "  npx @dmsdc-ai/aigentry-devkit setup --profile core",
    "  npx @dmsdc-ai/aigentry-devkit setup --profile orchestrator",
    "  npx @dmsdc-ai/aigentry-devkit install --profile autoresearch-public",
    "  npx @dmsdc-ai/aigentry-devkit profiles",
    "  npx @dmsdc-ai/aigentry-devkit doctor",
    "  npx @dmsdc-ai/aigentry-devkit repair-gemini-mcp",
    "  npx @dmsdc-ai/aigentry-devkit update",
    "  npx @dmsdc-ai/aigentry-devkit status",
    "  npx @dmsdc-ai/aigentry-devkit init",
    "",
    "Sessions: use telepty (lifecycle/inject) + bin/open-session.sh (terminal spawn).",
  ].join("\n");
  process.stdout.write(`${text}\n`);
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], { stdio: "ignore" });
  return result.status === 0;
}


function loadMcpRegistry() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, "config", "mcp-registry.json"), "utf-8"));
  } catch {
    return { servers: {} };
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function checkMcpServerStatus(name, serverDef) {
  // deliberation: check local install
  if (serverDef.local_install) {
    const indexPath = path.join(HOME, ".local", "lib", "mcp-deliberation", "index.js");
    return fs.existsSync(indexPath) ? "installed" : "not_installed";
  }
  // npx servers: check if registered in .mcp.json
  const cfg = readJson(path.join(HOME, ".claude", ".mcp.json"));
  if (cfg?.mcpServers?.[name]) return "registered";
  return serverDef.default ? "not_registered" : "available";
}

function parseCommandArgs(args) {
  const options = {
    force: false,
    help: false,
    dryRun: false,
    profile: null,
    manifest: null,
    resume: null,
    skills: false,
  };
  const extras = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--force" || arg === "-f") {
      options.force = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--skills") {
      options.skills = true;
      continue;
    }
    if (arg === "--profile" || arg === "--manifest" || arg === "--resume") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Missing value for ${arg}`);
      }
      const key = arg.slice(2);
      options[key] = value;
      i += 1;
      continue;
    }
    extras.push(arg);
  }

  return { options, extras };
}

function resolveManifestPath(manifestPath) {
  return path.resolve(process.cwd(), manifestPath || defaultManifestPath);
}

function loadInstallerManifest(manifestPath) {
  const resolvedPath = resolveManifestPath(manifestPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Installer manifest not found: ${resolvedPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
  } catch (error) {
    throw new Error(`Failed to parse installer manifest: ${resolvedPath}\n${error.message}`);
  }

  if (!manifest || typeof manifest !== "object") {
    throw new Error(`Invalid installer manifest: ${resolvedPath}`);
  }
  if (!manifest.profiles || typeof manifest.profiles !== "object") {
    throw new Error(`Installer manifest is missing "profiles": ${resolvedPath}`);
  }
  if (!manifest.components || typeof manifest.components !== "object") {
    throw new Error(`Installer manifest is missing "components": ${resolvedPath}`);
  }

  return { manifest, resolvedPath };
}

function resolveInstallContext(options = {}) {
  const { manifest, resolvedPath } = loadInstallerManifest(options.manifest);
  const profileName = options.profile || "core";
  const profile = manifest.profiles[profileName];

  if (!profile) {
    const validProfiles = Object.keys(manifest.profiles).sort().join(", ");
    throw new Error(`Unknown installer profile: ${profileName}\nAvailable profiles: ${validProfiles}`);
  }

  const requiredComponents = Array.isArray(profile.components) ? profile.components : [];
  const optionalComponents = Array.isArray(profile.optional_components) ? profile.optional_components : [];
  const componentNames = [...requiredComponents];
  const missingComponents = componentNames.filter((name) => !manifest.components[name]);
  if (missingComponents.length > 0) {
    throw new Error(
      `Profile "${profileName}" references unknown components: ${missingComponents.join(", ")}`
    );
  }

  if (options.resume) {
    const isPhaseNumber = /^\d+$/.test(options.resume);
    const isKnownComponent = !!manifest.components[options.resume];
    if (!isPhaseNumber && !isKnownComponent) {
      throw new Error(
        `Unknown resume target: ${options.resume}\nUse a phase number or one of: ${Object.keys(manifest.components).sort().join(", ")}`
      );
    }
  }

  const components = componentNames
    .map((name) => ({
      name,
      phase: manifest.components[name].phase ?? null,
      required: manifest.components[name].required !== false,
    }))
    .sort((left, right) => {
      const leftPhase = left.phase ?? Number.MAX_SAFE_INTEGER;
      const rightPhase = right.phase ?? Number.MAX_SAFE_INTEGER;
      if (leftPhase !== rightPhase) return leftPhase - rightPhase;
      return left.name.localeCompare(right.name);
    });

  return {
    manifest,
    manifestPath: resolvedPath,
    profileName,
    profile,
    components,
    optionalComponents,
  };
}

function printProfiles(options = {}) {
  const { manifest, resolvedPath } = loadInstallerManifest(options.manifest);
  const lines = [
    "Installer Profiles",
    "",
    `Manifest: ${resolvedPath}`,
    "",
  ];

  for (const [name, profile] of Object.entries(manifest.profiles)) {
    const components = Array.isArray(profile.components) ? profile.components.join(", ") : "";
    lines.push(`${name}`);
    lines.push(`  ${profile.description || "No description"}`);
    lines.push(`  components: ${components}`);
    if (Array.isArray(profile.optional_components) && profile.optional_components.length > 0) {
      lines.push(`  optional: ${profile.optional_components.join(", ")}`);
    }
    lines.push("");
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

function printInstallPlan(context, options = {}) {
  const lines = [
    "Resolved Install Plan",
    "",
    `Manifest: ${context.manifestPath}`,
    `Profile: ${context.profileName}`,
  ];
  if (options.resume) {
    lines.push(`Resume: ${options.resume}`);
  }
  lines.push("");
  lines.push("Components:");
  for (const component of context.components) {
    const phaseLabel = component.phase == null ? "unphased" : `phase ${component.phase}`;
    lines.push(`  - ${component.name} (${phaseLabel})`);
  }
  if (context.optionalComponents.length > 0) {
    lines.push("");
    lines.push(`Optional components: ${context.optionalComponents.join(", ")}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) {
    process.stderr.write(`Failed to run "${command}": ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status == null ? 1 : result.status);
}

function runInstall(options = {}) {
  const context = resolveInstallContext(options);

  if (options.dryRun) {
    printInstallPlan(context, options);
    process.exit(0);
  }

  const installerEnv = {
    AIGENTRY_INSTALL_PROFILE: context.profileName,
    AIGENTRY_INSTALL_MANIFEST: context.manifestPath,
    AIGENTRY_INSTALL_COMPONENTS: context.components.map((component) => component.name).join(","),
    AIGENTRY_OPTIONAL_COMPONENTS: context.optionalComponents.join(","),
  };
  if (options.resume) {
    installerEnv.AIGENTRY_INSTALL_RESUME = options.resume;
  }

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
    if (options.force) args.push("-Force");
    run(shell, args, installerEnv);
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
  if (options.force) args.push("--force");
  run("bash", args, installerEnv);
}

// #739 drift guard — `doctor --skills`. Runs standalone (not part of the full
// doctor sweep) so it stays a fast, focused check.
function runDoctorSkills() {
  const { checkSkillsDrift } = require("../lib/skills-drift");
  const installedDir = path.join(HOME, ".claude", "skills");

  console.log("🔍 aigentry-devkit Doctor — Skills\n");
  console.log(`  devkit:    ${path.join(rootDir, "skills")}`);
  console.log(`  installed: ${installedDir}\n`);

  const results = checkSkillsDrift(rootDir, installedDir);
  let drifted = 0;
  for (const r of results) {
    if (r.status === "ok") {
      console.log(`    ✅ ${r.name}`);
    } else if (r.status === "missing") {
      console.log(`    ➖ ${r.name} — not installed`);
      console.log("       → npx @dmsdc-ai/aigentry-devkit setup");
    } else {
      drifted += 1;
      console.log(`    ❌ ${r.name} — installed copy differs from devkit SSOT`);
      console.log("       → npx @dmsdc-ai/aigentry-devkit setup --force");
    }
  }

  console.log(
    drifted === 0
      ? `\n✅ ${results.length}개 스킬 SSOT 일치`
      : `\n⚠️ ${drifted}개 스킬 드리프트 감지`
  );
  process.exit(drifted === 0 ? 0 : 1);
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
        const cfg = readJson(path.join(HOME, ".claude", ".mcp.json"));
        return !!cfg?.mcpServers?.deliberation;
      },
      fix: "npx @dmsdc-ai/aigentry-devkit setup 실행",
    },
    {
      name: "Gemini deliberation MCP",
      test: () => {
        const cfg = readJson(path.join(HOME, ".gemini", "settings.json"));
        return !!cfg?.mcpServers?.deliberation;
      },
      fix: "npx --yes --package @dmsdc-ai/aigentry-devkit aigentry-devkit repair-gemini-mcp",
    },
    {
      name: "Skills 심볼릭 링크",
      test: () => {
        const skillsDir = path.join(HOME, ".claude", "skills");
        // clipboard-image was de-listed (#739 D1/D4) and no longer installs —
        // env-manager is the second always-shipped marker.
        return fs.existsSync(path.join(skillsDir, "deliberation")) ||
               fs.existsSync(path.join(skillsDir, "env-manager"));
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

  console.log("  📋 System Checks:");
  for (const check of checks) {
    let ok = false;
    try { ok = check.test(); } catch { ok = false; }
    const icon = ok ? "✅" : "❌";
    console.log(`    ${icon} ${check.name}`);
    if (!ok) {
      console.log(`       → ${check.fix}`);
      allPassed = false;
    }
  }

  // Orchestrator profile checks (#518) — auto-detected: only shown when the
  // orchestrator profile is installed (installer-state has orchestrator-role /
  // an orchestrator block, or $ORCH_DIR exists). A core-only user is unaffected.
  const orchStateFile = path.join(
    process.env.XDG_CONFIG_HOME || path.join(HOME, ".config"),
    "aigentry-devkit", "install-state.json"
  );
  const orchState = readJson(orchStateFile) || {};
  const orchDir = (orchState.orchestrator && orchState.orchestrator.repo_dir) ||
    process.env.AIGENTRY_ORCH_DIR || "";
  const orchInstalled = !!orchState.orchestrator ||
    (Array.isArray(orchState.components) && orchState.components.includes("orchestrator-role")) ||
    (!!orchDir && fs.existsSync(orchDir));
  if (orchInstalled) {
    const aigentryHome = process.env.AIGENTRY_HOME || path.join(HOME, ".aigentry");
    const orchChecks = [
      {
        name: "instruction tree present",
        test: () => fs.existsSync(path.join(aigentryHome, "instructions", "roles", "orchestrator.md")),
        fix: `bash ${orchDir || "$ORCH_DIR"}/bin/install-instructions.sh`,
      },
      {
        name: "dispatch.sh on PATH",
        test: () => commandExists("dispatch.sh"),
        fix: "add ~/.local/bin to PATH / re-run setup --profile orchestrator",
      },
      {
        name: "config.json roles present",
        test: () => {
          const c = readJson(path.join(aigentryHome, "config.json"));
          return !!(c && c.roles && Object.values(c.roles).some((r) => r && r.path));
        },
        fix: "re-run setup --profile orchestrator",
      },
      {
        name: "deliberation MCP registered",
        test: () => {
          const cfg = readJson(path.join(HOME, ".claude", ".mcp.json"));
          return !!(cfg && cfg.mcpServers && cfg.mcpServers.deliberation);
        },
        fix: "npx @dmsdc-ai/aigentry-devkit setup",
      },
      {
        // Info-only (tolerant of AIGENTRY_SKIP_DAEMON / headless): never fails doctor.
        name: "reconciler daemon loaded",
        optional: true,
        test: () => {
          if (process.platform === "darwin") {
            return spawnSync("launchctl", ["print", `gui/${process.getuid()}/com.aigentry.reconciler`], { stdio: "ignore" }).status === 0;
          }
          if (process.platform === "linux") {
            return spawnSync("systemctl", ["--user", "is-active", "aigentry-reconciler"], { stdio: "ignore" }).status === 0;
          }
          return true;
        },
        fix: "re-run setup / load the generated unit",
      },
    ];

    console.log("\n  🪐 Orchestrator Profile:");
    for (const check of orchChecks) {
      let ok = false;
      try { ok = check.test(); } catch { ok = false; }
      const icon = ok ? "✅" : (check.optional ? "➖" : "❌");
      console.log(`    ${icon} ${check.name}`);
      if (!ok && !check.optional) {
        console.log(`       → ${check.fix}`);
        allPassed = false;
      }
    }
  }

  // MCP Server Bundle checks
  console.log("\n  📦 MCP Servers:");
  const registry = loadMcpRegistry();
  for (const [name, def] of Object.entries(registry.servers || {})) {
    const status = checkMcpServerStatus(name, def);
    let icon, label;
    switch (status) {
      case "installed":
      case "registered":
        icon = "✅";
        label = def.local_install ? "installed" : "registered";
        break;
      case "not_registered":
        icon = "⚠️";
        label = "not registered (default server — run setup)";
        allPassed = false;
        break;
      case "not_installed":
        icon = "❌";
        label = "not installed";
        allPassed = false;
        break;
      default:
        icon = "➖";
        label = "available (optional)";
    }
    const defaultTag = def.default ? " [default]" : " [optional]";
    console.log(`    ${icon} ${name}${defaultTag} — ${label}`);
  }

  console.log(allPassed ? "\n✅ 모든 검사 통과!" : "\n⚠️ 일부 항목 수정 필요");
  process.exit(allPassed ? 0 : 1);
}

function runRepairGeminiMcp() {
  const installArgs = ["--yes", "--package", "@dmsdc-ai/aigentry-deliberation", "deliberation-install"];
  const doctorArgs = ["--yes", "--package", "@dmsdc-ai/aigentry-deliberation", "deliberation-doctor"];

  console.log("🔧 Re-registering Gemini local MCP through canonical deliberation installer...\n");
  const installResult = spawnSync("npx", installArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (installResult.status !== 0) {
    console.error("\n❌ deliberation-install failed");
    process.exit(installResult.status == null ? 1 : installResult.status);
  }

  console.log("\n🩺 Running deliberation-doctor...\n");
  const doctorResult = spawnSync("npx", doctorArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  process.exit(doctorResult.status == null ? 1 : doctorResult.status);
}

function runUpdate(options = {}) {
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
  runInstall({ ...options, force: true });
}

function runStatus() {
  const modulesDir = path.join(rootDir, "config", "modules");
  let adapterFiles = [];
  try {
    adapterFiles = fs.readdirSync(modulesDir).filter((f) => f.endsWith(".adapter.json"));
  } catch {
    process.stderr.write(`Cannot read modules directory: ${modulesDir}\n`);
    process.exit(1);
  }

  if (adapterFiles.length === 0) {
    process.stdout.write("No module adapters found.\n");
    return;
  }

  const COL_NAME = 20;
  const COL_VERSION = 20;
  const COL_STATUS = 12;
  const header =
    "Module".padEnd(COL_NAME) +
    "Version".padEnd(COL_VERSION) +
    "Health";
  const separator = "-".repeat(COL_NAME + COL_VERSION + COL_STATUS);

  process.stdout.write(`\naigentry-devkit module status\n\n`);
  process.stdout.write(`${header}\n${separator}\n`);

  for (const file of adapterFiles.sort()) {
    const adapter = readJson(path.join(modulesDir, file));
    if (!adapter) continue;

    const name = adapter.name || file.replace(".adapter.json", "");
    const version = adapter.version || "unknown";
    const healthcheck = adapter.healthcheck && adapter.healthcheck.command;

    let health = "unknown";
    if (!healthcheck) {
      health = "no-healthcheck";
    } else {
      const parts = healthcheck.split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);
      const result = spawnSync(cmd, args, {
        stdio: "pipe",
        shell: process.platform === "win32",
        timeout: adapter.healthcheck.timeout_ms || 10000,
      });
      if (result.error || result.status === null) {
        health = "not-installed";
      } else if (result.status === 0) {
        health = "healthy";
      } else {
        health = "unhealthy";
      }
    }

    const healthLabel =
      health === "healthy"
        ? "healthy"
        : health === "not-installed"
        ? "not-installed"
        : health === "no-healthcheck"
        ? "no-healthcheck"
        : "unhealthy";

    process.stdout.write(
      name.padEnd(COL_NAME) +
        version.padEnd(COL_VERSION) +
        healthLabel +
        "\n"
    );
  }

  process.stdout.write("\n");
}

function runInit() {
  const configDir = path.join(HOME, ".config", "aigentry");
  const templateSrc = path.join(rootDir, "config", "aigentry.yml.template");
  const configDest = path.join(configDir, "aigentry.yml");

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    process.stdout.write(`Created directory: ${configDir}\n`);
  } else {
    process.stdout.write(`Directory already exists: ${configDir}\n`);
  }

  if (fs.existsSync(configDest)) {
    process.stdout.write(`Config already exists, skipping: ${configDest}\n`);
  } else if (fs.existsSync(templateSrc)) {
    fs.copyFileSync(templateSrc, configDest);
    process.stdout.write(`Created config: ${configDest}\n`);
  } else {
    process.stderr.write(`Template not found: ${templateSrc}\n`);
    process.exit(1);
  }

  process.stdout.write([
    "",
    "aigentry init complete.",
    "",
    "Next steps:",
    `  1. Edit ${configDest} to enable/configure modules`,
    "  2. Run: aigentry-devkit setup   — to install all components",
    "  3. Run: aigentry-devkit status  — to verify module health",
    "",
  ].join("\n"));
}


// ── CLI Entry Point ──

const argv = process.argv.slice(2);
let command = "setup";
if (argv.length > 0 && !argv[0].startsWith("-")) {
  command = argv.shift();
}
let parsed;
try {
  parsed = parseCommandArgs(argv);
} catch (error) {
  process.stderr.write(`${error.message}\n\n`);
  printHelp();
  process.exit(1);
}
const { options, extras } = parsed;

if (extras.length > 0 && command !== "session" && command !== "workspace-init" && command !== "scaffold" && command !== "breakdown") {
  process.stderr.write(`Unexpected arguments: ${extras.join(" ")}\n\n`);
  printHelp();
  process.exit(1);
}

if (command === "scaffold" && options.help) {
  if (extras[0] === "install-hooks") {
    const { run: runScaffoldInstallHooks } = require("../lib/scaffold/install-hooks/dispatcher");
    process.exit(runScaffoldInstallHooks(extras, { ...options, help: true }));
  } else {
    printScaffoldHelp();
    process.exit(0);
  }
}

if (command === "help" || options.help) {
  printHelp();
  process.exit(0);
}

emitModuleEvent("module_load", { entry: "aigentry-devkit", command, argc: argv.length });

try {
  switch (command) {
    case "profiles":
      printProfiles(options);
      break;
    case "install":
    case "setup":
      runInstall(options);
      break;
    case "doctor":
      if (options.skills) {
        runDoctorSkills();
      } else {
        runDoctor();
      }
      break;
    case "repair-gemini-mcp":
      runRepairGeminiMcp();
      break;
    case "update":
      runUpdate(options);
      break;
    case "status":
      runStatus();
      break;
    case "init":
      runInit();
      break;
    case "scaffold": {
      if (extras[0] === "install-hooks") {
        const { run: runScaffoldInstallHooks } = require("../lib/scaffold/install-hooks/dispatcher");
        process.exit(runScaffoldInstallHooks(extras, options));
      }
      let scaffoldOpts;
      try {
        scaffoldOpts = parseProjectArgv(extras, options);
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(error.exitCode || 2);
      }
      const result = scaffoldProject(scaffoldOpts);
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
      break;
    }
    case "workspace-init": {
      let wiArgs;
      try {
        wiArgs = parseProjectArgv(extras, options);
      } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exit(error.exitCode || 2);
      }
      const result = workspaceInit(wiArgs);
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
      break;
    }
    // #773 — `up/start/stop/session` removed: telepty owns session lifecycle
    // and bin/open-session.sh owns terminal spawning. Point users at those.
    case "up":
    case "start":
    case "stop":
    case "session":
      process.stderr.write(
        `'aigentry-devkit ${command}' was removed.\n` +
        "  Session lifecycle (create/list/kill/inject): telepty\n" +
        "  Terminal spawning: bin/open-session.sh\n"
      );
      process.exit(1);
      break;
    case "bootstrap": {
      const { bootstrap } = require("../lib/bootstrap");
      bootstrap();
      break;
    }
    case "breakdown": {
      const { runBreakdown } = require("../lib/breakdown");
      const bArgs = {};
      const bAll = [...extras];
      for (let i = 0; i < bAll.length; i++) {
        if (bAll[i] === "--task-id" && bAll[i + 1]) {
          bArgs.taskId = parseInt(bAll[++i], 10);
        } else if (bAll[i] === "--cwd" && bAll[i + 1]) {
          bArgs.cwd = bAll[++i];
        }
      }
      if (options["task-id"]) bArgs.taskId = parseInt(options["task-id"], 10);
      if (options.cwd) bArgs.cwd = options.cwd;
      runBreakdown(bArgs);
      break;
    }
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      printHelp();
      process.exit(1);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
