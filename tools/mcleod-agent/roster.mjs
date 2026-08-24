/**
 * Roster source: read drivers / tractors / trailers from McLeod's SQL Server and map them onto
 * FuelGuard's neutral contract.
 *
 * WHY THE MAPPING LIVES HERE AND NOT IN FUELGUARD
 * `packages/shared/src/tms.ts` states the rule: the agent owns the vendor field mapping so FuelGuard
 * never learns a vendor schema. Everything McLeod-shaped — that `name` is a surname, that
 * `trailer_type = 'R'` means reefer, that `inspection_date` runs backwards from every other date —
 * is resolved on this side of the wire.
 *
 * CHANGE DETECTION
 * A stable hash per row over the columns we actually send, kept in state.json. McLeod offers two
 * alternatives and both were measured and rejected (MCLEOD-ROSTER-SYNC-PLAN §1):
 *   · `audit_log` is indexed and cheap to query, but `dbo.driver` takes ~228,000 writes a day and
 *     essentially all of them are one system heartbeat column, `event_date`. Two real changes hide in
 *     a quarter of a million rows of noise.
 *   · Change Tracking is enabled on all three tables with column-level masks, but `event_date` touches
 *     every driver row several times an hour, so CHANGETABLE returns the whole table on every poll.
 *     (It also needs a VIEW CHANGE TRACKING grant this login does not have.)
 * The hash is immune to both, for free: `event_date` is not in the allowlist, so it is not in the hash.
 * The whole active roster is 589 rows, which makes a full read cheaper than either delta.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { rosterQueries, retirementQueries, ROSTER_COUNTS } from "./queries.mjs";

/** Trim + empty-to-null. `char(n)` columns arrive space-padded even after a SQL-side RTRIM. */
const s = (v) => {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
/** `model_year` is char(4); anything not a plausible year becomes null rather than NaN. */
const year = (v) => {
  const n = Number(s(v));
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
};

/**
 * McLeod's employment flag → FuelGuard's DRIVER_STATUSES vocabulary.
 *
 * `is_active = 'N'` splits in two and the distinction matters: with a termination date the person left,
 * without one they are an inactive record. Measured on the sandbox, that second bucket is 71 rows of
 * which 61 have no hire date at all — stale records rather than people. `status_code` is NULL on every
 * row in the table and is not consulted.
 *
 * Nothing outside this vocabulary is ever returned. `drivers.status` has no CHECK constraint in
 * FuelGuard (verified), so a mapping bug here would write a novel status and every `status = 'active'`
 * query in the product would silently exclude those drivers.
 */
export function driverStatus(isActive, terminationDate) {
  if (s(isActive) === "Y") return "active";
  return terminationDate ? "terminated" : "inactive";
}

/**
 * The email this carrier keeps in `name_of_spouse` (see queries.mjs), returned only when it is
 * actually usable.
 *
 * The column is `char(28)`, which is shorter than plenty of real addresses, and the data shows the
 * damage: of 164 active drivers 14 sit at exactly 28 characters, and only 6 of those still end in a
 * plausible TLD. The other 8 are addresses cut off mid-domain.
 *
 * So a value AT the column limit is suspect and is accepted only if it still ends in a TLD — truncation
 * removes the end of a string, so an address that survives to `.com` was not truncated. Everything
 * below the limit is taken as-is once it looks like an address at all.
 *
 * Rejecting is the safe direction. A missing email is recoverable — the office types it in — while a
 * silently wrong one is not: mail bounces into nobody's inbox and the roster still claims the driver is
 * contactable.
 */
export function usableEmail(raw) {
  const v = s(raw);
  if (!v) return null;
  const at = v.indexOf("@");
  if (at < 1 || v.indexOf(".", at) < 0) return null; // not an address at all
  if (v.length < 28) return v;
  return /\.[a-z]{2,4}$/i.test(v) ? v : null; // at the limit: only if it still ends in a TLD
}

const MAP = {
  drivers: (r) => ({
    external_id: s(r.external_id),
    company_id: s(r.company_id),
    cdl_number: s(r.cdl_number),
    cdl_state: s(r.cdl_state),
    // `dbo.driver.name` is the SURNAME — verified, 0 of 164 contain a comma and none contains the
    // first name. Composing a display name is FuelGuard's job; this side only ever sends parts.
    first_name: s(r.first_name),
    middle_name: s(r.middle_name),
    last_name: s(r.last_name),
    ...("is_active" in r
      ? {
          status: driverStatus(r.is_active, s(r.termination_date)),
          hire_date: s(r.hire_date),
          termination_date: s(r.termination_date),
          cdl_expires_at: s(r.cdl_expires_at),
          medical_card_expires_at: s(r.medical_card_expires_at),
          date_of_birth: s(r.date_of_birth),
          address_line1: s(r.address_line1),
          city: s(r.city),
          state: s(r.state),
          postal_code: s(r.postal_code),
          email: usableEmail(r.email_raw),
        }
      : {}),
  }),
  vehicles: (r) => ({
    external_id: s(r.external_id),
    company_id: s(r.company_id),
    vin: s(r.vin),
    unit_number: s(r.unit_number),
    ...("make" in r
      ? {
          status: "active", // the query selects in-service tractors only
          make: s(r.make),
          model: s(r.model),
          year: year(r.model_year),
          plate: s(r.plate),
          plate_state: s(r.plate_state),
          registration_expires_at: s(r.registration_expires_at),
          // Sent as OBSERVED. `inspection_date` is the date the annual was performed — 175 of 175 in
          // the past, the opposite of every driver date — and FuelGuard's column is an expiry, so the
          // derivation happens there rather than being baked in here.
          annual_inspection_performed_at: s(r.annual_inspection_performed_at),
        }
      : {}),
  }),
  trailers: (r) => ({
    external_id: s(r.external_id),
    company_id: s(r.company_id),
    vin: s(r.vin),
    unit_number: s(r.unit_number),
    ...("trailer_type" in r
      ? {
          status: "active",
          // THE reefer signal. McLeod's temperature columns — min_temp, max_temp, reefer_id,
          // heater_code — are unpopulated at this carrier (0 of 240), so the type code is all there is.
          // It corroborates well: 45 rows of type 'R' against 46 R-prefixed trailers in FuelGuard.
          is_reefer: s(r.trailer_type) === "R",
          make: s(r.make),
          year: year(r.model_year),
          plate: s(r.plate),
          plate_state: s(r.plate_state),
        }
      : {}),
  }),
};

/** Order-independent hash of a mapped row — the change-detection unit. */
export function rowHash(obj) {
  const sorted = Object.keys(obj)
    .sort()
    .map((k) => [k, obj[k] ?? null]);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 32);
}

/**
 * Split a mapped set into what changed since last run. `full` forces everything through, which is what
 * the link-only match report needs — it is measuring a whole roster, not a delta.
 */
export function diffAgainstState(entity, rows, state, full = false) {
  const prev = state[entity] ?? {};
  const next = {};
  const changed = [];
  for (const row of rows) {
    const h = rowHash(row);
    next[row.external_id] = h;
    if (full || prev[row.external_id] !== h) changed.push(row);
  }
  // Rows that were present last run and are absent now: they left the active predicate — terminated,
  // sold, taken out of service. REPORTED, never acted on here; deciding what a disappearance means is
  // FuelGuard's job (D-MR7 forbids clearing a termination date, and a thin read must never mass-retire
  // a fleet), and this side cannot tell a real retirement from a failed query.
  const vanished = Object.keys(prev).filter((id) => !(id in next));
  return { changed, vanished, nextState: next };
}

export function loadState(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}
export function saveState(path, state) {
  writeFileSync(path, JSON.stringify(state, null, 2));
}

/**
 * Connect, read the three tables, map them. `mssql` is required lazily so that mock mode and the ws
 * path keep working on a box where the driver was never installed.
 */
/**
 * Read the rows that have LEFT the active roster, with an explicit status apiece.
 *
 * Shares the connection settings of fetchRoster and is deliberately a separate call: retirement is the
 * one operation here that removes capability from a person, so it runs when an operator asks for it
 * rather than riding along with a routine identity sweep.
 */
export async function fetchRetirements(cfg) {
  const rows = await withPool(cfg, async (pool, mssql) => {
    const q = retirementQueries();
    const out = {};
    for (const entity of ["drivers", "vehicles", "trailers"]) {
      const res = await pool.request().input("companyId", mssql.VarChar(32), cfg.companyId).query(q[entity]);
      out[entity] = res.recordset.map((r) =>
        entity === "drivers"
          ? {
              external_id: s(r.external_id),
              company_id: s(r.company_id),
              status: driverStatus(r.is_active, s(r.termination_date)),
              termination_date: s(r.termination_date),
            }
          : {
              external_id: s(r.external_id),
              company_id: s(r.company_id),
              status: "inactive",
              out_of_service_at: s(r.out_of_service_at),
            },
      );
    }
    return out;
  });
  return rows;
}

export async function fetchRoster({
  server,
  port,
  database,
  user,
  password,
  companyId,
  mode,
  encrypt,
  trustCert,
  serverName,
}) {
  return withPool(
    { server, port, database, user, password, companyId, encrypt, trustCert, serverName },
    async (pool, mssql) => {
      const q = rosterQueries(mode);
      const out = {};
      for (const entity of ["drivers", "vehicles", "trailers"]) {
        const res = await pool.request().input("companyId", mssql.VarChar(32), companyId).query(q[entity]);
        out[entity] = res.recordset.map(MAP[entity]);
      }
      const counts = await pool.request().input("companyId", mssql.VarChar(32), companyId).query(ROSTER_COUNTS);
      out.counts = Object.fromEntries(counts.recordset.map((r) => [r.entity, r.n]));
      return out;
    },
  );
}

/** Open a read-only pool, run `fn`, always close. */
async function withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, fn) {
  const mssql = (await import("mssql")).default;
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

  const pool = await mssql.connect({
    server,
    port,
    database,
    user,
    password,
    options: {
      encrypt: wantEncrypt,
      ...(serverName ? { serverName } : {}),
      trustServerCertificate: trustCert !== false,
      // Read-only intent is advisory here but correct: it lets a DBA route us to a readable secondary
      // and documents the posture in their connection logs.
      readOnlyIntent: true,
      appName: "FuelGuard roster agent",
    },
    requestTimeout: 120_000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 30_000 },
  });
  try {
    return await fn(pool, mssql);
  } finally {
    await pool.close();
  }
}
