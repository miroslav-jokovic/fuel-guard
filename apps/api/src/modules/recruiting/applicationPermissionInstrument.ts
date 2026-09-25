import type { SupabaseClient } from "@supabase/supabase-js";
import { APPLICATION_RELEASE_ORDER, type AuthorizationPurpose } from "@silvicom/shared";
import { loadCarrierWording } from "./carrierWording.js";
import { permissionInstrumentPdf } from "./applicationPdf/permissionInstrument.js";
import { carrierOf } from "./applicationPdf/sources.js";
import {
  isIntakeError,
  requireEsignConsent,
  resolveInvitation,
  type IntakeError,
} from "./applicationIntake.js";

/**
 * One permission, unsigned, as the applicant is about to sign it (AF6, D-AF2).
 *
 * ── WHAT THE TOKEN IS ENOUGH FOR ──────────────────────────────────────────────────────────────
 * The same text the link's own `GET /:token` already serves under `releases`: the carrier's wording,
 * with its name in the blanks. Nothing personal is on it. The signature box, the date and the printed
 * name are left empty, because nobody has signed it yet; the office's B2 copy is where a signed
 * instrument prints, from the signed row.
 *
 * ⚠ **The consent to transact electronically comes first**, as it does for every other write and read
 * on the ceremony (`requireEsignConsent`). An instrument handed to somebody who has not agreed to
 * receive records electronically is an electronic record delivered without the 7001(c) consent
 * §390.32(d) asks us to be able to show.
 *
 * ⚠ **Only the five purposes the applicant is asked for.** `AUTHORIZATION_PURPOSES` is wider than the
 * ceremony, and a document for a purpose nobody signs on this path is a document this path should not
 * produce.
 */

export const NOT_A_PERMISSION: IntakeError = {
  code: "not_a_permission",
  message: "There is no such permission on this application.",
};

export async function applicantPermissionInstrument(
  admin: SupabaseClient,
  token: string,
  purpose: string,
  now: Date,
): Promise<{ pdf: Buffer; filename: string } | IntakeError> {
  const invitation = await resolveInvitation(admin, token, now);
  if (isIntakeError(invitation)) return invitation;
  if (!(APPLICATION_RELEASE_ORDER as readonly string[]).includes(purpose)) return NOT_A_PERMISSION;

  const wording = await loadCarrierWording(admin, invitation.org_id);
  const consent = requireEsignConsent(invitation, wording);
  if (consent) return consent;

  const doc = wording.disclosures[purpose as AuthorizationPurpose];
  const pdf = await permissionInstrumentPdf({
    purpose,
    version: doc.version,
    title: doc.title,
    body: doc.body,
    intent: doc.intent,
    carrier: await carrierOf(admin, invitation.org_id),
    signer: null,
  });
  return { pdf, filename: `${purpose}.pdf` };
}
