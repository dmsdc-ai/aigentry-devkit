"use strict";

// Major 1: run(argv: string[], io?: {stdin, stdout, stderr}) -> Promise<number>.
// Import is inert. Only run reads metadata; no subprocess, socket, logger,
// credential parser, installer or dynamic adapter is reachable from this module.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const state = require("./install-state");
const root = path.resolve(__dirname, "..");
const contractMajor = 1;
const HELP = "setup [--profile ID --runtime defer|native-srt] --configure-only [--dry-run] [--revisit]\n" +
  "Noninteractive: --non-interactive --profile ID --runtime ID --configure-only --accept-plan SHA256\n" +
  "Installation unavailable in D1. No runtime verification. Custom manifests, commands and --yes are unsupported.\n";
const AUTH = "Authentication: not checked. Owner must separately follow the provider's official authentication documentation for the selected client/version, then use setup --revisit. No login, token provisioning or worker confinement verification is performed.\n";

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readSource(rel) {
  const file = path.join(root, rel), s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 1024 * 1024 || fs.realpathSync(file) !== file) throw Error("unsafe setup package metadata");
  return fs.readFileSync(file, "utf8");
}
function sources() {
  const names = ["package.json", "config/installer-manifest.json", "config/setup-capabilities.json", "lib/setup.js", "lib/install-state.js", "bin/aigentry-devkit.js"];
  const text = Object.fromEntries(names.map(n => [n, readSource(n)]));
  const pkg = JSON.parse(text["package.json"]);
  if (pkg.name !== "@dmsdc-ai/aigentry-devkit") throw Error("incompatible setup package");
  return { pkg: { name: pkg.name, version: pkg.version },
    manifest: JSON.parse(text["config/installer-manifest.json"]),
    catalogue: JSON.parse(text["config/setup-capabilities.json"]),
    hashes: Object.fromEntries(names.map(n => [n, digest(text[n])])) };
}
function parse(argv) {
  const flags = ["--configure-only","--dry-run","--revisit","--non-interactive","--help"];
  const values = ["--profile","--runtime","--accept-plan"];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (Object.hasOwn(opts, key) || (!flags.includes(key) && !values.includes(key))) throw Error("unsupported or duplicate setup option");
    if (values.includes(key)) {
      const value = argv[++i];
      if (typeof value !== "string" || !value || value.startsWith("-") || value.length > 128) throw Error("missing or invalid setup option value");
      opts[key] = value;
    } else opts[key] = true;
  }
  return opts;
}
function stateDir() {
  const home = process.env.HOME || process.env.USERPROFILE;
  const base = process.env.XDG_CONFIG_HOME || (home && path.join(home, ".config"));
  if (!base || !path.isAbsolute(base) || /[\x00-\x1f\x7f]/.test(base)) throw Error("absolute installer state root required");
  return path.join(base, "aigentry-devkit");
}
function fileObservation(file) {
  try {
    const s = fs.lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || fs.realpathSync(file) !== file) return { status: "unknown" };
    return { status: "detected", identity: { dev: s.dev, ino: s.ino, mode: s.mode, size: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs } };
  } catch (err) { return { status: err.code === "ENOENT" ? "missing" : "unknown" }; }
}
function detect(entry) {
  if (!entry.hosts.includes(process.platform)) return { status: "unsupported", runtime_readiness: "unknown" };
  if (entry.id === "defer") return { status: "unknown", runtime_readiness: "not-requested" };
  if (entry.id === "native-srt") return { ...fileObservation(path.join(root,"node_modules","@anthropic-ai","sandbox-runtime","package.json")), runtime_readiness: "unknown" };
  const dirs = (process.env.PATH || "").split(path.delimiter);
  let unknown = dirs.length > 32;
  const observations = [];
  for (let i = 0; i < Math.min(dirs.length, 32); i++) {
    const dir = dirs[i];
    if (!dir || dir.length > 4096 || !path.isAbsolute(dir)) { unknown = true; continue; }
    try { if (fs.realpathSync(dir) !== dir) { unknown = true; continue; } }
    catch (err) { if (err.code !== "ENOENT") unknown = true; continue; }
    for (const name of entry.executables) {
      const item = fileObservation(path.join(dir, name + (process.platform === "win32" ? ".exe" : "")));
      observations.push({ index: i, ...item });
      if (item.status === "unknown") unknown = true;
    }
  }
  return { status: observations.some(o => o.status === "detected") ? "detected" : unknown ? "unknown" : "missing",
    observations, runtime_readiness: "unknown" };
}
function planFor(opts) {
  const source = sources(), profile = opts["--profile"], runtime = opts["--runtime"];
  if (!Object.hasOwn(source.manifest.profiles, profile || "")) throw Error("explicit supported --profile required");
  const entry = source.catalogue.runtimes.find(r => r.id === runtime);
  if (!entry) throw Error("explicit supported --runtime required");
  if (!entry.preference) throw Error("runtime gated: primary-source and native evidence missing");
  if (!entry.hosts.includes(process.platform)) throw Error("runtime preference unsupported on this host");
  const dir = stateDir(), storage = state.inspectSetupStorage(dir);
  return { schema: "aigentry-devkit/setup-plan@1", contract_major: contractMajor,
    package: source.pkg, sources: source.hashes, catalogue_revision: source.catalogue.revision,
    host: { platform: process.platform, arch: process.arch, node: process.versions.node },
    selection: { profile, runtime, components: source.manifest.profiles[profile].components },
    observations: source.catalogue.runtimes.map(r => ({ id: r.id, ...detect(r) })),
    storage, recovery: { decision: "preserve; no replay or force-unlock", unresolved: storage.unresolved },
    effects: [
      { action: "create-missing-private-directories", paths: storage.ancestors.filter(a=>!a.identity).map(a=>a.path), mode: "0700" },
      { action: "exclusive-lock", path: path.join(dir, state.LOCK_NAME), mode: "0600", cleanup: "own lock only" },
      { action: "atomic-replace-journal", path: path.join(dir, state.JOURNAL_NAME), temporary: path.join(dir,state.JOURNAL_NAME + ".tmp-<pid>-<random>"), mode: "0600", preserve: "existing history; append preference attempt" },
      { action: "release-own-lock", path: path.join(dir, state.LOCK_NAME) }
    ],
    outcome: runtime === "defer" ? "deferred" : "selected", verification: "not-verified",
    runtime_actions: [], auth: "not-checked", service_privilege_network_changes: [] };
}
function showPlan(plan, stdout) {
  stdout.write("Configure-only preview: selected, not runtime-verified. No installation, runtime, service, authentication or network action.\n");
  stdout.write(JSON.stringify(plan, null, 2) + "\n");
  stdout.write("--accept-plan " + digest(canonical(plan)) + "\n");
}
function showCatalogue(stdout) {
  const {catalogue,manifest} = sources();
  stdout.write("Profiles: " + Object.keys(manifest.profiles).join(", ") + "\n");
  for (const r of catalogue.runtimes) stdout.write(r.id + ": " + (r.preference ? "preference only" : "GATED") +
    "; candidate hosts " + r.hosts.join("/") + "; architecture " + r.architecture +
    "; license/cost " + r.license_cost + "; privilege/services/data " + r.data_services_privilege + ". " + r.disclosure + "\n");
}

// An async iterator retains queued lines and EOF, unlike repeated question()
// callbacks which can lose piped input. SIGINT becomes cancellation.
async function run(argv, io = {}) {
  const stdin = io.stdin || process.stdin, stdout = io.stdout || process.stdout, stderr = io.stderr || process.stderr;
  let rl;
  try {
    const opts = parse(argv);
    if (opts["--help"]) { stdout.write(HELP + AUTH); return 0; }
    stdout.write(AUTH);
    if (opts["--revisit"]) {
      const prior = state.inspectSetupStorage(stateDir()).suggestion;
      stdout.write(prior ? "Saved suggestion only: " + prior.profile + "/" + prior.runtime + "; fresh consent required.\n" : "No saved suggestion; fresh detection required.\n");
    }
    showCatalogue(stdout);
    if (opts["--non-interactive"] || !stdin.isTTY) {
      if (!opts["--non-interactive"]) throw Error("D1 installation unavailable; use --non-interactive with explicit choices and --configure-only");
      if (!opts["--configure-only"]) throw Error("D1 installation unavailable; --configure-only required");
      const plan = planFor(opts), hash = digest(canonical(plan));
      showPlan(plan, stdout);
      if (opts["--dry-run"]) return 0;
      if (opts["--accept-plan"] !== hash) throw Error("missing or stale --accept-plan; preview again");
      const current = planFor(opts);
      if (digest(canonical(current)) !== hash) throw Error("stale plan; preview again");
      state.saveSetupChoice(stateDir(), { profile: plan.selection.profile, runtime: plan.selection.runtime,
        outcome: plan.outcome, verification: plan.verification, plan_digest: hash, catalogue_revision: plan.catalogue_revision }, plan.storage);
      stdout.write("Preference saved: " + plan.outcome + ", not runtime-verified. Local journal write only.\n");
      return 0;
    }
    const readline = require("readline");
    rl = readline.createInterface({ input: stdin, crlfDelay: Infinity, terminal: false });
    rl.on("SIGINT", () => rl.close());
    const lines = rl[Symbol.asyncIterator]();
    const ask = async prompt => {
      stdout.write(prompt);
      const next = await lines.next();
      if (next.done || next.value.trim() === "cancel" || next.value.includes("\x03")) throw Error("setup cancelled (EOF/cancel)");
      return next.value.trim();
    };
    while (true) {
      const profile = await ask("Select profile (or cancel/skip): ");
      if (profile === "skip") { stdout.write("Skipped without saving.\n"); return 0; }
      if (profile === "back") continue;
      const runtime = await ask("Select runtime preference (defer/native-srt, back/cancel/skip): ");
      if (runtime === "back") continue;
      if (runtime === "skip") { stdout.write("Skipped without saving.\n"); return 0; }
      opts["--profile"] = profile; opts["--runtime"] = runtime;
      let plan;
      try { plan = planFor(opts); } catch (err) { stderr.write("setup: " + err.message + "\n"); continue; }
      showPlan(plan, stdout);
      if (opts["--dry-run"]) return 0;
      if (!opts["--configure-only"]) {
        const answer = await ask("D1 installation unavailable. Type back to reselect or skip to leave unsaved (saving requires --configure-only): ");
        if (answer === "skip") return 0;
        continue;
      }
      const answer = await ask("To save type the exact plan digest; back to reselect, skip to leave unsaved, cancel to exit: ");
      if (answer === "back") continue;
      if (answer === "skip") return 0;
      const hash = digest(canonical(plan));
      if (answer !== hash || digest(canonical(planFor(opts))) !== hash) throw Error("missing or stale plan consent");
      state.saveSetupChoice(stateDir(), { profile, runtime, outcome: plan.outcome, verification: plan.verification,
        plan_digest: hash, catalogue_revision: plan.catalogue_revision }, plan.storage);
      stdout.write("Preference saved: " + plan.outcome + ", not runtime-verified. Local journal write only.\n");
      return 0;
    }
  } catch (err) {
    // Avoid echoing arbitrary filesystem errors, input values or raw records.
    const message = err && err.code ? "setup metadata/storage unavailable; no installation performed" : err.message;
    stderr.write("setup: " + message + "\n");
    return 1;
  } finally { if (rl) rl.close(); }
}
module.exports = { contractMajor, run };
