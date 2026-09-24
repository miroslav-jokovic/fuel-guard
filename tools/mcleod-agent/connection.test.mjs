import test from "node:test";
import assert from "node:assert/strict";
import {
  createConnector,
  wrapStatement,
  isBusySignal,
  SESSION_SETTINGS,
  STATEMENT_TIMEOUT_MS,
  BREAKER_PAUSE_MS,
  APP_NAME,
} from "./connection.mjs";

/**
 * Every promise the letter to the carrier makes about HOW we read, asserted against a fake `mssql`
 * that records what would have gone on the wire. No server is needed and none is touched.
 */
function fakeMssql({ failWith = null } = {}) {
  const sent = [];
  const pools = [];
  class ConnectionPool {
    constructor(config) {
      this.config = config;
      this.connected = false;
      this.closed = false;
      pools.push(this);
    }
    async connect() {
      this.connected = true;
    }
    async close() {
      this.connected = false;
      this.closed = true;
    }
    request() {
      const inputs = {};
      return {
        input(name, type, value) {
          inputs[name] = { type, value };
          return this;
        },
        async query(sql) {
          sent.push({ sql, inputs });
          const err = typeof failWith === "function" ? failWith(sent.length) : failWith;
          if (err) throw err;
          return { recordset: [{ ok: 1 }] };
        },
      };
    }
  }
  return { mssql: { ConnectionPool, VarChar: (n) => `VarChar(${n})` }, sent, pools };
}

const CFG = { server: "10.0.1.171", port: 1433, database: "lme", user: "u", password: "p", encrypt: false };
const lockTimeout = Object.assign(new Error("Lock request time out period exceeded."), { number: 1222 });

test("every statement goes out with the session settings first and MAXDOP 1 on its own line last", async () => {
  const f = fakeMssql();
  const c = createConnector({ loadMssql: async () => f.mssql });
  await c.withPool(CFG, (pool) => pool.request().query("SELECT 1 AS x -- a trailing comment"));
  const sql = f.sent[0].sql;
  for (const s of ["SET LOCK_TIMEOUT 5000;", "SET DEADLOCK_PRIORITY LOW;", "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;"]) {
    assert.ok(sql.startsWith(SESSION_SETTINGS.join(" ")) && sql.includes(s), `missing ${s}`);
  }
  // On its own line: a statement ending in a -- comment would otherwise swallow the hint.
  assert.match(sql, /-- a trailing comment\nOPTION \(MAXDOP 1\)$/);
});

test("a statement may not bring its own query hint", () => {
  assert.throws(() => wrapStatement("SELECT 1 OPTION (MAXDOP 8)"), /owns query hints/);
});

test("one connection, fifteen-second ceiling, read-only intent, named for the DBA", async () => {
  const f = fakeMssql();
  const c = createConnector({ loadMssql: async () => f.mssql });
  await c.withPool(CFG, (pool) => pool.request().query("SELECT 1"));
  const cfg = f.pools[0].config;
  assert.equal(cfg.pool.max, 1);
  assert.equal(cfg.requestTimeout, STATEMENT_TIMEOUT_MS);
  assert.equal(STATEMENT_TIMEOUT_MS, 15_000);
  assert.equal(cfg.options.readOnlyIntent, true);
  assert.equal(cfg.options.appName, APP_NAME);
});

test("outside the service a call opens and closes; inside it one held connection is reused", async () => {
  const f = fakeMssql();
  const c = createConnector({ loadMssql: async () => f.mssql });
  await c.withPool(CFG, (pool) => pool.request().query("SELECT 1"));
  assert.equal(f.pools.length, 1);
  assert.equal(f.pools[0].closed, true);

  c.hold();
  await c.withPool(CFG, (pool) => pool.request().query("SELECT 1"));
  await c.withPool(CFG, (pool) => pool.request().query("SELECT 2"));
  assert.equal(f.pools.length, 2, "the held connection was opened once for two calls");
  assert.equal(f.pools[1].closed, false);
  await c.release();
  assert.equal(f.pools[1].closed, true);
});

test("three busy signals in a row open the breaker, and an open breaker never reaches the server", async () => {
  let t = 1_000_000;
  const f = fakeMssql({ failWith: lockTimeout });
  const c = createConnector({ loadMssql: async () => f.mssql, now: () => t });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(c.withPool(CFG, (pool) => pool.request().query("SELECT 1")), /Lock request/);
  }
  assert.equal(c.breakerState().open, true);
  const before = { sent: f.sent.length, pools: f.pools.length };
  await assert.rejects(c.withPool(CFG, (pool) => pool.request().query("SELECT 1")), /circuit breaker open/);
  assert.deepEqual({ sent: f.sent.length, pools: f.pools.length }, before, "not even a login while open");

  t += BREAKER_PAUSE_MS;
  assert.equal(c.breakerState().open, false, "the pause ends after fifteen minutes");
});

test("our own mistakes do not trip the breaker, and a success resets the count", async () => {
  const syntax = Object.assign(new Error("Incorrect syntax near 'FROM'."), { number: 102 });
  const f = fakeMssql({ failWith: (n) => (n === 3 ? null : n <= 2 ? lockTimeout : syntax) });
  const c = createConnector({ loadMssql: async () => f.mssql });
  const q = () => c.withPool(CFG, (pool) => pool.request().query("SELECT 1"));
  await assert.rejects(q());
  await assert.rejects(q());
  await q(); // success after two busy signals
  for (let i = 0; i < 5; i++) await assert.rejects(q(), /syntax/);
  assert.equal(c.breakerState().open, false);
});

test("the busy signals are exactly lock timeout and the driver's timeout", () => {
  assert.equal(isBusySignal(lockTimeout), true);
  assert.equal(isBusySignal(Object.assign(new Error("x"), { code: "ETIMEOUT" })), true);
  assert.equal(isBusySignal(Object.assign(new Error("Login failed"), { number: 18456 })), false);
});

test("an encrypted connection to a bare IP is refused rather than silently downgraded", async () => {
  const f = fakeMssql();
  const c = createConnector({ loadMssql: async () => f.mssql });
  await assert.rejects(c.withPool({ ...CFG, encrypt: true }, () => null), /TLS will not accept an IP address/);
});
