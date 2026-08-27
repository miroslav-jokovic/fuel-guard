import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INVITE_TTL_DAYS_DEFAULT,
  applicationInviteCreateSchema,
  renderApplicationInviteEmail,
  rolesThatCanView,
  rolesThatManage,
  type ApplicationInviteCreate,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { mintInvitationToken } from "../../services/applicationIntake.js";
import { sendEmail } from "../../lib/mailer.js";
import { ensureApplicationPdf } from "../../services/applicationPdf/file.js";
import { DOCUMENTS_BUCKET } from "@silvicom/shared";
import type { Env } from "../../env.js";

/**
 * Inviting an applicant to fill in their own §391.21 application (H5).
 *
 * ── THE LINK IS RETURNED ONCE AND NEVER AGAIN ──────────────────────────────────────────────────
 * The response carries the only copy of the token that will ever exist outside the applicant's
 * inbox; the table holds a SHA-256. That is the same contract `/api/invites` offers — "the link is
 * always returned when it could be generated, even if the email failed to send" — with one addition
 * it does not have: there is no resend that re-reads the old token, because there is nothing to
 * re-read. A lost link is replaced by a NEW invitation, and the old one is revoked.
 *
 * ── AND SINCE 2026-08-22, IT IS ALSO SENT ─────────────────────────────────────────────────────
 * ⚠ This route stored `email` in a column from the day it shipped and never imported a mailer. The
 * address was recorded "so a recruiter can see who was invited" and the recruiter then copied the
 * link into their own mail client by hand. D-APP13 says "email ships first"; A11b's own Done-when
 * reads "a driver who did not consent gets an email" — and A11b was marked DONE with only the
 * ABANDONMENT nudge sending, which is the SECOND email a driver would ever receive. The first one
 * had no send path at all.
 *
 * The delivery stack needed nothing new: `sendEmail` (lib/mailer.ts) and the shared template module
 * were already carrying the nudge (`applicationNudgeSweep.ts`). What was missing was six lines here.
 *
 * ⚠ **Sending never decides whether the invitation exists.** The row is committed and the audit
 * written before the mailer is touched, and a refused send is reported in the response rather than
 * raised — the recruiter still has the link and can pass it on any way they like. An invitation that
 * rolled back because a mail provider was rate-limited would be the worst possible failure here: the
 * token cannot be re-derived, so the applicant would be left with nothing and the recruiter with no
 * way to know why.
 *
 * ── WHY A RECRUITER MAY DO THIS AND MAY NOT HIRE ───────────────────────────────────────────────
 * Sending somebody a form is the recruitment act; flipping `drivers.status` is not (0213). So this
 * takes the section's own manage guard, unlike `/hire` next door.
 */
/** What became of the email. `sent: false` is an outcome to report, never a reason to fail. */
export interface ApplicationInviteDelivery {
  sent: boolean;
  /** Where it went, echoed so the UI can name the address without re-reading the row. */
  email: string | null;
  /** `no_address` | `mail_disabled` | `send_failed`. null when it went. */
  reason: string | null;
}

/**
 * The carrier's own name, which is what the applicant recognises — they applied to a trucking
 * company, not to this product. Falls back rather than failing: an email that says "the carrier" is
 * worth sending; an invitation that did not go out because an org row was missing a name is not.
 */
async function carrierName(admin: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "the carrier";
}

async function deliverApplicationInvite(
  env: Env,
  email: string | null,
  carrier: string,
  link: string,
  expiresInDays: number,
): Promise<ApplicationInviteDelivery> {
  if (!email) return { sent: false, email: null, reason: "no_address" };
  // Checked here rather than left to the mailer so the UI can distinguish "we are not configured to
  // send" from "the provider refused". The first is an admin's problem and the second is the
  // applicant's address; telling a recruiter the wrong one sends them to the wrong person.
  if (env.MAIL_PROVIDER === "none") return { sent: false, email, reason: "mail_disabled" };

  const mail = renderApplicationInviteEmail(carrier, link, expiresInDays);
  const result = await sendEmail(env, {
    to: [email],
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  if (!result.ok) {
    // Loud: the recruiter sees "could not send" and can act, but nobody sees WHY without this.
    console.error("[application-invite] could not send", { detail: result.detail });
  }
  return { sent: result.ok, email, reason: result.ok ? null : "send_failed" };
}

export function recruitmentApplicationInvitesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("recruitment"));
  const canInvite = requireRole(...rolesThatManage("recruitment"));

  // ⚠ `submitted_at` and not `used_at` since A5. 0225 replaced the single-use fuse with dated phase
  // stamps and kept `used_at` as a mirror for exactly three readers, of which this was one; the
  // column is dropped once this code is provably deployed (see A5's entry in the plan for why the
  // drop is its own step and not this migration).
  const INVITE_COLS =
    "id, driver_id, email, expires_at, consented_at, releases_completed_at, submitted_at, revoked_at, created_at";

  router.get(
    "/drivers/:driverId/application-invites",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("application_invitations")
        // Never `token_hash`: a hash is not a link, but it is also not something a UI has any use
        // for, and a column that leaves the database is a column somebody eventually logs.
        .select(INVITE_COLS)
        .eq("org_id", req.auth!.orgId!)
        .eq("driver_id", String(req.params.driverId ?? ""))
        .order("created_at", { ascending: false });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load the invitations"));
        return;
      }
      res.json({ invitations: data ?? [] });
    }),
  );

  router.post(
    "/application-invites",
    requireOrg,
    canInvite,
    validateBody(applicationInviteCreateSchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as ApplicationInviteCreate;

      const { data: driver } = await admin
        .from("drivers")
        .select("id, status")
        .eq("id", body.driver_id)
        .eq("org_id", orgId)
        .maybeSingle();
      const row = driver as { id: string; status: string } | null;
      if (!row) {
        res.status(404).json(apiError("not_found", "Driver not found"));
        return;
      }
      // An application is what somebody submits BEFORE they are hired. Sending the form to a driver
      // who already works here would collect a §391.21 certification dated after their hire, which
      // is not the document §391.51(b)(1) is asking for.
      if (row.status !== "applicant") {
        res.status(409).json(apiError("not_an_applicant", `This driver is ${row.status}, not an applicant.`));
        return;
      }

      const { token, hash } = mintInvitationToken();
      const days = body.expires_in_days ?? INVITE_TTL_DAYS_DEFAULT;
      const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

      const { data, error } = await admin
        .from("application_invitations")
        .insert({
          org_id: orgId,
          driver_id: body.driver_id,
          token_hash: hash,
          email: body.email ?? null,
          expires_at: expiresAt,
          created_by: req.auth!.userId,
        })
        .select(INVITE_COLS)
        .single();
      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not create the invitation"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.application_invited",
        entity: "application_invitations",
        entityId: (data as { id: string }).id,
        // The id and the expiry. NEVER the token or its hash — an audit log is the last place a
        // credential should be recoverable from, and the hash is a credential's fingerprint.
        meta: { driverId: body.driver_id, expiresAt, email: body.email ?? null },
      });

      // The only copy. Not stored, not re-derivable, not returned again.
      const link = `${env.WEB_APP_URL}/apply/${token}`;

      /**
       * Send it, if there is anywhere to send it.
       *
       * Deliberately AFTER the insert and the audit row: see the header. `delivery.sent === false`
       * with a reason is an outcome the UI reports beside the link, not an error — the recruiter's
       * next action ("copy this and text it to them") is the same either way, and only the sentence
       * above it changes.
       */
      const carrier = await carrierName(admin, orgId);
      const delivery = await deliverApplicationInvite(env, body.email ?? null, carrier, link, days);

      res.status(201).json({ invitation: data, link, delivery });
    }),
  );

  /**
   * The application itself, as one document (A6).
   *
   * ── WHY THIS ROUTE EXISTS AT ALL ─────────────────────────────────────────────────────────────
   * PSP's §0.2 lesson, applied before it can repeat: a document filed only where somebody would have
   * to go looking is a document nobody reads. The recruiter's screen is where the application is
   * asked about, so the PDF is offered from there rather than left to be found in a driver's document
   * list. It is the same argument that moved the PSP report onto the panel that bought it.
   *
   * Rendering here is also the retry (D-APP9): `ensureApplicationPdf` files one if none is filed, so
   * a submission whose inline render failed heals the first time anybody asks for the document.
   */
  router.get(
    "/drivers/:driverId/application",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { data } = await admin
        .from("driver_applications")
        .select("id, certified_at, signed_name")
        .eq("org_id", orgId)
        .eq("driver_id", String(req.params.driverId ?? ""))
        .order("certified_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const application = data as { id: string; certified_at: string; signed_name: string } | null;
      if (!application) {
        res.json({ application: null, documentUrl: null });
        return;
      }

      const filed = await ensureApplicationPdf(admin, orgId, application.id);
      let documentUrl: string | null = null;
      if (filed) {
        const { data: signed } = await admin.storage
          .from(DOCUMENTS_BUCKET)
          // Short-lived, like every other document link in the product: the bytes are a driver's
          // §391.21 application and a URL that outlives the click is a URL that gets forwarded.
          .createSignedUrl(filed.storagePath, 300, { download: `application-${application.id}.pdf` });
        documentUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? null;
      }
      res.json({ application, documentUrl });
    }),
  );

  /** Revocation is an edit here rather than a new row: an invitation is a credential, not evidence,
   *  and the auditable fact is the `driver_authorizations` signature it leads to. */
  router.post(
    "/application-invites/:id/revoke",
    requireOrg,
    canInvite,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { data, error } = await admin
        .from("application_invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", String(req.params.id ?? ""))
        .eq("org_id", orgId)
        // An invitation that has been submitted through is spent, whatever else it did; revoking it
        // would take back a link the driver already used. The other phases do not block a revoke —
        // a carrier may withdraw an application somebody has half-signed.
        .is("submitted_at", null)
        .select(INVITE_COLS)
        .maybeSingle();
      if (error) {
        res.status(500).json(apiError("db_error", "Could not revoke the invitation"));
        return;
      }
      if (!data) {
        res.status(404).json(apiError("not_found", "That invitation is not open."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.application_invite_revoked",
        entity: "application_invitations",
        entityId: (data as { id: string }).id,
        meta: { driverId: (data as { driver_id: string }).driver_id },
      });
      res.json({ invitation: data });
    }),
  );

  return router;
}
