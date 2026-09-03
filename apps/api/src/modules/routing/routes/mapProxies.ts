import type { Router } from "express";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { geocodeSuggest } from "../geocode.js";
import { fetchVehicleCurrentGps } from "../../samsara/lib/samsara.js";
import { loadSamsaraToken } from "../../samsara/lib/samsaraToken.js";
import { hereReverseGeocode } from "../../../lib/hereGeocode.js";

/** Map + geocoding proxies: keep the HERE key / vendor rate server-side, never in the browser. */
export function registerMapRoutes(router: Router): void {
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

  /**
   * Address autocomplete for the dispatcher form (server-proxied geocoder — no key/rate exposure to
   * the browser).
   *
   * ⚠ S7 added the section gate, and it is a NARROWING said out loud rather than slipped in: this
   * was `requireOrg` alone, so any signed-in member could type an address into the org's geocoder
   * quota. The two callers are Fuel Planning and Truck Stops (`useFuelPlan.ts`), both catalogued
   * `dispatch`, and since S2's guard no role without `dispatch: view` can open either — so nothing
   * a person can reach today stops working. `view` and not `manage` because reading a suggestion is
   * not planning a route.
   */
  router.get(
    "/geocode-suggest",
    requireOrg,
    requireSection("dispatch", "view"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const q = String(req.query.q ?? "");
      res.json({ suggestions: await geocodeSuggest(env, q) });
    }),
  );

  // Current GPS of the selected vehicle from Samsara, reverse-geocoded — used to prefill the plan
  // Start. Gated with the rest of the planning surface by S7; it names a truck's live position,
  // which is the most specific thing this file returns.
  router.get(
    "/vehicle-location",
    requireOrg,
    requireSection("dispatch", "view"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const vehicleId = String(req.query.vehicleId ?? "");
      if (!vehicleId) {
        res.status(400).json(apiError("bad_request", "vehicleId is required"));
        return;
      }
      const { data: veh } = await admin.from("vehicles").select("samsara_vehicle_id").eq("id", vehicleId).eq("org_id", orgId).maybeSingle();
      if (!veh?.samsara_vehicle_id) {
        res.status(404).json(apiError("no_telematics", "This truck is not linked to Samsara."));
        return;
      }
      const token = await loadSamsaraToken(admin, env, orgId);
      if (!token) {
        res.status(422).json(apiError("no_telematics", "Samsara is not connected."));
        return;
      }
      const gps = await fetchVehicleCurrentGps(env, token, String(veh.samsara_vehicle_id));
      if (!gps) {
        res.status(404).json(apiError("no_fix", "No current GPS fix for this truck."));
        return;
      }
      const label = await hereReverseGeocode(env, gps.lat, gps.lng);
      res.json({ lat: gps.lat, lng: gps.lng, time: gps.time, label });
    }),
  );
}
