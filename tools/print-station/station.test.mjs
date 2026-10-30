import { test } from "node:test";
import assert from "node:assert/strict";
import { handleJob, runLoop, sleepUnless } from "./station.mjs";

// The loop with a scripted API: what the station does with a job, a print failure, an outage and a
// refusal — without a network, a printer or a real clock.

const CONFIG = { apiUrl: "https://app.example.com", token: "t0k", stationName: "Office PC" };
const JOB = { jobId: "44444444-4444-4444-8444-444444444444", systemName: "MUNBYN RW403B", labelCount: 1, payloadBase64: Buffer.from("SIZE").toString("base64") };

function harness(script) {
  const calls = [];
  const printed = [];
  let i = 0;
  const deps = {
    hostName: "OFFICE-PC",
    now: () => 0,
    sleep: async () => {},
    listPrinters: async () => [{ name: "MUNBYN RW403B" }],
    printRaw: async (name, bytes) => {
      if (deps.printFails) throw new Error(deps.printFails);
      printed.push({ name, bytes: bytes.toString() });
    },
    stop: () => i >= script.length,
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : undefined });
      const step = path.endsWith("/hello") ? { status: 200, body: deps.helloAnswer ?? { ok: true } } : script[i++] ?? { status: 204 };
      if (step.throw) throw new Error(step.throw);
      return new Response(step.body === undefined ? null : JSON.stringify(step.body), { status: step.status });
    },
  };
  return { deps, calls, printed };
}

test("a job is printed with its own bytes on its own printer, then reported printed", async () => {
  const h = harness([{ status: 200, body: { ok: true, job: JOB } }, { status: 200, body: { ok: true, status: "printed" } }]);
  assert.equal(await runLoop(CONFIG, h.deps), "stopped");
  assert.deepEqual(h.printed, [{ name: "MUNBYN RW403B", bytes: "SIZE" }]);
  const report = h.calls.find((c) => c.path.endsWith("/report"));
  assert.deepEqual(report.body, { ok: true });
  assert.ok(h.calls.every((c) => c.auth === "Bearer t0k"));
  assert.deepEqual(h.calls[0].body.printers, [{ name: "MUNBYN RW403B" }], "says hello with this machine's printers first");
});

test("the hello carries the serial ports and scanner states, and hands its answer's scanners to the relay", async () => {
  const h = harness([{ status: 204 }]);
  const synced = [];
  const scanner = { id: "55555555-5555-4555-8555-555555555555", portName: "COM3", vendorId: "0581", productId: "0215" };
  h.deps.helloAnswer = { ok: true, stationName: "Office PC", scanners: [scanner] };
  h.deps.scanners = {
    refreshPorts: async () => [{ name: "COM3", vendorId: "0581", productId: "0215" }],
    states: () => [{ scannerId: scanner.id, state: "reading", portName: "COM3" }],
    sync: (list) => synced.push(list),
  };
  assert.equal(await runLoop(CONFIG, h.deps), "stopped");
  assert.deepEqual(h.calls[0].body.serialPorts, [{ name: "COM3", vendorId: "0581", productId: "0215" }]);
  assert.deepEqual(h.calls[0].body.scannerStates, [{ scannerId: scanner.id, state: "reading", portName: "COM3" }]);
  assert.equal(h.calls[0].body.agentVersion, "1.1.0");
  assert.deepEqual(synced, [[scanner]]);
});

test("an older Silvicom answers the hello without scanners: nothing is read, and printing goes on", async () => {
  const h = harness([{ status: 200, body: { ok: true, job: JOB } }, { status: 200, body: { ok: true, status: "printed" } }]);
  const synced = [];
  h.deps.scanners = { refreshPorts: async () => [], states: () => [], sync: (list) => synced.push(list) };
  assert.equal(await runLoop(CONFIG, h.deps), "stopped");
  assert.deepEqual(synced, []);
  assert.equal(h.printed.length, 1);
});

test("a print failure is reported with the system's words, and the station carries on", async () => {
  const h = harness([{ status: 200, body: { ok: true, job: JOB } }, { status: 200, body: { ok: true } }, { status: 204 }]);
  h.deps.printFails = "The printer is out of paper.";
  assert.equal(await runLoop(CONFIG, h.deps), "stopped");
  assert.deepEqual(h.calls.find((c) => c.path.endsWith("/report")).body, { ok: false, error: "The printer is out of paper." });
  assert.equal(h.calls.filter((c) => c.path.endsWith("/jobs/next")).length, 2);
});

test("an outage is waited out, not fatal", async () => {
  const h = harness([{ throw: "fetch failed" }, { status: 503, body: {} }, { status: 204 }]);
  assert.equal(await runLoop(CONFIG, h.deps), "stopped");
  assert.equal(h.calls.filter((c) => c.path.endsWith("/jobs/next")).length, 3);
});

test("a refused token stops the station instead of hammering the server", async () => {
  const h = harness([{ status: 401, body: { error: { code: "unauthorized", message: "Invalid print station token" } } }, { status: 204 }]);
  assert.equal(await runLoop(CONFIG, h.deps), "refused");
  assert.equal(h.calls.filter((c) => c.path.endsWith("/jobs/next")).length, 1);
});

test("a report that cannot land is retried, then left for Silvicom to call unknown", async () => {
  const h = harness([{ throw: "down" }, { throw: "down" }, { throw: "down" }, { throw: "down" }, { throw: "down" }]);
  const outcome = await handleJob(JOB, CONFIG, h.deps);
  assert.deepEqual(outcome, { ok: true });
  assert.equal(h.calls.filter((c) => c.path.endsWith("/report")).length, 5);
});

// PS5, 10/29: a SIGTERM waited out the 25-second long poll, so the station looked like it ignored it.
// Each wait below has a deadline, so a stop that is ignored fails here instead of hanging the run.

const within = (ms, promise) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms).unref())]);

test("a stop ends a long poll at once, and is not logged as an outage", async () => {
  const stop = new AbortController();
  const h = harness([]);
  let polls = 0;
  const slept = [];
  Object.assign(h.deps, {
    signal: stop.signal,
    stop: () => stop.signal.aborted,
    sleep: async (ms) => slept.push(ms),
    // A poll that never answers by itself — only an abort of its signal ends it.
    fetchImpl: async (url, init) => {
      if (new URL(url).pathname.endsWith("/hello")) return new Response("{}", { status: 200 });
      polls += 1;
      setTimeout(() => stop.abort(), 5);
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
    },
  });
  assert.equal(await within(1_000, runLoop(CONFIG, h.deps)), "stopped");
  assert.equal(polls, 1);
  assert.deepEqual(slept, [], "no backoff after a stop");
});

test("a label already in hand is printed and reported even when the stop comes mid-print", async () => {
  const stop = new AbortController();
  const h = harness([]);
  const reports = [];
  Object.assign(h.deps, {
    signal: stop.signal,
    stop: () => stop.signal.aborted,
    printRaw: async () => stop.abort(),
    fetchImpl: async (url, init) => {
      assert.equal(init.signal.aborted, false, "the report is not sent with the stop signal");
      reports.push(new URL(url).pathname);
      return new Response("{}", { status: 200 });
    },
  });
  assert.deepEqual(await handleJob(JOB, CONFIG, h.deps), { ok: true });
  assert.deepEqual(reports, [`/api/print-station/jobs/${JOB.jobId}/report`]);
});

test("sleepUnless waits, and a stop cuts the wait short", async () => {
  const stop = new AbortController();
  const sleep = sleepUnless(stop.signal);
  const started = Date.now();
  setTimeout(() => stop.abort(), 10);
  await within(1_000, sleep(60_000));
  assert.ok(Date.now() - started < 1_000);
  await within(1_000, sleep(60_000)); // already stopped: no wait at all
  const plain = sleepUnless(new AbortController().signal);
  const t0 = Date.now();
  await plain(30);
  assert.ok(Date.now() - t0 >= 25);
});

test("after a stop, a report that fails is not retried", async () => {
  const h = harness([{ throw: "down" }, { throw: "down" }, { throw: "down" }]);
  h.deps.stop = () => true;
  assert.deepEqual(await handleJob(JOB, CONFIG, h.deps), { ok: true });
  assert.equal(h.calls.filter((c) => c.path.endsWith("/report")).length, 1);
});
