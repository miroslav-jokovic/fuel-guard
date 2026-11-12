import type { SupabaseClient } from "@supabase/supabase-js";
import type { FactEditRow } from "@silvicom/shared";

/**
 * The rows for `application_edits` (0337, written by 0593's `record_application_edits`), and the one rule for when the office may still write
 * at all (APPLICATION-FIX-PLAN F3, E7).
 *
 * ── WHY ITS OWN MODULE ────────────────────────────────────────────────────────────────────────
 * Three office acts change what an application says before the driver signs it: a draft correction
 * (`editApplication`), a Part 1 correction (`correctApplicantPartOne`) and an identity correction
 * (`correctApplicantIdentity`); a single Part 1 answer and the SSN replace came later. Until F3 only the first wrote a row, so the other two reached the signed
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
 * What one office act changed, one row per answer, as the `correct_*` functions take it (`p_edits`), so
 * the driver sees each on 3.1 (D-AX12).
 *
 * ── ONE TRANSACTION (Q-AM14 (a), owner 2026-11-11; migration 0593) ────────────────────────────
 * Until 0593 the rows were a second PostgREST insert after the change, so a failed insert left a change
 * on file the driver was never shown, and a retry found nothing to log. Now every office door calls a
 * `correct_*` function with these rows, and `record_application_edits` writes them in the same
 * transaction as the change: if they are refused, the correction is undone with them. The shaping
 * rules (a withheld row carries no value; null is "left blank") live in that function, the one writer.
 * An empty list is sent as null: an unchanged answer is not a correction the driver must read.
 */
export function editsParam(rows: readonly FactEditRow[]): FactEditRow[] | null {
  return rows.length === 0 ? null : rows.map((r) => ({
    path: r.path,
    before: r.before ?? null,
    after: r.after ?? null,
    note: r.note ?? null,
    withheld: r.withheld === true,
  }));
}

/**
 * The refusal when the edit rows themselves were refused (0593's AE001, or 0586's CHECK on a reason,
 * 23514). Since 0593 nothing was changed in that case, so the office can simply try again.
 */
export function editRowsRefusal(error: { code?: string } | null): EditLogRefusal | null {
  if (!error || (error.code !== "AE001" && error.code !== "23514")) return null;
  return {
    code: "edit_not_recorded",
    message: "Nothing was changed: the record the applicant is shown could not be written. Try again, and tell support if it keeps happening.",
  };
}
