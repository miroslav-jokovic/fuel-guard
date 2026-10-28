import { UNITS_OF_MEASURE, type UnitOfMeasure } from "../inventoryContract.js";

/**
 * FleetPal's unit of measure → ours (FLEETPAL-INTEGRATION-PLAN.md F12, measured 2026-10-28).
 *
 * ── MEASURED, NOT ASSUMED ─────────────────────────────────────────────────────────────────────
 * The spec lists 23 values; the live account uses twelve, and most parts state none at all:
 * `null` 6,531 · `ea` 922 · `bx` 68 · `set` 20 · `pk` 17 · `gal` 15 · `ft` 6 · `lb` 5 · `pr` 3 ·
 * `oz` 1 · `pt` 1 · `disp` 1 (7,590 parts, read-only walk of `/v1/parts/`). So the table below maps
 * the seven that have an exact counterpart in our eleven and names the rest `unmapped` — a value the
 * CHECK admits since 0525 and the part's page shows with the vendor's word beside it, so a person can
 * decide. `pk` (pack) is NOT a box, `pt` (pint) is NOT a quart, `oz` is not a pound: a near miss
 * written here would be a wrong count on a shelf nobody could trace.
 *
 * ── NULL IS NOT UNMAPPED ──────────────────────────────────────────────────────────────────────
 * A part FleetPal records no unit for is counted `each` — the catalogue's default and what every
 * oil filter is — and its `fleetpal_unit` stays null, so "FleetPal said nothing" and "FleetPal said
 * `ea`" remain two different rows. Flagging 86% of the catalogue as unmapped would make the flag mean
 * nothing on the one row it matters for.
 */
export const FLEETPAL_UNIT_MAP: Readonly<Record<string, UnitOfMeasure>> = {
  ea: "each",
  bx: "box",
  set: "set",
  gal: "gallon",
  ft: "foot",
  lb: "pound",
  pr: "pair",
};

/** The unit our catalogue counts a FleetPal part in; `"unmapped"` when FleetPal's word has no counterpart. */
export function mapFleetpalUnit(raw: string | null | undefined): UnitOfMeasure {
  const key = (raw ?? "").trim().toLowerCase();
  if (key === "") return "each";
  const mapped = FLEETPAL_UNIT_MAP[key];
  if (mapped && (UNITS_OF_MEASURE as readonly string[]).includes(mapped)) return mapped;
  return "unmapped";
}
