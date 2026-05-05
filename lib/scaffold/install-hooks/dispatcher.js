const { resolveScope } = require("../scope");

const modules = {
  claude: require("./claude"),
  codex: require("./codex"),
  gemini: require("./gemini"),
};

const orderedAll = ["claude", "codex", "gemini"];

function helpText() {
  return [
    "Usage:",
    "  aigentry scaffold install-hooks <cli> [--global|--project <path>] [--dry-run] [--uninstall] [--force] [--json] [--all]",
    "",
    "Install the [context-ref/v1] receiver hook or directive for claude, codex, gemini, or all.",
    "",
    "Flags:",
    "  --global           Install under $HOME for the selected CLI.",
    "  --project <path>   Install under a project root (default: current directory).",
    "  --dry-run          Print the changes that would be made without writing files.",
    "  --uninstall        Remove devkit-owned context-ref hook files or sentinel blocks.",
    "  --force            Overwrite a user-modified managed script or corrupted sentinel after creating a backup.",
    "  --json             Print machine-readable JSON status.",
    "  --all              Fan out sequentially to claude, codex, then gemini.",
    "",
    "Exit codes:",
    "  0  success or idempotent no-op",
    "  2  unknown CLI or invalid argument",
    "  3  scope inaccessible",
    "  4  hook installation failure",
    "",
    "Protocol reference: [context-ref/v1] ADR section 3.1.2.",
    "",
    "Examples:",
    "  aigentry scaffold install-hooks claude --project .",
    "  aigentry scaffold install-hooks codex --global --dry-run",
    "  aigentry scaffold install-hooks claude --project . --uninstall",
  ].join("\n");
}

function parseArgs(argv, inherited = {}) {
  const args = [...argv];
  if (args[0] === "install-hooks") args.shift();
  const parsed = {
    cli: null,
    all: false,
    global: false,
    project: null,
    dryRun: Boolean(inherited.dryRun),
    uninstall: false,
    force: Boolean(inherited.force),
    json: false,
    help: Boolean(inherited.help),
    errors: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--global") {
      parsed.global = true;
    } else if (arg === "--project") {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        parsed.errors.push("missing value for --project");
      } else {
        parsed.project = value;
        i += 1;
      }
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--uninstall") {
      parsed.uninstall = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--all") {
      parsed.all = true;
    } else if (arg.startsWith("-")) {
      parsed.errors.push(`unknown flag ${arg}`);
    } else if (!parsed.cli) {
      parsed.cli = arg;
    } else {
      parsed.errors.push(`unexpected argument ${arg}`);
    }
  }
  if (parsed.cli === "all") parsed.all = true;
  if (parsed.all) parsed.cli = "all";
  return parsed;
}

function normalizeResult(result) {
  const hasChange = result.files.some((file) => !["noop", "skipped"].includes(file.action));
  return {
    version: "scaffold-install-hooks/v1",
    cli: result.cli,
    scope: result.scope,
    action: result.action,
    result: result.exitCode === 0 ? (hasChange ? "ok" : "noop") : "error",
    exitCode: result.exitCode,
    files: result.files,
    diagnostics: result.diagnostics || [],
  };
}

function emitDiagnostics(stderr, result) {
  for (const item of result.diagnostics || []) {
    stderr.write(`aigentry: scaffold install-hooks ${result.cli}: ${item.severity}: ${item.message}\n`);
  }
}

function emitHuman(stdout, stderr, results, opts) {
  for (const result of results) emitDiagnostics(stderr, result);
  if (opts.dryRun) {
    let changed = 0;
    let unchanged = 0;
    for (const result of results) {
      for (const file of result.files) {
        if (file.diff) {
          changed += 1;
          stdout.write(`=== ${file.path} ===\n${file.diff}\n`);
        } else {
          unchanged += 1;
        }
      }
    }
    stdout.write(`[dry-run] ${changed} files would change; ${unchanged} unchanged.\n`);
    return;
  }
  for (const result of results) {
    for (const file of result.files) {
      stdout.write(`${file.action} ${file.path}\n`);
    }
  }
}

function executeOne(cli, scope, parsed) {
  const mod = modules[cli];
  const method = parsed.uninstall ? "uninstall" : "install";
  return mod[method](scope, {
    dryRun: parsed.dryRun,
    force: parsed.force,
    global: parsed.global,
  });
}

function run(argv, inherited = {}, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const env = io.env || process.env;
  const cwd = io.cwd || process.cwd();
  const parsed = parseArgs(argv, inherited);

  if (parsed.help || argv.length === 0 || (argv.length === 1 && argv[0] === "install-hooks")) {
    stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (parsed.errors.length > 0) {
    for (const message of parsed.errors) {
      stderr.write(`aigentry: scaffold install-hooks: error: ${message}\n`);
    }
    return 2;
  }
  if (!parsed.cli) {
    stderr.write("aigentry: scaffold install-hooks: error: missing CLI; expected one of: claude, codex, gemini, all\n");
    return 2;
  }
  if (!parsed.all && !modules[parsed.cli]) {
    stderr.write(`aigentry: scaffold install-hooks ${parsed.cli}: error: unknown CLI '${parsed.cli}'; expected one of: claude, codex, gemini, all\n`);
    return 2;
  }

  const scopeResult = resolveScope(parsed, env, cwd);
  if (scopeResult.exitCode) {
    stderr.write(`aigentry: scaffold install-hooks ${parsed.cli}: ${scopeResult.diagnostic.severity}: ${scopeResult.diagnostic.message}\n`);
    return scopeResult.exitCode;
  }

  const clis = parsed.all ? orderedAll : [parsed.cli];
  const results = clis.map((cli) => executeOne(cli, scopeResult.scope, parsed));
  const normalized = results.map(normalizeResult);
  let exitCode = Math.max(...normalized.map((result) => result.exitCode));
  if (parsed.dryRun && exitCode !== 3) exitCode = 0;

  if (parsed.json) {
    const payload = parsed.all ? { results: normalized, exitCode } : { ...normalized[0], exitCode };
    stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    emitHuman(stdout, stderr, normalized, parsed);
  }
  return exitCode;
}

module.exports = {
  helpText,
  parseArgs,
  run,
};
