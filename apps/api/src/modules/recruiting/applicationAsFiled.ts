import type { SupabaseClient } from "@supabase/supabase-js";
import { composeFiledApplication, todayInZone, type ApplicationFilingIssue } from "@silvicom/shared";
import { partOneForFiling } from "./applicantIntake.js";
import { carrierZone } from "./carrierClock.js";

/**
 * An application with Part 1's facts laid over it, as filing lays them (`composeFiledApplication`, D-AW3).
 *
 * ── ONE COMPOSITION FOR THE FILING AND THE OFFICE'S PREVIEW ──────────────────────────────────
 * Filing composed Part 1 inline, and the office's preview drew the raw draft (F2b, 2026-11-11). So the
 * preview printed whatever the applicant's tab last saved: a licence, phone or class the office corrected
 * in Part 1 afterwards, and every endorsement, never reached the copy the office reviews before sending
 * it for signing — the copy D-AM7 says must match the signed one. Both read this now.
 *
 * `asOf` is the carrier's day the licences are judged on, or null for a legacy link (no Part 1 row),
 * which files what it certified and is composed with nothing.
 */
export async function applicationAsFiled<T extends Parameters<typeof composeFiledApplication>[0]>(
  admin: SupabaseClient,
  invitation: { id: string; org_id: string; driver_id: string },
  application: T,
  now: Date,
): Promise<{ application: T; issues: ApplicationFilingIssue[]; asOf: string | null }> {
  const partOne = await partOneForFiling(admin, invitation.org_id, invitation);
  if (!partOne) return { application, issues: [], asOf: null };
  const asOf = todayInZone(now, await carrierZone(admin, invitation.org_id));
  const composed = composeFiledApplication(application, partOne.intake, partOne.licences, asOf);
  return { ...composed, asOf };
}
