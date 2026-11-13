import type { Router } from "express";
import { lumperSweepPayloadSchema } from "@silvicom/shared";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { ingestLumperSweep } from "../lumperIngest.js";

/**
 * `POST /api/tms/lumper` — one lumper sweep from the connector (LUMPER-REVISED-RC-PLAN.md LRC2).
 * Registered inside `tmsIngestRouter`, behind the same ingest token and body limit as every other
 * feed. Its own file because `tmsIngest.ts` is near its line budget.
 *
 * It does not touch the roster's "last synced" stamp: the sweep records its own time in
 * `mcleod_lumper_sweeps`, which is what the lumper page and its reminder read.
 */
export function registerTmsLumperRoutes(router: Router): void {
  router.post(
    "/lumper",
    asyncHandler(async (req, res) => {
      const parsed = lumperSweepPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        res.status(400).json(apiError("invalid_payload", issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid payload"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await ingestLumperSweep(admin, req.tms!.orgId, parsed.data);
      res.json({ ok: true, ...result });
    }),
  );
}
