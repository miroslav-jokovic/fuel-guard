import type { Router } from "express";
import { tmsSettlementsPayloadSchema, tmsApVouchersPayloadSchema, tmsBillingPayloadSchema } from "@silvicom/shared";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { ingestSettlements, ingestApVouchers, ingestBilling } from "../financialIngest.js";

/**
 * Financial staging endpoints for the on-prem agent (P3.2). Registered INSIDE tmsIngestRouter,
 * so they sit behind the same ingest-token middleware and body limits as the roster/movement
 * sweeps — the agent authenticates once, the same way, for everything it sends. Two endpoints
 * rather than one because the payloads have different shapes and a partial failure should
 * strand one domain, not both (the roster endpoints' argument, unchanged).
 */
export function registerTmsFinancialRoutes(router: Router): void {
  router.post(
    "/settlements",
    asyncHandler(async (req, res) => {
      const parsed = tmsSettlementsPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", `Invalid settlements payload: ${parsed.error.issues[0]?.message ?? "unreadable"}`));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await ingestSettlements(admin, req.tms!.orgId, parsed.data);
      res.json({ ok: true, ...result });
    }),
  );

  router.post(
    "/vouchers",
    asyncHandler(async (req, res) => {
      const parsed = tmsApVouchersPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", `Invalid vouchers payload: ${parsed.error.issues[0]?.message ?? "unreadable"}`));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await ingestApVouchers(admin, req.tms!.orgId, parsed.data);
      res.json({ ok: true, ...result });
    }),
  );

  router.post(
    "/billing",
    asyncHandler(async (req, res) => {
      const parsed = tmsBillingPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", `Invalid billing payload: ${parsed.error.issues[0]?.message ?? "unreadable"}`));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await ingestBilling(admin, req.tms!.orgId, parsed.data);
      res.json({ ok: true, ...result });
    }),
  );
}
