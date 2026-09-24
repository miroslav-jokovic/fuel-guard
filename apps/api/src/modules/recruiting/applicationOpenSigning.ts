import type { SupabaseClient } from "@supabase/supabase-js";
import { INVITE_TTL_DAYS_DEFAULT, OPEN_SIGNING_WARNS_ON, type HiringStepKey } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { applicantChecklist, isChecklistError } from "./applicantChecklist.js";
import { mintInvitationToken } from "./applicationIntake.js";

/**
 * The office opens packet signing, in person (AF5, D-AF3, D-AF6).
 *
 * ── WHAT IT DOES, IN ORDER ────────────────────────────────────────────────────────────────────
 * Mints a fresh token and hands its hash to `open_packet_signing` (0369), which sets it as the
 * invitation's sign link, stamps `signing_opened_at` the first time only, and extends the expiry
 * without ever shortening it — reviving a link that lapsed while the applicant waited on a lab result
 * and a bus ticket. Then the audit row. The link comes back to the office's screen and goes nowhere
 * else.
 *
 * ── ⚠ IT SENDS NOTHING, AND THAT IS THE DIFFERENCE FROM "SEND THE APPLICATION" ────────────────
 * D-AF7 has every office act hand its link back on screen AS WELL AS by email. This one is the
 * exception, on purpose: D-AF3 is that the packet is signed in the office, and the office pressing
 * this button at the desk IS the in-person act (D-AF6). A sign link emailed from here would let the
 * packet be signed from anywhere the moment it was opened, which is the thing D-AF3 took away. The
 * office opens the link on its own screen (or copies it to a tablet in the room) and hands it over.
 *
 * ── IT WARNS, IT NEVER REFUSES, ON WHAT IS OUTSTANDING (D-AF6) ────────────────────────────────
 * The only refusal is the database's: not approved (AI006), revoked (AI002), filed (AI003). Whether
 * the applicant is standing in the room is not something software can check, and the federal gates
 * refuse where they belong — at travel and at hire. So the answer names what is still outstanding —
 * every `beforeTravel` federal gate and the road test (`OPEN_SIGNING_WARNS_ON`) — read from the SAME
 * fold the checklist shows, so the warning and the row beside the button cannot disagree.
 *
 * ⚠ A second press rotates the sign link — the tab was closed, or the tablet was the wrong one — and
 * the stamp keeps its FIRST date. The previous sign link dies; the applicant's own link is untouched.
 */

export type OpenSigningError = { code: string; message: string };
export const isOpenSigningError = (v: object): v is OpenSigningError => "code" in v && "message" in v;

export interface SigningOpened {
  /** The only copy of the sign link. Not stored, not re-derivable, not returned again. */
  link: string;
  /** The steps D-AF6 warns about that are not done yet. Step KEYS — the screen reads the words. */
  warnings: HiringStepKey[];
  signingOpenedAt: string;
}

const NOT_FOUND: OpenSigningError = {
  code: "application_not_found",
  message: "That application is not in this organization.",
};

export async function openPacketSigning(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  actorId: string,
): Promise<SigningOpened | OpenSigningError> {
  const { data: inv } = await admin
    .from("application_invitations")
    .select("id, driver_id")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const invitation = inv as { id: string; driver_id: string } | null;
  if (!invitation) return NOT_FOUND;

  // Read BEFORE the write, so the warning describes what the office knew when it pressed the button.
  const checklist = await applicantChecklist(admin, orgId, invitation.driver_id);
  const warnings = isChecklistError(checklist)
    ? [...OPEN_SIGNING_WARNS_ON]
    : checklist.steps
        .filter((s) => OPEN_SIGNING_WARNS_ON.includes(s.key) && s.state !== "done")
        .map((s) => s.key);

  const { token, hash } = mintInvitationToken();
  const { data: openedAt, error } = await admin.rpc("open_packet_signing", {
    p_org: orgId,
    p_invitation: invitation.id,
    p_sign_token_hash: hash,
    p_extend_days: INVITE_TTL_DAYS_DEFAULT,
  });
  if (error) {
    if (error.code === "AI006") {
      return {
        code: "application_not_approved",
        message: "Approve the application before opening it for signing.",
      };
    }
    if (error.code === "AI002") {
      return { code: "invitation_revoked", message: "This invitation was revoked. Nothing was opened." };
    }
    if (error.code === "AI003") {
      return { code: "already_filed", message: "The application is already signed and filed." };
    }
    if (error.code === "AI001") return NOT_FOUND;
    return { code: "open_signing_failed", message: error.message };
  }

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "compliance.packet_signing_opened",
    entity: "application_invitations",
    entityId: invitation.id,
    // Never the token or its hash — an audit log is the last place a credential should be recoverable.
    meta: { driverId: invitation.driver_id, warnings },
  });

  return { link: `${env.WEB_APP_URL}/apply/${token}`, warnings, signingOpenedAt: String(openedAt) };
}
