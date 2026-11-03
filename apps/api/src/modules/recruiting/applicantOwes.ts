import type { SupabaseClient } from "@supabase/supabase-js";
import { applicantOwed, type ApplicantOwedKind } from "@silvicom/shared";
import { readOrientationVideoFacts } from "./orientationVideos.js";

/**
 * What the applicant still owes, for their link's status (HIRING-WORKFLOW-AUDIT §13 SP1, D-SP2).
 *
 * Read from the rows the office's acts already write — the drug-test appointment (0376), the videos'
 * facts the checklist folds (`readOrientationVideoFacts`), the trip (0376) — all on THIS invitation, and
 * folded by `applicantOwed` in `@silvicom/shared`. Kinds only (D-SP3): nothing here leaves the server
 * but the list.
 *
 * ⚠ Never throws (D-SP4): a failed read serves an empty list, and the page opens on "nothing more to do"
 * rather than not at all. Every query carries its own `.eq("org_id", …)` — the token resolved the org.
 */
export async function applicantOwes(
  admin: SupabaseClient,
  invitation: { id: string; org_id: string; driver_id: string },
  now: Date,
): Promise<ApplicantOwedKind[]> {
  try {
    const [tests, trips, videos] = await Promise.all([
      admin.from("drug_test_appointments").select("window_start, window_end")
        .eq("org_id", invitation.org_id).eq("invitation_id", invitation.id).is("cancelled_at", null),
      admin.from("applicant_travel").select("depart_at")
        .eq("org_id", invitation.org_id).eq("invitation_id", invitation.id).is("cancelled_at", null),
      readOrientationVideoFacts(admin, invitation.org_id, [{ driverId: invitation.driver_id, invitationId: invitation.id }]),
    ]);
    if (tests.error) throw new Error(tests.error.message);
    if (trips.error) throw new Error(trips.error.message);
    const v = videos.get(invitation.driver_id);
    const watched = new Set(v?.attested ?? []);
    return applicantOwed({
      drugTestWindowsEnd: ((tests.data ?? []) as Array<{ window_start: string; window_end: string | null }>)
        .map((t) => t.window_end ?? t.window_start),
      videosSent: Boolean(v?.sentAt),
      requiredVideosUnwatched: (v?.required ?? []).filter((id) => !watched.has(id)).length,
      tripDepartures: ((trips.data ?? []) as Array<{ depart_at: string }>).map((t) => t.depart_at),
    }, now);
  } catch (e) {
    console.error("[applicant-owes] read failed, serving nothing owed", { detail: (e as Error).message });
    return [];
  }
}
