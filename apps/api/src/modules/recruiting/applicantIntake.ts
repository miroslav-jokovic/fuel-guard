import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INTAKE_CAPTURE_SLOTS,
  type ApplicantIntake,
  type ApplicantIntakeLicence,
  todayInZone,
  type PartOneFacts,
  type PartOneFactsView,
  type PartOneLicence,
  type PartOneStatus,
} from "@silvicom/shared";
import { writeAudit } from "../../lib/audit.js";
import { loadCarrierWording } from "./carrierWording.js";
import { FCRA_SUMMARY_VERSION } from "./fcraSummary.js";
import { promoteCaptures } from "./applicationCapture.js";
import { carrierZone } from "./carrierClock.js";
import {
  ALREADY_SUBMITTED,
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
} from "./applicationIntake.js";

/**
 * Part 1 of the applicant's link — "get started" (APPLICATION-FLOW-V2-PLAN.md §6.2, AW2, D-AW1..D-AW4).
 *
 * ── ONE WRITER, AS IDENTITY HAD ONE ───────────────────────────────────────────────────────────
 * Every Part 1 fact goes through `record_applicant_intake` (0376), which replaces
 * `record_applicant_identity` as the single identity writer (D-AW3, amends D-AF8) and calls it from
 * inside for the date of birth and the current licence — so the licence PSP runs against, the one on
 * `drivers` and the one in the draft stay one fact. The applicant's calls are FILL-ONLY
 * (`p_overwrite = false`): a value the carrier already holds wins, and the answer names which fields
 * kept it, never what they hold (0365's rule, D-APP16).
 *
 * ── PART 1 ENDS ONCE ──────────────────────────────────────────────────────────────────────────
 * `complete_applicant_intake` stamps `intake_completed_at` and files Part 1's photographs as
 * `documents` (D-AW4) — weeks before the application, because the draft and its captures are pruned
 * at 90 days (§2.3.2) and screening outlives that. After it, the applicant's writes are refused
 * (AI008): the office screened on those answers, and only the office corrects them now.
 *
 * ── LEGACY INVITATIONS, AND WHERE THE ROW COMES FROM ─────────────────────────────────────────
 * All eight production invitations predate Part 1 and have no `application_intakes` row (plan §7's
 * legacy rule). Since C3a every NEW invitation is given its (empty) row the moment it is created
 * (`mintIntakeRow`, called by `createApplicationInvite`), so "has a row" and "is v2" are the same
 * fact from the first second — no cutover date, and nothing that reads the row has to learn one. An
 * invitation created before C3a's deploy never gets one: re-sending its link keeps the invitation,
 * and so keeps it legacy. `intakeState` is how every other path asks which kind it is looking at.
 *
 * ⚠ Every query org-filters itself: the service role bypasses RLS, and the org comes from a resolved
 * token, never from the request.
 */

export const INTAKE_FROZEN: IntakeError = {
  code: "intake_frozen",
  message: "You have already finished this part. If something is wrong, tell the carrier and they will correct it.",
};

/** AI009 (D-AW13) — the §40.25(j) question comes before every other Part 1 answer is stored. */
export const PRIOR_POSITIVE_REQUIRED: IntakeError = {
  code: "prior_positive_required",
  message:
    "Answer the question about drug and alcohol tests in the past two years first. Nothing you typed is lost.",
};

export const INTAKE_INCOMPLETE: IntakeError = {
  code: "intake_incomplete",
  message:
    "Before you go on: photograph both sides of your licence, photograph your medical card or say you "
    + "don't have one yet, and read the summary of your rights.",
};

/**
 * The page showed a summary other than the one this server holds — it was loaded before the text
 * changed. Refused rather than recorded: the version says which text was READ, and recording the new
 * one would be a claim about a screen the applicant never saw.
 */
export const FCRA_SUMMARY_CHANGED: IntakeError = {
  code: "fcra_summary_changed",
  message: "The summary of your rights has been updated. Reload the page to read the current one.",
};

const INVALID_LINK: IntakeError = {
  code: "invalid_link",
  message: "This application link is not valid. Ask for a new one.",
};

/** The Part 1 answers as `record_applicant_intake` reads them — present keys written, absent kept. */
function intakePayload(body: ApplicantIntake): Record<string, unknown> {
  const { endorsements: _endorsements, ...fields } = body;
  return fields;
}

/** Map the function's refusals to this surface's answers, one table for both writers. */
function refusalOf(error: { code?: string; message: string }): IntakeError {
  switch (error.code) {
    case "AI001":
    case "AI002":
      return INVALID_LINK;
    case "AI003":
      return ALREADY_SUBMITTED;
    case "AI004":
      return { code: "invalid_request", message: "Some of that could not be saved. Check it and try again." };
    case "AI007":
      return INTAKE_INCOMPLETE;
    case "AI008":
      return INTAKE_FROZEN;
    case "AI009":
      return PRIOR_POSITIVE_REQUIRED;
    default:
      return { code: "intake_failed", message: error.message };
  }
}

/** The live, consented, unfiled session every Part 1 write needs — or the refusal that stops it. */
async function openIntake(admin: SupabaseClient, token: string, now: Date) {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  // §390.32(d): nothing is written before the 7001(c) consent, and a date of birth is among the first
  // things this path writes — the carrier's published wording, never the placeholders.
  const consent = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
  if (consent) return consent;
  if (invitation.submitted_at) return ALREADY_SUBMITTED;
  // The cheap refusal; the function checks it again under its lock.
  if (invitation.intake_completed_at) return INTAKE_FROZEN;
  return invitation;
}

/**
 * One Part 1 screen's answers, and/or the licence list — both through the one function.
 *
 * `licences` replaces the stored list whole, in the order given: position 0 is the current CDL.
 */
export async function recordIntake(
  admin: SupabaseClient,
  token: string,
  body: { intake?: ApplicantIntake; licences?: ApplicantIntakeLicence[] },
  now: Date,
): Promise<{ keptExisting: string[]; licenceCount: number } | IntakeError> {
  const invitation = await openIntake(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  const shown = body.intake?.fcra_summary_version;
  if (shown !== undefined && shown !== FCRA_SUMMARY_VERSION) return FCRA_SUMMARY_CHANGED;

  const { data, error } = await admin.rpc("record_applicant_intake", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_intake: body.intake ? intakePayload(body.intake) : {},
    p_licences: body.licences
      ? body.licences.map((l, position) => ({
          position,
          state_code: l.state_code,
          agency: l.agency ?? null,
          licence_number: l.licence_number,
          expires_on: l.expires_on ?? null,
          source: "intake",
        }))
      : null,
    p_endorsements: body.intake?.endorsements ?? null,
    p_overwrite: false,
  });
  if (error) return refusalOf(error);
  const row = data as { kept_existing?: unknown; licence_count?: unknown } | null;
  return {
    keptExisting: Array.isArray(row?.kept_existing) ? (row.kept_existing as string[]) : [],
    licenceCount: Number(row?.licence_count ?? 0),
  };
}

/**
 * Finish Part 1: file its photographs, stamp `intake_completed_at`. Idempotent — a second press
 * answers with the first stamp and files nothing (0376).
 *
 * The bytes are copied into the evidence bucket BEFORE the transaction, for the reason
 * `promoteCaptures` states: a row citing bytes that are not there is the one state 0146 exists to
 * prevent, and orphaned bytes after a refused transaction are collected by the nightly sweep.
 */
export async function completeIntake(
  admin: SupabaseClient,
  token: string,
  now: Date,
): Promise<{ intakeCompletedAt: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  const consent = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
  if (consent) return consent;
  if (invitation.submitted_at) return ALREADY_SUBMITTED;
  if (invitation.intake_completed_at) return { intakeCompletedAt: invitation.intake_completed_at };

  const captures = await promoteCaptures(
    admin, invitation.org_id, invitation.id, invitation.driver_id, INTAKE_CAPTURE_SLOTS,
  );
  if (isIntakeError(captures)) return captures;

  const { data, error } = await admin.rpc("complete_applicant_intake", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_driver: invitation.driver_id,
    p_captures: captures,
  });
  if (error) return refusalOf(error);
  const intakeCompletedAt = String(data ?? now.toISOString());

  // The invitation and the driver, never an answer: Part 1 holds a date of birth and an address.
  await writeAudit(admin, {
    orgId: invitation.org_id,
    actorId: null,
    action: "application_intake_completed",
    entity: "application_invitations",
    entityId: invitation.id,
    meta: { driverId: invitation.driver_id, documentsFiled: captures.length },
  });
  return { intakeCompletedAt };
}

/**
 * Which kind of invitation is this — v2 (it has a Part 1 row) or legacy?
 *
 * "Has an `application_intakes` row" is the whole of the legacy test, and since C3a it stays the whole
 * of it: plan §7's second half ("created before C3's merge") is made true by construction, because
 * every invitation created since is minted its row (`mintIntakeRow`). A row therefore no longer means
 * the applicant has BEGUN Part 1 — `prior_positive_2y` answered is that fact (AI009 refuses every
 * other first write), which is what `partOneStatus` and the office's list read.
 */
export async function intakeState(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<{ v2: boolean }> {
  const { data } = await admin
    .from("application_intakes")
    .select("id")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  return { v2: Boolean(data) };
}

/**
 * Part 1's facts as the filed application reads them (D-AW3, C2c) — null for a legacy invitation, which
 * files what it certified exactly as before. The same "has a row" test as `intakeState`, in one read.
 *
 * C3c2c2: also what a v2 applicant's page is shown behind the unlock and the office's drawer reads
 * (`partOneFactsView`) — one read of Part 1 for all three, so none of them composes a different
 * document. The CDL class is `record_applicant_intake`'s write to `drivers.cdl_class` (0376), read here.
 */
export async function partOneForFiling(
  admin: SupabaseClient,
  orgId: string,
  invitation: { id: string; driver_id: string },
): Promise<{ intake: PartOneFacts; licences: PartOneLicence[] } | null> {
  const invitationId = invitation.id;
  const { data: row } = await admin
    .from("application_intakes")
    .select("phone, address_line1, address_line2, city, state, postal_code, prior_positive_2y")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .maybeSingle();
  if (!row) return null;
  const { data: driver } = await admin
    .from("drivers")
    .select("cdl_class")
    .eq("org_id", orgId)
    .eq("id", invitation.driver_id)
    .maybeSingle();
  const data = { ...(row as Omit<PartOneFacts, "cdl_class">), cdl_class: (driver as { cdl_class?: string | null } | null)?.cdl_class ?? null };
  const { data: licences } = await admin
    .from("application_intake_licences")
    .select("position, state_code, agency, licence_number, expires_on")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .order("position", { ascending: true });
  return { intake: data, licences: (licences ?? []) as PartOneLicence[] };
}

/** `partOneForFiling` with the carrier's day it is judged on, as the page and the drawer are served it. */
export async function partOneFactsView(
  admin: SupabaseClient,
  orgId: string,
  invitation: { id: string; driver_id: string },
  now: Date,
): Promise<PartOneFactsView | null> {
  const facts = await partOneForFiling(admin, orgId, invitation);
  if (!facts) return null;
  return { ...facts, asOf: todayInZone(now, await carrierZone(admin, orgId)) };
}

/**
 * Give a new invitation its Part 1 row (C3a) — empty, so it says "this link is v2" and nothing else.
 *
 * ⚠ A direct INSERT and not `record_applicant_intake`, which cannot write an empty row: AI009 refuses
 * any write that leaves §40.25(j) unanswered, and at creation nobody has answered anything. The row
 * holds no fact, so the "one writer of Part 1's facts" rule (D-AW3) is untouched — every answer still
 * arrives through the function. `on conflict do nothing` (never an upsert, `lint:upserts`): the row is
 * one per invitation, and a retried create must not fail on its own first attempt.
 */
export async function mintIntakeRow(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<boolean> {
  const { error } = await admin
    .from("application_intakes")
    .insert({ org_id: orgId, invitation_id: invitationId });
  // 23505: the row is already there, which is the state this exists to reach.
  return !error || error.code === "23505";
}

/**
 * Where Part 1 stands, for the page that walks it — booleans and the stamp, never a value (D-APP16:
 * the bare link does not read back a date of birth, and an address is no different). Null for a legacy
 * invitation, which has no Part 1.
 *
 * `rights` is true only for the text served now — a summary read under an older version is read again.
 */
export async function partOneStatus(
  admin: SupabaseClient,
  orgId: string,
  invitation: { id: string; intake_completed_at?: string | null },
): Promise<PartOneStatus | null> {
  const { data } = await admin
    .from("application_intakes")
    .select("phone, postal_code, prior_positive_2y, medical_card_pending, fcra_summary_version")
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    phone: string | null;
    postal_code: string | null;
    prior_positive_2y: boolean | null;
    medical_card_pending: boolean | null;
    fcra_summary_version: string | null;
  };
  const { count } = await admin
    .from("application_intake_licences")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("invitation_id", invitation.id);
  return {
    completedAt: invitation.intake_completed_at ?? null,
    contact: row.phone !== null,
    address: row.postal_code !== null,
    licences: (count ?? 0) > 0,
    screening: row.prior_positive_2y !== null,
    medicalCardPending: row.medical_card_pending === true,
    rights: row.fcra_summary_version === FCRA_SUMMARY_VERSION,
  };
}
