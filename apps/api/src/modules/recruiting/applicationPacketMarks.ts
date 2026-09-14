import type { SupabaseClient } from "@supabase/supabase-js";
import {
  driverPlacements,
  packetDriverMarkCount,
  packetPlacementById,
  type ApplicationPacketMark,
  type PacketPlacement,
} from "@silvicom/shared";
import { loadCarrierWording } from "./carrierWording.js";
import {
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
  type SubmitContext,
} from "./applicationIntake.js";

/**
 * The driver's twenty-two marks on the carrier's own packet (P5, D-PKT6).
 *
 * ── WHAT THIS IS, AND WHAT `applicationReleases.ts` NEXT DOOR IS ──────────────────────────────
 * That module collects four INSTRUMENTS — each its own document, its own disclosure text, its own
 * §604(b)(2) obligation — before the form, because they are what let the office run the checks it is
 * reviewing with. This one collects PLACES on paper, after the office has approved, because the
 * owner's flow ends with the driver being walked to every line the carrier's lawyers drew:
 *
 *   *"the driver needs to be navigated precisely from place to place and sign all places."*
 *
 * The two never share a stop. Six of the twenty-two sit on pages whose instrument was already signed
 * on the phone — page 15's past-employment release, page 20's FCRA disclosure, page 22's urinalysis
 * notification — and the driver signs those pages anyway, because the carrier's paper has a line
 * there and a packet with a blank line on page 20 is not the carrier's packet.
 *
 * ── THE ORDER IS THE PAPER'S, NOT OURS ────────────────────────────────────────────────────────
 * `driverPlacements()` is already in the packet's own page order and the queue is served in it. A
 * driver reviewing a document they are signing follows the paper; reordering by convenience would
 * mean the PDF and the ceremony disagree about what came before what.
 *
 * ── AND THE ONE THING THE SERVER DECIDES RATHER THAN ACCEPTS ──────────────────────────────────
 * Everything except the name. `page`, `mark`, `anchor` and the sentence all come from
 * `PACKET_PLACEMENTS` here and are written into the row, so what a driver agreed to is a fact the
 * server can prove — 0092's rule for `hazmat_reviews.attestation`, 0215's for `disclosure_text`.
 * A request that named a stop and supplied its own wording would be a signature over text the
 * signer's own browser composed.
 */

export const PACKET_NOT_APPROVED: IntakeError = {
  code: "packet_not_yet_approved",
  message: "The carrier has not finished reviewing this application yet.",
};

export const PACKET_ALREADY_FILED: IntakeError = {
  code: "already_submitted",
  message: "This application has already been filed.",
};

export const PACKET_MARK_ALREADY_MADE: IntakeError = {
  code: "packet_mark_already_made",
  message: "You have already signed this one.",
};

/**
 * ⚠ The refusal that exists because the client could get it wrong in a way nothing else would catch.
 *
 * Six of the twenty-eight placements belong to the carrier or to a witness. A ceremony bug that
 * walked an applicant onto `p18c` or `p22w` would put their name where the company's
 * countersignature or an independent witness's belongs, on a page that is evidence — and the request
 * that did it would be indistinguishable from every other one.
 */
export const PACKET_MARK_NOT_THE_DRIVERS: IntakeError = {
  code: "packet_mark_not_the_drivers",
  message: "That is not one of the places you sign.",
};

export const PACKET_MARK_NAME_CHANGED: IntakeError = {
  code: "packet_mark_name_changed",
  message:
    "This packet is already being signed with a different name. Start again if you need to change it.",
};

/** One stop as the ceremony serves it: the inventory's entry plus whether it is already collected. */
export interface PacketStop extends PacketPlacement {
  signedAt: string | null;
}

/**
 * The queue, with this link's progress folded in.
 *
 * ⚠ Served whole rather than one stop at a time, and marked rather than filtered. A driver being
 * walked through twenty-two places is owed a sense of how far along they are — D-PKT6's "progress
 * visible" — and a list that silently shortened as they went would make the end unknowable. The
 * ceremony advances to the first unsigned stop; it does not need the signed ones hidden to do that.
 */
export async function packetStops(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<PacketStop[]> {
  const { data } = await admin
    .from("application_packet_marks")
    .select("placement_id, signed_at")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  const signed = new Map(
    ((data ?? []) as Array<{ placement_id: string; signed_at: string }>).map((r) => [
      r.placement_id,
      r.signed_at,
    ]),
  );
  return driverPlacements().map((p) => ({ ...p, signedAt: signed.get(p.id) ?? null }));
}

/**
 * Record one mark.
 *
 * NOT part of the submit transaction, for `applicationReleases.ts`'s reason: twenty-two acts on
 * twenty-two places are twenty-two acts, and a half-signed packet is a real state the ceremony knows
 * how to resume from rather than an inconsistency to be prevented. What IS one transaction is the
 * row and the count that reports it — `record_packet_mark` holds the invitation FOR UPDATE, so
 * "that was the last one" cannot be decided while another stop is landing.
 */
export async function recordPacketMark(
  admin: SupabaseClient,
  token: string,
  body: ApplicationPacketMark,
  ctx: SubmitContext,
  now: Date,
): Promise<{ id: string; signedCount: number; complete: boolean } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;

  // A signature given electronically by somebody who never agreed to sign electronically is the gap
  // §390.32(d) exists to close — and the carrier's PUBLISHED wording, never the code's placeholders,
  // which is the omission that recorded a release with no consent behind it on 2026-09-13.
  const wording = await loadCarrierWording(admin, invitation.org_id);
  const consent = requireEsignConsent(invitation, wording);
  if (consent) return consent;

  const placement = packetPlacementById(body.placement_id);
  if (!placement || placement.party !== "driver") return PACKET_MARK_NOT_THE_DRIVERS;

  // The cheap refusals, before the transaction. The RPC checks both again under its lock — these
  // keep a ceremony opened on a stale page from reaching the database at all.
  if (!invitation.approved_at) return PACKET_NOT_APPROVED;
  if (invitation.submitted_at) return PACKET_ALREADY_FILED;

  const { data, error } = await admin.rpc("record_packet_mark", {
    p_org: invitation.org_id,
    p_invitation: invitation.id,
    p_placement: placement.id,
    // Every one of these comes from the inventory rather than from the request.
    p_page: placement.page,
    p_mark: placement.mark,
    p_anchor: placement.anchor,
    p_affirmed: placement.what,
    p_signed_name: body.signed_name,
    p_ip: ctx.ip,
    p_user_agent: ctx.userAgent,
    // The count lives in TypeScript and the migration applies what it produced — 0228's division,
    // and the reason counsel ruling on page 19's duplicate moves one array rather than a constant
    // in a migration nobody remembers to open.
    p_expected_count: packetDriverMarkCount(),
  });
  if (error) {
    if (error.code === "DR034" || /packet_mark_already_made/.test(error.message)) {
      return PACKET_MARK_ALREADY_MADE;
    }
    if (error.code === "DR035" || /packet_mark_name_changed/.test(error.message)) {
      return PACKET_MARK_NAME_CHANGED;
    }
    if (error.code === "DR032" || /packet_not_yet_approved/.test(error.message)) {
      return PACKET_NOT_APPROVED;
    }
    if (error.code === "DR033" || /packet_already_filed/.test(error.message)) {
      return PACKET_ALREADY_FILED;
    }
    if (
      error.code === "DR030"
      || error.code === "DR031"
      || /invitation_unusable|invitation_not_found/.test(error.message)
    ) {
      return { code: "invalid_link", message: "This application link is not valid. Ask for a new one." };
    }
    return { code: "packet_mark_failed", message: error.message };
  }
  const row = data as { mark_id?: string; signed_count?: number; complete?: boolean } | null;
  return {
    id: String(row?.mark_id ?? ""),
    signedCount: Number(row?.signed_count ?? 0),
    complete: Boolean(row?.complete),
  };
}
