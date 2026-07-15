import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { planFuelRoute, type PlanRequest } from "../services/fuelPlanning.js";
import { geocodeSuggest } from "../services/geocode.js";
import { ingestPilotPrices } from "../services/pilotPriceIngest.js";
import { fetchVehicleCurrentGps } from "../lib/samsara.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { hereReverseGeocode } from "../lib/hereGeocode.js";

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

  // Load a Pilot daily price report (client decodes the .xls to a cell grid; we parse + geocode + upsert).
  router.post(
    "/prices",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const grid = (req.body as { grid?: unknown[] })?.grid;
      if (!Array.isArray(grid)) {
        res.status(400).json(apiError("bad_request", "Expected { grid: Cell[][] } from the decoded report."));
        return;
      }
      const result = await ingestPilotPrices(admin, env, req.auth!.orgId!, grid as (string | number | null)[][]);
      if (!result.ok) {
        res.status(422).json(apiError("ingest_failed", result.error ?? "Could not ingest the report"));
        return;
      }
      res.json(result);
    }),
  );

  // Current GPS of the selected vehicle from Samsara, reverse-geocoded — used to prefill the plan Start.
  router.get(
    "/vehicle-location",
    requireOrg,
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

  // All loaded truck stops + their current net/posted price (latest per station), with staleness vs the
  // org price-freshness window. Read-only listing for the Truck Stops page.
  router.get(
    "/stations",
    requireOrg,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      const { data: settingsRow } = await admin.from("route_fuel_settings").select("price_ttl_hours").eq("org_id", orgId).maybeSingle();
      const ttlHours = settingsRow?.price_ttl_hours != null ? Number(settingsRow.price_ttl_hours) : 30;

      // Latest diesel price per station (paginate — a single select is capped at 1000 rows).
      const latest = new Map<string, { net: number | null; posted: number | null; at: string }>();
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("fuel_prices")
          .select("station_id, net_price, posted_price, observed_at")
          .eq("org_id", orgId).eq("product", "diesel")
          .order("observed_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) { res.status(500).json(apiError("db_error", error.message)); return; }
        for (const p of (data ?? []) as Array<{ station_id: string; net_price: number | string | null; posted_price: number | string | null; observed_at: string }>) {
          if (!latest.has(p.station_id)) latest.set(p.station_id, { net: p.net_price != null ? Number(p.net_price) : null, posted: p.posted_price != null ? Number(p.posted_price) : null, at: p.observed_at });
        }
        if (!data || data.length < PAGE) break;
      }

      const stationIds = [...latest.keys()];
      const stations: Record<string, unknown>[] = [];
      const now = Date.now();
      for (let i = 0; i < stationIds.length; i += 200) {
        const part = stationIds.slice(i, i + 200);
        const { data } = await admin.from("fuel_stations").select("id, brand, store_number, name, state, lat, lng, exit").in("id", part);
        for (const st of (data ?? []) as Array<{ id: string; brand: string; store_number: string | null; name: string | null; state: string | null; lat: number | string; lng: number | string; exit: string | null }>) {
          const pr = latest.get(st.id)!;
          const ageHours = Math.round((now - Date.parse(pr.at)) / 3_600_000);
          stations.push({ id: st.id, brand: st.brand, storeNumber: st.store_number, name: st.name, state: st.state, lat: Number(st.lat), lng: Number(st.lng), exit: st.exit, netPrice: pr.net, postedPrice: pr.posted, observedAt: pr.at, ageHours, stale: ageHours > ttlHours });
        }
      }
      stations.sort((a, b) => String(a.state).localeCompare(String(b.state)) || String(a.name).localeCompare(String(b.name)));
      res.json({ stations, ttlHours });
    }),
  );

  return router;
}
