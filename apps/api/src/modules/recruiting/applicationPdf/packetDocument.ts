import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverApplication } from "@silvicom/shared";
import { packetFieldFill } from "./packet/packetFieldValues.js";
import { renderPacketOverlay } from "./packet/packetOverlay.js";

/**
 * The filed document, as the CARRIER's own packet (D-PKT1, D-PKT5).
 *
 * ── WHAT THIS REPLACES, AND WHAT IT DOES NOT ──────────────────────────────────────────────────
 * The owner's sentence, 2026-09-14: *"when driver fills out the application link and sends it back
 * we review it as this PDF form, and resend it to the driver for signing."* Until now `file.ts`
 * rendered `render.ts`'s §391.21-shaped summary — regulation-correct, and not the document he was
 * asking for. This assembles the carrier's own 31 pages with the applicant's answers and the
 * driver's twenty-two marks drawn on top.
 *
 * ⚠ **`render.ts` is NOT deleted and must not be** (D-PKT5). Two reasons, and the second is the one
 * that decides the switch below:
 *
 *   1. §390.32(d) asks that a filed electronic record stay reproducible, and every
 *      `qualification_records` row filed before today cites a document `render.ts` produced.
 *   2. ⚠ **An application with no packet marks cannot be drawn as the packet.** The overlay draws
 *      marks; given none it produces the carrier's 31 pages with every signature line blank, which
 *      is a WORSE document than the summary — it looks like a form nobody signed. Applications filed
 *      before the ceremony shipped have zero marks and `driver_applications` is append-only, so they
 *      can never gain any.
 *
 * So: **marks decide.** A submission the server accepted since D-PKT15 has all twenty-two of them,
 * because `submitApplication` refuses one that is not signed through. An older one has none and keeps
 * rendering the way it always did.
 */

export interface PacketMarkRow {
  placement_id: string;
  signed_name: string;
  signed_at: string;
}

/**
 * Every mark on this link, for the renderer.
 *
 * ⚠ Org-filtered, like every read in this module: the API uses the service role, which BYPASSES RLS
 * (`apps/api/CLAUDE.md`'s first rule), so the scope has to be in the query.
 */
export async function packetMarksFor(
  admin: SupabaseClient,
  orgId: string,
  invitationId: string,
): Promise<PacketMarkRow[]> {
  const { data } = await admin
    .from("application_packet_marks")
    .select("placement_id, signed_name, signed_at")
    .eq("org_id", orgId)
    .eq("invitation_id", invitationId);
  return (data ?? []) as PacketMarkRow[];
}

export interface PacketDocumentInput {
  marks: readonly PacketMarkRow[];
  application: DriverApplication;
  certifiedAt: string;
  signedName: string;
  /** The driver's drawn mark, when they gave one (D-PKT13). Decoration; the typed name is the record. */
  drawnMark?: Buffer | null;
}

/**
 * Draw the packet.
 *
 * ⚠ **The overflow is passed through, never dropped** (Q-PKT10). §391.21(b)(7) and (b)(8) ask for
 * every accident and every non-parking conviction in the preceding three years, and the carrier's
 * grids hold three of each — so a filed form that drew three and dropped the fourth would be signed,
 * filed and materially false. `renderPacketOverlay` appends the continuation sheet the carrier's own
 * page 11 asks for, and puts a notice under each grid that continues.
 */
export async function renderPacketDocument(input: PacketDocumentInput): Promise<Buffer> {
  const markedAt = Object.fromEntries(input.marks.map((m) => [m.placement_id, m.signed_at]));
  const { placed, overflow } = packetFieldFill({
    application: input.application,
    certifiedAt: input.certifiedAt,
    markedAt,
    signedName: input.signedName,
  });
  const a = input.application;
  return renderPacketOverlay({
    marks: input.marks.map((m) => ({ placementId: m.placement_id, signedName: m.signed_name })),
    fields: placed,
    overflow,
    // ⚠ The name off the PAYLOAD, not the adopted signature. The sheet's job is to be re-attachable
    // to the right packet, and `signed_name` is how somebody signs rather than what they are called.
    applicantName: [a.first_name, a.middle_name, a.last_name].filter(Boolean).join(" "),
    drawnMark: input.drawnMark ?? null,
  });
}
