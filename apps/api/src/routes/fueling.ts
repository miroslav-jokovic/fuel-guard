import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { planFuelRoute, type PlanRequest } from "../services/fuelPlanning.js";
import { saveFuelPlanHistory } from "../services/fuelPlanHistory.js";
import { resolveEffectivePrice, median, DEFAULT_PRICE_LOOKBACK_HOURS, type DiscountRule } from "@fuelguard/shared";

// Validate + bound the plan request (security: reject malformed/oversized input before any Samsara/HERE work).
const planPointSchema = z.object({ lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), text: z.string().max(300).nullable().optional() });
const planBodySchema = z.object({
  vehicleId: z.string().min(1).max(64),
  origin: planPointSchema,
  destination: planPointSchema,
  waypoints: z.array(planPointSchema).max(12).optional(),
  loadGrossLb: z.number().min(0).max(200000).nullable().optional(),
  equipmentType: z.string().max(32).nullable().optional(),
  hazmat: z.array(z.string().max(32)).max(11).optional(),
  tunnelCategory: z.string().max(4).nullable().optional(),
  avoidTunnels: z.boolean().nullable().optional(),
  originLabel: z.string().max(300).nullable().optional(),
  destinationLabel: z.string().max(300).nullable().optional(),
  manualFuelPct: z.number().min(0).max(100).nullable().optional(),
  manualHos: z.object({
    driveHours: z.number().min(0).max(24).nullable().optional(),
    breakHours: z.number().min(0).max(24).nullable().optional(),
    shiftHours: z.number().min(0).max(24).nullable().optional(),
    cycleHours: z.number().min(0).max(120).nullable().optional(),
  }).nullable().optional(),
});
import { geocodeSuggest } from "../services/geocode.js";
import { ingestPilotPrices } from "../services/pilotPriceIngest.js";
import { ingestPilotLocations } from "../services/pilotLocationsIngest.js";
import { ingestPostedPrices } from "../services/postedPriceIngest.js";
import { gatePostedBatch, runPostedPriceFetch, POSTED_SOURCE_XLSX } from "../services/postedPriceFetch.js";
import { runKwikTripSync } from "../services/kwikTripIngest.js";
import { runRoadRangerFetch } from "../services/roadRangerIngest.js";
import { ingestLovesExport } from "../services/lovesIngest.js";
import { runLovesApiSync } from "../services/lovesApiClient.js";
import { parsePilotPublicPricesXlsx } from "@fuelguard/shared";
import { fetchVehicleCurrentGps } from "../lib/samsara.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { hereReverseGeocode } from "../lib/hereGeocode.js";

/** Add a truck-stop network to the org's enabled_brands so freshly loaded/synced stations show up on the
 *  Truck Stops page (and its network filter) immediately, instead of staying hidden until an admin toggles
 *  it on in Fuel Planning settings. Idempotent — a no-op when the brand is already enabled. */
async function enableNetworkForOrg(admin: ReturnType<typeof getSupabaseAdmin>, orgId: string, brand: string): Promise<void> {
  const { data } = await admin.from("route_fuel_settings").select("enabled_brands").eq("org_id", orgId).maybeSingle();
  const current =
    Array.isArray(data?.enabled_brands) && data.enabled_brands.length
      ? (data.enabled_brands as string[])
      : ["pilot", "flying_j", "one9"];
  if (current.includes(brand)) return;
  await admin
    .from("route_fuel_settings")
    .upsert({ org_id: orgId, enabled_brands: [...current, brand], updated_at: new Date().toISOString() }, { onConflict: "org_id" });
}

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
      const parsed = planBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid plan request"));
        return;
      }
      const result = await planFuelRoute(admin, env, orgId, parsed.data as PlanRequest);
      // Save to history (best-effort — never fail the plan response on a history write).
      try { await saveFuelPlanHistory(admin, orgId, req.auth!.userId ?? null, parsed.data as PlanRequest, result); } catch { /* ignore */ }
      res.json(result);
    }),
  );
  // Planned-route history — the plans this org has generated, newest first, with the creator + summary data.
  router.get(
    "/plans",
    requireOrg,
    requireRole("admin", "fleet_manager", "auditor"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { data } = await admin.from("fuel_plans")
        .select("id, created_at, created_by_label, unit_number, origin_label, destination_label, distance_miles, duration_hours, status, stop_count, total_gallons, total_cost, arrival_fuel_pct")
        .eq("org_id", orgId).order("created_at", { ascending: false }).limit(200);
      res.json({ plans: data ?? [] });
    }),
  );
  // Delete one saved plan from history. Org-scoped via the service-role client (auditor is read-only, so
  // deletion is limited to the roles that can generate plans). Idempotent — deleting a missing id is a no-op.
  router.delete(
    "/plans/:id",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      if (!id) {
        res.status(400).json(apiError("bad_request", "Missing plan id"));
        return;
      }
      const { error } = await admin.from("fuel_plans").delete().eq("org_id", orgId).eq("id", id);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not delete the plan"));
        return;
      }
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "fuel_plan.deleted", entity: "fuel_plans", entityId: id });
      res.json({ ok: true });
    }),
  );
  // Bulk-delete saved plans from history (multi-select). One org-scoped `in (...)` delete, capped to match the
  // history page size so a malformed/oversized body can't fan out into a huge statement.
  router.post(
    "/plans/delete",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const parsed = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Expected { ids: string[] } with 1–200 ids"));
        return;
      }
      const ids = parsed.data.ids;
      const { error } = await admin.from("fuel_plans").delete().eq("org_id", orgId).in("id", ids);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not delete the selected plans"));
        return;
      }
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "fuel_plan.bulk_deleted", entity: "fuel_plans", entityId: ids.join(","), meta: { count: ids.length } });
      res.json({ ok: true, deleted: ids.length });
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

  // Load the Pilot "Download All Locations" export (exact coordinates for the whole family) into the
  // GLOBAL station registry. Admin-only: it rewrites shared reference data (brands, precise coords).
  router.post(
    "/locations",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const grid = (req.body as { grid?: unknown[] })?.grid;
      if (!Array.isArray(grid)) {
        res.status(400).json(apiError("bad_request", "Expected { grid: Cell[][] } from the decoded export."));
        return;
      }
      const result = await ingestPilotLocations(admin, grid as (string | number | null)[][]);
      if (!result.ok) {
        res.status(422).json(apiError("ingest_failed", result.error ?? "Could not ingest the locations export"));
        return;
      }
      res.json(result);
    }),
  );

  // Load the public "Download Fuel Prices" .xlsx (network-wide POSTED prices — the global layer).
  // Gated exactly like the automated page fetch: completeness floor + diesel-median sanity band.
  router.post(
    "/posted-prices",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const grid = (req.body as { grid?: unknown[] })?.grid;
      if (!Array.isArray(grid)) {
        res.status(400).json(apiError("bad_request", "Expected { grid: Cell[][] } from the decoded file."));
        return;
      }
      const parsed = parsePilotPublicPricesXlsx(grid as (string | number | null)[][]);
      if (!parsed.headerFound) {
        res.status(422).json(apiError("ingest_failed", "Unrecognized file — expected the public 'Download Fuel Prices' export."));
        return;
      }
      const dieselUsd = parsed.rows.filter((r) => r.product === "diesel" && r.currency === "USD").map((r) => r.price);
      const gateError = gatePostedBatch(parsed.stationRows, dieselUsd, 700);
      if (gateError) {
        res.status(422).json(apiError("ingest_failed", gateError));
        return;
      }
      const result = await ingestPostedPrices(admin, parsed.rows, {
        source: POSTED_SOURCE_XLSX, observedAt: new Date().toISOString(),
        stationRows: parsed.stationRows, skipped: parsed.skipped,
      });
      if (!result.ok) {
        res.status(422).json(apiError("ingest_failed", result.error ?? "Could not ingest the posted prices"));
        return;
      }
      res.json(result);
    }),
  );

  // Manually trigger the automated posted-price page fetch (same gates as the scheduler) — lets an
  // admin refresh now and SEE the result instead of waiting for the next tick.
  router.post(
    "/posted-prices/fetch",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const result = await runPostedPriceFetch(admin, env);
      if (!result.ok) {
        res.status(422).json(apiError("fetch_failed", result.error ?? "Posted-price fetch failed"));
        return;
      }
      res.json(result);
    }),
  );

  // Sync the Kwik Trip / Kwik Star network into the registry (official truck-friendly stores only —
  // parse + completeness gates refuse a partial table). Admin-only; safe to re-run any time.
  router.post(
    "/networks/kwiktrip/sync",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const result = await runKwikTripSync(admin, env);
      if (!result.ok) {
        res.status(422).json(apiError("sync_failed", result.error ?? "Kwik Trip sync failed"));
        return;
      }
      await enableNetworkForOrg(admin, req.auth!.orgId!, "kwik_trip");
      res.json(result);
    }),
  );

  // Fetch Road Ranger stations + today's truck-diesel CASH prices now (same gates as the scheduler).
  router.post(
    "/networks/roadranger/fetch",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const result = await runRoadRangerFetch(admin, env);
      if (!result.ok) {
        res.status(422).json(apiError("fetch_failed", result.error ?? "Road Ranger fetch failed"));
        return;
      }
      await enableNetworkForOrg(admin, req.auth!.orgId!, "road_ranger");
      res.json(result);
    }),
  );

  // Load the Love's "Search Results" .xlsx export — the whole network's exact locations + current posted
  // diesel/DEF prices in one file. Admin-only; Love's has its own store-number space (never the Pilot family).
  router.post(
    "/networks/loves/import",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const grid = (req.body as { grid?: unknown[] })?.grid;
      if (!Array.isArray(grid)) {
        res.status(400).json(apiError("bad_request", "Expected { grid: Cell[][] } from the decoded file."));
        return;
      }
      const result = await ingestLovesExport(admin, grid as (string | number | null)[][]);
      if (!result.ok) {
        res.status(422).json(apiError("ingest_failed", result.error ?? "Could not ingest the Love's export"));
        return;
      }
      await enableNetworkForOrg(admin, req.auth!.orgId!, "loves");
      res.json(result);
    }),
  );

  // Live Love's Store & Fuel Prices API sync (OAuth). Returns a clear "not configured" message until
  // credentials + product codes are set, so it is safe to wire a button now.
  router.post(
    "/networks/loves/sync",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const result = await runLovesApiSync(admin, env);
      if (!result.ok) {
        res.status(422).json(apiError("sync_failed", result.error ?? "Love's API sync failed"));
        return;
      }
      await enableNetworkForOrg(admin, req.auth!.orgId!, "loves");
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

  // All registry truck stops in the org's ENABLED networks + the diesel price planning would use for
  // each (fresh tenant net → posted−rule → history → brand median → none), with staleness vs the org
  // price-freshness window. Read-only listing for the Truck Stops page.
  router.get(
    "/stations",
    requireOrg,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      const { data: settingsRow } = await admin
        .from("route_fuel_settings").select("price_ttl_hours, enabled_brands").eq("org_id", orgId).maybeSingle();
      const ttlHours = settingsRow?.price_ttl_hours != null ? Number(settingsRow.price_ttl_hours) : 72;
      const enabledBrands: string[] =
        Array.isArray(settingsRow?.enabled_brands) && settingsRow.enabled_brands.length
          ? (settingsRow.enabled_brands as string[])
          : ["pilot", "flying_j", "one9"];

      const now = Date.now();
      const lookbackHours = DEFAULT_PRICE_LOOKBACK_HOURS;
      const cutoffMs = now - lookbackHours * 3_600_000;
      const SAMPLE_CAP = 40; // recent samples kept per station for the estimate (bounds memory)

      // Latest diesel price per station + a bounded recent-history window for estimating stale/missing prices.
      const latest = new Map<string, { net: number | null; posted: number | null; at: string }>();
      const samples = new Map<string, { net: number | null; observedAtMs: number }[]>();
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
          const net = p.net_price != null ? Number(p.net_price) : null;
          const atMs = Date.parse(p.observed_at);
          if (!latest.has(p.station_id)) latest.set(p.station_id, { net, posted: p.posted_price != null ? Number(p.posted_price) : null, at: p.observed_at });
          if (atMs >= cutoffMs) {
            const arr = samples.get(p.station_id) ?? samples.set(p.station_id, []).get(p.station_id)!;
            if (arr.length < SAMPLE_CAP) arr.push({ net, observedAtMs: atMs });
          }
        }
        if (!data || data.length < PAGE) break;
      }

      // The full registry for the enabled networks (not just tenant-priced stations — a station with
      // only a posted price must appear, with its effective planning price).
      type StMeta = { id: string; brand: string; store_number: string | null; name: string | null; state: string | null; city: string | null; lat: number | string; lng: number | string; exit: string | null; coord_source: string | null };
      const meta = new Map<string, StMeta>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("fuel_stations")
          .select("id, brand, store_number, name, state, city, lat, lng, exit, coord_source")
          .eq("status", "active").in("brand", enabledBrands)
          .range(from, from + PAGE - 1);
        if (error) { res.status(500).json(apiError("db_error", error.message)); return; }
        for (const st of (data ?? []) as StMeta[]) meta.set(st.id, st);
        if (!data || data.length < PAGE) break;
      }

      // Latest posted diesel quote per station (global layer) within the lookback.
      const posted = new Map<string, { price: number; currency: string; unit: string; at: string }>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from("fuel_prices_posted").select("station_id, price, currency, unit, observed_at")
          .eq("product", "diesel").gte("observed_at", new Date(cutoffMs).toISOString())
          .order("observed_at", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) { res.status(500).json(apiError("db_error", error.message)); return; }
        for (const p of (data ?? []) as Array<{ station_id: string; price: number | string; currency: string; unit: string; observed_at: string }>) {
          if (!posted.has(p.station_id)) posted.set(p.station_id, { price: Number(p.price), currency: p.currency, unit: p.unit, at: p.observed_at });
        }
        if (!data || data.length < PAGE) break;
      }

      const { data: ruleRows } = await admin.from("fuel_discount_rules").select("brand, type, cents_off").eq("org_id", orgId);
      const ruleByBrand = new Map<string, DiscountRule>(
        ((ruleRows ?? []) as Array<{ brand: string; type: DiscountRule["type"]; cents_off: number | string }>).map((r) => [
          r.brand, { brand: r.brand, type: r.type, centsOff: Number(r.cents_off) },
        ]),
      );

      // Brand medians (fresh tenant quotes only) — the fallback when a station has no usable history.
      const freshByBrand = new Map<string, number[]>();
      for (const [id, pr] of latest) {
        const m = meta.get(id);
        if (m && pr.net != null && (now - Date.parse(pr.at)) / 3_600_000 <= ttlHours)
          (freshByBrand.get(m.brand) ?? freshByBrand.set(m.brand, []).get(m.brand)!).push(pr.net);
      }

      const stations: Record<string, unknown>[] = [];
      for (const [id, st] of meta) {
        const pr = latest.get(id) ?? null;
        const po = posted.get(id) ?? null;
        const est = resolveEffectivePrice({
          tenantSamples: samples.get(id) ?? [],
          posted: po ? { price: po.price, currency: po.currency, unit: po.unit, observedAtMs: Date.parse(po.at) } : null,
          discountRule: ruleByBrand.get(st.brand) ?? null,
          brandMedian: median(freshByBrand.get(st.brand) ?? []),
          nowMs: now, ttlHours, lookbackHours,
        });
        // Freshness reflects the quote the effective price is actually based on.
        const basisAt = est.basis === "posted_discount" ? (po?.at ?? null) : (pr?.at ?? null);
        const ageHours = basisAt != null ? Math.round((now - Date.parse(basisAt)) / 3_600_000) : null;
        stations.push({
          id, brand: st.brand, storeNumber: st.store_number, name: st.name, state: st.state, city: st.city,
          lat: Number(st.lat), lng: Number(st.lng), exit: st.exit, coordSource: st.coord_source ?? "geocoded_city",
          netPrice: est.net, priceEstimated: est.estimated, priceConfidence: est.estimated ? est.confidence : null,
          priceBasis: est.basis,
          // Prefer the global posted layer (USD/gal); until that's populated (waiting on chain feeds),
          // fall back to the retail price the daily email already carries so the column isn't blank.
          postedPrice:
            po && po.currency === "USD" && po.unit === "gal"
              ? po.price
              : (pr?.posted ?? null),
          observedAt: basisAt, ageHours, stale: ageHours != null && ageHours > ttlHours,
        });
      }
      stations.sort((a, b) => String(a.state).localeCompare(String(b.state)) || String(a.name).localeCompare(String(b.name)));
      res.json({ stations, ttlHours });
    }),
  );

  return router;
}
