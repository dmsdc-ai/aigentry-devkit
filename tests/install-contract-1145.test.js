// Cross-field install contract for the telepty version, the adapter chain, the
// documented behaviour and the support floor (#1145 F1/F3/F4/F12).
//
// The installer manifest (config/installer-manifest.json) is the ONE source of
// the telepty package/version decision — #1213's shipped slice, enforced by
// lib/telepty-version-policy.js from install.sh and install.ps1. Every other
// tracked declarative source that names a telepty version, documents an
// installer capability, or states the support floor is checked against it here,
// so a second decision source cannot drift back in silently.
//
// Static rows read tracked files only. The one live row runs the shipped policy
// frontend in a fresh pinned Node process with a private HOME/TMPDIR (mode 0700,
// umask 0077) and a PATH of inert logging fakes plus refusing tripwires for
// npm/npx/curl/git/brew/sudo/launchctl/systemctl, and asserts the floor refusal
// touches no actuator at all. No installer, service, network or global state is
// reached from this file.
//
// Not proved here (recorded, not silently implied): native Node 18 refusal at
// install.sh level stays tests/install-telepty-version.test.js's existing row
// "node_minimum above this runtime -> refuse before npm" plus ci.yml's Node 18
// leg; this file measures the shared decision and the declarations around it.
//
// Run: node --test tests/install-contract-1145.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const MANIFEST_REL = "config/installer-manifest.json";
const MODULES_REL = "config/modules";
const POLICY_REL = "lib/telepty-version-policy.js";
const p = (...rel) => path.join(REPO, ...rel);
const read = (rel) => fs.readFileSync(p(rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel).replace(/^\uFEFF/, ""));

const IS_WIN = process.platform === "win32";
const KEEP = process.env.AIGENTRY_TEST_KEEP === "1";
const RUN_TIMEOUT_MS = 60000;

const manifest = readJson(MANIFEST_REL);
const pkg = readJson("package.json");
const TELEPTY = manifest.compatibility.telepty;
const TELEPTY_INSTALL = manifest.components.telepty.install;
const PIN = TELEPTY_INSTALL.version;
const MIN = TELEPTY.minimum;
const MAX = TELEPTY.maximum_exclusive;
const NODE_MIN = TELEPTY.node_minimum;

// Sources that ship or render a declaration. README.md is generated from the
// template; both are checked so a hand edit cannot hide a stale version.
const DECLARATIVE_JSON = ["ecosystem.json"]; // plus every config/**/*.json
const DECLARATIVE_DOCS = ["README.md", "README.tmpl.md"];
// Everything that could execute an adapter field.
const EXECUTABLE_DIRS = ["bin", "lib", "hooks", "scripts", "tools", "skills", "hud", "mcp-servers", "templates"];
const EXECUTABLE_FILES = ["install.sh", "install.ps1"];

function parse(v) {
  const m = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/.exec(String(v));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
function inRange(v) {
  const t = parse(v);
  return !!t && cmp(t, parse(MIN)) >= 0 && cmp(t, parse(MAX)) < 0;
}

function walkFiles(rel) {
  const abs = p(rel);
  let st;
  try {
    st = fs.statSync(abs);
  } catch (_) {
    return [];
  }
  if (st.isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((e) => (e === "node_modules" || e === ".git" ? [] : walkFiles(path.join(rel, e))));
}

const EXECUTABLE_SOURCES = [...EXECUTABLE_DIRS.flatMap(walkFiles), ...EXECUTABLE_FILES.flatMap(walkFiles)];

function executablesContaining(needle) {
  return EXECUTABLE_SOURCES.filter((rel) => {
    try {
      return fs.readFileSync(p(rel), "utf8").includes(needle);
    } catch (_) {
      return false; // binary/unreadable: cannot be a textual consumer
    }
  });
}

const ADAPTERS = fs.readdirSync(p(MODULES_REL)).filter((f) => f.endsWith(".adapter.json")).sort();
const adapterOf = (f) => readJson(path.join(MODULES_REL, f));

// ── F1: one source of decision for the telepty version ─────────────────────

test("F1 :: the telepty adapter derives its version and install spec from the installer manifest", () => {
  const adapter = adapterOf("telepty.adapter.json");
  assert.equal(adapter.version, TELEPTY.target,
    `telepty.adapter.json version must be compatibility.telepty.target (${TELEPTY.target})`);
  assert.equal(adapter.attach.install_command, `npm install -g ${TELEPTY_INSTALL.package}@${PIN}`,
    "telepty.adapter.json attach.install_command must be the manifest package@install.version");
  // The adapter says where its numbers come from, so a future hand edit is a
  // visible contradiction rather than a silent second decision source.
  assert.ok(/installer-manifest\.json/.test(adapter["x-version-source"] || ""),
    "telepty.adapter.json must record that its version fields are derived from the installer manifest");
  // The manifest keeps naming the same decision #1213 shipped.
  assert.equal(TELEPTY.target, PIN, "compatibility.telepty.target and components.telepty.install.version must agree");
  assert.ok(inRange(PIN), `the pin ${PIN} must sit inside >=${MIN} <${MAX}`);
});

test("F1/F3 :: no tracked declarative source names a telepty version outside the supported range", () => {
  // Allowed besides the range itself: the manifest's own bounds.
  const bounds = new Set([MAX, NODE_MIN]);
  const offenders = [];

  const checkToken = (where, token) => {
    if (bounds.has(token) || inRange(token)) return;
    offenders.push(`${where}: ${token}`);
  };

  // Structured: every string whose own path identifies telepty. The trail
  // starts at the file name (so telepty.adapter.json is in scope as a whole)
  // and picks up a record's name/package (so one row of a module list is in
  // scope without dragging its siblings in).
  const walkJson = (node, trail, file) => {
    if (typeof node === "string") {
      if (!/telepty/i.test(trail.join("."))) return;
      for (const token of node.match(/[0-9]+\.[0-9]+\.[0-9]+/g) || []) checkToken(`${file} ${trail.join(".")}`, token);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walkJson(v, [...trail, String(i)], file));
      return;
    }
    if (node && typeof node === "object") {
      const self = [node.name, node.package].filter((v) => typeof v === "string");
      for (const [k, v] of Object.entries(node)) walkJson(v, [...trail, ...self, k], file);
    }
  };
  for (const rel of [...walkFiles("config").filter((f) => f.endsWith(".json")), ...DECLARATIVE_JSON]) {
    walkJson(readJson(rel), [path.basename(rel)], rel);
  }

  // Textual: any documentation line that mentions telepty and carries an X.Y.Z token.
  for (const rel of DECLARATIVE_DOCS) {
    read(rel).split(/\r?\n/).forEach((line, i) => {
      if (!/telepty/i.test(line)) return;
      for (const token of line.match(/[0-9]+\.[0-9]+\.[0-9]+/g) || []) checkToken(`${rel}:${i + 1}`, token);
    });
  }

  assert.deepEqual(offenders, [],
    `declared telepty versions outside >=${MIN} <${MAX} (bounds ${[...bounds].join(", ")} excepted)`);
});

test("F1 :: attach.install_command and install.fallback have no executing consumer, and the enumeration is exact", () => {
  // Declarations, enumerated from the adapters themselves.
  const withInstallCommand = ADAPTERS.filter((f) => adapterOf(f).attach && "install_command" in adapterOf(f).attach);
  const withFallback = ADAPTERS.filter((f) => adapterOf(f).install && "fallback" in adapterOf(f).install);
  assert.deepEqual(withFallback, ["orchestrator-role.adapter.json"],
    "only orchestrator-role declares install.fallback; a new one needs an intended-behavior contract first");
  assert.ok(withInstallCommand.length > 0, "fixture precondition: adapters still declare attach.install_command");

  // The one declared fallback entry is a skip, so nothing can be replayed from it.
  const fallback = adapterOf("orchestrator-role.adapter.json").install.fallback;
  assert.deepEqual(fallback.map((e) => e.kind), ["skip"], "orchestrator-role fallback must stay a single skip entry");

  // No executable source reads either field: the only reference is the schema.
  assert.deepEqual(executablesContaining("install_command"), [],
    "attach.install_command gained an executing consumer: re-review F1 before shipping a second decision source");
  assert.ok(read("config/module-adapter.schema.json").includes("install_command"),
    "fixture precondition: the schema still declares attach.install_command");

  // Adapter readers are enumerated, and each reads only the fields it owns.
  // (bin/aigentry-devkit.js joins the directory at runtime, so the file name
  // suffix — not the directory literal — is what identifies a reader.)
  const adapterReaders = executablesContaining(".adapter.json").sort();
  assert.deepEqual(adapterReaders, ["bin/aigentry-devkit.js", "install.sh"].sort(),
    "a new adapter reader must be reviewed against F1's single-source contract");
  const adapterFieldArgs = [...read("install.sh").matchAll(/adapter_field\s+'([^']+)'/g)].map((m) => m[1]);
  assert.ok(adapterFieldArgs.length > 0, "fixture precondition: install.sh still reads adapter fields");
  for (const field of adapterFieldArgs) {
    assert.ok(field.startsWith("x-git-install."),
      `install.sh reads adapter field ${field}; only x-git-install.* is a tracked consumer`);
  }
  const cli = read("bin/aigentry-devkit.js");
  for (const field of ["install_command", "install.fallback"]) {
    assert.ok(!cli.includes(field), `bin/aigentry-devkit.js must not consume ${field}`);
  }
});

// ── F3: one refreshed source for the ecosystem table, generated README ─────

test("F3 :: README.md is exactly what gen-readme.mjs renders from local data", () => {
  const r = spawnSync(process.execPath, [p("scripts/gen-readme.mjs"), "--check"], {
    cwd: REPO,
    encoding: "utf8",
    timeout: RUN_TIMEOUT_MS,
    env: { ...process.env, npm_config_registry: "http://127.0.0.1:9/" },
  });
  assert.equal(r.status, 0, `gen-readme --check failed\n${r.stdout}\n${r.stderr}`);
});

test("F3 :: the ecosystem telepty row agrees with the installer decision", () => {
  const eco = readJson("ecosystem.json");
  const row = eco.modules.find((m) => m.package === TELEPTY_INSTALL.package);
  assert.ok(row, `ecosystem.json has no row for ${TELEPTY_INSTALL.package}`);
  assert.ok(inRange(row.version), `ecosystem telepty version ${row.version} must sit inside >=${MIN} <${MAX}`);
  assert.equal(row.version, PIN, "the ecosystem telepty row must be the installer-manifest pin, not a separate snapshot");
  assert.ok(/installer-manifest|single source|source of decision/i.test(eco._comment),
    "ecosystem.json must record where the telepty row comes from");
  assert.deepEqual(eco._comment.match(/[0-9]+\.[0-9]+\.[0-9]+/g), null,
    "the provenance comment must not restate module versions; the rows are the data");
  assert.ok(read("README.md").includes(`| ${PIN} |`), "the generated README table must carry the pinned telepty version");
});

// ── F4: documentation describes shipped behaviour ──────────────────────────

test("F4 :: every installer capability the README claims has a tracked consumer", () => {
  // Capabilities the README documented at the reviewed HEAD. Each token must
  // either have an executing consumer, or be absent from the documentation.
  const CLAIMS = [
    "AIGENTRY_INSTALL_FALLBACK_MODE",
    "AIGENTRY_INSTALL_TIMEOUT",
    "AIGENTRY_VERBOSE",
    "AIGENTRY_QUIET",
    "--fallback-mode",
    "--install-timeout",
    "install-with-fallback",
    "brain_status_degraded",
    "aigentry-brain-stub.mjs",
    "logs/install-",
    "EAI_AGAIN",
    "ENOSPC",
    "aigentry setup --verbose",
    "aigentry setup --quiet",
  ];
  const docs = ["README.tmpl.md", "README.md"];
  const unbacked = [];
  for (const claim of CLAIMS) {
    const consumers = executablesContaining(claim);
    if (consumers.length > 0) continue;
    for (const doc of docs) {
      if (read(doc).includes(claim)) unbacked.push(`${doc} claims "${claim}" with no tracked consumer`);
    }
  }
  assert.deepEqual(unbacked, [], "documentation must describe shipped behaviour, or the feature must land");
});

test("F4 :: the brain stub the README promised does not exist, so it is not promised", () => {
  assert.ok(!fs.existsSync(p("bin/aigentry-brain-stub.mjs")),
    "bin/aigentry-brain-stub.mjs exists now: #593's disposition changed, re-review the documentation");
  assert.ok(!/brain fallback chain/i.test(read("README.tmpl.md")), "README must not promise a brain fallback chain");
});

test("F4 :: the documented offline behaviour is the shipped one", () => {
  const doc = read("README.tmpl.md");
  // Shipped: an in-range telepty is kept with no npm call, so a firewalled host works.
  assert.ok(/no npm call/i.test(doc), "README must keep documenting the offline-safe keep path");
  // Shipped: exactly one install attempt per soft component, then a warning.
  assert.ok(/soft/i.test(doc) && /warn/i.test(doc),
    "README must state that optional components warn and continue instead of falling back");
  // install.sh really parses one flag only.
  const flags = [...read("install.sh").matchAll(/^\s*(--[a-z-]+(\|-[a-z])?)\)/gm)].map((m) => m[1]);
  assert.deepEqual(flags, ["--force|-f"], "install.sh flag surface changed: re-check the documented flags");
});

// ── F12: the support floor is derived and expressed once ───────────────────

test("F12 :: the support floor is feature-derived, expressed once, and agrees across sources", () => {
  const node = manifest.compatibility.node;
  assert.equal(typeof node, "object",
    "compatibility.node must say which floor it means instead of asserting one bare range");
  assert.ok(parse(node.devkit_minimum), `compatibility.node.devkit_minimum must be a stable X.Y.Z (got ${node.devkit_minimum})`);

  // Expressed once: the profile floor is a pointer, never a second literal.
  assert.ok(!JSON.stringify(node).includes(NODE_MIN),
    `compatibility.node must not restate ${NODE_MIN}; it points at the component field that enforces it`);
  assert.ok(String(node.profile_minimum_source).includes("node_minimum"),
    "compatibility.node must name the component field the profile floor is derived from");
  assert.ok(String(node.enforced_by).includes(POLICY_REL),
    `compatibility.node must name the enforcing module (${POLICY_REL})`);

  // Derivation: every built-in profile selects a required, hard-failing telepty,
  // so the effective floor for a profile install is telepty's node_minimum.
  const floors = Object.entries(manifest.profiles).map(([name, profile]) => {
    const required = profile.components.filter(
      (c) => manifest.components[c] && manifest.components[c].required && manifest.components[c].failure_policy === "hard",
    );
    const mins = required
      .map((c) => manifest.compatibility[c] && manifest.compatibility[c].node_minimum)
      .filter(Boolean);
    return [name, mins];
  });
  for (const [name, mins] of floors) {
    assert.ok(mins.includes(NODE_MIN),
      `profile ${name} must derive its floor from a required component's node_minimum (got ${JSON.stringify(mins)})`);
  }

  // telepty really is required and hard everywhere, which is why the floor binds.
  assert.equal(TELEPTY.required, true, "compatibility.telepty.required");
  assert.equal(manifest.components.telepty.failure_policy, "hard", "components.telepty.failure_policy");
  assert.ok(cmp(parse(NODE_MIN), parse(node.devkit_minimum)) > 0,
    "the profile floor must be above the devkit CLI floor, otherwise F12 is moot");

  // Agreement: package.json engines (release owner's field) and README prose.
  const engines = String(pkg.engines.node);
  assert.equal(engines, `>=${parse(node.devkit_minimum)[0]}`,
    `package.json engines.node (${engines}) must match compatibility.node.devkit_minimum (${node.devkit_minimum})`);
  const readme = read("README.tmpl.md");
  assert.ok(readme.includes(`Node.js ${parse(node.devkit_minimum)[0]}+`), "README must state the devkit CLI floor");
  assert.ok(readme.includes(`Node.js ${parse(NODE_MIN)[0]}+`), "README must state the profile floor");
  assert.ok(readme.includes(NODE_MIN), "README must keep naming the enforced node_minimum literal");
});

// ── F12: the floor is really enforced before any actuator runs ─────────────

const FAKE_JS = String.raw`"use strict";
// Inert tripwire for task-1145 contract tests. argv: <tool> ...args
// Where it writes is not an input: the state directory is this script's own
// location plus the fixed leaf "state", and the file name is a literal, so no
// argument or environment value can redirect the write. argv carries the tool
// name and its arguments as data only and is never joined into a path.
const fs = require("fs");
const path = require("path");
const stateDir = path.join(__dirname, "state");
const tool = process.argv[2];
fs.appendFileSync(path.join(stateDir, "calls.jsonl"),
  JSON.stringify({ tool, args: process.argv.slice(3), pid: process.pid }) + "\n");
process.exitCode = 97;
`;

const TRIPWIRES = IS_WIN
  ? ["npm", "npx", "curl", "git", "sudo", "schtasks"]
  : ["npm", "npx", "curl", "git", "brew", "sudo", "launchctl", "systemctl"];

// withTelepty: put a telepty tripwire first on PATH too, so a row can prove the
// decision refused *before* even probing an installed telepty. Without it the
// closed PATH holds no telepty at all, which is the "absent" control.
function mkSandbox(label, { withTelepty = false } = {}) {
  const prev = process.umask(0o077);
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `ic1145-${label}-`));
    const sb = { root, home: path.join(root, "home"), tmp: path.join(root, "tmp"), fakebin: path.join(root, "fakebin"), state: path.join(root, "state") };
    for (const d of [sb.home, sb.tmp, sb.fakebin, sb.state]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
    fs.chmodSync(root, 0o700);
    sb.fakeJs = path.join(root, "fake.js");
    fs.writeFileSync(sb.fakeJs, FAKE_JS);
    fs.writeFileSync(path.join(sb.state, "calls.jsonl"), "");
    for (const tool of [...TRIPWIRES, ...(withTelepty ? ["telepty"] : [])]) {
      // The shim passes the tool name only; the fake derives its own state dir.
      if (IS_WIN) {
        fs.writeFileSync(path.join(sb.fakebin, `${tool}.cmd`),
          `@echo off\r\n"${process.execPath}" "${sb.fakeJs}" ${tool} %*\r\nexit /b %ERRORLEVEL%\r\n`);
      } else {
        const f = path.join(sb.fakebin, tool);
        fs.writeFileSync(f, `#!/bin/sh\nexec '${process.execPath}' '${sb.fakeJs}' ${tool} "$@"\n`);
        fs.chmodSync(f, 0o755);
      }
    }
    return sb;
  } finally {
    process.umask(prev);
  }
}

function runPolicy(sb, manifestPath) {
  const env = {
    HOME: sb.home,
    TMPDIR: sb.tmp,
    TEMP: sb.tmp,
    TMP: sb.tmp,
    LANG: "C",
    // Closed PATH: only the fakes. The policy frontend is launched by absolute
    // path, so nothing here needs a real node/telepty to be reachable, and the
    // lookup can never observe a command this fixture did not place.
    PATH: IS_WIN
      ? [sb.fakebin, path.join(process.env.SystemRoot || "C:\\Windows", "System32")].join(";")
      : sb.fakebin,
  };
  if (IS_WIN) {
    for (const k of ["SystemRoot", "windir", "ComSpec", "PATHEXT", "SystemDrive"]) {
      if (process.env[k]) env[k] = process.env[k];
    }
    env.USERPROFILE = sb.home;
  }
  const r = spawnSync(process.execPath, [p(POLICY_REL), "--mode", "plan", "--manifest", manifestPath, "--probe", "bounded"], {
    cwd: sb.root,
    env,
    encoding: "utf8",
    timeout: RUN_TIMEOUT_MS,
    windowsHide: true,
  });
  const calls = fs.readFileSync(path.join(sb.state, "calls.jsonl"), "utf8").split("\n").filter(Boolean);
  const [action, status, spec, observed, ...rest] = String(r.stdout).trim().split("\t");
  return { code: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr, calls, action, status, spec, observed, message: rest.join("\t") };
}

function writeFixtureManifest(sb, mutate) {
  const m = readJson(MANIFEST_REL);
  mutate(m);
  const file = path.join(sb.root, "installer-manifest.fixture.json");
  fs.writeFileSync(file, JSON.stringify(m, null, 2));
  return file;
}

const RUNTIME_OK = cmp(parse(process.versions.node), parse(NODE_MIN)) >= 0;

// The tripwire writes only inside its own directory: its state location is
// derived from the script's own path, never received, so no argument can
// redirect a fixture write (#1145 phase 2 — the reported argv-to-filesystem
// flow is corrected at its origin, not suppressed). argv stays data.
test("fixture integrity :: the tripwire's state location is not an input", { timeout: RUN_TIMEOUT_MS }, () => {
  const sb = mkSandbox("path-independence");
  try {
    const decoy = path.join(sb.root, "decoy");
    fs.mkdirSync(decoy, { recursive: true, mode: 0o700 });
    const shaped = [decoy, path.join(decoy, "calls.jsonl"), `..${path.sep}..${path.sep}escape`];
    const r = spawnSync(process.execPath, [sb.fakeJs, ...shaped], {
      cwd: sb.root,
      env: { PATH: sb.fakebin, HOME: sb.home, TMPDIR: sb.tmp, LANG: "C" },
      encoding: "utf8",
      timeout: RUN_TIMEOUT_MS,
      windowsHide: true,
    });
    const d = `exit=${r.status} signal=${r.signal}\n${r.stdout}${r.stderr}`;
    assert.deepEqual(fs.readdirSync(decoy), [], `an argv value redirected a fixture write into ${decoy}\n${d}`);
    assert.ok(!fs.existsSync(path.join(sb.root, "escape")) && !fs.existsSync(path.join(os.tmpdir(), "escape")),
      `an argv value escaped the sandbox\n${d}`);
    const calls = fs.readFileSync(path.join(sb.state, "calls.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(calls.length, 1, `the call must be logged in the derived state dir\n${d}`);
    assert.equal(calls[0].tool, shaped[0], "argv must be recorded as data");
    assert.deepEqual(calls[0].args, shaped.slice(1), "argv must be recorded as data");
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("F12 :: a runtime below the floor is refused before any actuator, naming the floor", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("below-floor", { withTelepty: true });
  try {
    // The runtime is the real one; only the declared floor moves (nothing fakes
    // process.versions). On the CI Node 18 leg the shipped floor already binds.
    const above = writeFixtureManifest(sb, (m) => {
      m.compatibility.telepty.node_minimum = "99.0.0";
    });
    const r = runPolicy(sb, above);
    assert.equal(r.code, 1, `expected a refusal\n${r.stdout}${r.stderr}`);
    assert.equal(r.action, "refuse", r.stdout);
    assert.equal(r.status, "runtime-unsupported", r.stdout);
    assert.ok(r.message.includes("99.0.0"), `the refusal must name the floor\n${r.stdout}`);
    assert.ok(/Node\.js/.test(r.message), `the refusal must name Node.js\n${r.stdout}`);
    assert.ok(/not installed or changed/.test(r.message), `the refusal must say nothing was changed\n${r.stdout}`);
    // telepty itself is first on this PATH: the floor refusal must precede even
    // the identification probe, let alone npm.
    assert.deepEqual(r.calls, [], "a refused install must not reach npm, telepty or any other actuator");
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("F12 :: control — with the shipped floor the same fixture is not a runtime refusal", { timeout: RUN_TIMEOUT_MS + 30000 }, () => {
  const sb = mkSandbox("shipped-floor");
  try {
    const shipped = writeFixtureManifest(sb, () => {});
    const r = runPolicy(sb, shipped);
    if (RUNTIME_OK) {
      // No telepty on this PATH, so the decision is "install the pin" — the
      // refusal above came from the floor, not from the fixture.
      assert.equal(r.action, "install", r.stdout);
      assert.equal(r.status, "absent", r.stdout);
      assert.equal(r.spec, `${TELEPTY_INSTALL.package}@${PIN}`, r.stdout);
      assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    } else {
      // Node 18 leg: the shipped floor itself refuses, before any actuator.
      assert.equal(r.action, "refuse", r.stdout);
      assert.equal(r.status, "runtime-unsupported", r.stdout);
      assert.ok(r.message.includes(NODE_MIN), `the refusal must name the shipped floor\n${r.stdout}`);
      assert.equal(r.code, 1, r.stdout);
    }
    // Deciding never mutates anything: no actuator in either branch.
    assert.deepEqual(r.calls, [], "the decision step must not invoke npm, telepty or any other actuator");
  } finally {
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true, maxRetries: 5 });
  }
});
