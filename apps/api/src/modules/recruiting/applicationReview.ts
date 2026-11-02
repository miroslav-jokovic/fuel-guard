import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import {
  applyApplicationEdit,
  applicationIsEditable,
  isEditRefusal,
  withEmployerKeys,
  applicationReviewState,
  applicationDraftPayloadSchema,
  type ApplicationEdit,
  type ApplicationPath,
  type ApplicationPhases,
  type ApplicationReviewState,
  type PartOneFactsView,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import type { Env } from "../../env.js";
import { notifyApplicationApproved, type ApprovalNotice } from "./applicationApprovalNotice.js";
import { partOneFactsView } from "./applicantIntake.js";

/**
 * The office's review of an application before the driver certifies it (F4, D-AX11–13).
 *
 * ── WHAT THE OFFICE IS EDITING, AND WHY THAT IS THE CHEAP PART ────────────────────────────────
 * `application_drafts.payload` — the answers, still a draft. Not `driver_applications`, which is the
 * append-only certified record and does not exist yet. That is the whole reason the certification
 * moved behind the review: correcting a draft costs nothing, and correcting a filed §391.51 document
 * is not a thing anyone should be able to do.
 *
 * ── THE WINDOW: FROM THE OFFICE'S SEND UNTIL THE DRIVER'S FIRST MARK (§9 P5, Q-WF5) ──────────
 * Until 2026-10-31 it closed at approval, so that an answer could not change between the driver being
 * asked to sign and signing. The owner's office needs the reverse — the recruiter types the jobs in on
 * the phone, before the applicant sends and after approval — and the protection that mattered is kept
 * at the point it is real: the first mark on the packet. From then on the driver is signing a document
 * and it does not move (`signingStarted`); before it, every change is shown to them at signing
 * (`applicantVisibleEdits`) and they certify what is on the screen that day.
 *
 * ── AND WHY EVERY EDIT RE-PARSES THE WHOLE DOCUMENT ───────────────────────────────────────────
 * `applicationEditSchema.value` is `unknown`, deliberately: which type is legal depends entirely on
 * which path. A boolean at `declares_no_accidents`, a string at `employers.0.city`, an array at
 * `addresses`. The only check that can actually be right is the contract itself, run over the result
 * — so an edit is applied to a COPY, the copy is parsed, and the copy is kept only if it parses. An
 * office that types a word into the fatalities count gets a refusal, not a draft the driver cannot
 * certify.
 */

export interface ReviewError {
  code: string;
  message: string;
}

export const isReviewError = (v: unknown): v is ReviewError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

const NOT_FOUND: ReviewError = {
  code: "application_not_found",
  message: "There is no application on this invitation.",
};

const NOT_EDITABLE: ReviewError = {
  code: "application_not_editable",
  // §9 P5 moved the window to "the office's send until the first packet mark"; this said "waiting for review".
  message: "This application can't be changed now — it has not been sent to the applicant yet, or it is filed.",
};

/**
 * What a REPEATED approval reports (Q-AX4). Not "we could not send" — nothing was attempted, because
 * the first approval already told them. Naming it rather than inventing a reason keeps the drawer
 * from telling a recruiter to phone somebody who has already been emailed.
 */
const ALREADY_TOLD: ApprovalNotice = { sent: false, email: null, reason: "already_notified", texted: false };

const NOT_REVIEWABLE: ReviewError = {
  code: "application_not_reviewable",
  message: "This application has not been sent for review yet.",
};

interface InvitationRow {
  id: string;
  org_id: string;
  driver_id: string;
  /** Where the approval notice goes (Q-AX4). Nullable: a recruiter may invite with a link alone. */
  email: string | null;
  application_sent_at: string | null;
  review_requested_at: string | null;
  approved_at: string | null;
  signing_opened_at: string | null;
  submitted_at: string | null;
}

const phasesOf = (row: InvitationRow): ApplicationPhases => ({
  applicationSentAt: row.application_sent_at,
  reviewRequestedAt: row.review_requested_at,
  approvedAt: row.approved_at,
  signingOpenedAt: row.signing_opened_at,
  submittedAt: row.submitted_at,
});

async function invitation(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<InvitationRow | null> {
  const { data } = await admin
    .from("application_invitations")
    // The service role bypasses RLS, so the org filter is the only thing between two carriers.
    .select("id, org_id, driver_id, email, application_sent_at, review_requested_at, approved_at, signing_opened_at, submitted_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  return (data as InvitationRow | null) ?? null;
}

export interface ApplicationForReview {
  invitationId: string;
  driverId: string;
  state: ApplicationReviewState;
  editable: boolean;
  payload: Record<string, unknown> | null;
  /** The draft's revision as read (0376); 0 when there is no draft yet. Every edit names it (§9 P5). */
  revision: number;
  /**
   * A v2 invitation's Part 1 facts (C3c2c2, Q-AW34), null for a legacy one — so the drawer composes the
   * document filing will (`composeFiledApplication`) rather than showing the draft's retyped copy.
   */
  partOne: PartOneFactsView | null;
  edits: Array<{ path: ApplicationPath; before: unknown; after: unknown; editedAt: string; editedBy: string | null }>;
}

/** The application as the office reads it: the answers, where it has got to, and what was changed. */
export async function applicationForReview(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<ApplicationForReview | ReviewError> {
  const inv = await invitation(admin, orgId, invitationId);
  if (!inv) return NOT_FOUND;

  const { data: draft } = await admin
    .from("application_drafts")
    .select("payload, revision")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();

  const { data: edits } = await admin
    .from("application_edits")
    .select("path, before, after, edited_at, edited_by")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .order("edited_at", { ascending: false });

  const phases = phasesOf(inv);
  return {
    invitationId: inv.id,
    driverId: inv.driver_id,
    state: applicationReviewState(phases),
    editable: applicationIsEditable(phases),
    payload: ((draft as { payload?: Record<string, unknown> } | null)?.payload) ?? null,
    // §9 P5: the revision the office is looking at, sent back with every edit.
    revision: ((draft as { revision?: number | null } | null)?.revision) ?? 0,
    partOne: await partOneFactsView(admin, orgId, inv, new Date()),
    edits: (edits ?? []).map((e) => {
      const row = e as { path: ApplicationPath; before: unknown; after: unknown; edited_at: string; edited_by: string | null };
      return { path: row.path, before: row.before, after: row.after, editedAt: row.edited_at, editedBy: row.edited_by };
    }),
  };
}

export interface EditContext {
  actorId: string;
}

/**
 * §8.1 / §9 P5: the applicant's phone and the office write the same draft, and only one revision of
 * it can win. Said in the office's words; the drawer reloads and the recruiter types it again.
 */
export const DRAFT_CHANGED: ReviewError = {
  code: "draft_revision_conflict",
  message: "The applicant changed this just now — reload the application and try again.",
};

const SIGNING_STARTED: ReviewError = {
  code: "application_not_editable",
  message: "The applicant has started signing, so what the application says is fixed now.",
};

/** Has the driver made any mark on the packet? From then on the document they are signing stays put. */
async function signingStarted(admin: SupabaseClient, orgId: string, invitationId: string): Promise<boolean> {
  const { count } = await admin
    .from("application_packet_marks")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  return (count ?? 0) > 0;
}

/**
 * Change the draft — one answer, a job removed or added, or a gap explained (§9 P5).
 *
 * Returns the new payload and revision, or a refusal. Nothing is written unless the changed document
 * parses against the same draft schema the applicant's own saves are held to, so the office cannot
 * put the draft into a state the driver would then be unable to certify.
 *
 * ⚠ Written through `save_application_draft` with the revision the office READ (0376, DA041) — never
 * a bare update. Until 2026-10-31 it was `.update({ payload })`, outside the check the applicant's
 * phone is held to, so a recruiter's correction could land over an autosave made a second earlier
 * and erase it (HIRING-WORKFLOW-AUDIT §8.1). Now whichever writes second is told, on either side.
 */
export async function editApplication(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  edit: ApplicationEdit,
  ctx: EditContext,
): Promise<{ payload: Record<string, unknown>; revision: number | null } | ReviewError> {
  const inv = await invitation(admin, orgId, invitationId);
  if (!inv) return NOT_FOUND;
  if (!applicationIsEditable(phasesOf(inv))) return NOT_EDITABLE;
  if (await signingStarted(admin, orgId, invitationId)) return SIGNING_STARTED;

  const { data: draft } = await admin
    .from("application_drafts")
    .select("payload, revision")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const row = draft as { payload?: Record<string, unknown> | null; revision?: number | null } | null;
  // EM-1: before the applicant has typed anything there is no draft; the office's edit makes the first.
  const original = row?.payload ?? {};
  if ((row?.revision ?? 0) !== edit.revision) return DRAFT_CHANGED;

  const applied = applyApplicationEdit(withEmployerKeys(original, randomUUID), original, edit);
  if (isEditRefusal(applied)) return applied;

  /**
   * ⚠ The DRAFT schema, not the certified one.
   *
   * This read `driverApplicationObject.partial()` until 2026-09-11, and that refused every correction
   * an office could make: a real autosaved payload carries `questionnaire`, the certified document
   * does not, and the contract is `.strict()` — so the parse failed on an unrecognised key before any
   * field was looked at. `applicationDraftPayloadSchema` carries the reasoning; what it still checks
   * is that every field PRESENT is a legal value of its own type, which is the one thing this path needs.
   */
  const parsed = applicationDraftPayloadSchema.safeParse(applied.payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      code: "invalid_edit",
      message: issue ? `That is not a valid answer for this field: ${issue.message}` : "That is not a valid answer for this field.",
    };
  }

  // The draft first, then the record of the change. If the second write fails the edit is still
  // made — and an edit nobody can see is exactly what D-AX13 exists to prevent — so the audit and
  // the edit row are written before anything is reported as done, and a failure surfaces.
  const { data: saved, error: saveError } = await admin.rpc("save_application_draft", {
    p_org: orgId,
    p_invitation: invitationId,
    p_driver: inv.driver_id,
    p_payload: applied.payload,
    p_section: null,
    p_expected_revision: edit.revision,
  });
  if (saveError) {
    if ((saveError as { code?: string }).code === "DA041") return DRAFT_CHANGED;
    return { code: "edit_failed", message: "That change could not be saved. Try again." };
  }

  const { error: logError } = await admin.from("application_edits").insert({
    org_id: orgId,
    invitation_id: invitationId,
    path: applied.logPath,
    before: applied.before ?? null,
    after: applied.after ?? null,
    edited_by: ctx.actorId,
  });
  if (logError) return { code: "edit_not_recorded", message: "That change could not be recorded. Try again." };

  await writeAudit(admin, {
    orgId,
    actorId: ctx.actorId,
    action: "application_answer_edited",
    entity: "application_invitations",
    entityId: invitationId,
    meta: { path: applied.logPath, op: edit.op ?? "set" },
  });

  const revision = (saved as { revision?: unknown } | null)?.revision;
  return { payload: applied.payload, revision: typeof revision === "number" ? revision : null };
}

/**
 * Approve it, and hand it back to the driver to certify.
 *
 * ⚠ Idempotent by the timestamp rather than by a refusal: approving twice is a double-click, and the
 * second one must not tell a recruiter something is wrong. The `is("approved_at", null)` filter is
 * what makes the first approval the one that is recorded.
 */
export async function approveApplication(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  ctx: EditContext,
  now: Date,
): Promise<{ approvedAt: string; notice: ApprovalNotice } | ReviewError> {
  const inv = await invitation(admin, orgId, invitationId);
  if (!inv) return NOT_FOUND;
  const state = applicationReviewState(phasesOf(inv));
  if (state === "filling") return NOT_REVIEWABLE;
  if (state === "certified") {
    return { code: "already_certified", message: "This application has already been signed and filed." };
  }
  // ⚠ The early return is also what makes the applicant's notice exactly-once. A second approval is a
  // double-click, and a driver told twice in one second that their application is ready to sign
  // learns nothing the first message did not already say — it just reads as a system that stutters.
  if (inv.approved_at) return { approvedAt: inv.approved_at, notice: ALREADY_TOLD };

  const approvedAt = now.toISOString();
  const { error } = await admin
    .from("application_invitations")
    .update({ approved_at: approvedAt, approved_by: ctx.actorId })
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .is("approved_at", null);
  if (error) return { code: "approve_failed", message: "That could not be approved. Try again." };

  await writeAudit(admin, {
    orgId,
    actorId: ctx.actorId,
    action: "application_approved",
    entity: "application_invitations",
    entityId: invitationId,
    meta: { driverId: inv.driver_id },
  });

  /**
   * ⚠ AFTER the stamp and after the audit, and never allowed to change either (Q-AX4).
   *
   * The same ordering the invitation route uses, for the same reason: an approval that rolled back
   * because a mail provider was rate-limited would leave a driver who is ALLOWED to sign sitting
   * behind a state that says they are not, and `approved_at` is what the certification route reads.
   * A notice that did not go is a sentence in the recruiter's drawer and a line in the log.
   */
  const notice = await notifyApplicationApproved(admin, env, orgId, inv.driver_id, invitationId, inv.email, now);

  return { approvedAt, notice };
}
