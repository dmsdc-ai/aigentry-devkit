// Contract tests for the pure telepty version decision (#1213):
//   lib/telepty-version-policy.js  ->  decide({packageName, pin, minimum,
//   maximumExclusive, nodeMinimum, runtimeVersion, probe:{found, exitCode, stdout}})
//   => {action, status, spec, observedVersion, message, exitCode}
//
// Controller design (task 1213): stable numeric X.Y.Z only (optional "v" on the
// OBSERVED CLI version), absent -> install exact pin, < minimum -> upgrade to exact
// pin, [minimum, maximumExclusive) -> keep (even newer than pin), >= maximum ->
// refuse, anything unknown / bad config / unsupported runtime -> refuse. No latest
// fallback, no implicit downgrade, no explicit-pin channel.
//
// decide() is pure: runtimeVersion is injected here (20.x), so these rows run on the
// Node 18 CI leg too. The installers' frontend must use the real runtime; that is
// covered by tests/install-telepty-version.test.js.
//
// Run: node --test tests/telepty-version-policy.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const POLICY = path.join(REPO, "lib", "telepty-version-policy.js");
const MANIFEST = path.join(REPO, "config", "installer-manifest.json");
const policy = require(POLICY);

const PKG = "@dmsdc-ai/aigentry-telepty";
// Controller-selected tested bounds (not a "latest" claim).
const PIN = "0.8.5";
const MIN = "0.8.5";
const MAX = "0.9.0";
const NODE_MIN = "20.0.0";
const RUNTIME = "20.11.1"; // injected; never process.versions.node

const ACTIONS = new Set(["keep", "install", "upgrade", "refuse"]);
// C0 (except \n), DEL and C1. A message must never carry raw probe bytes.
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

const found = (stdout, exitCode = 0) => ({ found: true, exitCode, stdout });
const ABSENT = { found: false, exitCode: null, stdout: "" };

function input(overrides = {}) {
  return {
    packageName: PKG,
    pin: PIN,
    minimum: MIN,
    maximumExclusive: MAX,
    nodeMinimum: NODE_MIN,
    runtimeVersion: RUNTIME,
    probe: found(`${PIN}\n`),
    ...overrides,
  };
}

// Shape + invariants every result must satisfy, whatever the row.
function check(res, inp) {
  assert.equal(typeof res, "object");
  assert.ok(res !== null);
  for (const k of ["action", "status", "spec", "observedVersion", "message", "exitCode"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(res, k), `result lacks ${k}`);
  }
  assert.ok(ACTIONS.has(res.action), `unknown action ${res.action}`);
  assert.equal(typeof res.status, "string");
  assert.ok(res.status.length > 0, "status must be non-empty");
  assert.equal(typeof res.message, "string");
  assert.ok(res.message.length > 0, "message must be non-empty");
  assert.ok(!CONTROL.test(res.message), `raw control char in message: ${JSON.stringify(res.message)}`);
  assert.ok(res.message.length <= 2000, `unbounded message (${res.message.length} chars)`);
  assert.ok(res.observedVersion === null || typeof res.observedVersion === "string");
  if (typeof res.observedVersion === "string") {
    assert.ok(!CONTROL.test(res.observedVersion), "raw control char in observedVersion");
  }
  if (res.action === "install" || res.action === "upgrade") {
    assert.equal(res.exitCode, 0);
    assert.equal(res.spec, `${inp.packageName}@${inp.pin}`, "non-keep success installs the exact pin");
  } else if (res.action === "keep") {
    assert.equal(res.exitCode, 0);
    assert.equal(res.spec, null);
  } else {
    assert.equal(res.exitCode, 1);
    assert.equal(res.spec, null, "refuse never names an npm spec");
  }
  if (typeof res.spec === "string") {
    assert.ok(!/latest|[\^~*<>=|\s]/.test(res.spec.slice(inp.packageName.length)), `non-exact spec ${res.spec}`);
  }
  return res;
}

function decide(overrides) {
  const inp = input(overrides);
  return check(policy.decide(inp), inp);
}

const stripV = (v) => (typeof v === "string" ? v.replace(/^v/, "") : v);

// ── module surface ───────────────────────────────────────────────────────────

test("module exports a decide function", () => {
  assert.equal(typeof policy.decide, "function");
});

test("require is side-effect free: no output, no stdin read, exits on its own", async () => {
  // stdin stays OPEN: a module that reads stdin or runs its CLI at require time hangs.
  const child = spawn(process.execPath, ["-e", `require(${JSON.stringify(POLICY)})`, "--", "--version", "x"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, AIGENTRY_LOGGER_DISABLED: "1" },
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { child.kill("SIGKILL"); resolve("timeout"); }, 15000);
    child.on("exit", (c) => { clearTimeout(t); resolve(c); });
  });
  child.stdin.destroy();
  assert.equal(code, 0, `require() did not exit cleanly (${code}); stderr=${err}`);
  assert.equal(out, "");
  assert.equal(err, "");
});

test("module is zero-dependency and has no network or eval surface (static)", () => {
  const src = fs.readFileSync(POLICY, "utf8");
  const builtins = new Set(require("module").builtinModules);
  const reqs = [...src.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]);
  for (const r of reqs) {
    const bare = r.replace(/^node:/, "");
    assert.ok(builtins.has(bare), `non-builtin require: ${r}`);
    assert.ok(!["http", "https", "http2", "net", "tls", "dgram", "dns"].includes(bare), `network module required: ${r}`);
  }
  assert.ok(!/\beval\s*\(/.test(src), "eval() in policy module");
  assert.ok(!/\bnew\s+Function\b|\bFunction\s*\(/.test(src), "Function constructor in policy module");
  assert.ok(!/\bimport\s*\(/.test(src), "dynamic import in policy module");
});

test("decide is pure: no child process, fs write, network or env/runtime read", () => {
  // Patch BEFORE require so destructured references are trapped too; the traps
  // only fire while decide() runs.
  const rows = [
    input(),
    input({ probe: ABSENT }),
    input({ probe: found("0.1.45\n") }),
    input({ probe: found("1.0.0\n") }),
    input({ probe: found("garbage\u001b[31m\n") }),
    input({ pin: "latest" }),
    input({ runtimeVersion: "18.20.4" }),
  ];
  const script = `
    "use strict";
    let inDecide = false;
    const hits = [];
    const trap = (mod, names) => {
      const m = require(mod);
      for (const n of names) {
        if (typeof m[n] !== "function") continue;
        const orig = m[n];
        m[n] = function (...a) { if (inDecide) hits.push(mod + "." + n); return orig.apply(this, a); };
      }
    };
    trap("child_process", ["spawn","spawnSync","exec","execSync","execFile","execFileSync","fork"]);
    trap("fs", ["writeFileSync","writeFile","appendFileSync","appendFile","mkdirSync","rmSync","unlinkSync","renameSync","copyFileSync","readFileSync","readFile","openSync","existsSync","statSync"]);
    trap("net", ["connect","createConnection","createServer"]);
    trap("http", ["request","get"]);
    trap("https", ["request","get"]);
    trap("dns", ["lookup","resolve"]);
    const envProxy = new Proxy(process.env, { get(t, k) { if (inDecide && typeof k === "string") hits.push("env." + k); return t[k]; } });
    Object.defineProperty(process, "env", { value: envProxy });
    const p = require(${JSON.stringify(POLICY)});
    const rows = JSON.parse(process.argv[1]);
    const out = [];
    for (const r of rows) { inDecide = true; try { out.push(p.decide(r)); } finally { inDecide = false; } }
    process.stdout.write(JSON.stringify({ hits, out }));
  `;
  const r = spawnSync(process.execPath, ["-e", script, JSON.stringify(rows)], {
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, AIGENTRY_LOGGER_DISABLED: "1" },
  });
  assert.equal(r.status, 0, `purity probe failed: ${r.stderr}`);
  const { hits, out } = JSON.parse(r.stdout);
  assert.deepEqual(hits, [], `decide() touched: ${hits.join(", ")}`);
  assert.equal(out.length, rows.length);
});

test("decide does not mutate its input and is deterministic", () => {
  const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };
  for (const probe of [ABSENT, found("0.1.45\n"), found("0.8.7\n"), found("1.0.0\n"), found("x y\n")]) {
    const a = deepFreeze(input({ probe }));
    const first = policy.decide(a);
    const second = policy.decide(input({ probe }));
    assert.deepEqual(first, second);
  }
});

// ── absent / older / in-range / incompatible ─────────────────────────────────

test("absent -> install exact pin, no observed version", () => {
  const r = decide({ probe: ABSENT });
  assert.equal(r.action, "install");
  assert.equal(r.spec, `${PKG}@${PIN}`);
  assert.equal(r.observedVersion, null);
});

for (const v of ["0.1.45", "0.8.4", "0.0.1", "0.7.99"]) {
  test(`installed ${v} < minimum -> upgrade to exact pin`, () => {
    const r = decide({ probe: found(`${v}\n`) });
    assert.equal(r.action, "upgrade");
    assert.equal(r.spec, `${PKG}@${PIN}`);
    assert.equal(stripV(r.observedVersion), v, "observed version is the probed one, not the pin");
  });
}

for (const v of ["0.8.5", "0.8.6", "0.8.10", "0.8.99"]) {
  test(`installed ${v} in [${MIN}, ${MAX}) -> keep, no npm`, () => {
    const r = decide({ probe: found(`${v}\n`) });
    assert.equal(r.action, "keep");
    assert.equal(r.spec, null);
    assert.equal(stripV(r.observedVersion), v);
  });
}

test("observed v-prefix is accepted (v0.8.7 -> keep, observed 0.8.7)", () => {
  const r = decide({ probe: found("v0.8.7\n") });
  assert.equal(r.action, "keep");
  assert.equal(stripV(r.observedVersion), "0.8.7");
});

for (const out of ["0.8.5", "0.8.5\r\n", "0.8.5\n"]) {
  test(`trailing line ending is not a second token (${JSON.stringify(out)} -> keep)`, () => {
    assert.equal(decide({ probe: found(out) }).action, "keep");
  });
}

test("ordering is numeric per field, not lexical", () => {
  assert.equal(decide({ probe: found("0.8.10\n") }).action, "keep"); // lexically < 0.8.5
  assert.equal(decide({ probe: found("0.10.0\n") }).action, "refuse"); // lexically < 0.9.0
  assert.equal(decide({ probe: found("0.8.4\n") }).action, "upgrade");
});

for (const v of ["0.9.0", "0.9.1", "0.10.0", "1.0.0", "10.0.0"]) {
  test(`installed ${v} >= maximumExclusive -> refuse, keep bytes, actionable message`, () => {
    const r = decide({ probe: found(`${v}\n`) });
    assert.equal(r.action, "refuse");
    assert.equal(r.exitCode, 1);
    assert.equal(r.spec, null, "no downgrade to the pin");
    assert.equal(stripV(r.observedVersion), v, "truthful observed version");
    assert.ok(r.message.includes(v), `message should name the installed version: ${r.message}`);
    assert.ok(r.message.includes(MAX), `message should name the compatibility bound: ${r.message}`);
  });
}

// ── custom pins: never permission to downgrade ───────────────────────────────

test("custom pin below installed (in range) keeps the newer install", () => {
  const r = decide({ pin: "0.8.6", minimum: "0.8.5", probe: found("0.8.8\n") });
  assert.equal(r.action, "keep");
  assert.equal(r.spec, null);
});

test("installed older than pin but >= minimum is kept (bounds, not the pin, decide)", () => {
  const r = decide({ pin: "0.8.7", minimum: "0.8.0", probe: found("0.8.2\n") });
  assert.equal(r.action, "keep");
  assert.equal(stripV(r.observedVersion), "0.8.2");
});

test("raised minimum upgrades to that exact custom pin", () => {
  const r = decide({ pin: "0.8.7", minimum: "0.8.7", probe: found("0.8.5\n") });
  assert.equal(r.action, "upgrade");
  assert.equal(r.spec, `${PKG}@0.8.7`);
});

test("boundaries: installed == minimum keeps; installed == maximumExclusive refuses", () => {
  assert.equal(decide({ minimum: "0.8.3", probe: found("0.8.3\n") }).action, "keep");
  assert.equal(decide({ maximumExclusive: "0.8.9", probe: found("0.8.9\n") }).action, "refuse");
});

// ── unknown installed version / failed probe ─────────────────────────────────

const UNKNOWN = {
  "free text": "not-a-version\n",
  empty: "",
  "only newline": "\n",
  "two fields": "0.8\n",
  "four fields": "0.8.5.1\n",
  prerelease: "0.8.5-beta.1\n",
  "prerelease of newer": "0.8.6-rc.1\n",
  build: "0.8.5+build.7\n",
  "name prefix (multi-token)": "telepty 0.8.5\n",
  "two versions": "0.8.5 0.8.6\n",
  "two lines": "0.8.5\n0.8.6\n",
  "bare v": "v\n",
  "double v": "vv0.8.5\n",
  "negative": "-1.8.5\n",
  "hex field": "0x1.8.5\n",
  "exponent": "1e3.0.0\n",
  "fullwidth digits": "０.８.５\n",
  "NUL inside": "0.8.5\u0000\n",
  "ANSI color": "\u001b[32m0.8.5\u001b[0m\n",
  "OSC title + BEL": "0.8.5\u001b]0;pwned\u0007\n",
  "backspace overwrite": "0.9.9\b\b\b\b\b0.8.5\n",
  "bare CR overwrite": "1.0.0\r0.8.5\n",
  "shell substitution": "$(touch /tmp/pwned-1213)\n",
  "js injection": "0.8.5'); require('fs').writeFileSync('pwned','x'); ('\n",
  "200k-digit major, message stays bounded": `${"9".repeat(200000)}.0.0\n`,
};

for (const [name, stdout] of Object.entries(UNKNOWN)) {
  test(`unknown installed version (${name}) -> refuse, no npm, not recorded as pin`, () => {
    const r = decide({ probe: found(stdout) });
    assert.equal(r.action, "refuse");
    assert.equal(r.spec, null);
    assert.notEqual(r.observedVersion, PIN, "an unknown version must not be reported as the pin");
  });
}

for (const [name, probe] of Object.entries({
  "nonzero exit with a good version": found("0.8.5\n", 1),
  "exit 127": found("", 127),
  "killed / timed out (exitCode null)": { found: true, exitCode: null, stdout: "" },
  "timed out after printing a version": { found: true, exitCode: null, stdout: "0.8.5\n" },
})) {
  test(`failed probe (${name}) -> refuse, never proceeds as compatible`, () => {
    const r = decide({ probe });
    assert.equal(r.action, "refuse");
    assert.equal(r.spec, null);
  });
}

test("unknown is never upgraded/replaced, also when absent-looking", () => {
  // found=true with empty output is NOT absent: no install over an unknown binary.
  const r = decide({ probe: found("") });
  assert.notEqual(r.action, "install");
  assert.notEqual(r.action, "upgrade");
});

// ── configuration errors (validated before anything else) ──────────────────

const BAD_VERSIONS = {
  missing: undefined,
  null: null,
  empty: "",
  latest: "latest",
  next: "next",
  caret: "^0.8.5",
  tilde: "~0.8.5",
  range: ">=0.8.5",
  star: "*",
  "x-range": "0.8.x",
  "two fields": "0.8",
  prerelease: "0.8.5-rc.1",
  build: "0.8.5+b1",
  "leading space": " 0.8.5",
  "trailing newline": "0.8.5\n",
  "shell metachar": "0.8.5;touch /tmp/pwned-1213",
  "substitution": "$(touch /tmp/pwned-1213)",
  number: 0.9,
  array: ["0.8.5"],
};

for (const field of ["pin", "minimum", "maximumExclusive", "nodeMinimum"]) {
  for (const [name, value] of Object.entries(BAD_VERSIONS)) {
    if (field === "maximumExclusive" && name === "number") continue; // covered below with a distinct value
    test(`bad config ${field} (${name}) -> refuse before any action`, () => {
      for (const probe of [ABSENT, found("0.1.45\n"), found(`${PIN}\n`)]) {
        const r = decide({ [field]: value, probe });
        assert.equal(r.action, "refuse", `${field}=${JSON.stringify(value)} probe=${JSON.stringify(probe)}`);
        assert.equal(r.spec, null);
      }
    });
  }
}

test("bad config maximumExclusive given as a JSON number -> refuse", () => {
  assert.equal(decide({ maximumExclusive: 1, probe: ABSENT }).action, "refuse");
});

for (const [name, b] of Object.entries({
  "pin below minimum": { pin: "0.8.4", minimum: "0.8.5" },
  "pin equal to maximumExclusive": { pin: "0.9.0", maximumExclusive: "0.9.0" },
  "pin above maximumExclusive": { pin: "0.9.1", maximumExclusive: "0.9.0" },
  "empty range (minimum == maximumExclusive)": { pin: "0.8.5", minimum: "0.8.5", maximumExclusive: "0.8.5" },
  "inverted range": { pin: "0.8.5", minimum: "0.9.0", maximumExclusive: "0.8.0" },
})) {
  test(`pin outside [minimum, maximumExclusive) (${name}) -> refuse`, () => {
    for (const probe of [ABSENT, found("0.1.45\n"), found("0.8.7\n")]) {
      const r = decide({ ...b, probe });
      assert.equal(r.action, "refuse");
      assert.equal(r.spec, null);
    }
  });
}

test("missing packageName -> refuse (no spec can be formed)", () => {
  for (const packageName of [undefined, null, ""]) {
    const inp = input({ packageName, probe: ABSENT });
    const r = policy.decide(inp);
    assert.equal(r.action, "refuse");
    assert.equal(r.spec, null);
    assert.equal(r.exitCode, 1);
  }
});

// ── runtime gate: telepty needs Node >= nodeMinimum ──────────────────────────

for (const rt of ["18.20.4", "19.9.9", "16.0.0"]) {
  test(`runtime ${rt} < nodeMinimum -> refuse for every probe state (no npm, no daemon)`, () => {
    for (const probe of [ABSENT, found("0.1.45\n"), found(`${PIN}\n`), found("0.8.8\n")]) {
      const r = decide({ runtimeVersion: rt, probe });
      assert.equal(r.action, "refuse");
      assert.equal(r.spec, null);
      assert.ok(r.message.includes(NODE_MIN) || /\b20\b/.test(r.message), `message should state the Node requirement: ${r.message}`);
    }
  });
}

test("runtime exactly nodeMinimum is supported", () => {
  assert.equal(decide({ runtimeVersion: "20.0.0", probe: ABSENT }).action, "install");
  assert.equal(decide({ runtimeVersion: "22.3.0", probe: found("0.8.6\n") }).action, "keep");
});

test("runtimeVersion is taken from the input, not from process.versions", () => {
  // Opposite of the host runtime in both directions.
  assert.equal(decide({ runtimeVersion: "18.0.0", probe: ABSENT }).action, "refuse");
  assert.equal(decide({ runtimeVersion: "99.0.0", probe: ABSENT }).action, "install");
});

for (const rt of [undefined, null, "", "v", "twenty", "20", "20.x.0"]) {
  test(`malformed runtimeVersion ${JSON.stringify(rt)} -> refuse`, () => {
    assert.equal(decide({ runtimeVersion: rt, probe: ABSENT }).action, "refuse");
  });
}

// ── shipped manifest carries the controller bounds ───────────────────────────

test("shipped installer manifest declares the selected telepty bounds", () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  assert.equal(m.components.telepty.install.package, PKG);
  assert.equal(m.components.telepty.install.version, PIN);
  assert.equal(m.compatibility.telepty.target, PIN);
  assert.equal(m.compatibility.telepty.minimum, MIN);
  assert.equal(m.compatibility.telepty.maximum_exclusive, MAX);
  assert.equal(m.compatibility.telepty.node_minimum, NODE_MIN);
  // devkit itself keeps its Node >= 18 engine; only telepty selection needs 20.
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  assert.equal(pkg.engines.node, ">=18");
  // the policy module ships with the npm package (files: lib/**)
  assert.ok(pkg.files.includes("lib/**"));
});

test("shipped bounds through decide: absent installs 0.8.5, 0.8.x kept, 0.9.0 refused", () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const t = m.compatibility.telepty;
  const base = {
    packageName: m.components.telepty.install.package,
    pin: m.components.telepty.install.version,
    minimum: t.minimum,
    maximumExclusive: t.maximum_exclusive,
    nodeMinimum: t.node_minimum,
    runtimeVersion: RUNTIME,
  };
  assert.equal(check(policy.decide({ ...base, probe: ABSENT }), base).spec, `${PKG}@0.8.5`);
  assert.equal(check(policy.decide({ ...base, probe: found("0.1.45\n") }), base).action, "upgrade");
  assert.equal(check(policy.decide({ ...base, probe: found("0.8.9\n") }), base).action, "keep");
  assert.equal(check(policy.decide({ ...base, probe: found("0.9.0\n") }), base).action, "refuse");
});
