import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectionExpiry, type AnnualDueDto } from "@silvicom/shared";
import { listAnnualInspectionExpiries } from "../../roster/index.js";

/**
 * Trucks and trailers whose annual inspection is due within the warning window or overdue — the Shop
 * worklist's "Annual inspection due" group (D-MX2, Q-MX5 (a), owner 2026-10-27).
 *
 * The same two roster reads `readAnnualDisagreements` makes, cut by `inspectionExpiry`, which is the
 * one definition of "expiring" the roster, the inspection form and the dispatch board already share
 * (`INSPECTION_EXPIRY_WARNING_DAYS`). Soonest first, overdue ahead of everything; a unit with no
 * recorded inspection is NOT here — "unknown" is a roster gap, not a shop job (see the contract).
 *
 * `today` is cut from `now` the way the sibling reader cuts it. The page shows the days left in the
 * org's zone; the server's cut decides membership only, and a unit crossing the 30-day line at
 * midnight UTC rather than midnight Central is on the list a few hours early, never late.
 */
export async function readAnnualDue(
  admin: SupabaseClient,
  orgId: string,
  now: Date = new Date(),
): Promise<AnnualDueDto[] | { error: { message: string } }> {
  const today = now.toISOString().slice(0, 10);
  const [tractors, trailers] = await Promise.all([
    listAnnualInspectionExpiries(admin, orgId, "tractor"),
    listAnnualInspectionExpiries(admin, orgId, "trailer"),
  ]);
  if ("error" in tractors) return { error: { message: tractors.error } };
  if ("error" in trailers) return { error: { message: trailers.error } };

  const out: AnnualDueDto[] = [];
  const take = (subjectType: AnnualDueDto["subjectType"], units: typeof tractors) => {
    for (const u of units) {
      const e = inspectionExpiry(u.expiresOn, today);
      if ((e.state === "expiring" || e.state === "expired") && u.expiresOn && e.daysRemaining !== null) {
        out.push({ subjectType, unitId: u.id, unitNumber: u.unitNumber, expiresOn: u.expiresOn, daysRemaining: e.daysRemaining });
      }
    }
  };
  take("tractor", tractors);
  take("trailer", trailers);
  return out.sort((a, b) => a.daysRemaining - b.daysRemaining || a.unitNumber.localeCompare(b.unitNumber, "en", { numeric: true }));
}
