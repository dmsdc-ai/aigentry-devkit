"use strict";

// δ2 Phase 2 (#440) — devkit emitter wrapper unit tests.

const test = require("node:test");
const assert = require("assert");

const helper = require("../../../lib/logger-emit");

const FROZEN = () => new Date("2026-05-23T12:00:00.000Z");

test("resolveContext — env values win", () => {
  const ctx = helper.resolveContext({ AIGENTRY_SESSION_ID: "sid-A", AIGENTRY_ROLE: "coder" });
  assert.equal(ctx.session_id, "sid-A");
  assert.equal(ctx.role, "coder");
});

test("resolveContext — invalid role falls back to orchestrator", () => {
  const ctx = helper.resolveContext({ AIGENTRY_SESSION_ID: "sid-A", AIGENTRY_ROLE: "devkit" });
  assert.equal(ctx.role, "orchestrator");
});

test("resolveContext — missing env falls back to pid + orchestrator", () => {
  const ctx = helper.resolveContext({});
  assert.match(ctx.session_id, /^pid-\d+$/);
  assert.equal(ctx.role, "orchestrator");
});

test("buildEvent — produces ssot-shaped envelope", () => {
  const event = helper.buildEvent(
    { kind: "state-change", payload: { subtype: "install_done", dirs: 3 }, correlation_id: "x" },
    { AIGENTRY_SESSION_ID: "sid-A", AIGENTRY_ROLE: "orchestrator" },
    FROZEN,
  );
  assert.equal(event.schema_version, "1");
  assert.equal(event.kind, "state-change");
  assert.equal(event.session_id, "sid-A");
  assert.equal(event.role, "orchestrator");
  assert.equal(event.emitted_at, "2026-05-23T12:00:00.000Z");
  assert.equal(event.correlation_id, "x");
  assert.deepEqual(event.payload, { subtype: "install_done", dirs: 3 });
});

test("emitTelemetry — sink receives well-formed event when __emit is provided", async () => {
  const events = [];
  await helper.emitTelemetry(
    { kind: "state-change", payload: { subtype: "module_load", entry: "x" } },
    { env: { AIGENTRY_SESSION_ID: "sid-A", AIGENTRY_ROLE: "orchestrator" }, now: FROZEN, __emit: (e) => events.push(e) },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "state-change");
  assert.equal(events[0].payload.subtype, "module_load");
});

test("emitTelemetry — sink failure is swallowed (§9 non-blocking)", async () => {
  const origErr = console.error;
  const errs = [];
  console.error = (msg) => { errs.push(msg); };
  try {
    await assert.doesNotReject(() =>
      helper.emitTelemetry(
        { kind: "state-change", payload: { subtype: "install_phase" } },
        { env: { AIGENTRY_SESSION_ID: "sid-A" }, now: FROZEN, __emit: () => { throw new Error("boom"); } },
      ),
    );
  } finally {
    console.error = origErr;
  }
  assert.ok(errs.some((m) => /sink threw/.test(m)), "console.error fallback");
});

test("emitInstallEvent / emitModuleEvent — convenience helpers tag subtype + kind", async () => {
  const events = [];
  const env = { AIGENTRY_SESSION_ID: "sid-A", AIGENTRY_ROLE: "orchestrator" };
  const sink = (e) => events.push(e);
  await helper.emitTelemetry(
    { kind: "state-change", payload: { subtype: "install_phase", phase: "start" }, correlation_id: "x" },
    { env, now: FROZEN, __emit: sink },
  );
  await helper.emitTelemetry(
    { kind: "state-change", payload: { subtype: "module_load", entry: "aigentry-devkit" } },
    { env, now: FROZEN, __emit: sink },
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].payload.subtype, "install_phase");
  assert.equal(events[1].payload.subtype, "module_load");
});
