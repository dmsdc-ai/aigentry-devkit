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
  "Partial local assets: --profile ID --runtime defer --install-assets skills|hud|skills,hud; preview with --dry-run, approve the exact --accept-plan SHA256.\n" +
  "Full profile installation and runtime verification unavailable. Custom manifests, commands, --force and --yes are unsupported.\n";
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
  if (!Array.isArray(argv) || argv.length > 32 || argv.some(v => typeof v !== "string")) throw Error("invalid setup arguments");
  const flags = ["--configure-only","--dry-run","--revisit","--non-interactive","--help"];
  const values = ["--profile","--runtime","--accept-plan","--install-assets"];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i] === "-h" ? "--help" : argv[i];
    if (Object.hasOwn(opts, key) || (!flags.includes(key) && !values.includes(key))) throw Error("unsupported or duplicate setup option");
    if (values.includes(key)) {
      const value = argv[++i];
      if (typeof value !== "string" || !value || value.startsWith("-") || value.length > 128) throw Error("missing or invalid setup option value");
      opts[key] = value;
    } else opts[key] = true;
  }
  if (opts["--install-assets"] && (opts["--configure-only"] || !["skills","hud","skills,hud"].includes(opts["--install-assets"]))) throw Error("invalid or conflicting asset selection");
  return opts;
}

// Filesystem observations are consent inputs, not race-free path capabilities.
// Portable lstat/rename cannot defeat malicious same-UID ancestor replacement.
function assetIdentity(file, directory, source = false) {
  let s;
  try { s = fs.lstatSync(file); } catch (err) { if (err.code === "ENOENT") return null; throw err; }
  if (s.isSymbolicLink() || (directory ? !s.isDirectory() : !s.isFile()) ||
      (s.uid !== process.getuid() && s.uid !== 0) || (s.mode & 0o022) ||
      (!directory && (s.nlink !== 1 || s.size > (source ? 1024 * 1024 : 16 * 1024 * 1024)))) {
    throw Error("unsafe asset ownership/type/mode/link/size");
  }
  return {dev:s.dev,ino:s.ino,uid:s.uid,mode:s.mode,
    ...(!directory ? {nlink:s.nlink,size:s.size,mtime:s.mtimeMs,ctime:s.ctimeMs} : {})};
}
function assetAncestors(dir) {
  if (!path.isAbsolute(dir) || path.normalize(dir) !== dir || /[\x00-\x1f\x7f]/.test(dir)) throw Error("unsafe asset path");
  const rows=[];
  let cursor=path.parse(dir).root;
  for (const part of dir.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part);
    rows.push({path:cursor,identity:assetIdentity(cursor,true)});
  }
  return rows;
}
function assetPlan(source, opts, storage) {
  if (opts["--runtime"] !== "defer") throw Error("partial assets require --runtime defer; runtime actions gated");
  const home=process.env.HOME || process.env.USERPROFILE;
  if (!home || !path.isAbsolute(home) || path.resolve(home)!==home || fs.realpathSync(home)!==home ||
      !assetIdentity(home,true) || fs.lstatSync(home).uid!==process.getuid()) throw Error("safe owned asset home required");
  if (storage.unresolved.length) throw Error("unresolved legacy phases; asset recovery/replay unavailable");
  const historyRead=state.readJournal(stateDir());
  if(historyRead.journal)for(const attempt of historyRead.journal.attempts){
    if(Object.hasOwn(attempt,"outcome") && !["running","completed","failed","unknown"].includes(attempt.outcome))throw Error("unknown asset history outcome");
    for(const rec of attempt.phases){
      if(!Object.hasOwn(state.PHASES,rec.phase) || (Object.hasOwn(rec,"partial") && typeof rec.partial!=="boolean"))throw Error("unknown asset history phase");
    }
  }
  const definition=source.catalogue.assets;
  if (!definition || Object.keys(definition).sort().join()!=="inventory,revision" || definition.revision!==1 ||
      !Array.isArray(definition.inventory) || definition.inventory.length!==39) throw Error("unsupported asset catalogue");
  const selection=opts["--install-assets"].split(","), inventory=[],seen=new Set();
  for (const f of definition.inventory) {
    if (!f || Object.keys(f).sort().join()!=="action,destinationSuffix,mode,sha256,source" ||
        typeof f.source!=="string" || typeof f.destinationSuffix!=="string" || typeof f.sha256!=="string" ||
        !/^[a-f0-9]{64}$/.test(f.sha256) || !/^[a-zA-Z0-9_.\/-]+$/.test(f.destinationSuffix) ||
        f.destinationSuffix.split("/").some(v=>!v || v==="." || v==="..")) throw Error("invalid asset catalogue entry");
    const hud=f.action==="install-bundled-hud";
    if ((!hud && f.action!=="install-bundled-skills") || f.mode!==(hud?"0700":"0600") ||
        (hud ? f.source!=="hud/simple-status.sh" || f.destinationSuffix!=="simple-status.sh" :
          !["skills/"+f.destinationSuffix,"templates/skills/"+f.destinationSuffix].includes(f.source))) throw Error("undeclared asset action");
    const key=f.action+":"+f.destinationSuffix;
    if (seen.has(key)) throw Error("duplicate asset destination");
    seen.add(key);
    if (!selection.includes(hud?"hud":"skills")) continue;
    const file=path.join(root,f.source),ancestors=assetAncestors(path.dirname(file)),identity=assetIdentity(file,false,true);
    if (!identity || fs.realpathSync(file)!==file) throw Error("missing or unsafe asset source");
    const bytes=fs.readFileSync(file);
    if (digest(bytes)!==f.sha256) throw Error("asset source digest mismatch");
    inventory.push({...f,size:bytes.length,identity,ancestors});
  }
  const clients=[{name:"claude",dir:".claude",selected:true}];
  const observations=[];
  if (selection.includes("skills")) for (const [name,dir] of [["codex",".codex"],["gemini",".gemini"],["agy",".gemini/config"],["grok",".grok"]]) {
    const config=path.join(home,dir),ancestors=assetAncestors(config);
    let selected=!!ancestors.at(-1).identity;
    const executables=[];
    if (!selected) {
      const dirs=(process.env.PATH||"").split(path.delimiter).filter(Boolean);
      if (dirs.length>32) throw Error("asset client detection unknown");
      for (const entry of dirs) {
        const parents=assetAncestors(entry),file=path.join(entry,name),identity=assetIdentity(file,false);
        if (identity && (identity.mode&0o111)) selected=true;
        executables.push({path:file,identity,ancestors:parents});
      }
    }
    observations.push({name,config,ancestors,executables,selected});
    clients.push({name,dir,selected});
  }
  const groups=new Map();
  for (const f of inventory) {
    const hud=f.action==="install-bundled-hud";
    for (const client of hud?[clients[0]]:clients.filter(c=>c.selected)) {
      const destination=path.join(home,client.dir,hud?"hud":"skills",f.destinationSuffix);
      const target=hud?destination:path.join(home,client.dir,"skills",f.destinationSuffix.split("/")[0]);
      if (!groups.has(target)) {
        const identity=assetIdentity(target,!hud);
        groups.set(target,{id:f.action+":"+client.name+":"+path.basename(target),action:f.action,target,
          ancestors:assetAncestors(path.dirname(target)),identity,skip:!!identity,
          reason:identity?"existing target preserved; no replacement":null,files:[],
          staging:hud?null:path.join(path.dirname(target),".aigentry-assets-<run-id>-<nonce>")});
      }
      groups.get(target).files.push({...f,destination});
    }
  }
  const history=path.join(stateDir(),state.JOURNAL_NAME);
  const sources={};
  for (const rel of ["install.sh","install.ps1","lib/setup-executor.js"]) sources[rel]=digest(readSource(rel));
  const executable=fs.lstatSync(process.execPath);
  if (!executable.isFile() || executable.nlink!==1 || executable.size>256*1024*1024) throw Error("unsupported Node interpreter identity");
  return {mode:"assets",asset_revision:1,home,home_ancestors:assetAncestors(home),
    interpreter:{path:process.execPath,sha256:digest(fs.readFileSync(process.execPath))},
    asset_sources:sources,assets:[...groups.values()],client_observations:observations,
    history_digest:storage.journalIdentity?digest(fs.readFileSync(history)):null,
    recovery:{decision:"refuse; no replay or force-unlock",unresolved:storage.unresolved},
    outcome:"partial-assets",verification:"not-verified",profile_gaps:source.manifest.profiles[opts["--profile"]].components,
    disclosure:"Partial local assets only. Clients may discover copied skills in later sessions. No settings activation, full profile installation or runtime verification.",
    copy_effects:{directories:"only missing approved ancestors and staging subdirectories, 0700",files:"exclusive new files 0600; HUD 0700",
      staging:"private sibling per missing skill; fsync files; refuse observed publication conflict; portable rename is not atomic no-replace",
      cleanup:"failed staging retained for inspection; no automatic removal or rollback",children:[],network:[],services:[]}};
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
  const plan = { schema: "aigentry-devkit/setup-plan@1", contract_major: contractMajor,
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
  if (opts["--install-assets"]) {
    Object.assign(plan,assetPlan(source,opts,storage));
    if (plan.assets.every(a=>a.skip)) plan.effects=[];
    else plan.effects.find(e=>e.action==="atomic-replace-journal").preserve="existing history; append partial asset attempt and phase1 receipts";
  }
  return plan;
}
function showPlan(plan, stdout) {
  stdout.write(plan.mode==="assets" ? "Partial assets preview: not runtime-verified; full profile installation remains gated.\n" :
    "Configure-only preview: selected, not runtime-verified. No installation, runtime, service, authentication or network action.\n");
  stdout.write(JSON.stringify(plan, null, 2) + "\n");
  stdout.write("--accept-plan " + digest(canonical(plan)) + "\n");
}

function applyAssets(opts, approved, hash, stdout) {
  // Only this fresh in-process plan can reach the writer. Neither io, disk nor
  // environment can provide an action list or reusable approval token.
  const bytes=canonical(approved);
  if (digest(bytes)!==hash || canonical(planFor(opts))!==bytes) throw Error("stale asset plan; preview again");
  const plan=JSON.parse(bytes);
  const freeze=value=>{if(value && typeof value==="object"){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
  freeze(plan);
  if (plan.assets.every(a=>a.skip)) { stdout.write("Partial assets: no changes; every target preserved. Profile/runtime remain unverified.\n"); return; }
  const receipt=state.beginAssetRun(stateDir(),plan.selection.profile,hash,plan.storage,plan.history_digest);
  const created=[],ownedDirs=new Map(),staged=[];
  const equal=(a,b)=>canonical(a)===canonical(b);
  const ensure=rows=>{
    for(const row of rows){
      const current=assetIdentity(row.path,true),expected=row.identity||ownedDirs.get(row.path)||null;
      if(!equal(current,expected))throw Error("asset ancestor changed");
      if(!current){fs.mkdirSync(row.path,{mode:0o700});ownedDirs.set(row.path,assetIdentity(row.path,true));}
    }
  };
  const copy=(file,destination,mode,published=false)=>{
    if(!equal(assetAncestors(path.dirname(path.join(root,file.source))),file.ancestors) ||
       !equal(assetIdentity(path.join(root,file.source),false,true),file.identity))throw Error("asset source changed");
    const data=fs.readFileSync(path.join(root,file.source));
    if(data.length!==file.size || digest(data)!==file.sha256)throw Error("asset source changed");
    const fd=fs.openSync(destination,"wx",mode);
    if(published)created.push(destination);
    try {fs.writeFileSync(fd,data);fs.fchmodSync(fd,mode);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    const identity=assetIdentity(destination,false);
    if((identity.mode&0o777)!==mode || digest(fs.readFileSync(destination))!==file.sha256)throw Error("asset verification failed");
  };
  try {
    for(const action of plan.assets){
      if(action.skip)continue;
      ensure(action.ancestors);
      if(assetIdentity(action.target,action.action!=="install-bundled-hud"))throw Error("asset publication conflict; existing target preserved");
      if(action.action==="install-bundled-hud"){
        // An exclusive file can remain partial after interruption; never truncate
        // or remove it on a retry. The durable phase-begin precedes this write.
        copy(action.files[0],action.target,0o700,true);
      }else{
        const staging=path.join(path.dirname(action.target),".aigentry-assets-"+receipt.run+"-"+crypto.randomBytes(8).toString("hex"));
        state.recordAssetStaging(receipt,staging);
        fs.mkdirSync(staging,{mode:0o700});
        const owned={path:staging,identity:assetIdentity(staging,true)};
        staged.push(owned);
        for(const file of action.files){
          const destination=path.join(staging,path.relative(action.target,file.destination));
          fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
          copy(file,destination,0o600);
        }
        ensure(action.ancestors);
        if(assetIdentity(action.target,true))throw Error("asset publication conflict; existing target preserved");
        if(!equal(assetIdentity(staging,true),owned.identity))throw Error("asset staging identity changed");
        // This refuses observed conflicts but is NOT atomic no-replace. A hostile
        // same-UID racer remains outside the portable filesystem guarantee.
        fs.renameSync(staging,action.target);
        staged.pop();
        for(const file of action.files)created.push(file.destination);
      }
      for(const file of action.files){
        const actual=assetIdentity(file.destination,false);
        if(!actual || (actual.mode&0o777)!==Number.parseInt(file.mode,8) || digest(fs.readFileSync(file.destination))!==file.sha256)throw Error("asset post-write verification failed");
      }
    }
    state.finishAssetRun(receipt,true,created);
    stdout.write("Partial assets completed: "+created.length+" files. Full profile installation gated; runtime not verified.\n");
  } catch(err) {
    // Failed staging is retained for inspection, not recursively removed: no
    // cleanup authority over an object that could have been replaced is assumed.
    try {state.finishAssetRun(receipt,false,created);} catch (_) {throw Error("partial asset outcome unknown; durable journal and lock require inspection");}
    throw Error("partial asset operation failed; existing data preserved; inspect journal and any recorded staging; no automatic rollback");
  }
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
      if (!opts["--non-interactive"] && !(opts["--dry-run"] && opts["--install-assets"])) throw Error("D1 installation unavailable; use --non-interactive with explicit choices and --configure-only or --install-assets");
      if (!opts["--configure-only"] && !opts["--install-assets"]) throw Error("D1 installation unavailable; --configure-only or explicit partial --install-assets required");
      const plan = planFor(opts), hash = digest(canonical(plan));
      showPlan(plan, stdout);
      if (opts["--dry-run"]) return 0;
      if (opts["--accept-plan"] !== hash) throw Error("missing or stale --accept-plan; preview again");
      const current = planFor(opts);
      if (digest(canonical(current)) !== hash) throw Error("stale plan; preview again");
      if (plan.mode==="assets") { applyAssets(opts,plan,hash,stdout); return 0; }
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
      if (!opts["--configure-only"] && !opts["--install-assets"]) {
        const answer = await ask("D1 installation unavailable. Type back to reselect or skip to leave unsaved (saving requires --configure-only): ");
        if (answer === "skip") return 0;
        continue;
      }
      const answer = await ask("To save type the exact plan digest; back to reselect, skip to leave unsaved, cancel to exit: ");
      if (answer === "back") continue;
      if (answer === "skip") return 0;
      const hash = digest(canonical(plan));
      if (answer !== hash || digest(canonical(planFor(opts))) !== hash) throw Error("missing or stale plan consent");
      if (plan.mode==="assets") { applyAssets(opts,plan,hash,stdout); return 0; }
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
