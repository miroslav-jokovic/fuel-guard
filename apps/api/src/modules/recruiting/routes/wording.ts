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
 * Publishing a carrier's OWN instrument wording, over the top of the catalogue we ship (0338).
 *
 * ── ⚠ THIS ROUTER HAS NO UI, DELIBERATELY, SINCE D-WORD1 (2026-09-14) ─────────────────────────
 * `/settings/application-wording` was deleted the day the product started shipping researched
 * wording. The page existed for one reason — every instrument was `v0-draft` and a carrier had to
 * publish something before an applicant could do anything — and `defaultWording()` removed that
 * reason. Asking a customer to approve six legal documents before their product works was the
 * wrong shape, and the owner said so.
 *
 * ⚠ **The router stays, and deleting it would be the mistake.** `org_disclosures` is a shipped,
 * append-only table that `driver_authorizations` rows point back into, and this is the only code
 * that writes it correctly: it assigns the version rather than accepting one, refuses a PSP body
 * that is not FMCSA's mandated language, and audits every publish. Without it the next carrier
 * that genuinely needs its own counsel's text gets rows written by hand, in a SQL editor, against
 * an evidence table. A capability with no button is not dead code; a table with no safe writer is
 * a liability.
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
      // The carrier's name goes into the two blanks FMCSA's form leaves for it. Read here rather
      // than typed by the office: an instrument authorising the wrong company authorises nobody.

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
