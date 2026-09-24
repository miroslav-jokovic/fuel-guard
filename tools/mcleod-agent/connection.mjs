/**
 * The ONLY door to the carrier's SQL Server (CA2 in docs/plans/mcleod/COLLECTOR-AUDIT-2026-09-24.md,
 * which is L5 of LOADS-GO-LIVE-PLAN.md).
 *
 * Every promise the letter to the carrier makes about HOW we read — one connection, lock timeout,
 * low deadlock priority, one core, read committed, a 15-second ceiling, backing off a busy server —
 * is kept here, once, so that no call site can forget one. `scripts/check-agent-syntax.mjs` fails any
 * other file that opens a pool, and `connection.test.mjs` pins each setting.
 *
 * Why these and not others, all measured on APPNEW on 2026-09-24:
 *  · `READ_COMMITTED_SNAPSHOT` is OFF on `lme`, so a reader can block a dispatcher's write. We cannot
 *    turn it on, so we make sure we are always the one who yields: `LOCK_TIMEOUT 5000` gives up a
 *    busy row after five seconds, `DEADLOCK_PRIORITY LOW` makes us the victim of any deadlock.
 *  · `OPTION (MAXDOP 1)` cost nothing on any statement we run (16 ms with or without) and removes the
 *    only way a 16 ms read could take several of their 42 cores at once. There is no session-level
 *    MAXDOP in SQL Server, so it is appended to each statement — on its OWN LINE, because several
 *    statements end in a `--` comment that would otherwise swallow it.
 *  · 15 seconds: the slowest statement after the MOVEMENT_FACTS fix (CA1) takes 1.4 s.
 *  · The settings are re-sent with every statement rather than once per connection. A pooled
 *    connection can be reset between uses, and re-sending three SET statements costs nothing
 *    measurable; trusting that they survived is the kind of assumption this file exists to remove.
 */

/** Sent ahead of every statement. `review/build-routine.mjs` prints these exact lines for the DBA. */
export const SESSION_SETTINGS = [
  "SET NOCOUNT ON;",
  "SET LOCK_TIMEOUT 5000;",
  "SET DEADLOCK_PRIORITY LOW;",
  "SET TRANSACTION ISOLATION LEVEL READ COMMITTED;",
];

export const STATEMENT_HINT = "OPTION (MAXDOP 1)";
export const STATEMENT_TIMEOUT_MS = 15_000;
export const BREAKER_THRESHOLD = 3;
export const BREAKER_PAUSE_MS = 15 * 60_000;

/**
 * What the DBA sees as `program_name` in sys.dm_exec_sessions. Every McLeod read goes through this
 * file — roster, loads, finance and discovery alike — so it names the product, not one feed, and the
 * letter tells them to look for exactly this string.
 */
export const APP_NAME = "Silvicom 360 connector";

/** The statement exactly as it goes on the wire. Pure, so the review file can print it too. */
export function wrapStatement(sql) {
  const body = String(sql).trim();
  if (/\bOPTION\s*\(/i.test(body)) {
    throw new Error("A statement brings its own OPTION clause; the connector owns query hints (CA2).");
  }
  return `${SESSION_SETTINGS.join(" ")}\n${body}\n${STATEMENT_HINT}`;
}

/**
 * SQL Server's lock-timeout error (1222) and the driver's own timeout are the two ways a busy server
 * tells us to go away. Anything else — a syntax error, a permission error — is our fault and must
 * not trip the breaker, or a bad deploy would read as a busy carrier and hide itself for 15 minutes.
 */
export function isBusySignal(err) {
  if (!err) return false;
  if (err.number === 1222) return true;
  if (err.code === "ETIMEOUT" || err.code === "ETIMEDOUT") return true;
  return /Lock request time out period exceeded|Timeout: Request failed to complete/i.test(String(err.message ?? ""));
}

/**
 * Build a connector around an `mssql` module. The agent uses the default instance below; tests pass
 * a fake `mssql` and a fake clock so every promise can be asserted without a server.
 */
export function createConnector({ loadMssql = async () => (await import("mssql")).default, now = () => Date.now() } = {}) {
  let held = null; // { pool, key } while --service holds its one connection
  let holding = false;
  let consecutiveBusy = 0;
  let openUntil = 0;

  function breakerState() {
    return { consecutiveBusy, open: now() < openUntil, openUntil };
  }

  async function open(cfg) {
    const mssql = await loadMssql();
    const { server, port, database, user, password, encrypt, trustCert, serverName } = cfg;
    const wantEncrypt = encrypt !== false;

    // TLS cannot name an IP address. The carrier's LoadMaster host IS an IP (10.0.1.171), so the default
    // encrypted connection fails outright with ERR_INVALID_ARG_VALUE from Node's TLS layer.
    //
    // The tempting fix is to notice the IP and quietly drop to an unencrypted connection. That is not
    // done here: silently downgrading transport security because a hostname was inconvenient is how a
    // credential ends up on the wire in plaintext without anybody deciding it should. Both real fixes are
    // one line of config, and the operator picks:
    //   · MCLEOD_SQL_SERVERNAME=<the name on the server's certificate> — keeps TLS, correct answer;
    //   · MCLEOD_SQL_ENCRYPT=false — no TLS, defensible on a private LAN, but it must be TYPED.
    const isIpLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(String(server)) || String(server).includes(":");
    if (wantEncrypt && isIpLiteral && !serverName) {
      throw new Error(
        `Cannot open an encrypted connection to ${server}: TLS will not accept an IP address as a server name.\n` +
          `  Either set MCLEOD_SQL_SERVERNAME to the hostname on the SQL Server certificate (keeps encryption),\n` +
          `  or set MCLEOD_SQL_ENCRYPT=false to connect without TLS (acceptable only on a trusted private network).`,
      );
    }

    const pool = new mssql.ConnectionPool({
      server,
      port,
      database,
      user,
      password,
      options: {
        encrypt: wantEncrypt,
        ...(serverName ? { serverName } : {}),
        trustServerCertificate: trustCert !== false,
        // Advisory, but it documents the posture in their connection logs and lets a DBA route us to a
        // readable secondary if they ever run one.
        readOnlyIntent: true,
        appName: APP_NAME,
      },
      requestTimeout: STATEMENT_TIMEOUT_MS,
      // ONE connection. Every feed runs one statement at a time (the scheduler in agent.mjs never runs
      // two feeds together), so a second connection could only ever be idle — or a bug.
      pool: { max: 1, min: 0, idleTimeoutMillis: 300_000 },
    });
    await pool.connect();
    return { pool, mssql };
  }

  /** The object handed to call sites: `request()` returns a request whose `query()` is wrapped. */
  function guarded(pool) {
    return {
      request() {
        const req = pool.request();
        const query = req.query.bind(req);
        req.query = async (sql) => {
          if (now() < openUntil) {
            const mins = Math.ceil((openUntil - now()) / 60_000);
            throw new Error(`McLeod circuit breaker open — the server was busy; not querying for another ${mins} min.`);
          }
          try {
            const res = await query(wrapStatement(sql));
            consecutiveBusy = 0;
            return res;
          } catch (err) {
            if (isBusySignal(err)) {
              consecutiveBusy += 1;
              if (consecutiveBusy >= BREAKER_THRESHOLD) {
                openUntil = now() + BREAKER_PAUSE_MS;
                consecutiveBusy = 0;
              }
            }
            throw err;
          }
        };
        return req;
      },
    };
  }

  /**
   * Run `fn(pool, mssql)` on the one connection. Outside --service it opens and closes around the
   * call, as every CLI always has; inside --service it reuses the held connection and leaves it open.
   * The breaker is checked BEFORE connecting, so an open breaker costs the server not even a login.
   */
  async function withPool(cfg, fn) {
    if (now() < openUntil) {
      const mins = Math.ceil((openUntil - now()) / 60_000);
      throw new Error(`McLeod circuit breaker open — the server was busy; not connecting for another ${mins} min.`);
    }
    if (holding) {
      if (!held) held = await open(cfg);
      try {
        return await fn(guarded(held.pool), held.mssql);
      } catch (err) {
        // A broken connection is dropped so the next cycle reconnects; a query error leaves it alone.
        if (!held.pool.connected) {
          await held.pool.close().catch(() => {});
          held = null;
        }
        throw err;
      }
    }
    const { pool, mssql } = await open(cfg);
    try {
      return await fn(guarded(pool), mssql);
    } finally {
      await pool.close();
    }
  }

  /** --service: keep the one connection open between cycles (D-MCC10: a reconnect costs 25× the query). */
  function hold() {
    holding = true;
  }

  async function release() {
    holding = false;
    if (held) {
      await held.pool.close().catch(() => {});
      held = null;
    }
  }

  return { withPool, hold, release, breakerState };
}

const connector = createConnector();
export const withPool = connector.withPool;
export const holdConnection = connector.hold;
export const releaseConnection = connector.release;
export const breakerState = connector.breakerState;
