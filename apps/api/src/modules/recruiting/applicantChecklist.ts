import type { SupabaseClient } from "@supabase/supabase-js";
import { hiringChecklist, type AuthorizationRow, type HiringChecklist } from "@silvicom/shared";
import { checklistInputs, type ChecklistInvitation } from "./applicantChecklistInputs.js";

/**
 * Gather the evidence one applicant's checklist folds over (B3, `HIRING-MODULE-PLAN.md` §9).
 *
 * ── THIS MODULE DECIDES NOTHING ────────────────────────────────────────────────────────────────
 * Every rule about what a step means, what blocks it and who owes the next move lives in
 * `hiringChecklist.ts` in `packages/shared`, because the office board, the applicant's own screen
 * and the tests must all fold the same evidence the same way (D-HM2). What happens here is reading
 * rows and naming which column is which. ⚠ If a question about hiring can be answered in this file,
 * it is in the wrong file — that is how the applicant comes to be told they are waiting on us while
 * the office is told it is waiting on them, which is what §1's board defects were, twice.
 *
 * ── THE SERVICE ROLE BYPASSES RLS ──────────────────────────────────────────────────────────────
 * ⚠ So every read below org-filters itself, without exception, and `applicantChecklist.test.ts`
 * asserts it through `supabaseRecorder`'s `expectOrgScoped` rather than trusting the review that
 * noticed.
 *
 * ── THE BOARD WITH ONE ROW (G-7, 2026-09-26) ──────────────────────────────────────────────────
 * ⚠ This read its evidence itself until G-7, in nine queries of its own, while the board read the
 * same tables in its own six — and the two had drifted (`applicantChecklistInputs.ts` has the
 * measurement). Now it reads the three things only it chooses — the driver, the live invitation,
 * the authorizations — and hands them to the builder the board uses.
 */

/** The driver is not this org's, or is not there at all. Told apart from an empty checklist. */
export interface ChecklistError {
  code: "not_found";
  message: string;
}

export const isChecklistError = (v: unknown): v is ChecklistError =>
  typeof v === "object" && v !== null && (v as ChecklistError).code === "not_found";

/** Just enough of the invitation to answer phases — the token hash is never selected. */
const INVITE_COLS =
  // ⚠ One literal: supabase-js types a select by parsing it, and a `+` makes it a plain string.
  "id, created_at, releases_completed_at, application_sent_at, review_requested_at, approved_at, signing_opened_at, submitted_at, revoked_at, handbook_signing_opened_at";

export async function applicantChecklist(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  // ⚠ A parameter rather than a `new Date()` inside, for `boardChecklists`' stated reason: the
  // §391.23(a)(2) three-year window is measured from the hire date or, for an applicant, from today
  // — so a function that read the clock itself could only be tested at a particular hour.
  today: string = new Date().toISOString().slice(0, 10),
): Promise<HiringChecklist | ChecklistError> {
  // ⚠ First, and it is a membership check rather than a lookup: the service role would happily read
  // another org's rows for this id, so the 404 below is what makes every read after it safe to
  // believe. `hire_date` comes back in the same round trip because step 14 is the only thing that
  // reads it.
  const { data: driver } = await admin
    .from("drivers")
    .select("id, hire_date")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver) {
    return { code: "not_found", message: "That applicant is not in this organization." };
  }

  /**
   * The LIVE invitation: the newest one that has not been REVOKED.
   *
   * ⚠ A driver can have several — a link that expired and was re-sent, or a rehire, which 0337 is
   * explicit must not merge with the first application. Reading the newest is the only answer that
   * stays right through both: an older row's stamps describe a hire that already happened or a link
   * that was replaced, and folding those would report last spring's progress as this week's.
   *
   * ⚠ **`revoked_at` was missing from this rule until B4 and that was a real divergence, not a
   * nicety.** `applicationIntake`'s `resolveInvitation` treats a revoked row as dead, and the
   * pipeline that draws the board beside this one has always skipped them. So the same driver could
   * be described by two different invitations on two adjacent surfaces — which is D-HM2's failure
   * named exactly: *the applicant can never be told they are waiting on us while the office is told
   * the opposite*. One rule, in the one place each caller reads it.
   *
   * A `.limit(1)` cannot express "newest unrevoked" in PostgREST without a filter, so the filter is
   * the `.is("revoked_at", null)` below rather than a slice taken afterwards.
   */
  const { data: invites } = await admin
    .from("application_invitations")
    .select(INVITE_COLS)
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const invitation = ((invites ?? []) as ChecklistInvitation[])[0] ?? null;

  const authorizations = await readAuthorizations(admin, orgId, driverId);
  const evidence = await checklistInputs(
    admin,
    orgId,
    [{ driverId, hiredAt: (driver as { hire_date: string | null }).hire_date, invitation, authorizations }],
    today,
  );
  return hiringChecklist(evidence.get(driverId)!.inputs);
}

/**
 * The signed instruments, whole rows.
 *
 * ⚠ `hasLiveAuthorization` needs `revokes` and `accepted_at` to work out which grant survives — 0215
 * revokes by writing a NEW row rather than by mutating one, so "what did we hold at the moment we
 * asked" stays answerable. A query that selected only `purpose` would report a revoked release as
 * live.
 */
async function readAuthorizations(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<AuthorizationRow[]> {
  const { data } = await admin
    .from("driver_authorizations")
    .select("id, purpose, accepted_at, revokes")
    .eq("org_id", orgId)
    .eq("driver_id", driverId);
  return (data ?? []) as AuthorizationRow[];
}
