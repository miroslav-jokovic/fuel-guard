import type { SupabaseClient } from "@supabase/supabase-js";
import type { FactEditRow } from "@silvicom/shared";

/**
 * The one writer of `application_edits` (0337), and the one rule for when the office may still write
 * at all (APPLICATION-FIX-PLAN F3, E7).
 *
 * ── WHY ITS OWN MODULE ────────────────────────────────────────────────────────────────────────
 * Three office acts change what an application says before the driver signs it: a draft correction
 * (`editApplication`), a Part 1 correction (`correctApplicantPartOne`) and an identity correction
 * (`correctApplicantIdentity`). Until F3 only the first wrote a row, so the other two reached the signed
 * document without the driver being shown them on 3.1, and only the first stopped at the driver's first
 * packet mark — the other two stopped at filing, so a phone or a date of birth could change under a
 * driver half way through signing. One module holds both the log and the stop, so a fourth act cannot
 * take one without the other. It imports nothing from recruiting, so each act can use it without the
 * identity → Part 1 → review import cycle.
 */

export interface EditLogRefusal {
  code: string;
  message: string;
}

/** The refusal every office correction gives once the driver has marked the packet. */
export const SIGNING_STARTED: EditLogRefusal = {
  code: "application_not_editable",
  message: "The applicant has started signing, so what the application says is fixed now.",
};

/** Has the driver made any mark on the packet? From then on the document they are signing stays put. */
export async function signingStarted(admin: SupabaseClient, orgId: string, invitationId: string): Promise<boolean> {
  const { count } = await admin
    .from("application_packet_marks")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  return (count ?? 0) > 0;
}

/**
 * Record what one office act changed, one row per answer, so the driver sees each on 3.1 (D-AX12).
 *
 * ⚠ After the change itself, never instead of it, and not in one transaction with it: the draft goes
 * through `save_application_draft` and Part 1 through `record_applicant_intake`, and neither takes the
 * log. So a failure here leaves a change made and unrecorded, and the caller reports it rather than
 * "done". A retry does not repair it: the change is already on file, so the next diff finds nothing.
 * The window is one insert wide. Closing it means writing the rows inside those two functions, which is
 * a migration on the functions every applicant save goes through. That is recorded in
 * APPLICATION-FIX-PLAN §5 rather than decided silently here.
 */
export async function recordOfficeEdits(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  rows: readonly FactEditRow[],
  actorId: string,
): Promise<EditLogRefusal | null> {
  if (rows.length === 0) return null;
  const { error } = await admin.from("application_edits").insert(
    rows.map((r) => ({
      org_id: orgId,
      invitation_id: invitationId,
      path: r.path,
      before: r.before ?? null,
      after: r.after ?? null,
      edited_by: actorId,
    })),
  );
  return error
    ? {
      code: "edit_not_recorded",
      message: "The change was saved, but the record the applicant is shown could not be written. Tell support before they sign.",
    }
    : null;
}
