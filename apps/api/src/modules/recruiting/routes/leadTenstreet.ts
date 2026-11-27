import { Router } from "express";
import { recordId } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readLeadTenstreetPost } from "../tenstreet/leadPost.js";

/**
 * `GET /leads/:leadId/tenstreet` — the lead drawer's "From Tenstreet" section (TENSTREET-INTAKE-PLAN TS5): the newest
 * post that became this lead, cut to the drawer's view (`tenstreetDrawerView`). `recruitment` view, the lead read's own
 * gate: whoever may open the lead may read what Tenstreet sent with it. `{ post: null }` when there is none (another
 * channel's lead, a purged one, a post not processed yet).
 */
export function recruitmentLeadTenstreetRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get(
    "/leads/:leadId/tenstreet",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req, res) => {
      const leadId = String(req.params.leadId ?? "");
      if (!recordId().safeParse(leadId).success) {
        res.status(404).json(apiError("not_found", "Lead not found"));
        return;
      }
      const env = getAppLocals(req).env;
      const out = await readLeadTenstreetPost(getSupabaseAdmin(env), env, req.auth!.orgId!, leadId);
      if (!out.ok) {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      res.set("Cache-Control", "no-store");
      res.json({ post: out.post });
    }),
  );
  return router;
}
