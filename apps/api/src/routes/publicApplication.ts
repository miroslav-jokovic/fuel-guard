import { Router } from "express";
import {
  applicationReleaseSchema,
  applicationSubmitSchema,
  type ApplicationRelease,
  type ApplicationSubmit,
} from "@fuelguard/shared";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getAppLocals } from "../lib/appLocals.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import {
  isIntakeError,
  recordRelease,
  releasesForApplicant,
  resolveInvitation,
  submitApplication,
} from "../services/applicationIntake.js";

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
 * Expired, revoked, already used, never existed — all return `invalid_link` with one message.
 * Distinguishing them would let an anonymous caller learn that a token EXISTED, which is a fact
 * about a person applying for a job at a named carrier. The one exception is `disclosure_not_final`,
 * which reveals nothing about anybody and tells the carrier's own staff exactly what is wrong.
 *
 * ── NO ORG ID EVER CROSSES THIS BOUNDARY ───────────────────────────────────────────────────────
 * The token resolves to the org server-side. Nothing here reads a tenant from the request, so there
 * is no parameter to tamper with — the shape 0174's header calls out for service-role functions,
 * applied to an HTTP surface.
 */
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

      res.json({
        // The carrier's name and nothing else about them. An application link is not a directory.
        carrier: (org as { name?: string } | null)?.name ?? "the carrier",
        expiresAt: invitation.expires_at,
        releases: releasesForApplicant(),
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
        res.status(result.code === "invalid_link" ? 404 : 500).json(apiError(result.code, result.message));
        return;
      }
      // The application id and nothing else. The applicant does not need — and must not be handed —
      // their own driver id or the carrier's org id.
      res.status(201).json({ ok: true, applicationId: result.applicationId });
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
          result.code === "invalid_link" ? 404 : result.code === "disclosure_not_final" ? 409 : 500;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true });
    }),
  );

  return router;
}
