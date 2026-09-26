import type { SupabaseClient } from "@supabase/supabase-js";
import { APPLICATION_CAPTURE_MARK_SLOT, type HandbookSelfAdoptionView } from "@silvicom/shared";

/**
 * ⚠ WORKAROUND — a handbook that adopts its own signature (APPLICATION-FLOW-V2-PLAN.md A-1, batch C0b).
 *
 * ── WHAT IT WORKS AROUND ──────────────────────────────────────────────────────────────────────
 * The handbook signs each place with the name the driver adopted for the PACKET, and prints the picture
 * staged for it (`handbookCeremony.ts`, D-HB1). An application filed before the packet was signed on
 * screen has neither: `d61557dc` was filed 2026-09-14 with 0 packet marks and 0 `signature_mark`
 * captures. Its handbook refused every place (`handbook_no_adopted_signature`), a filed packet cannot be
 * re-signed (DR033), and the handbook is a hire gate — so that driver could never be hired.
 *
 * The capability that is missing is `signature_adoptions` (D-AW15): one adoption per invitation, frozen
 * in the evidence bucket, applied by every later place. Until it exists, this module lets the handbook
 * screen take the signature itself, in exactly one state, and stores it in the two places that already
 * exist: the picture in the `signature_mark` capture slot (the slot every renderer reads), the typed
 * name on the first `handbook_marks.signed_name` (read back from there for every later place).
 *
 * ── WHAT REMOVES IT ───────────────────────────────────────────────────────────────────────────
 * C3s: the adoption screen, one-click apply, and the legacy back-fill of one `signature_adoptions` row
 * per invitation from its staged capture. Then this file, its two callers' branches
 * (`applicationCapture.ts`'s `openSession`, `handbookCeremony.ts`'s `recordHandbookMark`) and
 * `HandbookMark.signed_name` go.
 *
 * ⚠ The 90-day prune of the staged capture (`dataRetentionPolicy.ts`) is harmless here: the office
 * countersigns on the same visit, and the filed handbook carries the picture from then on.
 */

interface SelfAdoptionInvitation {
  id: string;
  org_id: string;
  submitted_at: string | null;
  handbook_signing_opened_at?: string | null;
  handbook_filed_at?: string | null;
}

export interface HandbookSelfAdoption extends HandbookSelfAdoptionView {
  /**
   * The capture path may stage a `signature_mark` on this FILED invitation: required, nothing pinned yet,
   * and any picture already there was staged after filing (by this screen) rather than by the
   * permissions ceremony before it — a permissions-era picture is kept, never replaced (G-13).
   */
  pictureOpen: boolean;
}

const NONE: HandbookSelfAdoption = { required: false, adoptedName: null, pictureStaged: false, pictureOpen: false };

export async function handbookSelfAdoption(
  admin: SupabaseClient,
  invitation: SelfAdoptionInvitation,
): Promise<HandbookSelfAdoption> {
  if (!invitation.submitted_at || !invitation.handbook_signing_opened_at || invitation.handbook_filed_at) return NONE;
  // ⚠ The service role bypasses RLS: each read carries its own org filter.
  const [packet, first, picture] = await Promise.all([
    admin.from("application_packet_marks").select("id").eq("org_id", invitation.org_id).eq("invitation_id", invitation.id).limit(1),
    admin
      .from("handbook_marks")
      .select("signed_name")
      .eq("org_id", invitation.org_id)
      .eq("invitation_id", invitation.id)
      .eq("party", "driver")
      .order("signed_at", { ascending: true })
      .limit(1),
    admin
      .from("application_captures")
      .select("captured_at")
      .eq("org_id", invitation.org_id)
      .eq("invitation_id", invitation.id)
      .eq("slot", APPLICATION_CAPTURE_MARK_SLOT.signature)
      .limit(1),
  ]);
  if (((packet.data ?? []) as unknown[]).length > 0) return NONE;

  const adoptedName = ((first.data ?? []) as Array<{ signed_name: string }>)[0]?.signed_name?.trim() || null;
  const capturedAt = ((picture.data ?? []) as Array<{ captured_at: string }>)[0]?.captured_at ?? null;
  const pictureStaged = capturedAt !== null;
  const stagedHere = pictureStaged && Date.parse(capturedAt!) > Date.parse(invitation.submitted_at);
  return {
    required: true,
    adoptedName,
    pictureStaged,
    pictureOpen: adoptedName === null && (!pictureStaged || stagedHere),
  };
}
