import { z } from "zod";

/**
 * The neutral contract for a SETTLED MOVEMENT — the atomic fact cents-per-mile is built from.
 *
 * Deliberately NOT `tmsLoadInputSchema` (tms.ts), and the distinction is worth stating because the two
 * describe the same physical trip. `tmsLoadInputSchema` is a DISPATCHABLE load: work a driver has not
 * finished, carrying appointment windows and proof-of-work expectations, and it is amendable while
 * dispatch still owns it. This is the accounting shadow of the same trip AFTER it closed — immutable,
 * carrying the miles and the equipment attribution that cost is divided by. Merging them would give one
 * schema two lifecycles and two mutability rules, which is how a settled fact ends up being "amended".
 *
 * The agent maps McLeod's columns onto this shape; nothing downstream of the agent knows a McLeod column
 * name (the D48 seam, same rule as the roster contract in queries.mjs).
 *
 * ⚠ This contract carries FACTS ONLY, never allocations. FuelGuard's CPM harness assigns unattributed
 * cost to trucks; the extraction layer never guesses an attribution McLeod does not itself assert
 * (D-MC12, `docs/plans/mcleod/MCLEOD-CPM-DATA-SOURCE-SPEC.md` §3).
 */

/**
 * One stop on a settled movement.
 *
 * `lat`/`lon` are REQUIRED here while the dispatch stop schema has them nullish, and that is the whole
 * reason this stop type exists separately. McLeod records no empty miles at all — every distance it
 * stores is a pickup-to-delivery mile — so deadhead has to be reconstructed by chaining one movement's
 * last delivery to the next movement's first pickup on the same tractor. That chaining is impossible
 * without coordinates. Measured 2026-08-26: 46,384 of 46,384 stops in 2026 carry both a coordinate pair
 * and a city id, so requiring them costs us nothing and a missing one is a real defect worth rejecting.
 * (D-MC16, spec §4.2.)
 */
export const tmsStopFactSchema = z.object({
  seq: z.number().int().min(1).max(50),
  kind: z.enum(["pickup", "dropoff", "other"]),
  city: z.string().max(120).nullish(),
  state: z.string().max(2).nullish(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Actuals, not schedule — a settled movement has happened. ISO 8601, UTC. */
  arrived_at: z.string().nullish(),
  departed_at: z.string().nullish(),
  /**
   * McLeod's `move_dist_from_previous`. Populated on 21,798 of 23,373 delivery stops and almost never
   * on pickups, because a two-stop trip books its whole distance on arrival at the delivery. Summing
   * this across a movement reproduces `loaded_miles` to within a mile on 95.4% of movements, which is
   * what proves the two numbers describe the same trip rather than two different ones.
   */
  distance_from_previous: z.number().nonnegative().max(99_999).nullish(),
});
export type TmsStopFact = z.infer<typeof tmsStopFactSchema>;

export const tmsMovementFactSchema = z.object({
  /** McLeod `movement.id`. The idempotency key. */
  external_id: z.string().min(1).max(32),
  company_id: z.string().min(1).max(4),

  /**
   * Resolved through `movement.equipment_group_id` → `equipment_item` (`equipment_type_id = 'T'`),
   * because `movement` has NO tractor column of its own. `movement.carrier_tractor` looks like one and
   * is not — it names a purchased-transportation carrier's unit, so reading it would attribute a
   * brokered load's cost to a truck the carrier does not own.
   */
  tractor_unit: z.string().trim().min(1).max(8).nullish(),
  trailer_unit: z.string().trim().min(1).max(8).nullish(),

  /**
   * An ARRAY, because team driving is real here: measured 2026-08-26, 176 of 21,215 movements carry two
   * `equipment_type_id = 'D'` rows. A scalar `driver_external_id` would either drop the second driver or
   * — far worse — a naive SQL join would emit the movement TWICE and double-count its miles into CPM.
   * Tractor (`T`) and trailer (`L`) are genuinely one per movement, so those stay scalar.
   */
  driver_external_ids: z.array(z.string().trim().min(1).max(8)).max(4).default([]),

  /** A movement can serve several orders; `movement_order` is many-to-many. */
  order_ids: z.array(z.string().max(8)).max(50).default([]),

  /**
   * `movement.move_distance`, declared `MI` on 21,542 of 21,547 rows. THE cents-per-mile denominator
   * (D-MC15). Named `loaded_miles` rather than `total_miles` on purpose: it excludes deadhead, which
   * McLeod does not store, and a downstream reader who assumes "total" would understate CPM by the
   * ~4-5% of miles the fleet runs empty.
   */
  loaded_miles: z.number().nonnegative().max(99_999).nullish(),

  /**
   * `movement.fuel_distance` — a cross-check, never an alternative basis. It runs 0.36% above
   * `move_distance` fleet-wide; a per-movement divergence beyond 2% is a data-quality alarm, not a
   * modelling choice (D-MC15).
   */
  fuel_miles: z.number().nonnegative().max(99_999).nullish(),

  /**
   * Explicit, because McLeod's settlement distances declare no unit at all — `pay_distance_um` and
   * `billed_distance_um` are NULL on all 20,833 rows measured. Movement distances DO declare `MI`, and
   * carrying it forward means a future carrier on kilometres cannot silently corrupt a CPM figure.
   */
  distance_unit: z.enum(["MI", "KM"]).default("MI"),

  external_status: z.string().max(8).nullish(),
  movement_type: z.string().max(4).nullish(),
  /** `movement.xfer2settle_date` — when the trip closed into settlement. ISO 8601. */
  settled_at: z.string().nullish(),

  stops: z.array(tmsStopFactSchema).max(50).default([]),
});
export type TmsMovementFact = z.infer<typeof tmsMovementFactSchema>;

export const tmsMovementFactsPayloadSchema = z.object({
  movements: z.array(tmsMovementFactSchema).max(500),
  /** The window the agent swept, so the ingest can tell a short batch from an empty one. */
  window_start: z.string(),
  window_end: z.string(),
});
export type TmsMovementFactsPayload = z.infer<typeof tmsMovementFactsPayloadSchema>;

/**
 * Great-circle miles between two coordinates.
 *
 * The deadhead estimator's primitive. Road distance runs roughly 1.2x great-circle, so this is a
 * deliberate FLOOR: the June 2026 sample put deadhead at 3.95% of loaded miles by this measure and
 * therefore nearer 4.7% on the road. Reporting the floor and labelling it an estimate is honest;
 * inflating it by a guessed constant and presenting the result as measured is not.
 */
export function greatCircleMiles(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 3958.7613; // mean Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** One inferred empty leg: the truck ran from `from` to `to` with nothing on it. */
export interface DeadheadLeg {
  tractor_unit: string;
  from_movement: string;
  to_movement: string;
  miles: number;
}

/**
 * When the truck actually finished this trip — the departure from its last delivery.
 *
 * NOT `settled_at`. That is `xfer2settle_date`, the moment the movement was transferred into the
 * settlement run, and settlement runs in BATCHES: measured 2026-08-26, 2,226 of 3,165 consecutive
 * movement pairs on the same tractor (70.3%) share an identical `settled_at` to the second. Within a
 * batch the order is arbitrary, so chaining on it pairs a delivery in Georgia with a pickup in
 * Tennessee that happened a week earlier.
 *
 * That is not a theoretical concern. The first version of this function sorted by `settled_at` and
 * produced 2,257,083 deadhead miles against 1,694,429 loaded — 133%, where the same fleet measured
 * 3.95% when ordered by actual delivery time. Unit tests did not catch it because a fixture with
 * distinct timestamps sorts correctly either way; only real data has the ties.
 */
function tripEndAt(m: TmsMovementFact): string | null {
  const last = lastStopOfKind(m, "dropoff");
  return last?.departed_at ?? last?.arrived_at ?? null;
}

/**
 * Chain a tractor's movements into the empty legs between them.
 *
 * This is the ONLY source of empty miles that exists. Both of McLeod's manifest distance columns
 * (`manifest_loaded_distance`, `manifest_empty_distance`) sum to exactly zero across all 21,547
 * movements settled in 2026, and `pay_distance` on the movement is zero too, so there is no column to
 * read and no vendor number to reconcile against — the inference IS the measurement (D-MC16).
 *
 * Movements are ordered by when the truck actually finished them (`tripEndAt`), never by settle date.
 * A movement with no tractor, no trip-end time, no final dropoff or no initial pickup cannot be
 * chained and is skipped rather than guessed at; skipping shortens the chain, which understates
 * deadhead, which is the safe direction for a number presented as a floor.
 */
export function inferDeadheadLegs(movements: TmsMovementFact[]): DeadheadLeg[] {
  const byTractor = new Map<string, Array<{ m: TmsMovementFact; at: string }>>();
  for (const m of movements) {
    if (!m.tractor_unit) continue;
    const at = tripEndAt(m);
    if (!at) continue;
    const entry = { m, at };
    const list = byTractor.get(m.tractor_unit);
    if (list) list.push(entry);
    else byTractor.set(m.tractor_unit, [entry]);
  }

  const legs: DeadheadLeg[] = [];
  for (const [tractor_unit, entries] of byTractor) {
    entries.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const list = entries.map((e) => e.m);
    for (let i = 1; i < list.length; i++) {
      const from = list[i - 1];
      const to = list[i];
      if (!from || !to) continue;
      const prev = lastStopOfKind(from, "dropoff");
      const next = firstStopOfKind(to, "pickup");
      if (!prev || !next) continue;
      legs.push({
        tractor_unit,
        from_movement: from.external_id,
        to_movement: to.external_id,
        miles: greatCircleMiles(prev.lat, prev.lon, next.lat, next.lon),
      });
    }
  }
  return legs;
}

function firstStopOfKind(m: TmsMovementFact, kind: TmsStopFact["kind"]): TmsStopFact | null {
  let best: TmsStopFact | null = null;
  for (const s of m.stops) if (s.kind === kind && (!best || s.seq < best.seq)) best = s;
  return best;
}

function lastStopOfKind(m: TmsMovementFact, kind: TmsStopFact["kind"]): TmsStopFact | null {
  let best: TmsStopFact | null = null;
  for (const s of m.stops) if (s.kind === kind && (!best || s.seq > best.seq)) best = s;
  return best;
}
