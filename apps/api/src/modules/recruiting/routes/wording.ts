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
import { packetWording } from "../packetWording.js";
import { pspDisclosure } from "../pspDisclosure.js";

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
/** Where a better draft than our placeholder comes from, for the instruments that have one. */
function wordingSource(
  instrument: (typeof PUBLISHABLE_INSTRUMENTS)[number],
  carrierName: string,
): { kind: "packet" | "fmcsa"; title: string; body: string; intent: string; provenance: string } | null {
  if (instrument === "psp") {
    const doc = pspDisclosure(carrierName);
    return {
      kind: "fmcsa",
      ...doc,
      provenance:
        "FMCSA publishes this disclosure and requires account holders to use it in whole, exactly "
        + "as provided, as a stand-alone document. It is not the carrier's to reword, and "
        + "publishing anything else here is refused.",
    };
  }
  const packet = packetWording(instrument);
  if (!packet) return null;
  return {
    kind: "packet",
    title: packet.title,
    body: packet.body,
    intent: packet.intent,
    provenance:
      `Your own wording, from page ${packet.page} of your application packet, spelling corrected. `
      + "Read it before you publish.",
  };
}

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
      const { data: org } = await admin
        .from("organizations")
        .select("name")
        .eq("id", orgId)
        .maybeSingle();
      const carrierName = (org as { name?: string } | null)?.name ?? "";

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
            /**
             * ⚠ Where the right words for this instrument actually come from, when they come from
             * somewhere better than our placeholder (2026-09-13). Two kinds, and the difference
             * matters to the office reading it:
             *
             *   `packet` — the carrier's OWN lawyers, pages 14/19/21 of `APPLICATION.xlsx`. Theirs
             *              to adopt or not.
             *   `fmcsa`  — the regulator's, and NOT optional: FMCSA publishes the PSP disclosure
             *              and requires it in whole, exactly as provided. Publishing anything else
             *              for `psp` is refused.
             *
             * Null for the instruments neither answers for. ⚠ Nothing publishes from here — it
             * fills the editor and somebody still reads it and presses Publish.
             */
            source: wordingSource(instrument, carrierName),
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
