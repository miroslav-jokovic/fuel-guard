import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ASK_AGAIN_MAX_OPEN,
  applicationReviewState,
  askAgainIsOpen,
  canAskAgain,
  type AskAgain,
  type AskAgainView,
  type ApplicationPath,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";

/**
 * The office asks the driver one question again (APPLICATION-FIX-PLAN.md F5; 0607) — the office's half:
 * ask, withdraw, and the list. `applicationAskAgainContract.ts` says what may be asked and why.
 *
 * ── THE WINDOW ────────────────────────────────────────────────────────────────────────────────
 * From the driver's Send until the office approves. Before the Send the driver is still filling the
 * form in and there is nothing to ask ABOUT. Approval is what sends the document to signing, so it is
 * also where asking ends — and approval itself waits on open questions (`openAskAgainCount`, read by
 * `approveApplication`), so no question can be open on a document that is being signed. That is why
 * there is no separate "has signing started" check here, as the office's corrections have: a packet
 * mark cannot exist before an approval.
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS, and 0607's table has no policies.
 */

export interface AskAgainError {
  code: string;
  message: string;
}
export const isAskAgainError = (v: unknown): v is AskAgainError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v && !("id" in v);

const NOT_FOUND: AskAgainError = { code: "application_not_found", message: "There is no application on this invitation." };
const NOT_SENT_YET: AskAgainError = {
  code: "application_not_reviewable",
  message: "The applicant has not sent their application yet, so there is nothing to ask about.",
};
const ALREADY_APPROVED: AskAgainError = {
  code: "application_not_editable",
  message: "This application is approved. A question now would change what the applicant is about to sign.",
};
const NOT_THE_DRIVERS: AskAgainError = {
  code: "not_askable",
  message: "The applicant cannot change this answer on their link any more. Correct it here instead.",
};
const TOO_MANY: AskAgainError = {
  code: "too_many_questions",
  message: `There are already ${ASK_AGAIN_MAX_OPEN} questions waiting for this applicant. Wait for an answer, or take one back.`,
};
const NOT_OPEN: AskAgainError = { code: "question_not_open", message: "That question is already answered or taken back." };

interface Row {
  id: string;
  path: ApplicationPath;
  question: string;
  asked_at: string;
  answered_at: string | null;
  withdrawn_at: string | null;
}
const COLUMNS = "id, path, question, asked_at, answered_at, withdrawn_at";
const view = (r: Row): AskAgainView => ({
  id: r.id, path: r.path, question: r.question, askedAt: r.asked_at, answeredAt: r.answered_at, withdrawnAt: r.withdrawn_at,
});

/** Every question asked on this application, oldest first — open, answered and taken back. */
export async function listAskAgains(admin: SupabaseClient, orgId: string, invitationId: string): Promise<AskAgainView[]> {
  const { data, error } = await admin
    .from("application_ask_agains")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .order("asked_at", { ascending: true });
  // A table not there yet (the deploy window) reads as no questions: nothing can have been asked.
  if (error) return [];
  return ((data ?? []) as Row[]).map(view);
}

/** How many are still waiting on the driver — what approval reads. */
export async function openAskAgainCount(admin: SupabaseClient, orgId: string, invitationId: string): Promise<number> {
  return (await listAskAgains(admin, orgId, invitationId)).filter(askAgainIsOpen).length;
}

const samePath = (a: ApplicationPath, b: ApplicationPath): boolean => JSON.stringify(a) === JSON.stringify(b);

export async function askAgain(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  body: AskAgain,
  ctx: { actorId: string },
  now: Date,
): Promise<AskAgainView | AskAgainError> {
  const { data: inv } = await admin
    .from("application_invitations")
    .select("id, driver_id, application_sent_at, review_requested_at, approved_at, signing_opened_at, submitted_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const row = inv as {
    id: string; driver_id: string; application_sent_at: string | null; review_requested_at: string | null;
    approved_at: string | null; signing_opened_at: string | null; submitted_at: string | null;
  } | null;
  if (!row) return NOT_FOUND;
  const state = applicationReviewState({
    applicationSentAt: row.application_sent_at, reviewRequestedAt: row.review_requested_at, approvedAt: row.approved_at,
    signingOpenedAt: row.signing_opened_at, submittedAt: row.submitted_at,
  });
  if (state === "filling") return NOT_SENT_YET;
  if (state !== "awaiting_review") return ALREADY_APPROVED;
  if (!canAskAgain(body.path)) return NOT_THE_DRIVERS;

  const asked = await listAskAgains(admin, orgId, invitationId);
  const open = asked.filter(askAgainIsOpen);
  // Asked twice about the same answer is a double-click: the question already waiting is the answer.
  const already = open.find((q) => samePath(q.path, body.path));
  if (already) return already;
  if (open.length >= ASK_AGAIN_MAX_OPEN) return TOO_MANY;

  const { data: made, error } = await admin
    .from("application_ask_agains")
    .insert({
      org_id: orgId, invitation_id: invitationId, path: body.path, question: body.question,
      asked_by: ctx.actorId, asked_at: now.toISOString(),
    })
    .select(COLUMNS);
  const inserted = ((made ?? []) as Row[])[0];
  if (error || !inserted) {
    return { code: "ask_failed", message: "The question could not be saved. Nothing was sent to the applicant. Try again." };
  }

  await writeAudit(admin, {
    orgId,
    actorId: ctx.actorId,
    action: "application_question_asked",
    entity: "application_invitations",
    entityId: invitationId,
    // Which answer and whose application. The office's words are on the row, not copied here.
    meta: { driverId: row.driver_id, questionId: inserted.id, path: body.path },
  });
  return view(inserted);
}

/** The office takes a question back: it found the answer another way, or asked in error. */
export async function withdrawAskAgain(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  questionId: string,
  ctx: { actorId: string },
  now: Date,
): Promise<AskAgainView | AskAgainError> {
  const { data, error } = await admin
    .from("application_ask_agains")
    .update({ withdrawn_at: now.toISOString(), withdrawn_by: ctx.actorId })
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .eq("id", questionId)
    // The filters, not a read before, are what stop a question answered a moment ago being taken back.
    .is("answered_at", null)
    .is("withdrawn_at", null)
    .select(COLUMNS);
  const taken = ((data ?? []) as Row[])[0];
  if (error || !taken) return NOT_OPEN;

  await writeAudit(admin, {
    orgId,
    actorId: ctx.actorId,
    action: "application_question_withdrawn",
    entity: "application_invitations",
    entityId: invitationId,
    meta: { questionId },
  });
  return view(taken);
}
