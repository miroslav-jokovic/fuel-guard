import type { SupabaseClient } from "@supabase/supabase-js";
import { asApplyingAs, type ApplyingAs } from "@silvicom/shared";

/**
 * What an applicant said they are applying as, read from their DRAFT (Q-HM14).
 *
 * ── WHY THE DRAFT AND NOT THE FILED APPLICATION ───────────────────────────────────────────────
 * The packet is signed BEFORE it is filed (AF5: approved, opened in the office, then filed), so while
 * the walk that answer decides is happening there is no filed payload to read. The submit gate reads
 * the payload it is filing instead (`applicationSubmit.ts`), which is what makes the FILED document
 * agree with itself even if the draft were changed mid-walk: the lines it demands and the lines the
 * overlay prints both come from the one payload that is filed.
 *
 * ⚠ **One key, by path, never the payload.** The draft holds a date of birth and a licence number,
 * and a count on a checklist has no business pulling either into a response (A11, D-APP16).
 * `payload->questionnaire->>applying_as` is the draft's own shape; the filed shape is
 * `questionnaire_answers`, which `applyingAsOf` reads for the renderer.
 */
export const DRAFT_APPLYING_AS_SELECT = "applying_as:payload->questionnaire->>applying_as";

export async function draftApplyingAs(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<ApplyingAs | null> {
  const { data } = await admin
    .from("application_drafts")
    .select(DRAFT_APPLYING_AS_SELECT)
    // The service role bypasses RLS; this filter is the only thing between two carriers.
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  return asApplyingAs((data as { applying_as?: unknown } | null)?.applying_as);
}
