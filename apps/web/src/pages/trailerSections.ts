import { VEHICLE_SECTIONS } from "./vehicleSections";

/**
 * The trailer page's sections (UNIT-FILES-PLAN UF5): the truck page's, without Fuel — a trailer has
 * no fills. DERIVED from `VEHICLE_SECTIONS` rather than restated, so a section added to one unit's
 * page is on the other's unless it is taken off here by name.
 */
export const TRAILER_SECTIONS = VEHICLE_SECTIONS.filter((s) => s.value !== "fuel");
export type TrailerSection = (typeof TRAILER_SECTIONS)[number]["value"];
const VALUES = new Set<string>(TRAILER_SECTIONS.map((s) => s.value));

/** Anything unrecognised — including the truck's `fuel` — lands on the overview rather than nowhere. */
export function resolveTrailerSection(raw: unknown): TrailerSection {
  const s = String(raw ?? "");
  return VALUES.has(s) ? (s as TrailerSection) : "overview";
}
