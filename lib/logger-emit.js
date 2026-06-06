"use strict";

// δ2 Phase 2 (#440) — devkit emitter wrapper.
//
// CJS bridge to ESM-only @dmsdc-ai/aigentry-logger. Loads the logger lazily via
// dynamic import() so:
//   - require()-style call sites (lib/bootstrap.js, bin/aigentry-devkit.js)
//     keep working;
//   - logger absence (missing dep, bad install) degrades to console.error
//     without blocking the primary code path (§9 독립).
//
// Schema mapping per orchestrator A1 decision (#440 dispatch ACK):
//   spec event       → ssot kind        + payload.subtype
//   install_event    → state-change     + install_phase | install_done
//   module_event     → state-change     + module_load   | module_init
//
// session_id / role discovery (B):
//   AIGENTRY_SESSION_ID env var, else `pid-${process.pid}`.
//   AIGENTRY_ROLE env var (must be valid ssot Role enum). Fallback for
//   library-as-callee is 'orchestrator' — devkit is most commonly invoked
//   from an orchestrator session install/bootstrap flow.

const VALID_ROLES = new Set([
  "orchestrator",
  "architect",
  "coder",
  "tester",
  "builder",
  "analyst",
  "researcher",
  "reviewer",
  "logger",
]);

function resolveContext(env) {
  const e = env || process.env;
  const session_id = e.AIGENTRY_SESSION_ID || `pid-${process.pid}`;
  const rawRole = e.AIGENTRY_ROLE;
  const role = rawRole && VALID_ROLES.has(rawRole) ? rawRole : "orchestrator";
  return { session_id, role };
}

function buildEvent(input, env, now) {
  const ctx = resolveContext(env);
  const event = {
    schema_version: "1",
    kind: input.kind,
    session_id: ctx.session_id,
    role: ctx.role,
    emitted_at: (now || (() => new Date()))().toISOString(),
    payload: input.payload || {},
  };
  if (input.correlation_id) event.correlation_id = input.correlation_id;
  return event;
}

let _loggerPromise = null;
function loadLogger() {
  if (_loggerPromise) return _loggerPromise;
  // Lazy dynamic import. Caches the promise so we only resolve the ESM once.
  _loggerPromise = import("@dmsdc-ai/aigentry-logger").then((m) => m.emit);
  return _loggerPromise;
}

function emitTelemetry(input, opts) {
  const env = (opts && opts.env) || process.env;
  const now = opts && opts.now;
  const sink = opts && opts.__emit; // test seam
  // §9 독립 + test-isolation opt-out. When set, the helper short-circuits
  // before any I/O so callers (CI, scaffold dry-runs) never write to disk.
  if (env.AIGENTRY_LOGGER_DISABLED === "1") return Promise.resolve();
  let event;
  try {
    event = buildEvent(input, env, now);
  } catch (err) {
    try { console.error(`[devkit:logger-emit] build failed: ${err.message}`); } catch (_e) { /* noop */ }
    return Promise.resolve();
  }
  if (sink) {
    try { sink(event); } catch (err) {
      try { console.error(`[devkit:logger-emit] sink threw: ${err.message}`); } catch (_e) { /* noop */ }
    }
    return Promise.resolve();
  }
  return loadLogger()
    .then((emit) => {
      try { emit(event); }
      catch (err) {
        try { console.error(`[devkit:logger-emit] emit failed: ${err.message}`); } catch (_e) { /* noop */ }
      }
    })
    .catch((err) => {
      try { console.error(`[devkit:logger-emit] logger load failed: ${err.message}`); } catch (_e) { /* noop */ }
    });
}

function emitInstallEvent(subtype, payload, correlationId) {
  return emitTelemetry({
    kind: "state-change",
    payload: Object.assign({ subtype }, payload || {}),
    correlation_id: correlationId,
  });
}

function emitModuleEvent(subtype, payload, correlationId) {
  return emitTelemetry({
    kind: "state-change",
    payload: Object.assign({ subtype }, payload || {}),
    correlation_id: correlationId,
  });
}

module.exports = {
  emitTelemetry,
  emitInstallEvent,
  emitModuleEvent,
  resolveContext,
  buildEvent,
};
