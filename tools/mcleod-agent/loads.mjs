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

import { createHash } from "node:crypto";
import {
  DISPATCH_LOADS,
  DISPATCH_LOAD_STOPS,
  DISPATCH_DISPATCHERS,
  CLOSE_READ_MAX_IDS,
  closeReadQueries,
} from "./queries.mjs";
import { withPool } from "./connection.mjs";
import { centralToIso } from "./centralTime.mjs";

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
    // Central wall-clock → an instant. Sent bare until 2026-09-24 and stored five hours early (see
    // centralTime.mjs): the fix is here, for the load feed, as much as for the raw mirror below.
    appointment_start: centralToIso(row.appointment_start),
    appointment_end: centralToIso(row.appointment_end),
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
      // Who dispatches it in McLeod (L4). Selected by DISPATCH_LOADS since LM1b and dropped right here
      // until 2026-09-23, so the ingest had nothing to persist even after it learned how. Null on an
      // A load, which no dispatcher has taken yet.
      dispatcher_external_id: row.dispatcher_external_id ?? null,
      dispatcher_name: row.dispatcher_name ?? null,
      // McLeod status V is a void. Only the close read can see one (the board reads P and A), and it is
      // McLeod's own statement, so it is passed on as the contract's cancellation. D (delivered) is not
      // a cancellation; it travels as external_status until LR4 projects status from it.
      canceled: String(row.external_status || "").trim() === "V",
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

/**
 * One McLeod stop, as McLeod has it (LR3, D-LMR3). EVERY stop — `VA`, `SP` and whatever McLeod adds
 * next travel with their type verbatim. Deciding what a stop means is the projection's job (LR4),
 * which is why `STOP_KIND` above is not consulted here: Alex's answer on 2026-09-24 (SD/SP split
 * trailer, VA/VP interline points) is exactly the kind of fact that has to find the rows still there.
 * Names are McLeod's own, as the raw table's are (0364). Only two things are done to a value: the
 * longitude is negated (McLeod stores it west-positive) and times get their zone, once, in
 * centralToIso.
 */
export function mapDispatchStop(s) {
  return {
    stop_id: String(s.stop_id).trim(),
    movement_sequence: s.seq ?? null,
    stop_type: s.stop_type ? String(s.stop_type).trim() || null : null,
    status: s.stop_status ?? null,
    location_id: s.location_id ?? null,
    location_name: s.location_name ?? null,
    address: s.address_line ?? null,
    city_name: s.city ?? null,
    state: s.state ?? null,
    zip_code: s.postal_code ?? null,
    latitude: s.lat == null ? null : Number(s.lat),
    longitude: toWesternLongitude(s.lon_west_positive),
    sched_arrive_early: centralToIso(s.appointment_start),
    sched_arrive_late: centralToIso(s.appointment_end),
    actual_arrival: centralToIso(s.actual_arrival),
    actual_departure: centralToIso(s.actual_departure),
    eta: centralToIso(s.eta),
    contact_name: s.contact_name ?? null,
    phone: s.phone ?? null,
    ponum: s.ponum ?? null,
  };
}

const num = (v) => (v == null ? null : Number(v));

/**
 * One McLeod movement for the raw mirror (`POST /api/tms/dispatch-movements`). Unlike `mapLoad` it
 * skips nothing for being unusual — a movement with no order is still a movement McLeod has — and it
 * carries all of its stops. A zero weight stays 0: whether McLeod's 0 means "not entered" is LR4's
 * ruling to make, and a raw copy that decided it could not be re-projected when it is made.
 */
export function mapDispatchMovement(row, stopRows) {
  const weight = num(row.weight);
  return {
    movement_id: String(row.movement_id).trim(),
    order_id: row.ref ?? null,
    blnum: row.bol_number ?? null,
    movement_status: row.external_status ?? null,
    loaded: row.loaded ?? null,
    dispatcher_user_id: row.dispatcher_external_id ?? null,
    driver_codes: splitCodes(row.driver_codes),
    tractor_id: row.vehicle_unit ?? null,
    trailer_id: row.trailer_unit ?? null,
    trailer_type: row.trailer_type ? String(row.trailer_type).trim() || null : null,
    commodity: row.commodity ?? null,
    customer_id: row.customer_id ?? null,
    weight,
    // A unit only means something beside a weight; McLeod fills weight_um on unweighed orders too.
    weight_um: weight == null ? null : (row.weight_um ?? null),
    pieces: num(row.pieces),
    pallets_how_many: num(row.pallets_how_many),
    consignee_refno: row.consignee_refno ?? null,
    move_distance: num(row.total_miles),
    stops: stopRows.map(mapDispatchStop),
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

    const { loads, movements, skipped, notes } = assemble(loadRes.recordset ?? [], stopRes.recordset ?? []);

    return {
      loads,
      movements,
      companyId: cfg.companyId,
      dispatchers: mapDispatchers(dispatcherRes.recordset ?? [], systemDispatchers),
      skipped,
      notes,
    };
  });
}

/**
 * Movement rows + flat stop rows → mapped loads AND raw movements, with every skip and note kept.
 *
 * ⚠ A movement carrying two orders arrives as two rows (the `movement_order` join). None did on the
 * board of 2026-09-24, and one load per movement rests on that; the raw row has ONE `order_id`, so such
 * a movement is REFUSED for the mirror and said out loud, never stored with an arbitrary order of the
 * two (0364's header). The load feed keeps its old behaviour until LR4 replaces it.
 */
export function assemble(loadRows, stopRows) {
  const stopsByMovement = new Map();
  for (const s of stopRows) {
    const key = String(s.movement_id).trim();
    if (!stopsByMovement.has(key)) stopsByMovement.set(key, []);
    stopsByMovement.get(key).push(s);
  }

  const loads = [];
  const movements = [];
  const skipped = [];
  const notes = [];
  const rowsPerMovement = new Map();
  for (const row of loadRows) {
    const id = String(row.external_id).split(":").pop();
    rowsPerMovement.set(id, (rowsPerMovement.get(id) ?? 0) + 1);
  }
  const refused = new Set();
  for (const row of loadRows) {
    const movementId = String(row.external_id).split(":").pop();
    const mapped = mapLoad(row, stopsByMovement.get(movementId) ?? []);
    if (mapped.load) loads.push(mapped.load);
    if (mapped.skipped) skipped.push(mapped.skipped);
    notes.push(...mapped.notes);
    if (rowsPerMovement.get(movementId) > 1) {
      if (!refused.has(movementId)) {
        refused.add(movementId);
        skipped.push({ movement_id: movementId, reason: `carries ${rowsPerMovement.get(movementId)} orders — not mirrored` });
      }
      continue;
    }
    movements.push(mapDispatchMovement(row, stopsByMovement.get(movementId) ?? []));
  }

  return { loads, movements, skipped, notes };
}

/**
 * The close read (LR5): current McLeod state of movements we hold open that are no longer on the board.
 *
 * `movementIds` are bare ids (no company prefix), at most CLOSE_READ_MAX_IDS per statement; a longer
 * list is read in chunks, one statement after another on the one connection. Every returned load is
 * posted as it is — a D or a V is McLeod saying so, and a P that fell off the board only by the
 * staleness bound is still open and is simply refreshed.
 */
export async function fetchClosedLoads(cfg, movementIds) {
  const ids = [...new Set(movementIds.map((id) => String(id).trim()).filter(Boolean))];
  const loads = [];
  const movements = [];
  const skipped = [];
  const notes = [];
  if (!ids.length) return { loads, movements, skipped, notes };
  return withPool(cfg, async (pool, mssql) => {
    for (let i = 0; i < ids.length; i += CLOSE_READ_MAX_IDS) {
      const part = ids.slice(i, i + CLOSE_READ_MAX_IDS);
      const q = closeReadQueries(part.length);
      const bind = () => {
        const req = pool.request().input("companyId", mssql.VarChar(32), cfg.companyId);
        part.forEach((id, k) => req.input(`id${k}`, mssql.VarChar(32), id));
        return req;
      };
      const loadRes = await bind().query(q.loads);
      const stopRes = await bind().query(q.stops);
      const out = assemble(loadRes.recordset ?? [], stopRes.recordset ?? []);
      loads.push(...out.loads);
      movements.push(...out.movements);
      skipped.push(...out.skipped);
      notes.push(...out.notes);
    }
    return { loads, movements, skipped, notes };
  });
}

/**
 * A stable hash of what we would POST for a load, so the service posts only loads that changed.
 *
 * Without it a 60-second cadence re-posts ~160 loads a minute and our ingest rewrites every one —
 * ~230,000 no-op UPDATEs a day on a database already short of memory. Keys are sorted recursively so
 * the hash depends on content, never on the order a property was assigned in.
 */
export function loadHash(load) {
  const canon = (v) =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
        : v;
  return createHash("sha256").update(JSON.stringify(canon(load))).digest("hex").slice(0, 32);
}

/**
 * Split a board against what was last posted: the loads to post (new or changed), and the movement
 * ids we hold open that are no longer on the board — the input to the close read.
 */
export function planLoadPosts(boardLoads, posted) {
  const changed = [];
  const onBoard = new Set();
  for (const load of boardLoads) {
    onBoard.add(load.external_id);
    if (posted[load.external_id] !== loadHash(load)) changed.push(load);
  }
  const leftBoard = Object.keys(posted).filter((id) => !onBoard.has(id));
  return { changed, leftBoard };
}
