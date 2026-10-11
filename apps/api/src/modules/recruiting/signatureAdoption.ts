import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import {
  DOCUMENTS_BUCKET,
  SIGNATURE_ADOPTION_MAX_BYTES,
  documentStoragePath,
  type PacketMarkKind,
  type SignatureAdoptionRequest,
  type SignatureAdoptionsView,
} from "@silvicom/shared";
import { loadCarrierWording } from "./carrierWording.js";
import {
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
  type SubmitContext,
} from "./applicationIntake.js";
import { INTAKE_INCOMPLETE, intakeState } from "./applicantIntake.js";
import { ADOPTION_IN_USE, adoptionSplitsADocument } from "./documentAdoption.js";

/**
 * Adopt once (APPLICATION-FLOW-V2-PLAN.md D-AW15, C3s1): the driver's signature and initials, each an
 * append-only `signature_adoptions` row whose PNG sits in the evidence bucket.
 *
 * ── WHAT THIS REPLACES, AND WHAT IT DOES NOT YET ──────────────────────────────────────────────
 * Until C3s1 the permissions adopted a signature by STAGING a picture into the `signature_mark`
 * capture slot — a staging bucket that A11 prunes at 90 days, which is how `d61557dc`'s handbook came
 * to have no signature to borrow (A-1). An adoption is kept for as long as the marks made with it: the
 * table is in `RETENTION_FORBIDDEN`, and the row IS the registration of its bytes (no `documents` row —
 * an adopted mark is not a qualification-file document). The permissions now sign with it
 * (`applicationReleases.ts`). The packet and the handbook still make marks of their own until C3s2,
 * which is also where the office supersedes an adoption; `signatureMarkBytes` draws whichever picture
 * was made last before the document's instant, so each document prints the mark it was signed with.
 *
 * ── ⚠ THE BYTES BEFORE THE ROW, AND WHAT KEEPS THEM ───────────────────────────────────────────
 * 0230's order: a row means the object is there. So the PNG is written first, and the row second; a
 * row that fails leaves an object nothing names, which this function removes and the nightly
 * reconcile catches if the removal fails too. ⚠ **The reconcile is also what would DELETE every
 * adoption** had it not been taught this table in the same change: `compliance-docs` is swept for
 * objects no `documents` row names, and an adoption has none (`storageReconcile.ts`).
 *
 * ── A NEW SIGNATURE SUPERSEDES THE OLD, BETWEEN DOCUMENTS ────────────────────────────────────
 * A driver may make a new signature at any point that does not split a document — the packet's "This
 * is your signature — use it, or make another" is the ordinary case. 0376 supersedes the old row, which
 * goes on saying what the marks made with it looked like; each document prints the adoption its own
 * marks name. Refused (`adoption_in_use`) only while a document is part-signed with the live one —
 * `documentAdoption.ts` says why.
 */

const NOT_A_PNG: IntakeError = {
  code: "adoption_not_png",
  message: "That picture could not be read. Make your signature again.",
};

interface AdoptionRow {
  id: string;
  kind: PacketMarkKind;
  typed_text: string;
}

/** The live adoption of each kind on one link. ⚠ The service role bypasses RLS: org-filtered here. */
async function liveAdoptions(admin: SupabaseClient, orgId: string, invitationId: string): Promise<AdoptionRow[]> {
  const { data } = await admin
    .from("signature_adoptions")
    .select("id, kind, typed_text")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId)
    .is("superseded_by", null);
  return (data ?? []) as AdoptionRow[];
}

/** The live adoption of one kind, or null — what a mark made now is made with. */
async function liveAdoption(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
  kind: PacketMarkKind,
): Promise<{ id: string; typedText: string } | null> {
  const row = (await liveAdoptions(admin, orgId, invitationId)).find((r) => r.kind === kind);
  return row ? { id: row.id, typedText: row.typed_text } : null;
}

/** What the page is shown: the typed text of each live adoption (`SignatureAdoptionsView`). */
export async function adoptionsForLink(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<SignatureAdoptionsView> {
  const rows = await liveAdoptions(admin, orgId, invitationId);
  const text = (kind: PacketMarkKind) => rows.find((r) => r.kind === kind)?.typed_text ?? null;
  return { signature: text("signature"), initials: text("initials") };
}

/** A PNG by its signature AND by decoding: a content type is a claim, and a mark that will not draw is none. */
async function readPng(base64: string): Promise<Buffer | null> {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > SIGNATURE_ADOPTION_MAX_BYTES) return null;
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  const meta = await sharp(bytes).metadata().catch(() => null);
  return meta?.format === "png" && (meta.width ?? 0) > 0 && (meta.height ?? 0) > 0 ? bytes : null;
}

export async function recordSignatureAdoption(
  admin: SupabaseClient,
  token: string,
  body: SignatureAdoptionRequest,
  ctx: SubmitContext,
  now: Date,
): Promise<{ adopted: PacketMarkKind; superseded: boolean } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  // An adoption is a signature, so it needs the §390.32(d) consent every signature on the link needs.
  const consent = requireEsignConsent(invitation, await loadCarrierWording(admin, invitation.org_id));
  if (consent) return consent;
  // Screen 13 comes after Part 1 on a v2 link (§6.2), for the permissions' own reason: the mark adopted
  // here is what they are signed with. A legacy link has no Part 1 and adopts as it always has.
  if (!invitation.intake_completed_at && (await intakeState(admin, invitation.org_id, invitation.id)).v2) {
    return INTAKE_INCOMPLETE;
  }

  const live = await liveAdoption(admin, invitation.org_id, invitation.id, body.kind);
  if (live && (await adoptionSplitsADocument(admin, invitation, live.id, body.kind))) return ADOPTION_IN_USE;

  const bytes = await readPng(body.png_base64);
  if (!bytes) return NOT_A_PNG;

  const id = randomUUID();
  const path = documentStoragePath(invitation.org_id, "driver", invitation.driver_id, id, "image/png");
  const bucket = admin.storage.from(DOCUMENTS_BUCKET);
  const { error: uploadError } = await bucket.upload(path, bytes, { contentType: "image/png", upsert: false });
  if (uploadError) return { code: "adoption_upload_failed", message: "That did not save. Try again." };

  const { data, error } = await admin.rpc("record_signature_adoption", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_adoption: id,
    p_kind: body.kind,
    p_typed_text: body.typed_text,
    p_storage_path: path,
    p_sha256: createHash("sha256").update(bytes).digest("hex"),
    p_ip: ctx.ip,
    p_user_agent: ctx.userAgent,
  });
  if (error) {
    // No row names these bytes. Removed now; the reconcile takes them if this fails as well.
    await bucket.remove([path]).catch(() => undefined);
    if (error.code === "SA020" || error.code === "SA021") {
      return { code: "invalid_link", message: "This application link is not valid. Ask for a new one." };
    }
    return { code: "adoption_failed", message: error.message };
  }
  const row = data as { superseded_id?: string | null } | null;
  return { adopted: body.kind, superseded: Boolean(row?.superseded_id) };
}
