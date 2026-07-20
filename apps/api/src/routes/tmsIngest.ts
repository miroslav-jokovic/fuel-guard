import { Router, json } from "express";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { tmsMovementsPayloadSchema, driverTimeOffPayloadSchema } from "@fuelguard/shared";
import { orgForIngestToken, ingestMovements, ingestDriverTimeOff, touchLastSynced } from "../services/tmsIngest.js";

/**
 * Inbound TMS ingest from the on-prem sync agent. NO user auth — authenticated by the org's ingest token
 * (`Authorization: Bearer <token>`), matched by HASH to an ENABLED org_integrations row. Mounted with its own
 * body parser (larger limit, for ≤1000-row batches) BEFORE the global 1 MB JSON parser so batches aren't
 * rejected and the browser API's parsing rules don't apply here.
 */
export function tmsIngestRouter(): Router {
  const router = Router();
  router.use(json({ limit: "8mb" }));

  // Authenticate every request by ingest token → org. One generic 401 (no token vs bad token are
  // indistinguishable) so the endpoint leaks nothing about which tokens exist.
  router.use(
    asyncHandler(async (req, res, next) => {
      const header = req.header("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      // Reject a missing token up front — no DB/client work for the unauthenticated path.
      if (!token) {
        res.status(401).json(apiError("unauthorized", "Invalid ingest token"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const owner = await orgForIngestToken(admin, token);
      if (!owner) {
        res.status(401).json(apiError("unauthorized", "Invalid ingest token"));
        return;
      }
      req.tms = owner;
      next();
    }),
  );

  router.post(
    "/movements",
    asyncHandler(async (req, res) => {
      const parsed = tmsMovementsPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "invalid payload"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { orgId, provider } = req.tms!;
      const result = await ingestMovements(admin, orgId, provider, parsed.data.movements);
      await touchLastSynced(admin, orgId, provider);
      res.json({ ok: true, ...result });
    }),
  );

  router.post(
    "/driver-time",
    asyncHandler(async (req, res) => {
      const parsed = driverTimeOffPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "invalid payload"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { orgId, provider } = req.tms!;
      const result = await ingestDriverTimeOff(admin, orgId, provider, parsed.data.windows);
      await touchLastSynced(admin, orgId, provider);
      res.json({ ok: true, ...result });
    }),
  );

  return router;
}
