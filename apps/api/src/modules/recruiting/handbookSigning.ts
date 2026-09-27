import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HANDBOOK_CARRIER_PLACEMENT_ID,
  HANDBOOK_PLACEMENTS,
  INVITE_TTL_DAYS_DEFAULT,
  handbookPlacementById,
  handbookStatus,
  type OfficeHandbookStatus,
} from "@silvicom/shared";
import { fileGeneratedDocument, insertQualificationRecord } from "../evidence/index.js";
import { displayNameFor } from "../../lib/memberLabels.js";
import { carrierOf, signatureMarkBytes } from "./applicationPdf/sources.js";
import { handbookPdf, type HandbookMarkPrint } from "./applicationPdf/handbook/handbookPdf.js";
import { HANDBOOK_VERSION } from "./applicationPdf/handbook/handbookText.js";
import { representativeForPrint } from "./representatives.js";

/**
 * The driver handbook, signed on screen — the office's half (HANDBOOK-SIGNING-PLAN.md HB3; D-HB1..5).
 *
 * ── THE ORDER, AND WHO HOLDS IT ───────────────────────────────────────────────────────────────
 * The application is filed → the office OPENS handbook signing at the desk → the driver signs its five
 * places on their link (`handbookCeremony.ts`) → the office COUNTERSIGNS for the carrier with a
 * Representative → the signed PDF is filed with one `qualification_records` row of kind `handbook`,
 * and the invitation is stamped filed. 0374's guard holds the same order in the database (HB022..HB024),
 * so these checks are the cheap early refusals and never the only ones.
 *
 * ⚠ The service role bypasses RLS: every read below filters on `org_id` itself.
 */

export interface HandbookError {
  code:
    | "not_found"
    | "application_not_filed"
    | "not_opened"
    | "already_filed"
    | "driver_not_finished"
    | "representative_not_found"
    | "link_expired"
    | "handbook_changed"
    | "filing_in_progress"
    | "storage_failed"
    | "insert_failed";
  message: string;
}

export const HANDBOOK_LINK_EXPIRED: HandbookError = {
  code: "link_expired",
  message:
    "The driver's application link has expired, so the handbook cannot be signed on it. "
    + "Press \"Extend the driver's link\" in the handbook step, then countersign.",
};

export const isHandbookError = (v: unknown): v is HandbookError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

interface HandbookInvitation {
  id: string;
  submitted_at: string | null;
  handbook_signing_opened_at: string | null;
  handbook_filed_at: string | null;
  expires_at: string;
}

const INVITATION_COLS = "id, submitted_at, handbook_signing_opened_at, handbook_filed_at, expires_at";

/** The driver's newest live invitation — the one the checklist reads (`applicantChecklist.ts`). */
async function currentInvitation(admin: SupabaseClient, orgId: string, driverId: string): Promise<HandbookInvitation | null> {
  const { data } = await admin
    .from("application_invitations")
    .select(INVITATION_COLS)
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? []) as HandbookInvitation[])[0] ?? null;
}

/** Every place signed on this invitation. Exported for the checklist's `handbook` input. */
export async function handbookPlacesSigned(admin: SupabaseClient, orgId: string, invitationId: string | null): Promise<string[]> {
  if (!invitationId) return [];
  const { data } = await admin
    .from("handbook_marks")
    .select("placement_id")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  return ((data ?? []) as Array<{ placement_id: string }>).map((r) => r.placement_id);
}

export async function driverHandbookStatus(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<OfficeHandbookStatus | HandbookError> {
  const inv = await currentInvitation(admin, orgId, driverId);
  if (!inv) return { code: "not_found", message: "This applicant has no application on file." };
  return {
    ...handbookStatus({
      submittedAt: inv.submitted_at,
      openedAt: inv.handbook_signing_opened_at,
      filedAt: inv.handbook_filed_at,
      signedPlacementIds: await handbookPlacesSigned(admin, orgId, inv.id),
    }),
    linkExpiresAt: inv.expires_at,
  };
}

/**
 * The link's new expiry for a handbook press: `max(expires_at, now + INVITE_TTL_DAYS_DEFAULT)` —
 * 0232's rule, the same one 0365/0369 apply in SQL: an extension never SHORTENS a link. Null when the
 * link already outlives the window, so nothing is written or audited.
 */
export function handbookLinkExpiry(expiresAt: string, now: Date): string | null {
  const floor = new Date(now.getTime() + INVITE_TTL_DAYS_DEFAULT * 86_400_000);
  return Date.parse(expiresAt) >= floor.getTime() ? null : floor.toISOString();
}

/**
 * The office opens handbook signing, at the desk — and every press, the first or a later one, keeps
 * the driver's link alive for another `INVITE_TTL_DAYS_DEFAULT` days (APPLICATION-FLOW-V2-PLAN.md A-2).
 *
 * ⚠ WHY THE EXTENSION SITS ABOVE THE "ALREADY OPENED" RETURN. 0374's guard refuses every handbook
 * mark once `expires_at <= now()` (HB021) — the driver's five places AND the office's countersignature
 * — and all three existing extenders (0232, 0365, 0369) skip a filed invitation, which a handbook's
 * invitation always is. So nothing else revives the link. Until 2026-09-26 this function returned early
 * for an opened handbook BEFORE any write, and `d61557dc` (filed 09-14, opened 2026-09-25 20:08) would
 * have lapsed at 2026-09-28 18:00 UTC with no button in the product that could save it. The drawer
 * now shows the link's expiry once signing is open, with "Extend the driver's link" — this same route.
 *
 * Opening itself stays idempotent: a second press never re-stamps who opened it.
 */
export async function openHandbookSigning(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  now: Date = new Date(),
): Promise<{ invitationId: string; openedAt: string; expiresAt: string; extended: boolean } | HandbookError> {
  const inv = await currentInvitation(admin, orgId, driverId);
  if (!inv) return { code: "not_found", message: "This applicant has no application on file." };
  if (!inv.submitted_at) {
    return { code: "application_not_filed", message: "The application is signed and filed first; the handbook comes after it." };
  }
  if (inv.handbook_filed_at) return { code: "already_filed", message: "The handbook is already signed and filed." };

  const newExpiry = handbookLinkExpiry(inv.expires_at, now);
  if (newExpiry) {
    const { error } = await admin
      .from("application_invitations")
      .update({ expires_at: newExpiry })
      .eq("org_id", orgId)
      .eq("id", inv.id)
      .is("handbook_filed_at", null);
    if (error) return { code: "insert_failed", message: "Could not extend the driver's link." };
  }
  const expiresAt = newExpiry ?? inv.expires_at;
  const extended = newExpiry !== null;

  if (inv.handbook_signing_opened_at) return { invitationId: inv.id, openedAt: inv.handbook_signing_opened_at, expiresAt, extended };
  const openedAt = now.toISOString();
  const { error } = await admin
    .from("application_invitations")
    .update({ handbook_signing_opened_at: openedAt, handbook_signing_opened_by: userId })
    .eq("org_id", orgId)
    .eq("id", inv.id)
    .is("handbook_signing_opened_at", null);
  if (error) return { code: "insert_failed", message: "Could not open handbook signing." };
  return { invitationId: inv.id, openedAt, expiresAt, extended };
}

/** The marks as the renderer takes them, by place. */
export async function handbookMarksForPrint(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<{ marks: Map<string, HandbookMarkPrint>; representativeId: string | null }> {
  const { data } = await admin
    .from("handbook_marks")
    .select("placement_id, signed_name, signed_at, representative_id")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  const rows = (data ?? []) as Array<{ placement_id: string; signed_name: string; signed_at: string; representative_id: string | null }>;
  // A place the placement list no longer names is skipped rather than drawn anywhere (the packet's rule).
  const known = rows.filter((r) => handbookPlacementById(r.placement_id));
  return {
    marks: new Map(known.map((r) => [r.placement_id, { signedName: r.signed_name, signedAt: r.signed_at }])),
    representativeId: known.find((r) => r.placement_id === HANDBOOK_CARRIER_PLACEMENT_ID)?.representative_id ?? null,
  };
}

/** The applicant's name and the SSN's last four, as the handbook prints them. */
export async function handbookPrintFacts(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  invitationId: string,
): Promise<{ driverName: string; ssnLast4: string | null }> {
  const [{ data: driver }, { data: application }] = await Promise.all([
    admin.from("drivers").select("full_name").eq("org_id", orgId).eq("id", driverId).maybeSingle(),
    admin.from("driver_applications").select("ssn_last4").eq("org_id", orgId).eq("invitation_id", invitationId).maybeSingle(),
  ]);
  return {
    driverName: (driver as { full_name?: string } | null)?.full_name ?? "",
    ssnLast4: (application as { ssn_last4?: string | null } | null)?.ssn_last4 ?? null,
  };
}

export const HANDBOOK_SIGNED_UNDER_OTHER_TEXT: HandbookError = {
  code: "handbook_changed",
  message:
    "The driver signed an earlier version of the handbook, and this one's text is different, so it cannot be "
    + "filed under their signature. Nothing was filed.",
};

/** Every driver mark on this invitation carries the text version that would be printed now (A-6). */
async function driverMarksMatchCurrentText(admin: SupabaseClient, orgId: string, invitationId: string): Promise<boolean> {
  const { data } = await admin
    .from("handbook_marks")
    .select("handbook_version")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .eq("party", "driver");
  return ((data ?? []) as Array<{ handbook_version: string }>).every((m) => m.handbook_version === HANDBOOK_VERSION);
}

/** The carrier mark, made now or found from an earlier attempt that did not finish filing. */
async function carrierMark(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  invitationId: string,
  rep: { id: string; fullName: string },
): Promise<{ representativeId: string } | HandbookError> {
  const placement = handbookPlacementById(HANDBOOK_CARRIER_PLACEMENT_ID)!;
  const { error } = await admin.from("handbook_marks").insert({
    org_id: orgId,
    invitation_id: invitationId,
    placement_id: placement.id,
    party: "carrier",
    handbook_version: HANDBOOK_VERSION,
    signed_name: rep.fullName,
    affirmed: placement.what,
    representative_id: rep.id,
    recorded_by: userId,
  });
  if (!error) return { representativeId: rep.id };
  // ⚠ A countersignature that landed on an earlier press whose FILING then failed. The place is
  // unique, so the retry keeps the Representative it already recorded rather than a second one.
  if (error.code === "23505") {
    const { representativeId } = await handbookMarksForPrint(admin, orgId, invitationId);
    if (representativeId) return { representativeId };
  }
  // 0374's HB021: the driver's link lapsed (or was revoked) between the driver's last place and this
  // press. It was a 500 `insert_failed` until A-2; it is the office's own button that cures it.
  if (error.code === "HB021") return HANDBOOK_LINK_EXPIRED;
  return { code: "insert_failed", message: "Could not record the carrier's signature." };
}

/**
 * The office countersigns for the carrier, and the signed handbook is filed.
 *
 * ⚠ Refused until every DRIVER place is signed: a countersignature under an unsigned agreement is the
 * carrier agreeing with itself.
 */
export async function countersignHandbook(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  role: string | null,
  driverId: string,
  representativeId: string,
): Promise<{ documentId: string; recordId: string } | HandbookError> {
  const inv = await currentInvitation(admin, orgId, driverId);
  if (!inv) return { code: "not_found", message: "This applicant has no application on file." };
  if (inv.handbook_filed_at) return { code: "already_filed", message: "The handbook is already signed and filed." };
  if (!inv.handbook_signing_opened_at) return { code: "not_opened", message: "Open handbook signing first." };
  const signed = await handbookPlacesSigned(admin, orgId, inv.id);
  if (!handbookStatus({ submittedAt: inv.submitted_at, openedAt: inv.handbook_signing_opened_at, filedAt: null, signedPlacementIds: signed }).driverComplete) {
    return { code: "driver_not_finished", message: "The driver has not signed every place yet." };
  }
  // A-6: file only a handbook every place of which was signed under the text that will be printed.
  // `HANDBOOK_VERSION` is a content hash of that text, so a change in between would file words the
  // driver never agreed to above their signature — the thing A-5 found in the packet.
  if (!(await driverMarksMatchCurrentText(admin, orgId, inv.id))) return HANDBOOK_SIGNED_UNDER_OTHER_TEXT;

  const chosen = await representativeForPrint(admin, orgId, representativeId);
  if (!chosen) return { code: "representative_not_found", message: "That representative is not on file." };

  // A-10: the claim comes before anything is filed, and a filing that fails hands it back.
  const claimedAt = await claimHandbookFiling(admin, orgId, inv.id, new Date());
  if (!claimedAt) return HANDBOOK_FILING_IN_PROGRESS;
  const result = await fileCountersignedHandbook(admin, orgId, userId, role, driverId, inv.id, chosen);
  if (isHandbookError(result)) await releaseHandbookClaim(admin, orgId, inv.id, claimedAt);
  return result;
}

/**
 * A-10: a second press of Countersign — or the same press retried by a flaky connection — while the
 * first is still filing. Both used to file a PDF and a record before either stamped `handbook_filed_at`,
 * and both are append-only evidence. 0376's `handbook_filing_claimed_at` is taken by a conditional
 * UPDATE that only one request can win; the partial unique index on `qualification_records` is the
 * database's own backstop behind it.
 */
export const HANDBOOK_FILING_IN_PROGRESS: HandbookError = {
  code: "filing_in_progress",
  message: "The handbook is being filed from another press. Wait a moment, then refresh.",
};

/**
 * How long a claim holds with nothing filed. ⚠ Without it a process that died between the claim and
 * the release — a deploy, a crash — would leave the handbook unfileable for good; with it the next
 * press after ten minutes takes the claim over. Ten minutes is far past one filing (a PDF render and
 * two writes) and short enough that an office retrying after lunch is not told to wait.
 */
const HANDBOOK_CLAIM_STALE_MS = 10 * 60_000;

async function claimHandbookFiling(admin: SupabaseClient, orgId: string, invitationId: string, now: Date): Promise<string | null> {
  const claimedAt = now.toISOString();
  const stale = new Date(now.getTime() - HANDBOOK_CLAIM_STALE_MS).toISOString();
  const { data, error } = await admin
    .from("application_invitations")
    .update({ handbook_filing_claimed_at: claimedAt })
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .is("handbook_filed_at", null)
    .or(`handbook_filing_claimed_at.is.null,handbook_filing_claimed_at.lt.${stale}`)
    .select("id");
  return !error && ((data ?? []) as unknown[]).length === 1 ? claimedAt : null;
}

/** Only OUR claim is handed back: a stale-claim takeover in between is somebody else's now. */
async function releaseHandbookClaim(admin: SupabaseClient, orgId: string, invitationId: string, claimedAt: string): Promise<void> {
  await admin
    .from("application_invitations")
    .update({ handbook_filing_claimed_at: null })
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .eq("handbook_filing_claimed_at", claimedAt);
}

/** Everything the countersign files, under the claim `countersignHandbook` holds. */
async function fileCountersignedHandbook(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  role: string | null,
  driverId: string,
  invitationId: string,
  chosen: { id: string; fullName: string; title: string; signature: Buffer | null },
): Promise<{ documentId: string; recordId: string } | HandbookError> {
  const made = await carrierMark(admin, orgId, userId, invitationId, chosen);
  if (isHandbookError(made)) return made;
  const rep = made.representativeId === chosen.id ? chosen : await representativeForPrint(admin, orgId, made.representativeId);
  if (!rep) return { code: "representative_not_found", message: "That representative is not on file." };

  const [{ marks }, facts, carrier, driverSignature, appliedBy] = await Promise.all([
    handbookMarksForPrint(admin, orgId, invitationId),
    handbookPrintFacts(admin, orgId, driverId, invitationId),
    carrierOf(admin, orgId),
    signatureMarkBytes(admin, orgId, invitationId, "signature"),
    displayNameFor(admin, userId, orgId, role),
  ]);
  const pdf = await handbookPdf({
    carrier: { name: carrier.name },
    ...facts,
    marks,
    driverSignature,
    countersign: { fullName: rep.fullName, title: rep.title, signature: rep.signature, appliedBy: appliedBy ?? "an office user" },
  });

  const filed = await fileGeneratedDocument(admin, orgId, {
    id: randomUUID(), subjectType: "driver", subjectId: driverId, kind: "handbook", uploadedBy: userId,
  }, pdf);
  if ("error" in filed) return { code: "storage_failed", message: "Could not file the signed handbook." };

  const recordId = randomUUID();
  const inserted = await insertQualificationRecord(admin, orgId, userId, {
    id: recordId,
    driverId,
    kind: "handbook",
    occurredOn: new Date().toISOString().slice(0, 10),
    coversUntil: null,
    result: "Signed",
    performedBy: `${rep.fullName}, ${rep.title}`,
    reference: HANDBOOK_VERSION,
    documentId: filed.documentId,
    detail: {
      source: "handbook_signing",
      hiring_step: "handbook",
      invitation_id: invitationId,
      representative_id: rep.id,
      recorded_by: userId,
      handbook_version: HANDBOOK_VERSION,
      places: HANDBOOK_PLACEMENTS.map((p) => p.id),
    },
  });
  if ("error" in inserted) {
    // The index behind the claim: a record for this invitation is already on file.
    if (inserted.code === "duplicate") return { code: "already_filed", message: "The handbook is already signed and filed." };
    return { code: "insert_failed", message: "Could not record the signed handbook." };
  }

  await admin
    .from("application_invitations")
    .update({ handbook_filed_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .is("handbook_filed_at", null);
  return { documentId: filed.documentId, recordId };
}
