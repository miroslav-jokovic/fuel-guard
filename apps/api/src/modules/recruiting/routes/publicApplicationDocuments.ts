import { Router } from "express";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { applicantCopy } from "../applicationCopy.js";
import { applicantReadingCopy } from "../applicationReadingCopy.js";
import { applicantPermissionInstrument } from "../applicationPermissionInstrument.js";
import { applicantRoadTestCertificate } from "../applicationRoadTestCopy.js";
import { isIntakeError } from "../applicationIntake.js";

/**
 * What an application link will hand back as a DOCUMENT — split out of `publicApplication.ts` ahead
 * of C1, which adds a route to a file that stood at 461 of the 500-line budget.
 *
 * Same mount, same paths: the parent mounts this at its own root, so `GET /:token/document` still
 * answers at `/api/public/application/:token/document` exactly as before. Nothing here changed but
 * the file it lives in.
 *
 * ⚠ The seam is deliberately *documents*, and not "the leftovers". C1's gap is that the nine routes
 * on this link serve JSON and storage URLs and **none of them serves the packet the driver is about
 * to sign** — so the next route to arrive is a second document, answering the same question at a
 * different moment in the application's life. Putting the one that exists in a file named for the
 * question means the second one has somewhere obvious to go, and means the two are read together:
 * they differ on whether the application has been filed, and that is the only thing they differ on.
 */
export function publicApplicationDocumentsRouter(): Router {
  const router = Router();

  /**
   * The applicant's own copy of what was filed (X8, D-AX9).
   *
   * ⚠ A GET that returns a URL rather than the bytes, which is this product's idiom for every other
   * evidence document (`compliance.ts`). The bytes go from Storage to the driver's phone and never
   * through this API — one fewer place for a PDF of somebody's employment history to be logged,
   * buffered or cached.
   *
   * `not_submitted` is a 409 and not a 404: the link is perfectly valid and the answer is "not yet",
   * which is a different sentence and a different thing for the page to do about it.
   */
  router.get(
    "/:token/document",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicantCopy(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(result)) {
        const status = result.code === "invalid_link" ? 404 : result.code === "not_submitted" ? 409 : 503;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * The driver's copy of their road-test certificate (§391.31(g), RT4).
   *
   * ⚠ `/document`'s idiom exactly — a URL, never the bytes, on the intake's bucket — because it is the
   * same kind of read: one press, of a filed evidence document. `applicationRoadTestCopy.ts` says why
   * it can only ever be the certificate and never the form beside it.
   *
   * `no_certificate` is a 409 for `not_submitted`'s reason: the link is good and the answer is "not
   * yet" (or "not on this link" — a hand-recorded test is the office's to hand over).
   */
  router.get(
    "/:token/road-test-certificate",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicantRoadTestCertificate(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(result)) {
        const status = result.code === "invalid_link" ? 404 : result.code === "no_certificate" ? 409 : 503;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * The packet the driver is about to sign, before they sign it (C1).
   *
   * ⚠ **The tenth route, and the only part of C1 with no code behind it.** The five geometry modules
   * and the renderer all existed; what did not exist was any way for an applicant to READ the
   * document. `applicationReadingCopy.ts` carries the argument for why the token is enough and what
   * still bounds it.
   *
   * ⚠ **Bytes, not a URL, and the one place this surface departs from `compliance.ts`'s idiom.**
   * There is no object to sign a URL to: this document is rendered on demand from the draft and
   * deliberately never stored, because an unsigned uncited copy of a §391.51(b)(1) record sitting in
   * Storage beside the filed one is the state the route above refuses to create.
   *
   * ⚠ **One request for the whole document, and the viewer must keep it that way** (A0b). The
   * ceremony's own bucket covers `POST /:token/mark` only — 60 per minute, keyed per link — and
   * everything else on this prefix falls to the intake bucket at **20 per minute per address**. A
   * page-by-page fetch of a thirty-one-page document would blow that budget on the first scroll and
   * the driver would be told their link was invalid. The client fetches these bytes ONCE and renders
   * every page from them.
   *
   * `409` for a filed application: the link is perfectly good and the answer is "that document is
   * finished, and it is one route up".
   */
  router.get(
    "/:token/packet",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicantReadingCopy(admin, String(req.params.token ?? ""), new Date());
      if (isIntakeError(result)) {
        const status = result.code === "invalid_link" ? 404 : 409;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      // ⚠ `inline`, not `attachment`. The driver is reading this on the page they are signing on;
      // a download prompt in the middle of a ceremony is how somebody loses their place.
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${result.filename}"`);
      // ⚠ Never cached by anything in between. The mark count changes with every stop the driver
      // completes, so a cached copy would show a returning driver a page with fewer signatures on
      // it than the paper actually has — and it is somebody's employment history in any case.
      res.setHeader("cache-control", "no-store, private");
      res.setHeader("x-packet-marks", String(result.markCount));
      res.send(result.pdf);
    }),
  );

  /**
   * One permission, unsigned, as the applicant is about to sign it (AF6, D-AF2).
   *
   * ⚠ **Bytes, for `/:token/packet`'s reason**: rendered on demand from the carrier's wording and never
   * stored. ⚠ And on the CEREMONY's bucket, not the intake's (`applicationLimits.ts`): five of these
   * plus the page's own reads would crowd 20 a minute on the screen where somebody is signing.
   *
   * `/<purpose>.pdf` rather than `/<purpose>`, so the address says what it returns. A purpose that is
   * not one of the five is 404, like a link that is not one.
   */
  router.get(
    "/:token/permission/:file",
    asyncHandler(async (req, res) => {
      const file = /^([a-z_]+)\.pdf$/.exec(String(req.params.file ?? ""));
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await applicantPermissionInstrument(
        admin, String(req.params.token ?? ""), file?.[1] ?? "", new Date(),
      );
      if (isIntakeError(result)) {
        const status = result.code === "invalid_link" || result.code === "not_a_permission" ? 404 : 409;
        res.status(status).json(apiError(result.code, result.message));
        return;
      }
      res.setHeader("content-type", "application/pdf");
      res.setHeader("content-disposition", `inline; filename="${result.filename}"`);
      res.setHeader("cache-control", "no-store, private");
      res.send(result.pdf);
    }),
  );

  return router;
}
