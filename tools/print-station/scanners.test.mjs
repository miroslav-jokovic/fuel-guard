import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createScannerRelay, READ_HOLD_MS } from "./scanners.mjs";

// The relay with fake ports, fake reader processes and a scripted API — no scanner, no network.

const CONFIG = { apiUrl: "https://app.example.com", token: "t0k" };
const SCANNER = { id: "55555555-5555-4555-8555-555555555555", portName: "COM3", vendorId: "0581", productId: "0215" };

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit("close", null);
  };
  return child;
}

function harness({ ports = [{ name: "COM3", vendorId: "0581", productId: "0215" }], respond } = {}) {
  let clock = 1_000;
  const spawned = [];
  const posts = [];
  const logs = [];
  const deps = {
    listSerialPorts: async () => ports,
    spawnReader: (port) => {
      const child = fakeChild();
      spawned.push({ port, child });
      return child;
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    log: (line) => logs.push(line),
    fetchImpl: async (url, init) => {
      posts.push({ path: new URL(url).pathname, auth: init.headers.authorization, body: JSON.parse(init.body) });
      const step = respond ? respond(posts.length) : { status: 200, body: { ok: true, delivered: true } };
      if (step.throw) throw new Error(step.throw);
      return new Response(JSON.stringify(step.body ?? {}), { status: step.status });
    },
  };
  const relay = createScannerRelay(CONFIG, deps);
  return {
    relay,
    spawned,
    posts,
    logs,
    setPorts: (p) => (ports = p),
    advance: (ms) => (clock += ms),
  };
}

test("an assigned scanner is read on its port, and each read is sent with the station's token", async () => {
  const h = harness();
  await h.relay.refreshPorts();
  h.relay.sync([SCANNER]);
  assert.equal(h.spawned.length, 1);
  assert.equal(h.spawned[0].port, "COM3");
  h.advance(40);
  h.spawned[0].child.stdout.emit("data", Buffer.from("SIL1:AST:7K3M9P\r\n"));
  await h.relay.flushed();
  assert.equal(h.posts.length, 1);
  assert.deepEqual(h.posts[0], {
    path: "/api/print-station/scans",
    auth: "Bearer t0k",
    body: { scannerId: SCANNER.id, code: "SIL1:AST:7K3M9P", ageMs: 0 },
  });
  assert.deepEqual(h.relay.states(), [{ scannerId: SCANNER.id, state: "reading", portName: "COM3" }]);
  h.relay.stop();
});

test("a second sync keeps the reader it already has; a removed scanner's reader is stopped", async () => {
  const h = harness();
  await h.relay.refreshPorts();
  h.relay.sync([SCANNER]);
  h.relay.sync([SCANNER]);
  assert.equal(h.spawned.length, 1);
  h.relay.sync([]);
  assert.equal(h.spawned[0].child.killed, true);
  assert.deepEqual(h.relay.states(), []);
});

test("a port the system does not have is waiting; a renumbered one is followed by its USB ids", async () => {
  const h = harness({ ports: [] });
  await h.relay.refreshPorts();
  h.relay.sync([SCANNER]);
  assert.equal(h.spawned.length, 0);
  assert.deepEqual(h.relay.states(), [{ scannerId: SCANNER.id, state: "waiting", portName: null }]);
  h.setPorts([{ name: "COM5", vendorId: "0581", productId: "0215" }]);
  await h.relay.refreshPorts();
  h.relay.sync([SCANNER]);
  assert.equal(h.spawned[0].port, "COM5");
  assert.equal(h.relay.states()[0].portName, "COM5");
  h.relay.stop();
});

test("a reader that dies is failed with the system's own words", async () => {
  const h = harness();
  await h.relay.refreshPorts();
  h.relay.sync([SCANNER]);
  const { child } = h.spawned[0];
  child.stderr.emit("data", "Exception calling \"Open\"\r\nAccess to the port 'COM3' is denied.\r\n");
  child.emit("close", 1);
  assert.deepEqual(h.relay.states(), [
    { scannerId: SCANNER.id, state: "failed", portName: "COM3", error: "Access to the port 'COM3' is denied." },
  ]);
  h.relay.stop();
});

test("an outage is retried, in order; a read held past 30 s is dropped, never sent late", async () => {
  let n = 0;
  const h = harness({
    respond: () => {
      n += 1;
      return n <= 2 ? { throw: "fetch failed" } : { status: 200, body: { ok: true, delivered: false } };
    },
  });
  await h.relay.refreshPorts();
  h.relay.sync([SCANNER]);
  h.spawned[0].child.stdout.emit("data", "FIRST1\rSECOND\r");
  await h.relay.flushed();
  const sent = h.posts.map((p) => p.body.code);
  assert.deepEqual(sent, ["FIRST1", "FIRST1", "FIRST1", "SECOND"]);
  assert.ok(h.posts[2].body.ageMs > 0, "the retry says how old the read is");

  const down = harness({ respond: () => ({ throw: "fetch failed" }) });
  await down.relay.refreshPorts();
  down.relay.sync([SCANNER]);
  down.spawned[0].child.stdout.emit("data", "STALE1\r");
  await down.relay.flushed();
  assert.ok(down.posts.every((p) => p.body.ageMs <= READ_HOLD_MS));
  assert.ok(down.logs.some((l) => l.includes("dropped a read") && l.includes("STALE1")));
  down.relay.stop();
  h.relay.stop();
});

test("a refused read is dropped and the relay carries on — it never stops the station", async () => {
  const h = harness({ respond: (i) => (i === 1 ? { status: 404, body: { error: { message: "not found" } } } : { status: 200, body: { ok: true, delivered: true } }) });
  await h.relay.refreshPorts();
  h.relay.sync([SCANNER]);
  h.spawned[0].child.stdout.emit("data", "GONE01\rNEXT01\r");
  await h.relay.flushed();
  assert.deepEqual(h.posts.map((p) => p.body.code), ["GONE01", "NEXT01"]);
  assert.ok(h.logs.some((l) => l.includes("refused") && l.includes("GONE01")));
  h.relay.stop();
});

test("stop kills every reader, and a dead reader is not then reported as failed", async () => {
  const h = harness();
  await h.relay.refreshPorts();
  h.relay.sync([SCANNER]);
  h.relay.stop();
  assert.equal(h.spawned[0].child.killed, true);
  assert.equal(h.relay.states()[0].state, "reading");
});
