/**
 * Settled-movement extraction — the cost-per-mile fact (C1).
 *
 * Separate from `roster.mjs` because the two answer different questions and fail differently. The
 * roster is a small set of CURRENT rows and is swept whole; this is an unbounded history of CLOSED
 * facts, read in bounded windows and never re-read from the top. Same connection helper, same
 * read-only posture, different cadence.
 *
 * Like the roster path, this file knows McLeod column names only by importing them from `queries.mjs`
 * — the mapping below turns them into the neutral shape `tmsMovementFactSchema` validates on arrival
 * (packages/shared/src/tmsCost/movementFact.ts). The agent deliberately does NOT import
 * `@silvicom/shared`: it ships to the carrier's own machine with `mssql` as its only dependency, and
 * a workspace import would drag the whole monorepo onto their box.
 */

import process from "node:process";
import { MOVEMENT_FACTS, MOVEMENT_STOPS, MOVEMENT_FACT_COUNTS } from "./queries.mjs";
import { withPool } from "./roster.mjs";

/**
 * McLeod stop types, mapped onto the neutral vocabulary.
 *
 * 'PU' and 'SO' are 45,777 of the 46,384 stops measured in 2026. The rest — 'VA', 'SD', 'SP', 'VP' —
 * are a long tail this integration has no rule for, so they map to 'other' rather than being guessed
 * into a pickup or a delivery. That matters: `inferDeadheadLegs` chains a movement's last DROPOFF to
 * the next one's first PICKUP, so mislabelling a yard move as a delivery would invent an empty leg
 * that was never run.
 */
const STOP_KIND = { PU: "pickup", SO: "dropoff" };

/** `char(n)` is space-padded and a comma list of one has no comma; both are handled here, not in SQL. */
function splitList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function mapStop(row) {
  return {
    seq: row.seq,
    kind: STOP_KIND[String(row.stop_type || "").trim()] ?? "other",
    city: row.city ?? null,
    state: row.state ?? null,
    lat: row.lat == null ? null : Number(row.lat),
    lon: row.lon == null ? null : Number(row.lon),
    arrived_at: row.arrived_at ?? null,
    departed_at: row.departed_at ?? null,
    distance_from_previous:
      row.distance_from_previous == null ? null : Number(row.distance_from_previous),
  };
}

function mapMovement(row, stops) {
  return {
    external_id: row.external_id,
    company_id: row.company_id,
    tractor_unit: row.tractor_unit ?? null,
    trailer_unit: row.trailer_unit ?? null,
    driver_external_ids: splitList(row.driver_external_ids),
    order_ids: splitList(row.order_ids),
    loaded_miles: row.loaded_miles == null ? null : Number(row.loaded_miles),
    fuel_miles: row.fuel_miles == null ? null : Number(row.fuel_miles),
    // McLeod declares 'MI' on 21,542 of 21,547 rows; the handful of nulls default rather than throw,
    // because a missing unit on a distance the carrier measures in miles is not worth a failed sweep.
    distance_unit: (row.distance_unit || "MI").trim() === "KM" ? "KM" : "MI",
    external_status: row.external_status ?? null,
    movement_type: row.movement_type ?? null,
    settled_at: row.settled_at ? `${row.settled_at}Z` : null,
    stops,
  };
}

/**
 * Read one settlement window.
 *
 * `windowStart`/`windowEnd` are REQUIRED and are half-open (`>= start`, `< end`). There is no default
 * and no "since last time" — deliberately. `stop.actual_departure` reaches the year 2215 because
 * McLeod writes far-future sentinels for unset dates, so any watermark this agent derived from the
 * data itself could walk past every real row and go silently quiet (D-MC14). The caller states the
 * window; a scheduler that re-reads a trailing window each cycle is the intended pattern.
 */
export async function fetchMovementFacts({
  server,
  port,
  database,
  user,
  password,
  companyId,
  windowStart,
  windowEnd,
  encrypt,
  trustCert,
  serverName,
}) {
  if (!windowStart || !windowEnd) {
    throw new Error("fetchMovementFacts requires an explicit windowStart and windowEnd (YYYY-MM-DD).");
  }

  return withPool({ server, port, database, user, password, encrypt, trustCert, serverName }, async (pool, mssql) => {
    const bind = () =>
      pool
        .request()
        .input("companyId", mssql.VarChar(32), companyId)
        .input("windowStart", mssql.VarChar(32), windowStart)
        .input("windowEnd", mssql.VarChar(32), windowEnd);

    const [factRows, stopRows, countRows] = [
      await bind().query(MOVEMENT_FACTS),
      await bind().query(MOVEMENT_STOPS),
      await bind().query(MOVEMENT_FACT_COUNTS),
    ];

    // Stops arrive as a flat second result set rather than a join, so a ten-stop movement does not
    // repeat its mileage ten times on the wire. Stitch them back on by movement id.
    const stopsByMovement = new Map();
    for (const row of stopRows.recordset) {
      const list = stopsByMovement.get(row.movement_id);
      if (list) list.push(mapStop(row));
      else stopsByMovement.set(row.movement_id, [mapStop(row)]);
    }

    const movements = factRows.recordset.map((row) =>
      mapMovement(row, stopsByMovement.get(row.external_id) ?? []),
    );

    return {
      movements,
      window_start: windowStart,
      window_end: windowEnd,
      counts: countRows.recordset[0] ?? null,
    };
  });
}

/**
 * The dry-run report: what a window contains, before a byte of it is sent anywhere.
 *
 * `loaded_miles` is the line a human should recognise from the carrier's own operations report for the
 * same window. If it does not match, the extraction is wrong and nothing downstream of it is worth
 * debugging. The rest are the integrity checks that catch the specific ways this query can go wrong:
 * a duplicated movement (the team-driver join trap), a stop without coordinates (deadhead becomes
 * unmeasurable), and movements whose equipment group resolves to no tractor at all.
 */
export function summarizeMovementFacts({ movements, window_start, window_end, counts }) {
  const ids = new Set();
  let duplicates = 0;
  let loadedMiles = 0;
  let fuelMiles = 0;
  let withoutTractor = 0;
  let stopsMissingCoords = 0;
  let teamDriven = 0;
  const tractors = new Set();

  for (const m of movements) {
    if (ids.has(m.external_id)) duplicates++;
    ids.add(m.external_id);
    loadedMiles += m.loaded_miles ?? 0;
    fuelMiles += m.fuel_miles ?? 0;
    if (m.tractor_unit) tractors.add(m.tractor_unit);
    else withoutTractor++;
    if (m.driver_external_ids.length > 1) teamDriven++;
    for (const s of m.stops) if (s.lat == null || s.lon == null) stopsMissingCoords++;
  }

  // fuel_distance runs ~0.36% above move_distance fleet-wide. A window that diverges much further
  // than that is not a modelling choice to be reconciled, it is a data-quality alarm (D-MC15).
  const fuelDivergencePct = loadedMiles > 0 ? ((fuelMiles - loadedMiles) / loadedMiles) * 100 : 0;

  return {
    window: `${window_start} .. ${window_end}`,
    movements: movements.length,
    duplicates,
    tractors: tractors.size,
    withoutTractor,
    teamDriven,
    loadedMiles: Math.round(loadedMiles),
    fuelMiles: Math.round(fuelMiles),
    fuelDivergencePct: Number(fuelDivergencePct.toFixed(2)),
    stops: movements.reduce((n, m) => n + m.stops.length, 0),
    stopsMissingCoords,
    serverCounts: counts,
  };
}

/**
 * `npm run movements -- 2026-06-01 2026-07-01`
 *
 * A DRY RUN and nothing else: it reads, it reports, it sends nothing. C1's job is to prove the
 * extraction produces numbers the carrier recognises, and a sweep that posts before anyone has
 * checked the mileage is how a wrong denominator reaches a cost report. The POSTING path (C2) lives
 * in `agent.mjs --financial`, which calls `fetchMovementFacts` and sends to /api/tms/movement-facts;
 * this CLI stays a pure dry run so the mileage check remains runnable without an ingest token.
 */
async function main() {
  const [windowStart, windowEnd] = process.argv.slice(2);
  if (!windowStart || !windowEnd) {
    console.error("usage: npm run movements -- <windowStart YYYY-MM-DD> <windowEnd YYYY-MM-DD>");
    process.exitCode = 2;
    return;
  }

  const result = await fetchMovementFacts({
    server: process.env.MCLEOD_SQL_SERVER,
    port: Number(process.env.MCLEOD_SQL_PORT || 1433),
    database: process.env.MCLEOD_SQL_DATABASE,
    user: process.env.MCLEOD_SQL_USER,
    password: process.env.MCLEOD_SQL_PASSWORD,
    companyId: process.env.MCLEOD_COMPANY_ID,
    encrypt: process.env.MCLEOD_SQL_ENCRYPT !== "false",
    trustCert: process.env.MCLEOD_SQL_TRUST_CERT !== "false",
    serverName: process.env.MCLEOD_SQL_SERVERNAME || undefined,
    windowStart,
    windowEnd,
  });

  const summary = summarizeMovementFacts(result);
  console.log(JSON.stringify(summary, null, 2));

  // These are defects, not warnings. A duplicated movement double-counts miles into cents-per-mile,
  // and a stop without coordinates silently shortens the deadhead chain.
  if (summary.duplicates > 0) console.error(`\nFAIL: ${summary.duplicates} duplicated movement rows.`);
  if (summary.stopsMissingCoords > 0) console.error(`\nFAIL: ${summary.stopsMissingCoords} stops without coordinates.`);
  if (summary.duplicates > 0 || summary.stopsMissingCoords > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
