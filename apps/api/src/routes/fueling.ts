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

  // Tells the client whether an interactive HERE tile map is available (key present) or it should keep the
  // dependency-free SVG route preview. Cheap, org-agnostic.
  router.get(
    "/map-config",
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      res.json({ tilesEnabled: Boolean(env.HERE_API_KEY) });
    }),
  );

  // HERE raster-tile proxy: the browser map requests /api/fueling/map-tiles/{z}/{x}/{y} and we attach the
  // HERE key server-side, so the key is never shipped to the client (same privacy posture as the geocoder).
  // Authenticated (same-origin cookie) so the proxy is not an open tile relay against our HERE quota.
  router.get(
    "/map-tiles/:z/:x/:y",
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      if (!env.HERE_API_KEY) {
        res.status(404).json(apiError("tiles_unavailable", "HERE tiles are not configured"));
        return;
      }
      const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > 20 || x < 0 || y < 0) {
        res.status(400).json(apiError("bad_request", "invalid tile coordinate"));
        return;
      }
      const url =
        `https://maps.hereapi.com/v3/base/mc/${z}/${x}/${y}/png?style=explore.day&size=512` +
        `&apiKey=${encodeURIComponent(env.HERE_API_KEY)}`;
      try {
        const upstream = await fetch(url);
        if (!upstream.ok) {
          res.status(502).json(apiError("tile_upstream_error", `HERE tile HTTP ${upstream.status}`));
          return;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(buf);
      } catch (e) {
        res.status(502).json(apiError("tile_upstream_error", e instanceof Error ? e.message : "tile fetch failed"));
      }
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
