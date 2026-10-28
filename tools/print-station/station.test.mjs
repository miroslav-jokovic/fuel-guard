import { test } from "node:test";
import assert from "node:assert/strict";
import { handleJob, runLoop } from "./station.mjs";

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
      const step = path.endsWith("/hello") ? { status: 200, body: { ok: true } } : script[i++] ?? { status: 204 };
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
