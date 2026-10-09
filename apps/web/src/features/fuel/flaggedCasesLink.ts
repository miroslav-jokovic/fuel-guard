import { anomalyStatusesIn } from "@silvicom/shared";
import type { FuelFilters } from "@/composables/useFuelLog";

/**
 * Where the Fuel Log's "Flagged" tile sends its reader: the Alerts work queue, narrowed to the fills the
 * tile counted (F02-F04 PLAN.md chunk 11a, AUDIT.md N5). `null` when no address can say that.
 *
 * The tile counts fills with an OPEN case (migration 0446), so the link carries the Alerts page's own
 * `status` for that queue state, read from `anomalyStatusesIn("open")` rather than written here. The
 * page takes ONE status; if that queue state ever spans two, no single address names the set and the
 * tile stops offering one rather than opening half of it.
 *
 * It carries the window and the trucks, which the Alerts page reads as `from`, `to` and `vehicle`
 * (`useAnomaliesPage.ts`). The days agree: the Fuel Log windows on `business_date`, EFS's Central day
 * (0444), and the Alerts page windows `fueled_at` on the carrier's day, which is Central for both
 * production carriers — 0 of their canonical fills fall on a different day under the two rules
 * (measured 2026-10-09). A carrier in another zone would see the two disagree at the ends of a range.
 *
 * ⚠ The driver, fuel-type and search filters have no counterpart on the Alerts page. Under any of them
 * the tile counts a narrower set than any link could open, so it offers none: a link to a wider list
 * than the number above it is the disagreement this chunk exists to remove, moved one click away.
 *
 * An EMPTY truck list means "the units named are not in this fleet" (FUEL-P1): the tile reads 0 and
 * there is nothing to open.
 */
export function flaggedCasesLink(f: Pick<FuelFilters, "from" | "to" | "vehicleIds" | "driverId" | "tankType" | "search">): string | null {
  const [status, ...more] = anomalyStatusesIn("open");
  if (!status || more.length) return null;
  if (f.driverId || f.tankType || f.search) return null;
  if (f.vehicleIds && f.vehicleIds.length === 0) return null;
  const q = new URLSearchParams({ status });
  if (f.from) q.set("from", f.from);
  if (f.to) q.set("to", f.to);
  if (f.vehicleIds?.length) q.set("vehicle", f.vehicleIds.join(","));
  return `/anomalies?${q.toString()}`;
}
