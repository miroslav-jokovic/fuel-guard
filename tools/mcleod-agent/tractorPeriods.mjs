/**
 * Every tractor's service dates and owner — the per-truck P&L's truck-day census
 * (TRUCK-DRIVER-PNL-PLAN P2, D-TP3, 0510).
 *
 * Read-only, same posture as the other sweeps, no `@silvicom/shared` import: the wire shape here is
 * checked against `tmsTractorPeriodsPayloadSchema` by the ingest route, which is where a mismatch
 * becomes a refusal rather than a quietly wrong census.
 */

import { TRACTOR_PERIODS } from "./queries.mjs";
import { withPool } from "./connection.mjs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A McLeod date as the wire carries it: the source's own YYYY-MM-DD, or null — never re-parsed. */
const day = (v) => {
  const s = String(v ?? "").trim().slice(0, 10);
  return DAY.test(s) ? s : null;
};
const text = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/**
 * One tractor row as the wire carries it. A row with no id is dropped: it cannot be a member of any
 * census, and a placeholder id would invent a truck.
 */
export function mapTractorPeriod(row) {
  const tractor_id = text(row?.tractor_id);
  const company_id = text(row?.company_id);
  if (!tractor_id || !company_id) return null;
  return {
    tractor_id,
    company_id,
    in_service_on: day(row.in_service_on),
    out_of_service_on: day(row.out_of_service_on),
    purchased_on: day(row.purchased_on),
    model_year: text(row.model_year),
    service_status: text(row.service_status),
    tractor_status: text(row.tractor_status),
    owner_id: text(row.owner_id),
    pay_owner: text(row.pay_owner),
  };
}

export async function fetchTractorPeriods({
  server, port, database, user, password, companyId, encrypt, trustCert, serverName,
}) {
  return withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, async (pool, mssql) => {
    const rows = await pool.request().input("companyId", mssql.VarChar(32), companyId).query(TRACTOR_PERIODS);
    return { tractors: rows.recordset.map(mapTractorPeriod).filter(Boolean) };
  });
}
