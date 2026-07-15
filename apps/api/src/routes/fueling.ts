import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { planFuelRoute, type PlanRequest } from "../services/fuelPlanning.js";
import { geocodeSuggest } from "../services/geocode.js";

export function fuelingRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // On-demand smart-fuel plan for one truck + route. Read-only (no Samsara write-back).
  router.post(
    "/plan",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const body = req.body as PlanRequest;
      if (!body?.vehicleId || !body.origin || !body.destination) {
        res.status(400).json(apiError("bad_request", "vehicleId, origin and destination are required"));
        return;
      }
      const result = await planFuelRoute(admin, env, orgId, body);
      res.json(result);
    }),
  );

  // Address autocomplete for the dispatcher form (server-proxied geocoder — no key/rate exposure to the browser).
  router.get(
    "/geocode-suggest",
    requireOrg,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const q = String(req.query.q ?? "");
      res.json({ suggestions: await geocodeSuggest(env, q) });
    }),
  );

  return router;
}
