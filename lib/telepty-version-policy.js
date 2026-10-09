"use strict";

// #1213 telepty version policy — the single decision shared by install.sh and
// install.ps1 (Phase 2). The installer manifest pin is an install target for an
// absent or too-old telepty, never a reason to replace a working one: a newer
// compatible install is kept, an out-of-range or unidentifiable install is
// refused with its bytes left alone, and there is no `latest` fallback.
//
// Ordering is numeric MAJOR.MINOR.PATCH only. Prerelease/build/free text is
// "unknown" and is never ordered. Zero dependencies; plain ES2017 syntax so an
// old Node can still load this file and print the runtime refusal.
//
// decide() is pure (no fs, process, network). The CLI below is the frontend
// both installers call: argv flags (and either its own bounded probe or the
// probe's stdout on stdin), one tab-separated decision line on stdout, exit
// code = decision.exitCode.

const STABLE = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const OBSERVED = /^v?((?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8}))$/;
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const MAX_PROBE_CHARS = 1024;
const PROBE_TIMEOUT_MS = 5000;

// Manifest fields each decide() input comes from, so a refusal names what to fix.
const FIELDS = {
  packageName: "components.telepty.install.package",
  pin: "components.telepty.install.version",
  minimum: "compatibility.telepty.minimum",
  maximumExclusive: "compatibility.telepty.maximum_exclusive",
  nodeMinimum: "compatibility.telepty.node_minimum",
};

function parseStable(value) {
  if (typeof value !== "string") return null;
  const m = STABLE.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// Printable, quote/backslash/tab-free excerpt of untrusted text for messages.
function excerpt(value) {
  const text = String(value).replace(/[^A-Za-z0-9 ._+-]/g, "?");
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

function result(action, status, spec, observedVersion, message) {
  return {
    action,
    status,
    spec,
    observedVersion,
    message,
    exitCode: action === "refuse" ? 1 : 0,
  };
}

function refuse(status, message, observedVersion) {
  return result("refuse", status, null, observedVersion || null, message);
}

function decide(input) {
  const opts = input || {};

  // 1. Config: every bound present and stable, pin inside [minimum, maximumExclusive).
  if (typeof opts.packageName !== "string" || !PACKAGE_NAME.test(opts.packageName)) {
    return refuse("config-invalid", `installer manifest ${FIELDS.packageName} is missing or not a valid npm package name; telepty was not installed or changed`);
  }
  const bounds = {};
  for (const key of ["pin", "minimum", "maximumExclusive", "nodeMinimum"]) {
    bounds[key] = parseStable(opts[key]);
    if (!bounds[key]) {
      const shown = opts[key] === undefined || opts[key] === null ? "missing" : `"${excerpt(opts[key])}"`;
      return refuse("config-invalid", `installer manifest ${FIELDS[key]} is ${shown}, expected a stable X.Y.Z version; telepty was not installed or changed`);
    }
  }
  const { pin, minimum, maximumExclusive, nodeMinimum } = opts;
  if (compare(bounds.minimum, bounds.maximumExclusive) >= 0) {
    return refuse("config-invalid", `installer manifest telepty range is empty (minimum ${minimum} is not below maximum_exclusive ${maximumExclusive}); telepty was not installed or changed`);
  }
  if (compare(bounds.pin, bounds.minimum) < 0 || compare(bounds.pin, bounds.maximumExclusive) >= 0) {
    return refuse("config-invalid", `installer manifest telepty pin ${pin} is outside the supported range >=${minimum} <${maximumExclusive}; telepty was not installed or changed`);
  }
  const spec = `${opts.packageName}@${pin}`;
  const range = `>=${minimum} <${maximumExclusive}`;

  // 2. Runtime: telepty needs a newer Node than devkit itself; refuse before npm/daemon.
  const runtime = parseStable(opts.runtimeVersion);
  if (!runtime || compare(runtime, bounds.nodeMinimum) < 0) {
    const shown = runtime ? opts.runtimeVersion : `"${excerpt(opts.runtimeVersion)}"`;
    return refuse("runtime-unsupported", `Node.js ${shown} is not supported by telepty ${pin} (needs Node.js >=${nodeMinimum}); upgrade Node.js and rerun. telepty was not installed or changed`);
  }

  // 3. Installed telepty, from the frontend's bounded `telepty --version` probe.
  const probe = opts.probe;
  if (!probe || typeof probe.found !== "boolean") {
    return refuse("probe-failed", "the installed telepty could not be probed; telepty was left unchanged");
  }
  if (!probe.found) {
    return result("install", "absent", spec, null, `telepty is not installed; installing ${spec}`);
  }
  if (probe.exitCode !== 0 || typeof probe.stdout !== "string") {
    const how = Number.isInteger(probe.exitCode)
      ? `failed (exit ${probe.exitCode})`
      : `did not exit normally (timed out after ${PROBE_TIMEOUT_MS / 1000}s, printed over ${MAX_PROBE_CHARS} bytes, or was killed)`;
    return refuse("probe-failed", `telepty --version ${how}, so the installed telepty could not be identified; it was left unchanged. Check it with: telepty --version`);
  }
  const trimmed = probe.stdout.length > MAX_PROBE_CHARS ? null : probe.stdout.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  const m = trimmed === null ? null : OBSERVED.exec(trimmed);
  if (!m) {
    return refuse("installed-unknown", `telepty --version printed "${excerpt(probe.stdout)}", not a stable X.Y.Z version; the installed telepty was left unchanged. Check it with: telepty --version, or reinstall it yourself with: npm install -g ${spec}`);
  }
  const observedVersion = m[1];
  const observed = parseStable(observedVersion);
  if (compare(observed, bounds.minimum) < 0) {
    return result("upgrade", "installed-older", spec, observedVersion, `telepty ${observedVersion} is below the supported range ${range}; upgrading to ${spec}`);
  }
  if (compare(observed, bounds.maximumExclusive) >= 0) {
    return refuse("installed-incompatible", `telepty ${observedVersion} is outside the supported range ${range} (tested ${pin}); it was left unchanged and will not be downgraded. Use a devkit release that supports telepty ${observedVersion}, or replace it yourself with: npm install -g ${spec}`, observedVersion);
  }
  const note = observedVersion === pin ? "the tested version" : `within the supported range ${range} (tested ${pin})`;
  return result("keep", "installed-compatible", null, observedVersion, `telepty ${observedVersion} is ${note}; keeping it, no npm install`);
}

// After `npm install -g <spec>`, the fresh probe must land inside the range.
// Anything else is a failure; the pin is never recorded as the observed version.
function verify(input) {
  const d = decide(input);
  if (d.action === "keep") {
    return result("keep", "verified", null, d.observedVersion, `telepty ${d.observedVersion} verified after install`);
  }
  if (d.status === "config-invalid" || d.status === "runtime-unsupported") return d;
  const seen = d.observedVersion ? `reports ${d.observedVersion}` : "could not be identified";
  return refuse("post-install-incompatible", `after npm install, telepty --version ${seen} (${d.status}), which is not a compatible telepty; nothing was recorded. Check it with: telepty --version`, d.observedVersion);
}

function readManifestPolicy(manifestPath) {
  const fs = require("fs");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, ""));
  const pick = (obj, keys) => keys.reduce((cur, k) => (cur && typeof cur === "object" ? cur[k] : undefined), obj);
  return {
    packageName: pick(manifest, ["components", "telepty", "install", "package"]),
    pin: pick(manifest, ["components", "telepty", "install", "version"]),
    minimum: pick(manifest, ["compatibility", "telepty", "minimum"]),
    maximumExclusive: pick(manifest, ["compatibility", "telepty", "maximum_exclusive"]),
    nodeMinimum: pick(manifest, ["compatibility", "telepty", "node_minimum"]),
  };
}

// Why a found telepty is not probed: it may be what the user's shell runs, so it
// is refused as unknown instead of read as absent. Never names the raw path.
const UNSUPPORTED = {
  relative: "the first telepty on PATH is in a relative or empty (current-directory) PATH entry, which this installer does not run",
  ps1: "the first telepty on PATH is a PowerShell .ps1 with no PATHEXT command (.cmd) beside it, which this installer does not run",
  unobservable: "PATH is unset or a PATH entry could not be checked for telepty, so telepty cannot be confirmed absent",
};

// First `telepty` on PATH, like `command -v` (Windows: PATHEXT order). Returns
// { file } for a command the probe runs, null only when every PATH entry was
// observed to hold none, or { unsupported: <UNSUPPORTED key> } when the first
// candidate is one the probe will not run: in a relative or empty entry (the
// shell would resolve it from the current directory), a Windows .ps1 with no
// PATHEXT shim beside it, or an entry that could not be looked at. Lookup stops
// at that candidate, so a later absolute command can't hide it.
function findCommand(name) {
  const fs = require("fs");
  const path = require("path");
  const win = process.platform === "win32";
  const exts = win ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  // false only when observed not to be a runnable file here; other errors throw.
  const present = (file) => {
    try {
      if (!fs.statSync(file).isFile()) return false;
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") return false;
      throw err;
    }
    if (win) return true;
    try {
      fs.accessSync(file, fs.constants.X_OK);
    } catch (err) {
      if (err.code === "EACCES") return false;
      throw err;
    }
    return true;
  };
  if (process.env.PATH === undefined) return { unsupported: "unobservable" };
  for (const entry of process.env.PATH.split(path.delimiter)) {
    const dir = entry.replace(/^"(.*)"$/, "$1");
    const absolute = dir !== "" && path.isAbsolute(dir);
    try {
      for (const ext of exts) {
        const file = path.join(dir || ".", name + ext);
        if (present(file)) return absolute ? { file } : { unsupported: "relative" };
      }
      if (win && present(path.join(dir || ".", `${name}.ps1`))) return { unsupported: "ps1" };
    } catch (err) {
      return { unsupported: "unobservable" };
    }
  }
  return null;
}

// Bounded `telepty --version`: PROBE_TIMEOUT_MS wall clock and MAX_PROBE_CHARS
// bytes of stdout. Byte MAX_PROBE_CHARS + 1 is kept as the overflow marker, so an
// oversized reply can never be cut down into a valid version. On timeout or
// overflow only the probe this call spawned is stopped: the direct child on
// POSIX, or the tree rooted at its own cmd.exe on Windows (.cmd shim -> node).
// Resolves { found, exitCode, stdout }; exitCode is null whenever the probe was
// stopped, could not start, or died by a signal. An unsupported candidate is not
// run and resolves { found: true, exitCode: null, stdout: null, unsupported }.
function probeTelepty() {
  return new Promise((resolve) => {
    const lookup = findCommand("telepty");
    if (!lookup) {
      resolve({ found: false, exitCode: null, stdout: null });
      return;
    }
    if (lookup.unsupported) {
      resolve({ found: true, exitCode: null, stdout: null, unsupported: lookup.unsupported });
      return;
    }
    const file = lookup.file;
    const path = require("path");
    const { spawn, spawnSync } = require("child_process");
    const win = process.platform === "win32";
    const options = { stdio: ["ignore", "pipe", "ignore"], windowsHide: true };
    let child;
    try {
      if (win && /\.(cmd|bat)$/i.test(file)) {
        // Node refuses to spawn .cmd without a shell (CVE-2024-27980); run cmd.exe
        // ourselves on a fixed command line. Only `"` (impossible in Windows
        // paths) and `%` could escape the quotes, so such a path is refused.
        if (/["%\r\n]/.test(file)) throw new Error("unquotable path");
        child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/v:off", "/s", "/c", `""${file}" --version"`],
          Object.assign({ windowsVerbatimArguments: true }, options));
      } else {
        child = spawn(file, ["--version"], options);
      }
    } catch (err) {
      resolve({ found: true, exitCode: null, stdout: null });
      return;
    }

    const chunks = [];
    let size = 0;
    let exited = false;
    let finished = false;
    const stop = () => {
      if (exited) return;
      if (win) {
        const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
        spawnSync(taskkill, ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", windowsHide: true, timeout: PROBE_TIMEOUT_MS });
      } else {
        child.kill("SIGKILL");
      }
    };
    const finish = (exitCode, stopProbe) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (stopProbe && child.pid) stop();
      if (child.stdout) child.stdout.destroy();
      child.unref();
      resolve({ found: true, exitCode, stdout: Buffer.concat(chunks).toString("latin1") });
    };
    const timer = setTimeout(() => finish(null, true), PROBE_TIMEOUT_MS);
    if (child.stdout) child.stdout.on("data", (chunk) => {
      if (finished) return;
      const room = MAX_PROBE_CHARS + 1 - size;
      chunks.push(chunk.subarray(0, room));
      size += Math.min(chunk.length, room);
      if (size > MAX_PROBE_CHARS) finish(null, true);
    });
    child.on("exit", () => { exited = true; });
    child.on("error", () => finish(null, true));
    child.on("close", (code) => finish(Number.isInteger(code) ? code : null, false));
  });
}

// Usage: node telepty-version-policy.js --mode plan|verify --manifest <path>
//          --probe bounded                        (the frontend probes telepty itself)
//        | --probe-found 0|1 --probe-exit <int>   (probe stdout on stdin when found)
// Prints: action<TAB>status<TAB>spec|-<TAB>observedVersion|-<TAB>message
function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!["--mode", "--manifest", "--probe", "--probe-found", "--probe-exit"].includes(key) || key in args || i + 1 >= argv.length) {
      return refuse("usage-error", "telepty-version-policy: invalid arguments");
    }
    args[key] = argv[i + 1];
  }
  const mode = args["--mode"];
  const found = args["--probe-found"];
  const bounded = args["--probe"] === "bounded" && !("--probe-found" in args) && !("--probe-exit" in args);
  if ((mode !== "plan" && mode !== "verify") || !args["--manifest"]
    || (!bounded && ("--probe" in args || (found !== "0" && found !== "1")))
    || (found === "1" && !/^-?[0-9]{1,10}$/.test(args["--probe-exit"] || ""))) {
    return refuse("usage-error", "telepty-version-policy: invalid arguments");
  }

  let policy;
  try {
    policy = readManifestPolicy(args["--manifest"]);
  } catch (err) {
    return refuse("config-invalid", "installer manifest could not be read or parsed; telepty was not installed or changed");
  }

  if (bounded) {
    const base = Object.assign({}, policy, { runtimeVersion: process.versions.node });
    // Config and runtime refusals need no probe, so telepty is not even run for them.
    const pre = decide(Object.assign({}, base, { probe: { found: false, exitCode: null, stdout: null } }));
    if (pre.action === "refuse") return pre;
    return probeTelepty().then((probe) => {
      if (probe.unsupported) {
        const why = UNSUPPORTED[probe.unsupported];
        return mode === "verify"
          ? refuse("post-install-incompatible", `after npm install, ${why}; nothing was recorded. Check it with: telepty --version`)
          : refuse("installed-unknown", `${why}; its version is unknown, so it was left unchanged and nothing was installed. Check it with: telepty --version`);
      }
      const input = Object.assign({}, base, { probe });
      return mode === "verify" ? verify(input) : decide(input);
    });
  }

  const probe = { found: found === "1", exitCode: null, stdout: null };
  if (probe.found) {
    probe.exitCode = Number(args["--probe-exit"]);
    try {
      probe.stdout = require("fs").readFileSync(0).toString("utf8");
    } catch (err) {
      probe.stdout = null;
    }
  }

  const input = Object.assign({}, policy, { runtimeVersion: process.versions.node, probe });
  return mode === "verify" ? verify(input) : decide(input);
}

if (require.main === module) {
  Promise.resolve(main(process.argv.slice(2))).then((d) => {
    process.stdout.write(`${[d.action, d.status, d.spec || "-", d.observedVersion || "-", d.message].join("\t")}\n`);
    process.exitCode = d.exitCode;
  });
}

module.exports = { decide, verify, parseStable, compare };
