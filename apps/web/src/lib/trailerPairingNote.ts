import type { Trailer } from "@silvicom/shared";
import { formatDate } from "@/lib/format";

/**
 * The line under a GPS pairing that says how far to trust it: a person's choice, the day it was last
 * seen, or that nobody knows. An age older than a few days is the fact the reader needs, so the date is
 * shown, not hidden in a tooltip.
 */
export function gpsPairingNote(t: Pick<Trailer, "assigned_vehicle_id" | "pairing_source" | "pairing_confirmed_at">): string | null {
  if (!t.assigned_vehicle_id) return null;
  if (t.pairing_source === "manual") return "set by hand";
  return t.pairing_confirmed_at ? `GPS, as of ${formatDate(t.pairing_confirmed_at)}` : "GPS, age unknown";
}
