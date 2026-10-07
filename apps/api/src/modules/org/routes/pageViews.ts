import { Router } from "express";
import {
  acceptedPageViewKeys,
  organizationTimezone,
  pageViewsRecordSchema,
  todayInZone,
  type PageViewsRecordRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";

/**
 * The page-view count's one writer — `surface_page_views` via `record_surface_views` (0435), product
 * readiness X1 (Q-PR4). The contract and what is deliberately NOT sent live in
 * `packages/shared/src/pageViewsContract.ts`.
 *
 * ── NO ROLE GATE, AND NO AUDIT ROW ──────────────────────────────────────────────────────────────
 * Every signed-in member may report what they opened: the count is about the screen, and a screen
 * they could not open never reaches the router hook that queues it. An audit row per batch would put
 * a person back beside every view, which is the thing X1 was ruled to leave out.
 *
 * ── WHAT THE SERVER SUPPLIES ────────────────────────────────────────────────────────────────────
 *   • the ROLE, from the verified token (`req.auth.role`) — never from the body;
 *   • the DAY, as the org's calendar day (`todayInZone` over `operating_hours`), so "used on Monday"
 *     is the office's Monday;
 *   • the ORG, from the token, passed to the function explicitly because the service role bypasses RLS.
 *
 * A caller can still inflate its own role's count by posting repeatedly. That is accepted: the
 * question is "is anybody reading this screen", and the batch cap bounds what one request adds.
 */
export function pageViewsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.use(requireOrg);

  router.post(
    "/",
    validateBody(pageViewsRecordSchema),
    asyncHandler(async (req, res) => {
      const { keys } = res.locals.body as PageViewsRecordRequest;
      const accepted = acceptedPageViewKeys(keys);
      const role = req.auth!.role;
      if (accepted.length === 0 || !role) {
        res.status(204).end();
        return;
      }

      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { data: org } = await admin
        .from("organizations")
        .select("operating_hours")
        .eq("id", orgId)
        .maybeSingle();
      const day = todayInZone(new Date(), organizationTimezone(org?.operating_hours));

      const { error } = await admin.rpc("record_surface_views", {
        p_org: orgId,
        p_day: day,
        p_role: role,
        p_keys: accepted,
      });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not record page views"));
        return;
      }
      res.status(204).end();
    }),
  );

  return router;
}
