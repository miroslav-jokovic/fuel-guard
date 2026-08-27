import { Router } from "express";
import {
  applicationCaptureConfirmSchema,
  applicationCaptureStartSchema,
  applicationDraftSaveSchema,
  applicationDraftUnlockSchema,
  applicationReleaseSchema,
  applicationSubmitSchema,
  type ApplicationCaptureConfirm,
  type ApplicationCaptureStart,
  type ApplicationDraftSave,
  type ApplicationDraftUnlock,
  type ApplicationRelease,
  type ApplicationSubmit,
} from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { confirmCapture, listCaptures, startCapture } from "../applicationCapture.js";
import { loadDraft, saveDraft, unlockDraft } from "../applicationDraft.js";
import { esignConsentForApplicant, recordEsignConsent } from "../esignConsent.js";
import {
  isIntakeError,
  phasesOf,
  recordRelease,
  releasesForApplicant,
  resolveInvitation,
  signedReleases,
  submitApplication,
} from "../applicationIntake.js";

/**
 * The public application surface — H5, and the only unauthenticated write path in the product that
 * accepts personal data.
 *
 * `publicHazmat` is the precedent for the SHAPE (unauthenticated, rate-limited, mounted under
 * /api/public) and not for the risk: that one persists nothing and answers questions about chemicals.
 * This one accepts a date of birth, a licence number and possibly a Social Security number from
 * somebody with no account, so every decision below is about keeping the blast radius of a guessed
 * or leaked link to exactly one applicant.
 *
 * ── EVERY REFUSAL IS THE SAME REFUSAL ──────────────────────────────────────────────────────────
 * Expired, revoked, never existed — all return `invalid_link` with one message. Distinguishing them
 * would let an anonymous caller learn that a token EXISTED, which is a fact about a person applying
 * for a job at a named carrier.
 *
 * The exceptions are the refusals only a holder of a LIVE link can reach, which therefore disclose
 * nothing: `disclosure_not_final` (the carrier has not published its wording — the carrier's problem,
 * not the driver's), and A1's two spent-phase answers, `already_submitted` and `releases_complete`.
 * A spent phase is no longer a dead link (D-APP1): the session stays open and its other phases stay
 * reachable, which is the whole of what this step fixes.
 *
 * ── NO ORG ID EVER CROSSES THIS BOUNDARY ───────────────────────────────────────────────────────
 * The token resolves to the org server-side. Nothing here reads a tenant from the request, so there
 * is no parameter to tamper with — the shape 0174's header calls out for service-role functions,
 * applied to an HTTP surface.
 */
/**
 * The capture endpoints' shared answer map.
 *
 * `capture_upload_failed` is 422 and not 404: the link is fine, the slot is fine, and the one thing
 * that is wrong — no object at that key — is something the driver fixes by taking the photograph
 * again. A 404 here would read as "your link is dead" to a page whose whole vocabulary for 404 is
 * exactly that.
 */
function captureStatus(code: string): number {
  if (code === "invalid_link") return 404;
  if (code === "already_submitted" || code === "esign_consent_required") return 409;
  if (code === "capture_upload_failed") return 422;
  return 500;
}

export function publicApplicationRouter(): Router {
  const router = Router();

  const context = (req: Parameters<Parameters<typeof router.get>[1]>[0]) => ({
    // `trust proxy` is set in app.ts, so this is the applicant's address. ESIGN attribution
    // evidence — the same three fields 0215 records for a staff-recorded signature.
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  });

  /**
   * What the applicant sees when they open the link: which carrier, what is being asked, and the
   * exact wording of each instrument they will be asked to sign. The disclosures are SERVED, never
   * shipped in the client bundle, so what somebody signed is a fact the server can prove.
   */
  router.get(
    "/:token",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const invitation = await resolveInvitation(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(invitation)) {
        res.status(404).json(apiError(invitation.code, invitation.message));
        return;
      }

      const { data: org } = await admin
        .from("organizations")
        .select("name")
        .eq("id", invitation.org_id)
        .maybeSingle();

      // What they typed last time (A2). The body is withheld once a date of birth is in it — see
      // `applicationDraft.ts` for why the bare link is not enough to read one back (D-APP16).
      const draft = await loadDraft(admin, invitation.org_id, invitation.id);
      // Which of the four this link has already collected, so a resumed ceremony opens on the next
      // one rather than asking for a signature the driver has already given (A5).
      const signed = await signedReleases(admin, invitation.org_id, invitation.id);
      // And which slots have been photographed (A8), so a resumed session does not ask a driver to
      // take a licence photograph they already took.
      const captures = await listCaptures(admin, invitation.org_id, invitation.id);

      res.json({
        // The carrier's name and nothing else about them. An application link is not a directory.
        carrier: (org as { name?: string } | null)?.name ?? "the carrier",
        expiresAt: invitation.expires_at,
        releases: releasesForApplicant(),
        releasesSigned: signed,
        // Where this driver stopped (D-APP1). Three dates and nothing else — the page opens on the
        // step they had reached instead of on a blank form they have already filled in once.
        phases: phasesOf(invitation),
        draft,
        // The 15 U.S.C. 7001(c) consent, served like every other instrument — the exact text, from
        // the server, so what somebody agreed to is a fact we can prove (A4).
        esignConsent: esignConsentForApplicant(),
        // Slots and dates, not pictures (A8) — see `listCaptures` for why the photographs are not
        // re-served to the person who took them.
        captures,
      });
    }),
  );

  router.post(
    "/:token",
    validateBody(applicationSubmitSchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const result = await submitApplication(
        admin, env, String(req.params.token ?? ""),
        res.locals.body as ApplicationSubmit, context(req), new Date(),
      );
      if (isIntakeError(result)) {
        // 409 for a spent phase: the request conflicts with the state of a link that is otherwise
        // perfectly good, which is what that status is for and what 404 would have hidden.
        const status =
          result.code === "invalid_link"
            ? 404
            : result.code === "already_submitted"
              || result.code === "esign_consent_required"
              // The carrier has not published its wording, so this application cannot be filed yet
              // (WORDING_NOT_FINAL). 409 for the same reason as the others: the link is fine, the
              // request conflicts with the state of the world around it.
              || result.code === "disclosure_not_final"
              ? 409
              : 500;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      // The application id and nothing else. The applicant does not need — and must not be handed —
      // their own driver id or the carrier's org id.
      res.status(201).json({ ok: true, applicationId: result.applicationId });
    }),
  );

  /**
   * Consent to transact electronically — the first act on the link (A4, D-APP5).
   *
   * The body carries nothing: the version, the text and the intent are all composed server-side from
   * `ESIGN_CONSENT`, because a client-authored record of what somebody consented to is worth nothing
   * in the audit it exists for. What the request supplies is the act itself, and its IP and user
   * agent — the same attribution every signature in this product carries.
   */
  router.post(
    "/:token/consent",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await recordEsignConsent(
        admin, String(req.params.token ?? ""), context(req), new Date(),
      );
      if (isIntakeError(result)) {
        const status =
          result.code === "invalid_link"
            ? 404
            : result.code === "disclosure_not_final" || result.code === "esign_consent_already_given"
              ? 409
              : 500;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true });
    }),
  );

  /**
   * Autosave (A2). Partial, unvalidated, size-capped, and idempotent per invitation.
   *
   * PUT rather than POST because it is the same resource every time: one draft per link, replaced
   * wholesale. The client debounces to well inside the surface's rate budget — 20 req/min at
   * `app.ts:147` with `/api/public`'s 60/min stacked on top, so the intersection is 20.
   */
  router.put(
    "/:token/draft",
    validateBody(applicationDraftSaveSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await saveDraft(
        admin, String(req.params.token ?? ""),
        res.locals.body as ApplicationDraftSave, new Date(),
      );
      if (isIntakeError(result)) {
        const status =
          result.code === "invalid_link"
            ? 404
            : result.code === "already_submitted" || result.code === "esign_consent_required"
              ? 409
              : result.code === "draft_too_large"
                ? 413
                : 500;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true, updatedAt: result.updatedAt });
    }),
  );

  /**
   * Release a gated draft to the person who typed it (D-APP16).
   *
   * A wrong date of birth is not an error: it returns the same locked view a plain read returns, and
   * changes nothing about the invitation. There is no attempt counter and no lockout — a driver
   * mistyping their own birthday must not need a support call, and the throttle that actually stops
   * guessing is the rate limiter this route already sits behind.
   */
  router.post(
    "/:token/unlock",
    validateBody(applicationDraftUnlockSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await unlockDraft(
        admin, String(req.params.token ?? ""),
        (res.locals.body as ApplicationDraftUnlock).date_of_birth, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(result.code === "invalid_link" ? 404 : 500).json(apiError(result.code, result.message));
        return;
      }
      res.json({ draft: result });
    }),
  );

  /**
   * Somewhere to put one photograph (A8, D-APP10).
   *
   * The response is a signed upload URL and an id; nothing is written. The bytes go from the phone
   * straight to Storage — `compliance.ts:110`'s property, and the reason a driver uploading six
   * megabytes on a truck-stop connection does not occupy an API worker for the duration.
   */
  router.post(
    "/:token/capture",
    validateBody(applicationCaptureStartSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await startCapture(
        admin, String(req.params.token ?? ""),
        res.locals.body as ApplicationCaptureStart, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(captureStatus(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json(result);
    }),
  );

  /**
   * The bytes landed — record the slot (A8).
   *
   * PUT, and idempotent per slot: a re-shoot replaces what that slot held rather than adding to it,
   * which is what keeps three attempts at one blurry licence from becoming three rows in a
   * qualification file (D-APP10). The capture id in the path is what the start call minted; the
   * storage key is recomputed from it server-side and never taken from the request.
   */
  router.put(
    "/:token/capture/:captureId",
    validateBody(applicationCaptureConfirmSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await confirmCapture(
        admin, String(req.params.token ?? ""), String(req.params.captureId ?? ""),
        res.locals.body as ApplicationCaptureConfirm, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(captureStatus(result.code)).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, ...result });
    }),
  );

  /** One instrument, one call — FCRA §604(b)(2)'s "solely the disclosure", expressed in transport. */
  router.post(
    "/:token/release",
    validateBody(applicationReleaseSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await recordRelease(
        admin, String(req.params.token ?? ""),
        res.locals.body as ApplicationRelease, context(req), new Date(),
      );
      if (isIntakeError(result)) {
        const status =
          result.code === "invalid_link"
            ? 404
            : result.code === "disclosure_not_final"
                || result.code === "releases_complete"
                || result.code === "release_already_signed"
                || result.code === "esign_consent_required"
              ? 409
              : 500;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      // How far the ceremony got, so the page can move to the next instrument without refetching.
      res.status(201).json({ ok: true, signedCount: result.signedCount, completed: result.completed });
    }),
  );

  return router;
}
