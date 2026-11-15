import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_LINK_TTL_DAYS, offeredCaptureSlots, renderDocumentsLinkEmail, type DocumentsLinkBundle } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { writeAudit } from "../../lib/audit.js";
import { mintInvitationToken } from "./applicationIntake.js";
import { carrierName, deliverApplicationMail, type ApplicationInviteDelivery } from "./applicationMail.js";
import { listCaptures } from "./applicationCapture.js";
import { recruitingSettings } from "./recruitingSettings.js";

/**
 * The office sends a documents-only link (APPLICATION-FIX-PLAN.md, Q-AM19; migration 0608).
 * `applicationDocumentsLinkContract.ts` says what the link can and cannot do, and why it is narrow.
 *
 * ── WHEN IT MAY BE SENT ───────────────────────────────────────────────────────────────────────
 * - **Not before the applicant agreed to do this electronically.** A photograph is refused without
 *   the 7001(c) consent, and this link has no screen that can collect it — so a link sent earlier
 *   would open a list that refuses every photograph. The office sends the application link instead.
 * - **Not after the application is filed.** A photograph staged then is promoted by nothing
 *   (`applicationCapture.ts`), so the page would say "received" about a photo nobody will file. Until
 *   the office can file a late photograph from its drawer (the plan's stage 3), the office uploads it.
 * - **Not on a revoked invitation** — the database's own guard (`rotate_invitation_docs_token`).
 * A LAPSED application is fine, and is the case this exists for.
 *
 * ── EVERY SEND IS A NEW LINK ──────────────────────────────────────────────────────────────────
 * The rotation replaces the token, so the last link sent is the only one that works — a link mailed to
 * an address the office has since corrected dies when the next one is sent.
 *
 * ── THE MAIL IS REPORTED, NEVER RAISED ────────────────────────────────────────────────────────
 * The link is returned to the office's screen whether or not the e-mail went, as creating an
 * application link always has: with no address, the office reads it out or texts it by hand.
 */
export interface DocumentsLinkError {
  code: string;
  message: string;
}
export const isDocumentsLinkError = (v: unknown): v is DocumentsLinkError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v && !("link" in v);

export interface DocumentsLinkSent {
  link: string;
  expiresAt: string;
  delivery: ApplicationInviteDelivery;
}

const DAY_MS = 86_400_000;

export async function sendDocumentsLink(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  invitationId: string,
  ctx: { actorId: string },
  now: Date,
): Promise<DocumentsLinkSent | DocumentsLinkError> {
  const { data } = await admin
    .from("application_invitations")
    .select("id, driver_id, email, consented_at, submitted_at, revoked_at")
    .eq("org_id", orgId)
    .eq("id", invitationId)
    .maybeSingle();
  const inv = data as {
    id: string; driver_id: string; email: string | null; consented_at: string | null; submitted_at: string | null; revoked_at: string | null;
  } | null;
  if (!inv) return { code: "application_not_found", message: "There is no application on this invitation." };
  if (inv.revoked_at) return { code: "invitation_revoked", message: "This application was ended, so no link can be sent on it." };
  if (!inv.consented_at) {
    return {
      code: "not_consented",
      message: "The applicant has not started yet, so a documents link would refuse their photos. Send the application link instead.",
    };
  }
  if (inv.submitted_at) {
    return {
      code: "already_filed",
      message: "This application is filed, and a photo sent now would not reach the file. Upload the document here instead.",
    };
  }

  const { token, hash } = mintInvitationToken();
  const expiresAt = new Date(now.getTime() + DOCUMENTS_LINK_TTL_DAYS * DAY_MS).toISOString();
  const { data: written, error } = await admin.rpc("rotate_invitation_docs_token", {
    p_org: orgId, p_invitation: invitationId, p_token_hash: hash, p_expires_at: expiresAt,
  });
  if (error || written !== true) {
    return { code: "link_changed", message: "That application changed while you were looking at it. Reload and try again." };
  }

  await writeAudit(admin, {
    orgId,
    actorId: ctx.actorId,
    action: "compliance.documents_link_sent",
    entity: "application_invitations",
    entityId: invitationId,
    // The ids and the end. Never the token or its hash.
    meta: { driverId: inv.driver_id, expiresAt },
  });

  const link = `${env.WEB_APP_URL}/apply/${token}`;
  const delivery = await deliverApplicationMail(
    env, inv.email, renderDocumentsLinkEmail(await carrierName(admin, orgId), link, DOCUMENTS_LINK_TTL_DAYS),
  );
  return { link, expiresAt, delivery };
}

/**
 * What the documents link's page is served — the whole of it. The carrier's name, the list the carrier
 * asks for, and which slots are already photographed (slots and dates, never pictures: `listCaptures`).
 *
 * ⚠ **Nothing of the application.** No phase, no draft, no instrument, no question: the page has no
 * screen for them and the token has no route to act on them. A key added here is a key a link that
 * outlives the application can read, so the shape is `DocumentsLinkBundle` and nothing is spread in.
 * `localKey` is the route's (`localCopyKey`), handed in so this module does not import a route.
 */
export async function documentsLinkBundle(
  admin: SupabaseClient,
  link: { id: string; org_id: string; docs_link_expires_at: string },
  localKey: string,
): Promise<DocumentsLinkBundle> {
  // ⚠ A failed settings read offers every slot rather than failing the page, as the application's own
  // bundle does: a document the carrier withheld costs one photo the capture route then refuses.
  const offered = await recruitingSettings(admin, link.org_id)
    .then((s) => offeredCaptureSlots(s.offered_document_slots))
    .catch(() => offeredCaptureSlots(null));
  return {
    documentsOnly: true,
    carrier: (await carrierName(admin, link.org_id)).trim() || "the carrier",
    expiresAt: link.docs_link_expires_at,
    localKey,
    captures: await listCaptures(admin, link.org_id, link.id),
    offeredDocumentSlots: offered,
  };
}

