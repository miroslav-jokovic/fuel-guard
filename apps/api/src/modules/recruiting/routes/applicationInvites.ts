import { Router } from "express";
import {
  INVITE_TTL_DAYS_DEFAULT,
  applicationInviteCreateSchema,
  type ApplicationInviteCreate,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  INVITE_COLS,
  createApplicationInvite,
  findExistingApplicants,
  isApplicationLinkError,
  sendApplicationLinkAgain,
} from "../applicationLink.js";
import { ensureApplicationPdf } from "../applicationPdf/file.js";
import { DOCUMENTS_BUCKET } from "@silvicom/shared";

/**
 * Inviting an applicant to fill in their own §391.21 application (H5).
 *
 * ── THE LINK IS RETURNED ONCE AND NEVER AGAIN ──────────────────────────────────────────────────
 * The response carries the only copy of the token that will ever exist outside the applicant's
 * inbox; the table holds a SHA-256. That is the same contract `/api/invites` offers — "the link is
 * always returned when it could be generated, even if the email failed to send". There is nothing to
 * re-read, so "send the link again" (C2e, Q-AX5) REPLACES the token on the same invitation and the old
 * link dies — see `applicationLink.ts`, which also holds the create itself since then.
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
/** The delivery outcome's shape moved with the mailer (AF4); re-exported for existing importers. */
export type { ApplicationInviteDelivery } from "../applicationMail.js";

export function recruitmentApplicationInvitesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireSection("recruitment", "view");
  const canInvite = requireSection("recruitment");

  // ⚠ `submitted_at` and not `used_at` since A5. 0225 replaced the single-use fuse with dated phase
  // stamps and kept `used_at` as a mirror for exactly three readers, of which this was one; the
  // column is dropped once this code is provably deployed (see A5's entry in the plan for why the
  // drop is its own step and not this migration).
  // ⚠ The two phase columns the OFFICE owns are here since F5. Without them the invitation row could
  // only say "Open" for an application waiting on the carrier, or already sent back to be signed.
  // ⚠ ONE string literal, never a concatenation: PostgREST's types are inferred from the select text
  // statically, and a `+` turns every read of it into `GenericStringError`.

  router.get(
    "/drivers/:driverId/application-invites",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { data, error } = await admin
        .from("application_invitations")
        // Never `token_hash`: a hash is not a link, but it is also not something a UI has any use
        // for, and a column that leaves the database is a column somebody eventually logs.
        .select(INVITE_COLS)
        .eq("org_id", orgId)
        .eq("driver_id", String(req.params.driverId ?? ""))
        .order("created_at", { ascending: false });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load the invitations"));
        return;
      }

      /**
       * Whether anything has been typed against each link (F5).
       *
       * ⚠ The row itself, never its payload. The answer the screen needs is one boolean — has this
       * driver started — and a list endpoint that carried everybody's §391.21 answers would put a
       * date of birth and a licence number into a response nobody asked for. The answers have their
       * own surface, behind `manage`, one application at a time.
       */
      const rows = (data ?? []) as Array<{ id: string }>;
      const { data: drafts } = await admin
        .from("application_drafts")
        .select("invitation_id")
        .eq("org_id", orgId)
        .in("invitation_id", rows.map((r) => r.id));
      const started = new Set(
        ((drafts ?? []) as Array<{ invitation_id: string }>).map((d) => d.invitation_id),
      );
      // §7 (C2b2): which links are v2 — have a Part 1 row — and, since C3a mints that row with the
      // invitation, which of them have BEGUN Part 1: `prior_positive_2y` answered, the one fact every
      // first write must carry (AI009). Two booleans, never the answers, for the drafts' reason: the
      // address and licences have their own surface.
      const { data: intakes } = await admin
        .from("application_intakes")
        .select("invitation_id, prior_positive_2y")
        .eq("org_id", orgId)
        .in("invitation_id", rows.map((r) => r.id));
      const intakeRows = (intakes ?? []) as Array<{ invitation_id: string; prior_positive_2y: boolean | null }>;
      const partOne = new Set(intakeRows.map((d) => d.invitation_id));
      const begun = new Set(intakeRows.filter((d) => d.prior_positive_2y !== null).map((d) => d.invitation_id));

      res.json({
        invitations: rows.map((r) => ({
          ...r,
          has_draft: started.has(r.id),
          has_intake: partOne.has(r.id),
          intake_begun: begun.has(r.id),
        })),
      });
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

      const result = await createApplicationInvite(admin, env, {
        orgId,
        userId: req.auth!.userId,
        driverId: body.driver_id,
        email: body.email ?? null,
        days: body.expires_in_days ?? INVITE_TTL_DAYS_DEFAULT,
      });
      if (isApplicationLinkError(result)) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ invitation: result.invitation, link: result.link, delivery: result.delivery });
    }),
  );

  /**
   * "Send the link again" on the applicant's own record (C2e: Q-AX5, Q-AX6). The server decides whether
   * that replaces the current invitation's link or opens a new, empty application — `applicationLink.ts`.
   */
  router.post(
    "/drivers/:driverId/application-invites/again",
    requireOrg,
    canInvite,
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const result = await sendApplicationLinkAgain(getSupabaseAdmin(env), env, {
        orgId: req.auth!.orgId!,
        userId: req.auth!.userId,
        driverId: String(req.params.driverId ?? ""),
      });
      if (isApplicationLinkError(result)) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      res.status(result.mode === "created" ? 201 : 200).json(result);
    }),
  );

  /**
   * Is the person the office is about to add already on the board (Q-AX6)? Read before the board's
   * invite drawer creates anybody, so it can offer "send the link again" on the existing record.
   */
  router.get(
    "/applicant-matches",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const fullName = String(req.query.full_name ?? "").trim();
      const email = String(req.query.email ?? "").trim() || null;
      if (fullName.length < 2 || fullName.length > 200 || (email && email.length > 200)) {
        res.status(400).json(apiError("invalid_request", "A full name is required."));
        return;
      }
      const matches = await findExistingApplicants(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, { fullName, email });
      res.json({ matches });
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
