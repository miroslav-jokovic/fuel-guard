import type { Router } from "express";
import { lumperSweepPayloadSchema } from "@silvicom/shared";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { ingestLumperSweep } from "../lumperIngest.js";
import { addUnknownDispatchers } from "../tmsDispatcherIngest.js";

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
      // The orders' dispatchers the roster has never carried (`roman`, `jake`), so their cases can be
      // linked to a person. After the sweep, and never failing it: the sweep is already recorded, and a
      // login missed here is offered again by the next hourly sweep.
      let dispatchersAdded = 0;
      try {
        dispatchersAdded = await addUnknownDispatchers(admin, req.tms!.orgId, req.tms!.provider,
          parsed.data.orders.map((o) => ({ external_id: o.dispatcher_user_id, display_name: o.dispatcher_name })));
      } catch (e) {
        console.error(`[lumper] org ${req.tms!.orgId}: dispatchers not added — ${e instanceof Error ? e.message : String(e)}`);
      }
      res.json({ ok: true, ...result, dispatchersAdded });
    }),
  );
}
