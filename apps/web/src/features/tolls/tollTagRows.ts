import { tollTagKey, type TransponderDto } from "@silvicom/shared";

/**
 * How a toll tag reads in the Tolls page's tag list and its drawer (TOLLS-PER-TRUCK-PLAN.md TL2b).
 * Everything is worked out from the tag's history, as the API does (D-TL2): the truck is the open,
 * unvoided entry, never a stored column.
 */

export type TagStatus = "on" | "off" | "retired";
export const TAG_STATUSES = ["on", "off", "retired"] as const;

export const TAG_STATUS_LABEL: Record<TagStatus, string> = { on: "On a truck", off: "Not on a truck", retired: "Retired" };
export const TAG_STATUS_TONE: Record<TagStatus, "success" | "caution" | "neutral"> = { on: "success", off: "caution", retired: "neutral" };

export const tagStatus = (t: TransponderDto): TagStatus => (t.retiredAt ? "retired" : t.currentVehicleId ? "on" : "off");

const openEntry = (t: TransponderDto) => t.history.find((h) => h.vehicleId === t.currentVehicleId && h.validTo == null && h.voidedAt == null) ?? null;

/** The unit number of the truck holding the tag now, or null. */
export const tagUnit = (t: TransponderDto): string | null => openEntry(t)?.unitNumber ?? null;
/** When the tag went on the truck it is on now, or null. */
export const tagSince = (t: TransponderDto): string | null => openEntry(t)?.validFrom ?? null;

/**
 * Search by tag number (typed with or without leading zeros, spaces or dashes), by unit, or by issuer.
 * Uses the same key statements are matched on, so what finds a tag here finds its tolls later.
 */
export function matchesTagSearch(t: TransponderDto, q: string): boolean {
  const s = q.trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  const key = tollTagKey(t.provider, s);
  const mine = tollTagKey(t.provider, t.tagNumber);
  if (key && mine && mine.includes(key.split(":")[1]!)) return true;
  return [t.tagNumber, tagUnit(t) ?? "", t.issuer ?? ""].some((v) => v.toLowerCase().includes(lower));
}
