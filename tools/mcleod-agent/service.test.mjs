import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  POST_ATTEMPTS,
  RefusedError,
  LOCK_STALE_MS,
  loadServiceState,
  postJson,
  saveServiceState,
  serviceConfigProblems,
  takeLock,
  validateIngestUrl,
} from "./service.mjs";

/**
 * The service's unattended-running guarantees (production-readiness audit, 2026-09-28): each test
 * names the defect it pins, because each one was found in code that had been merged and gate-green.
 */

const tmp = () => mkdtempSync(join(tmpdir(), "silvicom-service-"));
const noSleep = async () => {};
const reply = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// ── postJson ─────────────────────────────────────────────────────────────────────────────────────

test("a refused token is reported at once and never retried", async () => {
  let calls = 0;
  const fetchImpl = async () => (calls++, reply(401));
  await assert.rejects(
    postJson({ origin: "https://api.example", path: "/api/tms/x", token: "t", body: {}, fetchImpl, sleep: noSleep }),
    // The operator must be told WHICH setting to fix, not just that something was refused.
    (e) => e instanceof RefusedError && /FUELGUARD_INGEST_TOKEN/.test(e.message),
  );
  assert.equal(calls, 1);
});

test("a rejected payload (4xx) is reported once with the API's message, never retried", async () => {
  let calls = 0;
  const fetchImpl = async () => (calls++, reply(400, { error: { code: "invalid_payload", message: "movements.0.movement_id: Required" } }));
  await assert.rejects(
    postJson({ origin: "https://api.example", path: "/api/tms/x", token: "t", body: {}, fetchImpl, sleep: noSleep }),
    (e) => e instanceof RefusedError && /HTTP 400/.test(e.message) && /movement_id: Required/.test(e.message),
  );
  assert.equal(calls, 1);
});

test("a 5xx, a 429 and a network error are retried, and the fourth attempt's success is returned", async () => {
  const script = [reply(503), reply(429), new TypeError("fetch failed"), reply(200, { ok: true, stored: 3 })];
  let calls = 0;
  const fetchImpl = async () => {
    const next = script[calls++];
    if (next instanceof Error) throw next;
    return next;
  };
  const out = await postJson({ origin: "https://api.example", path: "/p", token: "t", body: {}, fetchImpl, sleep: noSleep });
  assert.deepEqual(out, { ok: true, stored: 3 });
  assert.equal(calls, POST_ATTEMPTS);
});

test("an API that never answers is given up on after the timeout, on every attempt", async () => {
  let calls = 0;
  // A fetch that honours its AbortSignal and otherwise hangs forever — the defect was having no signal.
  const fetchImpl = (_url, init) =>
    new Promise((_, reject) => {
      calls++;
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    });
  const t0 = Date.now();
  await assert.rejects(
    postJson({ origin: "https://api.example", path: "/p", token: "t", body: {}, fetchImpl, sleep: noSleep, timeoutMs: 20 }),
    /unreachable after 4 attempts: no answer within 0.02 s/,
  );
  assert.equal(calls, POST_ATTEMPTS);
  assert.ok(Date.now() - t0 < 5_000);
});

test("the token is sent only to the configured origin, and a redirect is refused rather than followed", async () => {
  let seen;
  const fetchImpl = async (url, init) => ((seen = { url, init }), reply(200, {}));
  await postJson({ origin: "https://api.example", path: "/api/tms/roster", token: "fgtms_abc", body: { a: 1 }, fetchImpl, sleep: noSleep });
  assert.equal(seen.url, "https://api.example/api/tms/roster");
  assert.equal(seen.init.headers.authorization, "Bearer fgtms_abc");
  assert.equal(seen.init.redirect, "error");
  assert.ok(seen.init.signal instanceof AbortSignal);
});

// ── validateIngestUrl ────────────────────────────────────────────────────────────────────────────

test("the ingest URL must be an https origin; plain http is allowed only to this machine", () => {
  assert.equal(validateIngestUrl("https://fleetguardapi-production.up.railway.app/"), "https://fleetguardapi-production.up.railway.app");
  assert.equal(validateIngestUrl("http://localhost:3000"), "http://localhost:3000");
  assert.throws(() => validateIngestUrl("http://fleetguardapi-production.up.railway.app"), /must be https/);
  assert.throws(() => validateIngestUrl("https://host.example/api/tms"), /origin only/);
  assert.throws(() => validateIngestUrl("https://user:pw@host.example"), /credentials/);
  assert.throws(() => validateIngestUrl("fleetguardapi-production.up.railway.app"), /not a URL/);
});

// ── takeLock ─────────────────────────────────────────────────────────────────────────────────────

test("a second copy refuses to start while the first holds a fresh lock", () => {
  const path = join(tmp(), "service.lock");
  const first = takeLock(path, { pid: 1111, kill: () => true });
  assert.throws(() => takeLock(path, { pid: 2222, kill: () => true }), /already running \(pid 1111/);
  first.release();
  assert.equal(existsSync(path), false);
});

test("a lock whose process is gone, or untouched past the stale bound, is taken over", () => {
  const dir = tmp();
  const gone = join(dir, "a.lock");
  writeFileSync(gone, "1111");
  const esrch = () => Object.assign(new Error("no such process"), { code: "ESRCH" });
  const taken = takeLock(gone, { pid: 2222, kill: () => { throw esrch(); } });
  assert.equal(readFileSync(gone, "utf8"), "2222");
  taken.release();

  const stale = join(dir, "b.lock");
  writeFileSync(stale, "1111");
  const old = (Date.now() - LOCK_STALE_MS - 1000) / 1000;
  utimesSync(stale, old, old);
  takeLock(stale, { pid: 3333, kill: () => true }).release();
});

test("the heartbeat keeps the lock fresh, and stops the service once another copy holds it", () => {
  const path = join(tmp(), "service.lock");
  const lock = takeLock(path, { pid: 1111, kill: () => true });
  const old = (Date.now() - LOCK_STALE_MS - 1000) / 1000;
  utimesSync(path, old, old);
  lock.heartbeat();
  // Fresh again, so a second copy is still refused — the defect was a heartbeat only between cycles.
  assert.throws(() => takeLock(path, { pid: 2222, kill: () => true }), /already running/);

  writeFileSync(path, "2222"); // an operator removed it and another copy took it
  assert.throws(() => lock.heartbeat(), /lock lost/);
  assert.equal(readFileSync(path, "utf8"), "2222", "the heartbeat must not write its pid over another copy's");
  lock.release();
  assert.equal(readFileSync(path, "utf8"), "2222", "release must not delete another copy's lock");
});

// ── service state ────────────────────────────────────────────────────────────────────────────────

test("state survives a round trip, and a missing file is an empty state", () => {
  const path = join(tmp(), "service-state.json");
  assert.deepEqual(loadServiceState(path), { runs: {}, posted: {}, mirrored: {}, board: [], dispatchersHash: null });
  const state = { runs: { loads: { succeededAt: 1 } }, posted: {}, mirrored: { "TMS:1": "h" }, board: ["TMS:1"], dispatchersHash: "d" };
  saveServiceState(path, state);
  assert.deepEqual(loadServiceState(path), state);
  assert.equal(existsSync(`${path}.tmp`), false);
});

test("a half-written state file falls back to the previous good copy instead of crash-looping", () => {
  const path = join(tmp(), "service-state.json");
  saveServiceState(path, { runs: {}, posted: {}, mirrored: { "TMS:1": "old" }, board: [], dispatchersHash: null });
  saveServiceState(path, { runs: {}, posted: {}, mirrored: { "TMS:1": "new" }, board: [], dispatchersHash: null });
  writeFileSync(path, '{"runs": {"loads": '); // what power loss mid-write used to leave
  const logs = [];
  const state = loadServiceState(path, { log: (m) => logs.push(m) });
  assert.equal(state.mirrored["TMS:1"], "old");
  assert.match(logs.join("\n"), /resumed from .*\.bak/);
});

test("with no readable copy at all, it stops and names the file rather than forgetting what it owes", () => {
  const path = join(tmp(), "service-state.json");
  writeFileSync(path, "{broken");
  assert.throws(() => loadServiceState(path), /cannot be read .*close read still owes/);
});

// ── serviceConfigProblems ────────────────────────────────────────────────────────────────────────

test("the service refuses to retire by absence, and refuses to run as a dry run", () => {
  assert.deepEqual(serviceConfigProblems({ rosterMode: "identity", dryRun: false }), []);
  assert.match(serviceConfigProblems({ rosterMode: "reconcile", dryRun: false })[0], /Part 5/);
  assert.match(serviceConfigProblems({ rosterMode: "identity", dryRun: true })[0], /cannot run as a dry run/);
});
