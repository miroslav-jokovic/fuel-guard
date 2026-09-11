import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applicationIsEditable,
  applicationReviewState,
  driverApplicationObject,
  type ApplicationEdit,
  type ApplicationPath,
  type ApplicationPhases,
  type ApplicationReviewState,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";

/**
 * The office's review of an application before the driver certifies it (F4, D-AX11–13).
 *
 * ── WHAT THE OFFICE IS EDITING, AND WHY THAT IS THE CHEAP PART ────────────────────────────────
 * `application_drafts.payload` — the answers, still a draft. Not `driver_applications`, which is the
 * append-only certified record and does not exist yet. That is the whole reason the certification
 * moved behind the review: correcting a draft costs nothing, and correcting a filed §391.51 document
 * is not a thing anyone should be able to do.
 *
 * ── THE WINDOW, AND WHY IT CLOSES AT APPROVAL AND NOT AT SIGNING ──────────────────────────────
 * `applicationIsEditable` is true only between the driver sending it and the office approving it.
 * ⚠ It would be easy to leave editing open until the driver signs — the draft is still a draft, after
 * all. It must not be: approval is what tells the driver *this document, now, please sign it*, and an
 * answer changing underneath them between being asked and signing is exactly the thing this flow was
 * built to stop happening.
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
  message: "This application can only be changed while it is waiting for review.",
};

const NOT_REVIEWABLE: ReviewError = {
  code: "application_not_reviewable",
  message: "This application has not been sent for review yet.",
};

interface InvitationRow {
  id: string;
  org_id: string;
  driver_id: string;
  review_requested_at: string | null;
  approved_at: string | null;
  submitted_at: string | null;
}

const phasesOf = (row: InvitationRow): ApplicationPhases => ({
  reviewRequestedAt: row.review_requested_at,
  approvedAt: row.approved_at,
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
    .select("id, org_id, driver_id, review_requested_at, approved_at, submitted_at")
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
    .select("payload")
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
    edits: (edits ?? []).map((e) => {
      const row = e as { path: ApplicationPath; before: unknown; after: unknown; edited_at: string; edited_by: string | null };
      return { path: row.path, before: row.before, after: row.after, editedAt: row.edited_at, editedBy: row.edited_by };
    }),
  };
}

/** The value at a contract path, or undefined — the same walk `fieldLabels.ts` does for a message. */
function valueAt(root: unknown, path: ApplicationPath): unknown {
  let at: unknown = root;
  for (const step of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string | number, unknown>)[step as string | number];
  }
  return at;
}

/**
 * Write `value` at `path` in a COPY of `root`.
 *
 * ⚠ Structural-shares nothing: every container on the way down is cloned, so the original payload is
 * untouched if the result turns out not to parse. Refusing an edit has to leave the draft exactly as
 * the driver left it, and an in-place write that is then "rolled back" is a rollback nobody wrote.
 */
function withValueAt(root: unknown, path: ApplicationPath, value: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const clone: Record<string | number, unknown> = Array.isArray(root)
    ? ([...root] as unknown as Record<string | number, unknown>)
    : { ...((root as Record<string, unknown>) ?? {}) };
  clone[head as string | number] = rest.length === 0
    ? value
    : withValueAt(clone[head as string | number], rest as ApplicationPath, value);
  return clone;
}

export interface EditContext {
  actorId: string;
}

/**
 * Correct one answer.
 *
 * Returns the new payload, or a refusal. Nothing is written unless the corrected document parses
 * against `driverApplicationObject` — the same object the applicant's own wizard validates with, so
 * the office cannot put the draft into a state the driver would then be unable to certify.
 */
export async function editApplication(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  edit: ApplicationEdit,
  ctx: EditContext,
): Promise<{ payload: Record<string, unknown> } | ReviewError> {
  const inv = await invitation(admin, orgId, invitationId);
  if (!inv) return NOT_FOUND;
  if (!applicationIsEditable(phasesOf(inv))) return NOT_EDITABLE;

  const { data: draft } = await admin
    .from("application_drafts")
    .select("payload")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  const payload = ((draft as { payload?: Record<string, unknown> } | null)?.payload) ?? null;
  if (!payload) return NOT_FOUND;

  const before = valueAt(payload, edit.path);
  const next = withValueAt(payload, edit.path, edit.value) as Record<string, unknown>;

  /**
   * ⚠ `.partial()` — the draft is a DRAFT and is allowed to be incomplete. Parsing it whole would
   * refuse every edit to an application the driver has not finished, which is most of them. What is
   * being checked is that the edited field itself is a legal value of its own type, and that nothing
   * else was broken on the way in.
   */
  const parsed = driverApplicationObject.partial().safeParse(next);
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
  const { error: saveError } = await admin
    .from("application_drafts")
    .update({ payload: next })
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  if (saveError) return { code: "edit_failed", message: "That change could not be saved. Try again." };

  const { error: logError } = await admin.from("application_edits").insert({
    org_id: orgId,
    invitation_id: invitationId,
    path: edit.path,
    before: before ?? null,
    after: edit.value ?? null,
    edited_by: ctx.actorId,
  });
  if (logError) return { code: "edit_not_recorded", message: "That change could not be recorded. Try again." };

  await writeAudit(admin, {
    orgId,
    actorId: ctx.actorId,
    action: "application_answer_edited",
    entity: "application_invitations",
    entityId: invitationId,
    meta: { path: edit.path },
  });

  return { payload: next };
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
  orgId: string,
  invitationId: string,
  ctx: EditContext,
  now: Date,
): Promise<{ approvedAt: string } | ReviewError> {
  const inv = await invitation(admin, orgId, invitationId);
  if (!inv) return NOT_FOUND;
  const state = applicationReviewState(phasesOf(inv));
  if (state === "filling") return NOT_REVIEWABLE;
  if (state === "certified") {
    return { code: "already_certified", message: "This application has already been signed and filed." };
  }
  if (inv.approved_at) return { approvedAt: inv.approved_at };

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

  return { approvedAt };
}
