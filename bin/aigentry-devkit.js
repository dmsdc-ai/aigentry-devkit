#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { loadLicense, generateFreeLicense, getCurrentTier, checkEntitlement, getTierInfo, LICENSE_PATH } = require("../lib/entitlement");

const rootDir = path.resolve(__dirname, "..");
const HOME = process.env.HOME || process.env.USERPROFILE || "";
const defaultManifestPath = path.join(rootDir, "config", "installer-manifest.json");

function findKittySocket() {
  const { readdirSync, statSync } = require("fs");
  try {
    const files = readdirSync("/tmp").filter((f) => f.startsWith("kitty-sock"));
    for (const f of files) {
      const sockPath = `/tmp/${f}`;
      try {
        const st = statSync(sockPath);
        if (st.isSocket()) return sockPath;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

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
    "  aigentry-devkit repair-gemini-mcp   Re-run canonical Gemini MCP registration for deliberation",
    "  aigentry-devkit update [options]    Update to latest version",
    "  aigentry-devkit status              Show health status of all modules",
    "  aigentry-devkit init                Initialize ~/.config/aigentry/ config directory",
    "  aigentry-devkit up                  Start enabled modules (telepty daemon, health checks)",
    "  aigentry-devkit start              Start all workspace sessions (kitty/tmux tabs)",
    "  aigentry-devkit stop               Stop all workspace sessions",
    "  aigentry-devkit demo                Run 5-minute guided demo walkthrough",
    "  aigentry-devkit session <cmd>        Manage sessions (create/list/kill/inject)",
    "  aigentry-devkit tier                Show current license tier and features",
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
    "  npx @dmsdc-ai/aigentry-devkit install --profile autoresearch-public",
    "  npx @dmsdc-ai/aigentry-devkit profiles",
    "  npx @dmsdc-ai/aigentry-devkit doctor",
    "  npx @dmsdc-ai/aigentry-devkit repair-gemini-mcp",
    "  npx @dmsdc-ai/aigentry-devkit update",
    "  npx @dmsdc-ai/aigentry-devkit status",
    "  npx @dmsdc-ai/aigentry-devkit init",
    "  npx @dmsdc-ai/aigentry-devkit up",
    "  npx @dmsdc-ai/aigentry-devkit demo",
    "  aigentry start                     Start full ecosystem (one-click)",
    "  aigentry stop                      Stop all sessions",
    "  aigentry session create aigentry-amplify",
    "  aigentry session inject aigentry-amplify-claude \"implement the plan\"",
  ].join("\n");
  process.stdout.write(`${text}\n`);
}

function commandExists(command) {
  const checker = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(checker, [command], { stdio: "ignore" });
  return result.status === 0;
}

function detectTerminal() {
  if (process.env.KITTY_PID || process.env.KITTY_WINDOW_ID) return "kitty";
  if (process.env.TMUX) return "tmux";
  return null;
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

  // Generate free license if none exists
  if (!loadLicense()) {
    const license = generateFreeLicense();
    process.stdout.write(`\n✅ License generated: ${getTierInfo(license.tier).display_name} tier\n`);
    process.stdout.write(`   License: ${LICENSE_PATH}\n`);
  }
}

function runDoctor() {
  const checks = [
    {
      name: "License file",
      test: () => !!loadLicense(),
      fix: "Run 'aigentry setup' to generate a license",
    },
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
    "  3. Run: aigentry-devkit up      — to start enabled modules",
    "  4. Run: aigentry-devkit status  — to verify module health",
    "",
  ].join("\n"));
}

function readAigentrYml() {
  const locations = [
    path.join(process.cwd(), "aigentry.yml"),
    path.join(HOME, ".config", "aigentry", "aigentry.yml"),
  ];
  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      try {
        // Simple key: value YAML parser for flat module.enabled checks
        const raw = fs.readFileSync(loc, "utf-8");
        return { raw, path: loc };
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function isModuleEnabled(raw, moduleName) {
  if (!raw) return true; // default enabled when no config
  // Look for:  <moduleName>:\n    enabled: true
  const re = new RegExp(
    `^\\s*${moduleName}:\\s*\\n(?:[^\\n]*\\n)*?\\s*enabled:\\s*(true|false)`,
    "m"
  );
  const match = raw.match(re);
  if (!match) return true; // not explicitly set → assume enabled
  return match[1] === "true";
}

function parseWorkspace(raw) {
  if (!raw) return null;

  const wsIdx = raw.search(/^workspace:\s*$/m);
  if (wsIdx === -1) return null;

  const afterWs = raw.slice(wsIdx + raw.slice(wsIdx).indexOf("\n") + 1);
  const nextTopLevel = afterWs.search(/^\S/m);
  const wsBlock = nextTopLevel === -1 ? afterWs : afterWs.slice(0, nextTopLevel);

  const getValue = (key) => {
    const m = wsBlock.match(new RegExp(`^\\s+${key}:\\s*["']?(.+?)["']?\\s*$`, "m"));
    return m ? m[1] : null;
  };

  const root = (getValue("root") || "").replace(/^~/, HOME);
  const aiCli = getValue("ai_cli") || "claude";
  const autoPermissions = getValue("auto_permissions") === "true";
  const orchestrator = getValue("orchestrator") || null;

  const sessions = [];
  const sessIdx = wsBlock.search(/^\s+sessions:\s*$/m);
  if (sessIdx !== -1) {
    const afterSess = wsBlock.slice(sessIdx + wsBlock.slice(sessIdx).indexOf("\n") + 1);
    for (const line of afterSess.split("\n")) {
      const m = line.match(/^\s+-\s+["']?(.+?)["']?\s*$/);
      if (m) {
        sessions.push(m[1]);
      } else if (line.trim() && !line.match(/^\s*#/) && !line.match(/^\s+-/)) {
        break;
      }
    }
  }

  return { root, aiCli, autoPermissions, orchestrator, sessions };
}

function autoDetectWorkspace() {
  const projectsDir = path.join(HOME, "projects");
  if (!fs.existsSync(projectsDir)) return null;

  let dirs;
  try {
    dirs = fs.readdirSync(projectsDir).filter((d) => {
      const full = path.join(projectsDir, d);
      return d.startsWith("aigentry-") && fs.statSync(full).isDirectory();
    });
  } catch {
    return null;
  }

  if (dirs.length === 0) return null;

  return {
    root: projectsDir,
    aiCli: "claude",
    autoPermissions: false,
    orchestrator: dirs.find((d) => d.includes("orchestrator")) || null,
    sessions: dirs.sort(),
  };
}

function runUp() {
  const cfg = readAigentrYml();
  if (cfg) {
    process.stdout.write(`Using config: ${cfg.path}\n\n`);
  } else {
    process.stdout.write("No aigentry.yml found. Using defaults (all modules enabled).\n");
    process.stdout.write("Run 'aigentry-devkit init' to create a config file.\n\n");
  }

  const raw = cfg ? cfg.raw : null;

  // Start telepty daemon if enabled
  if (isModuleEnabled(raw, "telepty")) {
    if (commandExists("telepty")) {
      process.stdout.write("Starting telepty daemon...\n");
      const result = spawnSync("telepty", ["daemon"], {
        stdio: "inherit",
        shell: process.platform === "win32",
        timeout: 10000,
      });
      if (result.error) {
        process.stdout.write(`  Warning: telepty daemon may not have started (${result.error.message})\n`);
      } else {
        process.stdout.write("  telepty daemon started (or already running).\n");
      }
    } else {
      process.stdout.write("  telepty not installed. Run: npm install -g @dmsdc-ai/aigentry-telepty\n");
    }
  } else {
    process.stdout.write("telepty: disabled (skipping)\n");
  }

  process.stdout.write("\nRunning health checks...\n");
  runStatus();
}

function runStart() {
  const cfg = readAigentrYml();
  const raw = cfg ? cfg.raw : null;
  let workspace = parseWorkspace(raw);

  if (!workspace || workspace.sessions.length === 0) {
    process.stdout.write("No workspace config found. Auto-detecting aigentry-* projects...\n");
    workspace = autoDetectWorkspace();
  }

  if (!workspace || workspace.sessions.length === 0) {
    process.stderr.write([
      "No aigentry projects found.",
      "",
      "Either:",
      "  1. Add a workspace section to aigentry.yml (aigentry-devkit init)",
      "  2. Create aigentry-* directories in ~/projects/",
      "",
    ].join("\n"));
    process.exit(1);
  }

  process.stdout.write([
    "",
    "aigentry start",
    "==============",
    "",
    `  Root:         ${workspace.root}`,
    `  AI CLI:       ${workspace.aiCli}`,
    `  Sessions:     ${workspace.sessions.length}`,
    `  Orchestrator: ${workspace.orchestrator || "(none)"}`,
    `  Permissions:  ${workspace.autoPermissions ? "auto" : "manual"}`,
    "",
  ].join("\n"));

  // 1. Start telepty daemon
  if (isModuleEnabled(raw, "telepty") && commandExists("telepty")) {
    process.stdout.write("Starting telepty daemon...\n");
    spawnSync("telepty", ["daemon"], { stdio: "pipe", timeout: 5000 });
    process.stdout.write("  telepty daemon ready.\n\n");
  } else if (!commandExists("telepty")) {
    process.stderr.write([
      "telepty not installed. Sessions require telepty.",
      "  npm install -g @dmsdc-ai/aigentry-telepty",
      "",
    ].join("\n"));
    process.exit(1);
  }

  // 2. Detect terminal
  const terminal = detectTerminal();

  // 3. Detect kitty socket for remote control
  let kittyOk = false;
  let kittySock = null;
  if (terminal === "kitty") {
    kittySock = findKittySocket();
    if (kittySock) {
      const test = spawnSync("kitty", ["@", "--to", `unix:${kittySock}`, "ls"], { stdio: "pipe", timeout: 3000 });
      kittyOk = test.status === 0;
    }
    if (!kittyOk) {
      process.stdout.write([
        "  kitty detected but no reachable socket found.",
        "  Add to kitty.conf:",
        "    allow_remote_control yes",
        "    listen_on unix:/tmp/kitty-sock",
        "",
        "  Falling back to manual mode.",
        "",
      ].join("\n"));
    }
  }

  const useKitty = terminal === "kitty" && kittyOk;
  const useTmux = !useKitty && terminal === "tmux";
  const modeLabel = useKitty ? "kitty tabs" : useTmux ? "tmux windows" : "manual";
  process.stdout.write(`  Launch mode: ${modeLabel}\n\n`);

  // 4. Build sessions
  const root = workspace.root;
  const aiCli = workspace.aiCli;
  const sessions = workspace.sessions.map((name) => ({
    name,
    id: `${name}-${aiCli}`,
    dir: path.join(root, name),
    isOrchestrator: name === workspace.orchestrator,
  }));

  // 5. Validate directories
  for (const session of sessions) {
    if (!fs.existsSync(session.dir)) {
      process.stdout.write(`  skip: ${session.name} (directory not found: ${session.dir})\n`);
      session.skip = true;
    }
  }

  const active = sessions.filter((s) => !s.skip);
  if (active.length === 0) {
    process.stderr.write("No valid session directories found.\n");
    process.exit(1);
  }

  // 6. Sort: orchestrator last (so other tabs spawn first)
  const bgSessions = active.filter((s) => !s.isOrchestrator);
  const orchSession = active.find((s) => s.isOrchestrator);

  // 7. Build session command
  const teleptyPath = resolveFullPath("telepty");
  const aiCliPath = resolveFullPath(aiCli);

  const buildSessionCmd = (session) => {
    const parts = ["telepty", "allow", "--id", session.id, aiCli];
    if (workspace.autoPermissions) parts.push("--dangerously-skip-permissions");
    return parts;
  };

  const buildKittySessionArgs = (session) => {
    const parts = [process.execPath, teleptyPath, "allow", "--id", session.id, aiCliPath];
    if (workspace.autoPermissions) parts.push("--dangerously-skip-permissions");
    return [
      "--env", "TELEPTY_SESSION_ID=",
      "--env", `PATH=${process.env.PATH}`,
      "--", ...parts,
    ];
  };

  // 8. Launch background sessions
  for (const session of bgSessions) {
    const cmd = buildSessionCmd(session);
    process.stdout.write(`  launching: ${session.name} (${session.id})\n`);

    if (useKitty) {
      const kittyArgs = buildKittySessionArgs(session);
      const result = spawnSync("kitty", [
        "@", "--to", `unix:${kittySock}`,
        "launch",
        "--type=tab",
        "--tab-title", session.name,
        "--cwd", session.dir,
        ...kittyArgs,
      ], { stdio: "pipe", timeout: 5000 });
      if (result.status !== 0) {
        process.stdout.write(`    warning: kitty tab launch failed for ${session.name}\n`);
      }
    } else if (useTmux) {
      spawnSync("tmux", [
        "new-window", "-d",
        "-n", session.name,
        "-c", session.dir,
        cmd.join(" "),
      ], { stdio: "pipe", timeout: 5000 });
    } else {
      process.stdout.write(`    cd ${session.dir} && ${cmd.join(" ")}\n`);
    }
  }

  // 9. Launch orchestrator
  if (orchSession) {
    const cmd = buildSessionCmd(orchSession);

    if (useKitty || useTmux) {
      process.stdout.write(`  launching: ${orchSession.name} (orchestrator)\n`);
      if (useKitty) {
        const kittyArgs = buildKittySessionArgs(orchSession);
        spawnSync("kitty", [
          "@", "--to", `unix:${kittySock}`,
          "launch",
          "--type=tab",
          "--tab-title", orchSession.name,
          "--cwd", orchSession.dir,
          ...kittyArgs,
        ], { stdio: "pipe", timeout: 5000 });
        // Focus the orchestrator tab
        spawnSync("kitty", ["@", "--to", `unix:${kittySock}`, "focus-tab", "--match", `title:${orchSession.name}`], {
          stdio: "pipe",
          timeout: 3000,
        });
      } else {
        spawnSync("tmux", [
          "new-window",
          "-n", orchSession.name,
          "-c", orchSession.dir,
          cmd.join(" "),
        ], { stdio: "pipe", timeout: 5000 });
      }

      process.stdout.write([
        "",
        `${active.length} sessions launched.`,
        "Switch tabs to interact with each session.",
        "",
      ].join("\n"));
    } else {
      // No terminal multiplexer — print all commands, then exec into orchestrator
      process.stdout.write([
        "",
        `  orchestrator: cd ${orchSession.dir} && ${cmd.join(" ")}`,
        "",
        "Launching orchestrator in current terminal...",
        "",
      ].join("\n"));
      const result = spawnSync(cmd[0], cmd.slice(1), {
        stdio: "inherit",
        cwd: orchSession.dir,
      });
      process.exit(result.status == null ? 1 : result.status);
    }
  } else {
    process.stdout.write([
      "",
      `${active.length} sessions launched.`,
      "",
    ].join("\n"));
  }
}

function runStop() {
  const cfg = readAigentrYml();
  const raw = cfg ? cfg.raw : null;
  let workspace = parseWorkspace(raw);

  if (!workspace || workspace.sessions.length === 0) {
    workspace = autoDetectWorkspace();
  }

  if (!workspace || workspace.sessions.length === 0) {
    process.stderr.write("No workspace config found.\n");
    process.exit(1);
  }

  process.stdout.write("aigentry stop\n\n");

  const aiCli = workspace.aiCli;
  let stopped = 0;

  for (const name of workspace.sessions) {
    const sessionId = `${name}-${aiCli}`;
    if (commandExists("telepty")) {
      const result = spawnSync("telepty", ["kill", "--id", sessionId], {
        stdio: "pipe",
        timeout: 5000,
      });
      if (result.status === 0) {
        process.stdout.write(`  stopped: ${sessionId}\n`);
        stopped++;
      } else {
        process.stdout.write(`  skip: ${sessionId} (not running)\n`);
      }
    }
  }

  process.stdout.write(`\n${stopped} sessions stopped.\n`);
}

function runSession(subcommand, args) {
  if (!subcommand || subcommand === "help") {
    process.stdout.write([
      "aigentry session — dynamic session management",
      "",
      "Usage:",
      "  aigentry session create <project-name>    Create new session (opens kitty terminal)",
      "  aigentry session list                      List active telepty sessions",
      "  aigentry session kill <project-name>       Kill a session",
      "  aigentry session inject <project-name> <message>  Send task to session",
      "",
      "Examples:",
      "  aigentry session create aigentry-amplify",
      "  aigentry session list",
      "  aigentry session inject aigentry-amplify-claude \"implement the plan\"",
      "  aigentry session kill aigentry-amplify",
      "",
    ].join("\n"));
    return;
  }

  const sessionCfg = readAigentrYml();
  const sessionRaw = sessionCfg ? sessionCfg.raw : null;
  const sessionWorkspace = parseWorkspace(sessionRaw);
  const aiCli = sessionWorkspace ? sessionWorkspace.aiCli : "claude";

  switch (subcommand) {
    case "create": {
      const projectName = args[0];
      if (!projectName) {
        process.stderr.write("Missing project name. Usage: aigentry session create <project-name>\n");
        process.exit(1);
      }

      const projectDir = path.join(HOME, "projects", projectName);
      const sessionId = `${projectName}-${aiCli}`;

      // 1. Create directory if not exists
      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
        process.stdout.write(`Created directory: ${projectDir}\n`);
      }

      // 2. Detect terminal and open new tab/window
      const kSock = findKittySocket();
      const useKitty = !!kSock;
      const teleptyPath = resolveFullPath("telepty");
      const cliPath = resolveFullPath(aiCli);
      const nodeExec = process.execPath;
      const currentPath = process.env.PATH || "";

      if (useKitty) {
        process.stdout.write(`Opening kitty tab for ${projectName} (socket: ${kSock})...\n`);
        const result = spawnSync("kitty", [
          "@", "--to", `unix:${kSock}`,
          "launch",
          "--type=tab",
          "--tab-title", projectName,
          "--cwd", projectDir,
          "--env", "TELEPTY_SESSION_ID=",
          "--env", `PATH=${currentPath}`,
          "--", nodeExec, teleptyPath, "allow", "--id", sessionId, cliPath, "--dangerously-skip-permissions",
        ], { stdio: "pipe" });

        if (result.status !== 0) {
          // Fallback: spawn new kitty process
          process.stdout.write("  Socket launch failed, spawning new kitty process...\n");
          const fallback = spawnSync("kitty", [
            "--directory", projectDir,
            "-e", nodeExec, teleptyPath, "allow", "--id", sessionId, cliPath, "--dangerously-skip-permissions",
          ], { stdio: "pipe", detached: true, env: { ...process.env, TELEPTY_SESSION_ID: "" } });
          if (fallback.error) {
            process.stderr.write(`Failed to open kitty: ${fallback.error.message}\n`);
            process.exit(1);
          }
        }
      } else if (process.env.TMUX) {
        process.stdout.write(`Creating tmux window for ${projectName}...\n`);
        spawnSync("tmux", [
          "new-window", "-d",
          "-n", projectName,
          "-c", projectDir,
          `${teleptyPath} allow --id ${sessionId} ${cliPath} --dangerously-skip-permissions`,
        ], { stdio: "pipe" });
      } else {
        process.stdout.write([
          `Directory ready: ${projectDir}`,
          "",
          "Run manually in a new terminal:",
          `  cd ${projectDir}`,
          `  ${teleptyPath} allow --id ${sessionId} ${cliPath} --dangerously-skip-permissions`,
          "",
        ].join("\n"));
        return;
      }

      process.stdout.write([
        `Session: ${sessionId}`,
        `Directory: ${projectDir}`,
        "",
        "Waiting for session registration...",
        "Once registered, inject tasks with:",
        `  aigentry session inject ${sessionId} "your task here"`,
        "",
      ].join("\n"));
      break;
    }

    case "list": {
      if (!commandExists("telepty")) {
        process.stderr.write("telepty not installed.\n");
        process.exit(1);
      }
      const result = spawnSync("telepty", ["list"], { stdio: "inherit" });
      process.exit(result.status || 0);
      break;
    }

    case "kill": {
      const target = args[0];
      if (!target) {
        process.stderr.write("Missing project/session name. Usage: aigentry session kill <name>\n");
        process.exit(1);
      }
      const killId = target.includes(`-${aiCli}`) ? target : `${target}-${aiCli}`;

      if (!commandExists("telepty")) {
        process.stderr.write("telepty not installed.\n");
        process.exit(1);
      }

      const result = spawnSync("telepty", ["kill", "--id", killId], { stdio: "pipe" });
      if (result.status === 0) {
        process.stdout.write(`Killed session: ${killId}\n`);
      } else {
        process.stderr.write(`Session not found or already stopped: ${killId}\n`);
        process.exit(1);
      }
      break;
    }

    case "inject": {
      const targetSession = args[0];
      const message = args.slice(1).join(" ");
      if (!targetSession || !message) {
        process.stderr.write("Usage: aigentry session inject <session-id> <message>\n");
        process.exit(1);
      }

      if (!commandExists("telepty")) {
        process.stderr.write("telepty not installed.\n");
        process.exit(1);
      }

      const result = spawnSync("telepty", ["inject", targetSession, message], { stdio: "inherit" });
      process.exit(result.status || 0);
      break;
    }

    default:
      process.stderr.write(`Unknown session subcommand: ${subcommand}\n`);
      runSession("help", []);
      process.exit(1);
  }
}

function runDemo() {
  const lines = [
    "",
    "aigentry 5-minute demo walkthrough",
    "===================================",
    "",
    "This demo shows the key aigentry capabilities:",
    "  - Multi-LLM deliberation (claude + codex + gemini)",
    "  - Structured debate rounds",
    "  - Synthesized conclusions",
    "",
    "Prerequisites",
    "-------------",
    "",
  ];

  const nodeOk = (() => {
    const v = process.versions.node.split(".").map(Number);
    return v[0] >= 18;
  })();
  lines.push(`  Node.js 18+    : ${nodeOk ? "OK" : "MISSING — install from https://nodejs.org/"}`);

  const teleptyOk = commandExists("telepty");
  lines.push(`  telepty        : ${teleptyOk ? "OK" : "not installed (optional for transport)"}`);

  const deliberationOk = fs.existsSync(
    path.join(HOME, ".local", "lib", "mcp-deliberation", "index.js")
  );
  lines.push(`  deliberation   : ${deliberationOk ? "installed" : "not installed — run: aigentry-devkit setup"}`);

  const deliberationCliAvailable = (() => {
    const result = spawnSync(
      "npx",
      ["--yes", "--package", "@dmsdc-ai/aigentry-deliberation", "deliberation-cli", "--help"],
      { stdio: "pipe", shell: process.platform === "win32", timeout: 15000 }
    );
    return result.status === 0;
  })();
  lines.push(`  deliberation-cli: ${deliberationCliAvailable ? "available via npx" : "not available (will show manual commands)"}`);

  lines.push("");
  lines.push("Demo: Multi-LLM deliberation on testing strategy");
  lines.push("-------------------------------------------------");
  lines.push("");
  lines.push('Topic: "aigentry demo: which testing strategy is best for a CLI tool?"');
  lines.push("Speakers: claude, codex, gemini");
  lines.push("Rounds: 2");
  lines.push("");

  if (deliberationCliAvailable) {
    process.stdout.write(lines.join("\n") + "\n");
    process.stdout.write("Running live deliberation...\n\n");

    const topic = "aigentry demo: which testing strategy is best for a CLI tool?";
    const speakers = ["claude", "codex", "gemini"];

    // Step 1: Start deliberation
    process.stdout.write("Step 1/4  Starting deliberation...\n");
    const startResult = spawnSync(
      "npx",
      [
        "--yes",
        "--package", "@dmsdc-ai/aigentry-deliberation",
        "deliberation-cli",
        "start",
        "--topic", topic,
        "--speakers", speakers.join(","),
      ],
      { stdio: "inherit", shell: process.platform === "win32", timeout: 30000 }
    );
    if (startResult.status !== 0) {
      process.stdout.write("\nCould not start deliberation. Falling back to guided walkthrough.\n\n");
      printDemoGuide(topic, speakers);
      return;
    }

    // Step 2: Round 1
    process.stdout.write("\nStep 2/4  Running round 1...\n");
    spawnSync(
      "npx",
      [
        "--yes",
        "--package", "@dmsdc-ai/aigentry-deliberation",
        "deliberation-cli",
        "run",
        "--rounds", "1",
      ],
      { stdio: "inherit", shell: process.platform === "win32", timeout: 60000 }
    );

    // Step 3: Round 2
    process.stdout.write("\nStep 3/4  Running round 2...\n");
    spawnSync(
      "npx",
      [
        "--yes",
        "--package", "@dmsdc-ai/aigentry-deliberation",
        "deliberation-cli",
        "run",
        "--rounds", "1",
      ],
      { stdio: "inherit", shell: process.platform === "win32", timeout: 60000 }
    );

    // Step 4: Synthesize
    process.stdout.write("\nStep 4/4  Synthesizing results...\n");
    spawnSync(
      "npx",
      [
        "--yes",
        "--package", "@dmsdc-ai/aigentry-deliberation",
        "deliberation-cli",
        "synthesize",
      ],
      { stdio: "inherit", shell: process.platform === "win32", timeout: 30000 }
    );

    process.stdout.write([
      "",
      "Demo complete.",
      "",
      "What you just saw:",
      "  - Three LLMs debated a question in structured rounds",
      "  - Each speaker built on prior arguments",
      "  - A synthesized conclusion was produced automatically",
      "",
      "Next steps:",
      "  aigentry-devkit init    — set up your config",
      "  aigentry-devkit setup   — install all components",
      "  aigentry-devkit up      — start the stack",
      "  aigentry-devkit status  — check module health",
      "",
    ].join("\n"));
  } else {
    process.stdout.write(lines.join("\n") + "\n");
    printDemoGuide(
      "aigentry demo: which testing strategy is best for a CLI tool?",
      ["claude", "codex", "gemini"]
    );
  }
}

function printDemoGuide(topic, speakers) {
  const speakersStr = speakers.join(",");
  process.stdout.write([
    "Guided walkthrough — run these commands yourself:",
    "",
    "  # 1. Install deliberation",
    "  npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-install",
    "",
    "  # 2. Start a deliberation session",
    `  npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-cli \\`,
    `    start --topic "${topic}" \\`,
    `    --speakers ${speakersStr}`,
    "",
    "  # 3. Run 2 rounds (run this command twice)",
    "  npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-cli run --rounds 1",
    "",
    "  # 4. Synthesize the results",
    "  npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-cli synthesize",
    "",
    "  # 5. View full history",
    "  npx --yes --package @dmsdc-ai/aigentry-deliberation deliberation-cli history",
    "",
    "Or use the MCP tools inside Claude Code:",
    "  deliberation_start, deliberation_run_until_blocked, deliberation_synthesize",
    "",
    "Next steps:",
    "  aigentry-devkit init    — set up your config",
    "  aigentry-devkit setup   — install all components",
    "  aigentry-devkit up      — start the stack",
    "  aigentry-devkit status  — check module health",
    "",
  ].join("\n"));
}

function runTier() {
  const tier = getCurrentTier();
  const info = getTierInfo(tier);
  const license = loadLicense();

  process.stdout.write(`\n  Tier: ${info.display_name}\n`);
  if (license) {
    process.stdout.write(`  Licensed: ${license.issued_at}\n`);
    if (license.expires_at) {
      process.stdout.write(`  Expires: ${license.expires_at}\n`);
    }
  } else {
    process.stdout.write(`  No license file. Run 'aigentry setup' to generate.\n`);
  }

  process.stdout.write(`\n  Features:\n`);
  const features = require("../lib/entitlement").getFeaturesForTier(tier);
  for (const f of features) {
    process.stdout.write(`    ✅ ${f}\n`);
  }

  const allFeatures = Object.keys(require("../lib/entitlement").FEATURES);
  const locked = allFeatures.filter(f => !features.includes(f));
  if (locked.length > 0) {
    process.stdout.write(`\n  Locked (upgrade to Pro):\n`);
    for (const f of locked.slice(0, 10)) {
      process.stdout.write(`    🔒 ${f}\n`);
    }
    if (locked.length > 10) {
      process.stdout.write(`    ... and ${locked.length - 10} more\n`);
    }
    process.stdout.write(`\n  Upgrade: https://aigentry.dev/upgrade\n`);
  }
  process.stdout.write(`\n`);
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

if (extras.length > 0 && command !== "session") {
  process.stderr.write(`Unexpected arguments: ${extras.join(" ")}\n\n`);
  printHelp();
  process.exit(1);
}

if (command === "help" || options.help) {
  printHelp();
  process.exit(0);
}

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
      runDoctor();
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
    case "up":
      runUp();
      break;
    case "demo":
      runDemo();
      break;
    case "start":
      runStart();
      break;
    case "stop":
      runStop();
      break;
    case "session":
      runSession(extras[0], extras.slice(1));
      break;
    case "tier":
      runTier();
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      printHelp();
      process.exit(1);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
