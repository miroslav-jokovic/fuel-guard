import { Router } from "express";
import {
  PUBLISHABLE_INSTRUMENTS,
  publishWordingSchema,
  unpublishedInstruments,
  type PublishWording,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { isWordingError, loadCarrierWording, publishWording, wordingHistory } from "../carrierWording.js";

/**
 * Publishing the carrier's own instrument wording (0338).
 *
 * ── WHY PUBLISHING TAKES `settings` AND NOT `recruitment` ─────────────────────────────────────
 * This is the text a driver legally signs. Changing it is not a day-to-day recruiting act — a
 * recruiter processing applications has no business rewriting a federal authorization, and the blast
 * radius of a bad edit is every signature taken afterwards. Reading takes `recruitment view`, because
 * a recruiter absolutely does need to see what is live and, more to the point, that something is
 * still unpublished and therefore stopping every applicant they invite.
 *
 * ⚠ **The gate this opens is the one thing standing between this product and its first real
 * application.** Every instrument ships as `v0-draft`; until a carrier publishes all six, submission,
 * signing, the 7001(c) consent, PSP, §40.25 letters and Clearinghouse queries all refuse.
 */
export function recruitmentWordingRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canRead = requireSection("recruitment", "view");
  const canPublish = requireSection("settings");

  /** What is live, what is still a placeholder, and everything ever published. */
  router.get(
    "/wording",
    requireOrg,
    canRead,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const wording = await loadCarrierWording(admin, orgId);
      const outstanding = unpublishedInstruments(wording);

      res.json({
        instruments: PUBLISHABLE_INSTRUMENTS.map((instrument) => {
          const doc = instrument === "esign_consent" ? wording.esignConsent : wording.disclosures[instrument];
          return {
            instrument,
            version: doc.version,
            title: doc.title,
            intent: doc.intent,
            // The consent is six clauses; the others are one body. The screen renders whichever it
            // is given rather than deciding for itself which shape an instrument has.
            body: instrument === "esign_consent" ? null : (doc as { body: string }).body,
            clauses: instrument === "esign_consent" ? wording.esignConsent.clauses : null,
            published: !outstanding.includes(instrument),
          };
        }),
        outstanding,
        /** One number the office can act on: nothing an applicant does works until this is zero. */
        outstandingCount: outstanding.length,
        history: await wordingHistory(admin, orgId),
      });
    }),
  );

  /** Publish one instrument. The version is assigned, never taken from the request. */
  router.post(
    "/wording",
    requireOrg,
    canPublish,
    validateBody(publishWordingSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await publishWording(
        admin,
        req.auth!.orgId!,
        res.locals.body as PublishWording,
        { actorId: req.auth!.userId },
      );
      if (isWordingError(result)) {
        res.status(result.code === "publish_raced" ? 409 : 500).json(apiError(result.code, result.message));
        return;
      }
      res.status(201).json({ ok: true, ...result });
    }),
  );

  return router;
}
