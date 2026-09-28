import { Router } from "express";
import { applicationScreenEventsSchema, type ApplicationScreenEvents } from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { screenEventsLimiter } from "../../../middleware/applicationLimits.js";
import { isIntakeError } from "../applicationIntake.js";
import { recordScreenEvents } from "../applicationScreenEvents.js";

/**
 * Which screens the applicant's page showed, and for how long (AW14, C3d3a) — the report
 * `useScreenEvents.ts` sends about once a minute, when the phone is put away, and when the page closes.
 *
 * Its own module because `publicApplication.ts` is a router of routers at its size, and its own rate
 * budget (`screenEventsLimiter`) because a report counted against the intake's 20 a minute would be
 * telemetry taking requests from autosave.
 *
 * A dead link is the one `invalid_link`, as everywhere on this surface, and the page stops reporting
 * on it. The answer carries counts only: the page does not need them, and a report sent as the page
 * closes is never read.
 */
export function publicApplicationScreenEventsRouter(): Router {
  const router = Router();

  router.post(
    "/:token/screen-events",
    screenEventsLimiter(),
    validateBody(applicationScreenEventsSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await recordScreenEvents(
        admin, String(req.params.token ?? ""), res.locals.body as ApplicationScreenEvents, new Date(),
      );
      if (isIntakeError(result)) {
        res.status(404).json(apiError(result.code, result.message));
        return;
      }
      res.json({ ok: true, inserted: result.inserted, closed: result.closed });
    }),
  );

  return router;
}
