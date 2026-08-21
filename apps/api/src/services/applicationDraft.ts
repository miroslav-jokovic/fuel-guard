import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRAFT_PAYLOAD_MAX_BYTES,
  draftDateOfBirth,
  draftIsLocked,
  type ApplicationDraftSave,
} from "@fuelguard/shared";
import {
  ALREADY_SUBMITTED,
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
} from "./applicationIntake.js";

/**
 * The applicant's saved draft (A2) — the other half of what 0225 started.
 *
 * 0225 made the invitation a session; this gives the session a memory. Nine in ten of these forms
 * are filled on a phone, and the entire product battle is not losing the driver mid-form: before
 * this, a lost tab was forty minutes of typing gone and a request to the carrier for a new link.
 *
 * It lives beside `applicationIntake.ts` rather than inside it for two reasons. The draft is on the
 * other side of the evidence line from everything that file handles — it is prunable transcription,
 * not a certified or signed artifact — and keeping the two apart means the read gate below cannot be
 * confused with the neutral refusals that protect the invitation itself.
 *
 * ── THE READ GATE (D-APP16) ────────────────────────────────────────────────────────────────────
 * D-APP2 defended the database leak: a leaked table yields no working links, and the draft is not in
 * `RETENTION_FORBIDDEN` so it can actually be pruned. It did not defend the LINK leak. The link is a
 * session now, A10 re-sends it in a nudge email, and an email is forwarded and a phone is shared —
 * so a draft holding a date of birth is not something the bare token may read.
 *
 * Once a draft contains one, `GET /:token` returns the phase stamps and the furthest section and no
 * body; the body is released by `unlockDraft` carrying the matching date of birth. A failed unlock
 * reveals nothing and burns nothing — the driver who genuinely forgets can ask the carrier to
 * re-issue — and guessing is throttled by the surface's own rate limit (20/min at `app.ts:147`,
 * with `/api/public`'s 60/min stacked on top; the budget is the intersection).
 */

export interface DraftRow {
  payload: Record<string, unknown>;
  furthest_section: string | null;
  updated_at: string;
}

/** What the applicant's page is told about their draft. The body is present only when unlocked. */
export interface DraftView {
  /** True when a date of birth has been typed and the body is behind the unlock (D-APP16). */
  locked: boolean;
  /** Present only when `locked` is false, or after a successful unlock. */
  payload: Record<string, unknown> | null;
  furthestSection: string | null;
  updatedAt: string | null;
}

const EMPTY_VIEW: DraftView = { locked: false, payload: null, furthestSection: null, updatedAt: null };

/**
 * Constant-time compare of two dates of birth.
 *
 * Hashed first, then compared: `timingSafeEqual` throws on a length mismatch, and a caller who could
 * learn "your guess was the wrong LENGTH" has learned something about the answer. Two digests are
 * always the same length, so the comparison is uniform for every input — the same reasoning that
 * makes `hashInvitationToken` the thing the token lookup compares.
 */
function dobMatches(given: string, stored: string): boolean {
  const a = createHash("sha256").update(given.trim(), "utf8").digest();
  const b = createHash("sha256").update(stored.trim(), "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Read the one draft for an invitation. Absent is a normal state, not an error. */
async function readDraft(admin: SupabaseClient, orgId: string, invitationId: string): Promise<DraftRow | null> {
  const { data } = await admin
    .from("application_drafts")
    .select("payload, furthest_section, updated_at")
    // The service role bypasses RLS, so this query carries its own tenant scope even though
    // `invitation_id` is unique — the id came from a resolved token, and the org filter is what
    // makes that provenance explicit rather than assumed.
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  return (data as DraftRow | null) ?? null;
}

/** The draft as `GET /:token` presents it — body withheld once a date of birth is in it. */
export function viewDraft(row: DraftRow | null): DraftView {
  if (!row) return EMPTY_VIEW;
  const locked = draftIsLocked(row.payload);
  return {
    locked,
    payload: locked ? null : row.payload,
    furthestSection: row.furthest_section,
    updatedAt: row.updated_at,
  };
}

export async function loadDraft(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<DraftView> {
  return viewDraft(await readDraft(admin, orgId, invitationId));
}

/**
 * Save a partial form.
 *
 * The body is unvalidated by design (D-APP2) — a form that refuses to save until it is valid cannot
 * save at all until it is finished. Two things are still checked, and both are about what a draft
 * may CONTAIN rather than whether it is complete: its size, and the SSN key, which the contract
 * schema refuses before this function is reached.
 */
export async function saveDraft(
  admin: SupabaseClient,
  token: string,
  body: ApplicationDraftSave,
  now: Date,
): Promise<{ updatedAt: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  // A4: the consent is the first act on the link, so nothing writes before it. A draft holds a date
  // of birth, and storing one for somebody who has not agreed to transact electronically is the
  // thing §390.32(d) asks us to be able to disprove.
  const consent = requireEsignConsent(invitation);
  if (consent) return consent;
  // Nothing to draft once the application is filed: the certified payload is the record from then
  // on, and a draft written afterwards could only ever disagree with it.
  if (invitation.submitted_at) return ALREADY_SUBMITTED;

  // A cap, not a validation. 128 KB is orders of magnitude above a real application draft and well
  // inside the 1 MB body parser — it is here so an unauthenticated caller cannot use a driver's link
  // as free storage, not to tell the driver anything about their answers.
  if (Buffer.byteLength(JSON.stringify(body.payload), "utf8") > DRAFT_PAYLOAD_MAX_BYTES) {
    return { code: "draft_too_large", message: "That is more than this form can hold. Nothing was saved." };
  }

  const { data, error } = await admin.rpc("save_application_draft", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_payload: body.payload,
    p_section: body.section ?? null,
  });
  if (error) return { code: "draft_save_failed", message: error.message };
  return { updatedAt: String((data as { updated_at?: string } | null)?.updated_at ?? now.toISOString()) };
}

/**
 * Release a gated draft to the person who typed it (D-APP16).
 *
 * A wrong answer returns the same "no body" the locked read returns, and changes nothing: no
 * attempt counter, no lockout, no stamp on the invitation. Burning the link on a failed guess would
 * turn a driver mistyping their own birthday into a support call, and the throttle that actually
 * stops guessing is the rate limiter, which is already there.
 */
export async function unlockDraft(
  admin: SupabaseClient,
  token: string,
  dateOfBirth: string,
  now: Date,
): Promise<DraftView | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;

  const row = await readDraft(admin, invitation.org_id, invitation.id);
  const stored = row ? draftDateOfBirth(row.payload) : null;
  // No draft, or no date of birth in it: there is nothing gated, so unlocking is a no-op that
  // returns the same view the plain read would have. It must not become a way to ask whether a
  // draft exists.
  if (!row || !stored) return viewDraft(row);
  if (!dobMatches(dateOfBirth, stored)) {
    return { locked: true, payload: null, furthestSection: row.furthest_section, updatedAt: row.updated_at };
  }
  return { locked: false, payload: row.payload, furthestSection: row.furthest_section, updatedAt: row.updated_at };
}
