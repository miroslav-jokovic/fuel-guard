import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRAFT_PAYLOAD_MAX_BYTES,
  draftDateOfBirth,
  draftIsLocked,
  type ApplicationDraftSave,
  type PartOneFactsView,
} from "@silvicom/shared";
import {
  ALREADY_SUBMITTED,
  APPLICATION_NOT_SENT,
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
} from "./applicationIntake.js";
import { loadCarrierWording } from "./carrierWording.js";
import { identityOnRecord } from "./applicantIdentity.js";
import { partOneFactsView } from "./applicantIntake.js";

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
  /** 0376 (AW10): how many times the payload changed. Absent on a fixture or a row read before 0376. */
  revision?: number;
}

/** What the applicant's page is told about their draft. The body is present only when unlocked. */
export interface DraftView {
  /** True when a date of birth has been typed and the body is behind the unlock (D-APP16). */
  locked: boolean;
  /** Present only when `locked` is false, or after a successful unlock. */
  payload: Record<string, unknown> | null;
  furthestSection: string | null;
  updatedAt: string | null;
  /**
   * The revision the page saves against (C3d1b): 0 with no draft. Served on the locked view as well — a
   * count of saves says nothing about what was typed — so the page that unlocks already holds it.
   */
  revision: number;
  /**
   * C3c2c2 (Q-AW34): a v2 link's Part 1 facts, released with the body and on the same answer — never on
   * the bare link, where `GET /:token` serves booleans only. Absent on every other view.
   */
  partOne?: PartOneFactsView;
}

const EMPTY_VIEW: DraftView = { locked: false, payload: null, furthestSection: null, updatedAt: null, revision: 0 };

const revisionOf = (row: DraftRow | null): number => (typeof row?.revision === "number" ? row.revision : 0);

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
    .select("payload, furthest_section, updated_at, revision")
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
    revision: revisionOf(row),
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
): Promise<{ updatedAt: string; revision: number | null } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  // A4: the consent is the first act on the link, so nothing writes before it. A draft holds a date
  // of birth, and storing one for somebody who has not agreed to transact electronically is the
  // thing §390.32(d) asks us to be able to disprove.
  //
  // ⚠ The carrier's PUBLISHED wording, read per save, and the read is the point rather than an
  // overhead: 0338 publishes rows, so the code constant stays `v0-draft` for ever and this gate
  // asked it until 2026-09-13 — which is to say it did not gate. One indexed select against
  // `org_disclosures` is the price of the gate being real.
  const consent = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
  if (consent) return consent;
  // Nothing to draft once the application is filed: the certified payload is the record from then
  // on, and a draft written afterwards could only ever disagree with it.
  if (invitation.submitted_at) return ALREADY_SUBMITTED;
  // AF4, D-AF5: the form is the office's to send. The identity the permissions visit collects is
  // written by its own path (`record_applicant_identity`), never through this one.
  if (!invitation.application_sent_at) return APPLICATION_NOT_SENT;

  // A cap, not a validation. 128 KB is orders of magnitude above a real application draft and well
  // inside the 1 MB body parser — it is here so an unauthenticated caller cannot use a driver's link
  // as free storage, not to tell the driver anything about their answers.
  if (Buffer.byteLength(JSON.stringify(body.payload), "utf8") > DRAFT_PAYLOAD_MAX_BYTES) {
    return { code: "draft_too_large", message: "That is more than this form can hold. Nothing was saved." };
  }

  // ⚠ The identity on `drivers` wins over whatever this tab sent (D-AF8) — see `identityOnRecord`
  // for why a wholesale replace would otherwise make every stale tab a second identity writer.
  const payload = {
    ...body.payload,
    ...(await identityOnRecord(admin, invitation.org_id, invitation.driver_id)),
  };

  // C3d1b: the revision-checked overload when the page says which revision it holds, so a stale tab
  // or a replayed device copy is refused rather than written over a newer save (0376, DA041). Without
  // one — a page from before C3d1b — the 5-argument save, as before; M2 removes that path.
  const { data, error } = await admin.rpc("save_application_draft", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_payload: payload,
    p_section: body.section ?? null,
    ...(body.revision === undefined ? {} : { p_expected_revision: body.revision }),
  });
  if (error) {
    if ((error as { code?: string }).code === "DA041") return DRAFT_REVISION_CONFLICT;
    return { code: "draft_save_failed", message: error.message };
  }
  const saved = data as { updated_at?: string; revision?: number } | null;
  return {
    updatedAt: String(saved?.updated_at ?? now.toISOString()),
    revision: typeof saved?.revision === "number" ? saved.revision : null,
  };
}

/**
 * The draft moved on since this page read it: another tab or device saved, or the office corrected an
 * answer (both bump 0376's revision through its trigger). Said in the driver's words; the page stops
 * saving and offers the reload that shows them the newer answers.
 */
export const DRAFT_REVISION_CONFLICT: IntakeError = {
  code: "draft_revision_conflict",
  message: "Your application was changed on another screen. Reload this page to carry on from the latest answers.",
};

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
  // C3c2c2: a v2 link has Part 1's facts to release too, and they are gated whether or not a draft
  // exists — so the date of birth to check is the draft's, or, with none there, the one Part 1 recorded
  // on `drivers` (the same value: `record_applicant_identity` writes both, and every save re-lays it).
  const partOne = await partOneFactsView(admin, invitation.org_id, invitation, now);
  const stored = (row ? draftDateOfBirth(row.payload) : null)
    ?? (partOne ? await driverDateOfBirth(admin, invitation.org_id, invitation.driver_id) : null);
  // Nothing recorded to check against: there is nothing gated, so unlocking is a no-op that returns
  // the same view the plain read would have — and no Part 1 facts. It must not become a way to ask
  // whether a draft exists.
  if (!stored) return viewDraft(row);
  if (!dobMatches(dateOfBirth, stored)) {
    return {
      locked: true, payload: null, furthestSection: row?.furthest_section ?? null, updatedAt: row?.updated_at ?? null,
      revision: revisionOf(row),
    };
  }
  return {
    locked: false,
    // An empty body when Part 1 was answered and nothing of Part 2 yet: unlocked, with nothing to resume.
    payload: row?.payload ?? {},
    furthestSection: row?.furthest_section ?? null,
    updatedAt: row?.updated_at ?? null,
    revision: revisionOf(row),
    ...(partOne ? { partOne } : {}),
  };
}

/** The date of birth on `drivers`, as PostgREST serves a `date`: `YYYY-MM-DD`. */
async function driverDateOfBirth(admin: SupabaseClient, orgId: string, driverId: string): Promise<string | null> {
  const { data } = await admin
    .from("drivers")
    .select("date_of_birth")
    .eq("org_id", orgId)
    .eq("id", driverId)
    .maybeSingle();
  const value = (data as { date_of_birth?: string | null } | null)?.date_of_birth;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
