import { trailerUnitMatchKey } from "@fuelguard/shared";
import { vehicleUnitKey } from "./rosterMatch.js";

/**
 * Resolving a TMS's own identifiers to FuelGuard ids, for the ingests OUTSIDE the roster module
 * (MCLEOD-FIELD-GAP-PLAN F1, D-FG7/D-FG8).
 *
 * The roster ingest got this right and nothing else did. Two measured consequences, both silent:
 *
 *   · **The roster link was read by nothing.** `ingestLoads` resolved a driver only by
 *     `drivers.employee_id`, which is populated on 0 of 271 production rows (2026-08-24), while
 *     `mcleod_driver_id` — the link the entire integration is built on — was never consulted. A
 *     McLeod load would resolve to nobody, be reported as unmatched, and land with a null driver.
 *
 *   · **The trailer prefix was normalised in exactly one place.** FuelGuard writes `R532159` for the
 *     reefer McLeod calls `532159`; `trailerUnitMatchKey` strips that and lifted roster trailer
 *     matching from 157 of 235 to 201. Both the loads and movements ingests compared raw unit
 *     numbers, so roughly 44 reefers would fail to attach — to the very feed that exists to identify
 *     reefers.
 *
 * `employee_id` is deliberately NOT written from the TMS to close the first gap. It is an
 * office-owned field with its own meaning at carriers that use it, and filling it with a vendor's
 * surrogate key would make it unusable for the thing it is for. The link column already exists; this
 * is the code that finally reads it.
 *
 * AMBIGUITY IS NEVER RESOLVED BY GUESSING. A key claimed by two or more rows resolves to nothing —
 * the rule `rosterMatch` already applies, for the same reason: attaching a load to the wrong driver
 * is worse than reporting it unmatched. The hand-rolled `Map.set` loops this replaces silently kept
 * whichever row happened to come last.
 */
export interface KeyResolver {
  /** The FuelGuard id for this external key, or undefined when unknown or ambiguous. */
  get(raw: string | null | undefined): string | undefined;
}

/** Index rows by one or more keys; any key claimed twice is poisoned to `null` (= known ambiguous). */
function build<T>(rows: T[], keysOf: (row: T) => (string | null | undefined)[], idOf: (row: T) => string) {
  const m = new Map<string, string | null>();
  for (const row of rows) {
    for (const key of keysOf(row)) {
      if (!key) continue;
      m.set(key, m.has(key) ? null : idOf(row));
    }
  }
  return m;
}

const NORMALISE = {
  vehicles: vehicleUnitKey,
  trailers: trailerUnitMatchKey,
} as const;

export interface UnitRow {
  id: string;
  unit_number: string | null;
}

/**
 * Unit numbers, normalised the same way the roster ingest normalises them — trimmed and upper-cased
 * for both, plus the reefer-prefix strip for trailers. The stored `unit_number` is never rewritten
 * (D-MR11): normalisation belongs at the comparison and nowhere else.
 */
export function unitResolver(rows: UnitRow[], entity: keyof typeof NORMALISE): KeyResolver {
  const norm = NORMALISE[entity];
  const index = build(rows, (r) => [norm(r.unit_number)], (r) => r.id);
  return {
    get(raw) {
      const k = norm(raw);
      if (!k) return undefined;
      return index.get(k) ?? undefined;
    },
  };
}

export interface DriverKeyRow {
  id: string;
  employee_id: string | null;
  mcleod_driver_id: string | null;
}

/**
 * A driver by whichever identifier the TMS quotes. Both keys share one namespace on purpose: the wire
 * contract has a single `driver_employee_id` field, and widening it to a per-provider key would be a
 * contract change for something the two columns can answer between them. A value that somehow matches
 * one driver's employee id and another's McLeod id is ambiguous and resolves to nothing.
 */
export function driverResolver(rows: DriverKeyRow[]): KeyResolver {
  const index = build(rows, (r) => [r.employee_id, r.mcleod_driver_id], (r) => r.id);
  return {
    get(raw) {
      if (!raw) return undefined;
      return index.get(raw) ?? undefined;
    },
  };
}
