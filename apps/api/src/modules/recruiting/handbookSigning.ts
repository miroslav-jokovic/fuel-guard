import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HANDBOOK_CARRIER_PLACEMENT_ID,
  HANDBOOK_PLACEMENTS,
  handbookPlacementById,
  handbookStatus,
  type HandbookStatus,
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
    | "storage_failed"
    | "insert_failed";
  message: string;
}

export const isHandbookError = (v: unknown): v is HandbookError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

interface HandbookInvitation {
  id: string;
  submitted_at: string | null;
  handbook_signing_opened_at: string | null;
  handbook_filed_at: string | null;
}

const INVITATION_COLS = "id, submitted_at, handbook_signing_opened_at, handbook_filed_at";

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
): Promise<HandbookStatus | HandbookError> {
  const inv = await currentInvitation(admin, orgId, driverId);
  if (!inv) return { code: "not_found", message: "This applicant has no application on file." };
  return handbookStatus({
    submittedAt: inv.submitted_at,
    openedAt: inv.handbook_signing_opened_at,
    filedAt: inv.handbook_filed_at,
    signedPlacementIds: await handbookPlacesSigned(admin, orgId, inv.id),
  });
}

/** The office opens handbook signing, at the desk. Idempotent: a second press changes nothing. */
export async function openHandbookSigning(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
): Promise<{ invitationId: string; openedAt: string } | HandbookError> {
  const inv = await currentInvitation(admin, orgId, driverId);
  if (!inv) return { code: "not_found", message: "This applicant has no application on file." };
  if (!inv.submitted_at) {
    return { code: "application_not_filed", message: "The application is signed and filed first; the handbook comes after it." };
  }
  if (inv.handbook_filed_at) return { code: "already_filed", message: "The handbook is already signed and filed." };
  if (inv.handbook_signing_opened_at) return { invitationId: inv.id, openedAt: inv.handbook_signing_opened_at };
  const openedAt = new Date().toISOString();
  const { error } = await admin
    .from("application_invitations")
    .update({ handbook_signing_opened_at: openedAt, handbook_signing_opened_by: userId })
    .eq("org_id", orgId)
    .eq("id", inv.id)
    .is("handbook_signing_opened_at", null);
  if (error) return { code: "insert_failed", message: "Could not open handbook signing." };
  return { invitationId: inv.id, openedAt };
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

  const chosen = await representativeForPrint(admin, orgId, representativeId);
  if (!chosen) return { code: "representative_not_found", message: "That representative is not on file." };
  const made = await carrierMark(admin, orgId, userId, inv.id, chosen);
  if (isHandbookError(made)) return made;
  const rep = made.representativeId === chosen.id ? chosen : await representativeForPrint(admin, orgId, made.representativeId);
  if (!rep) return { code: "representative_not_found", message: "That representative is not on file." };

  const [{ marks }, facts, carrier, driverSignature, appliedBy] = await Promise.all([
    handbookMarksForPrint(admin, orgId, inv.id),
    handbookPrintFacts(admin, orgId, driverId, inv.id),
    carrierOf(admin, orgId),
    signatureMarkBytes(admin, orgId, inv.id, "signature"),
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
      invitation_id: inv.id,
      representative_id: rep.id,
      recorded_by: userId,
      handbook_version: HANDBOOK_VERSION,
      places: HANDBOOK_PLACEMENTS.map((p) => p.id),
    },
  });
  if ("error" in inserted) return { code: "insert_failed", message: "Could not record the signed handbook." };

  await admin
    .from("application_invitations")
    .update({ handbook_filed_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", inv.id)
    .is("handbook_filed_at", null);
  return { documentId: filed.documentId, recordId };
}
