import type { SupabaseClient } from "@supabase/supabase-js";
import { annualDisagreement, type AnnualDisagreementDto } from "@silvicom/shared";
import { listAnnualInspectionExpiries } from "../../roster/index.js";
import { readFleetPalAnnualDue } from "../../fleetpal/index.js";

/**
 * The units whose annual inspection FleetPal and our record disagree on (DISPATCH-BOARD-V2-PLAN Q-DBV2,
 * ruled 2026-10-16: "the record, with a disagreement shown to the shop manager"). The dispatch board's
 * annual chip reads our record; this is where the shop finds out which of the two is wrong — an
 * inspection FleetPal holds that never reached the record, or a FleetPal schedule nobody moved on.
 *
 * Measured 2026-10-16 on the in-service fleet: 409 units in both, 84 disagreeing by this rule, 14 of
 * them so that the board's verdict would change.
 *
 * ── TODAY IS THE BOARD'S ─────────────────────────────────────────────────────────────────────────
 * The UTC day, as `readBoardRows` judges the annual chip: the point of the list is "would the board
 * say otherwise", so it must judge on the board's day. Both reads move to the carrier's day together.
 *
 * Most pressing first: a unit whose verdicts differ, then the widest gap, then by unit number.
 * Errors carry the cause for the route to LOG, never to send.
 */
export async function readAnnualDisagreements(
  admin: SupabaseClient,
  orgId: string,
  now: Date = new Date(),
): Promise<AnnualDisagreementDto[] | { error: { message: string } }> {
  const today = now.toISOString().slice(0, 10);
  const [tractors, trailers] = await Promise.all([
    listAnnualInspectionExpiries(admin, orgId, "tractor"),
    listAnnualInspectionExpiries(admin, orgId, "trailer"),
  ]);
  if ("error" in tractors) return { error: { message: tractors.error } };
  if ("error" in trailers) return { error: { message: trailers.error } };
  let fleetpal: Awaited<ReturnType<typeof readFleetPalAnnualDue>>;
  try {
    fleetpal = await readFleetPalAnnualDue(admin, orgId);
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } };
  }

  const out: AnnualDisagreementDto[] = [];
  const check = (subjectType: AnnualDisagreementDto["subjectType"], units: typeof tractors, due: Map<string, string>) => {
    for (const u of units) {
      const fleetpalDueOn = due.get(u.id) ?? null;
      const d = annualDisagreement(u.expiresOn, fleetpalDueOn, today);
      if (d) out.push({ subjectType, unitId: u.id, unitNumber: u.unitNumber, ourExpiresOn: u.expiresOn, fleetpalDueOn: fleetpalDueOn!, ...d });
    }
  };
  check("tractor", tractors, fleetpal.byVehicleId);
  check("trailer", trailers, fleetpal.byTrailerId);
  return out.sort(
    (a, b) =>
      Number(b.ours !== b.fleetpal) - Number(a.ours !== a.fleetpal) ||
      Math.abs(b.gapDays ?? Infinity) - Math.abs(a.gapDays ?? Infinity) ||
      a.unitNumber.localeCompare(b.unitNumber, "en", { numeric: true }),
  );
}
