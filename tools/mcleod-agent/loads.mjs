/**
 * Dispatchable loads — the live board (LIVE-MAP-PLAN.md LM1b).
 *
 * Separate from `movements.mjs` for the same reason its own header gives for being separate from
 * `roster.mjs`: these answer different questions and fail differently. `movements.mjs` reads CLOSED
 * trips in settlement windows so cost can be divided by them; this reads OPEN trips so a dispatcher
 * can see them on a screen. Same tables, opposite end of the lifecycle.
 *
 * Like every other module here it knows McLeod column names only by importing them from
 * `queries.mjs`, and it deliberately does NOT import `@silvicom/shared` — the agent ships to the
 * carrier's own machine with `mssql` as its only dependency, and a workspace import would drag the
 * whole monorepo onto their box. The shapes below are the ones `tmsLoadsPayloadSchema` and
 * `tmsDispatchersPayloadSchema` validate on arrival.
 */

import { DISPATCH_LOADS, DISPATCH_LOAD_STOPS, DISPATCH_DISPATCHERS } from "./queries.mjs";
import { withPool } from "./roster.mjs";

/**
 * McLeod stop types, mapped onto the load vocabulary — and NOTHING else is mapped (D-LM15).
 *
 * `PU` and `SO` are 240 of the 247 stops on the live board. The tail — `VA`, `VP`, `SP`, and `SD`
 * historically — is deliberately absent from this table rather than pointed at `dropoff`, because
 * `kind` is not a label: `writeStops` derives the driver's photo checklist from it, so a yard move
 * called a delivery **asks a driver for a bill of lading that does not exist**. `movements.mjs`
 * refuses the same guess and maps its tail to `other`; this contract has no `other` yet, so an
 * unrecognised type is REPORTED and not sent, the way `entityLookup` reports an unmatched key.
 * Widening the vocabulary is LM2's, once somebody has measured what those stops actually are.
 */
const STOP_KIND = { PU: "pickup", SO: "dropoff" };

/** Human labels for `trailer.trailer_type`, which is where reefer lives at this carrier (D-LM13). */
const EQUIPMENT_LABEL = { V: "Van", R: "Reefer" };

/**
 * McLeod stores longitude WEST-POSITIVE at this carrier, so every coordinate must be negated.
 *
 * Measured 2026-09-10: **0 negative values across 119,962 rows** in seven days, spanning 68.39–123.39
 * against latitudes 25.87–48.60 — the continental US with the sign dropped. Copying the value through
 * puts the entire fleet in Asia, and it does it silently, on a map that looks like it is working.
 *
 * The guard is not decoration. If McLeod ever stores a real signed longitude, doubling the negation
 * would be just as wrong and just as quiet, so an already-negative value is passed through untouched
 * and a value outside the western hemisphere is refused rather than coerced.
 */
export function toWesternLongitude(raw) {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const west = n > 0 ? -n : n;
  if (west < -180 || west > 0) return null;
  return west;
}

/** `char(n)` is space-padded and a single-element list has no comma; both are handled here, not in SQL. */
function splitCodes(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The stop's name, which the load contract requires and McLeod does not put on the stop row.
 *
 * `stop` carries `location_id` — the shipper's own code, e.g. `THESCLO1` — and city/state, but the
 * trade name lives on `dbo.location`, a table this integration has never read and whose columns are
 * therefore unverified. Rather than guess at a column name or widen the grant on a hunch, the name
 * is composed from city and state (present on every stop measured) and `location_id` travels beside
 * it so nothing is lost. §4.2 P6 verifies `location` and this becomes a join.
 */
function stopName(row) {
  const city = row.city ?? null;
  const state = row.state ?? null;
  if (city && state) return `${city}, ${state}`;
  return city ?? state ?? row.location_id ?? "Stop";
}

function mapStop(row) {
  return {
    seq: row.seq,
    kind: STOP_KIND[String(row.stop_type || "").trim()],
    name: stopName(row),
    address_line: row.address_line ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    postal_code: row.postal_code ?? null,
    lat: row.lat == null ? null : Number(row.lat),
    lon: toWesternLongitude(row.lon_west_positive),
    appointment_start: row.appointment_start ?? null,
    appointment_end: row.appointment_end ?? null,
  };
}

/**
 * One movement → one load. Returns `{ load, skipped, notes }` so nothing disappears without a line.
 *
 * `hazmat` is ABSENT, never `false` (D-LM12). McLeod at this carrier does not record it —
 * `orders.hazmat` reads 'Y' on 1 of 134,996 rows — and the field is amendable, so sending `false`
 * would erase what Silvicom's own rules engine determined. Silence from a feed that does not know is
 * not an answer, and the contract now models that distinction.
 */
export function mapLoad(row, stopRows) {
  const notes = [];
  const movementId = String(row.external_id).split(":").pop();

  if (!row.ref) {
    return { load: null, skipped: { movement_id: movementId, reason: "no order attached" }, notes };
  }

  const driverCodes = splitCodes(row.driver_codes);
  if (driverCodes.length > 1) {
    // Teams. The contract carries one driver; the co-driver is reported rather than dropped, and the
    // load is NOT emitted twice — that fan-out is exactly what the aggregated SQL prevents.
    notes.push(`movement ${movementId}: team drivers ${driverCodes.join(", ")} — sent ${driverCodes[0]}`);
  }

  const sent = [];
  for (const s of stopRows) {
    const kind = STOP_KIND[String(s.stop_type || "").trim()];
    if (!kind) {
      notes.push(`movement ${movementId}: stop ${s.seq} has type '${String(s.stop_type).trim()}' — not sent (D-LM15)`);
      continue;
    }
    sent.push(mapStop(s));
  }

  const trailerType = String(row.trailer_type || "").trim();
  return {
    load: {
      external_id: row.external_id,
      ref: row.ref,
      driver_employee_id: driverCodes[0] ?? null,
      vehicle_unit: row.vehicle_unit ?? null,
      trailer_unit: row.trailer_unit ?? null,
      equipment: trailerType ? (EQUIPMENT_LABEL[trailerType] ?? trailerType) : null,
      commodity: row.commodity ?? null,
      total_miles: row.total_miles == null ? null : Number(row.total_miles),
      external_status: row.external_status ?? null,
      canceled: false,
      stops: sent,
      raw: {
        movement_id: movementId,
        bol_number: row.bol_number ?? null,
        trailer_type: trailerType || null,
        driver_codes: driverCodes,
      },
    },
    skipped: null,
    notes,
  };
}

/** `is_system` is configuration, never inferred from a display name (D-LM4). */
export function mapDispatchers(rows, systemIds) {
  const system = new Set(systemIds.map((s) => s.trim().toLowerCase()).filter(Boolean));
  return rows.map((r) => ({
    external_id: String(r.external_id).trim(),
    display_name: r.display_name ?? null,
    is_system: system.has(String(r.external_id).trim().toLowerCase()),
    is_active: r.is_active === 1 || r.is_active === true,
  }));
}

/**
 * Read the current board. `staleDays` bounds it by scheduled date rather than by status alone —
 * movement 11787 has been 'P' since March 2015 and would otherwise sit on the map forever (D-LM14).
 */
export async function fetchDispatchLoads(cfg, { staleDays = 30, systemDispatchers = [] } = {}) {
  const staleBefore = new Date(Date.now() - staleDays * 86_400_000);

  return withPool(cfg, async (pool, mssql) => {
    const run = (sql) =>
      pool
        .request()
        .input("companyId", mssql.VarChar(32), cfg.companyId)
        .input("staleBefore", mssql.DateTime, staleBefore)
        .query(sql);

    const [loadRes, stopRes] = [await run(DISPATCH_LOADS), await run(DISPATCH_LOAD_STOPS)];
    const dispatcherRes = await pool
      .request()
      .input("companyId", mssql.VarChar(32), cfg.companyId)
      .query(DISPATCH_DISPATCHERS);

    const stopsByMovement = new Map();
    for (const s of stopRes.recordset ?? []) {
      const key = String(s.movement_id).trim();
      if (!stopsByMovement.has(key)) stopsByMovement.set(key, []);
      stopsByMovement.get(key).push(s);
    }

    const loads = [];
    const skipped = [];
    const notes = [];
    for (const row of loadRes.recordset ?? []) {
      const movementId = String(row.external_id).split(":").pop();
      const mapped = mapLoad(row, stopsByMovement.get(movementId) ?? []);
      if (mapped.load) loads.push(mapped.load);
      if (mapped.skipped) skipped.push(mapped.skipped);
      notes.push(...mapped.notes);
    }

    return {
      loads,
      dispatchers: mapDispatchers(dispatcherRes.recordset ?? [], systemDispatchers),
      skipped,
      notes,
    };
  });
}
