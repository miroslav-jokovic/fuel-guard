import type { Router } from "express";
import { resolveBasemapStyle, resolveBasemapFormat } from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { geocodeSuggest } from "../geocode.js";
import { fetchVehicleCurrentGps } from "../../samsara/lib/samsara.js";
import { loadSamsaraToken } from "../../samsara/lib/samsaraToken.js";
import { hereReverseGeocode } from "../../../lib/hereGeocode.js";

/**
 * How long this proxy waits for HERE before answering the browser itself.
 *
 * ── IT IS HERE BECAUSE AN UNBOUNDED `fetch` IN A HANDLER IS A DEFECT ON ITS OWN TERMS ────────────
 * `await fetch(url)` with no signal inherits undici's defaults — `headersTimeout` and `bodyTimeout`
 * are five minutes each — so a wedged upstream connection held this handler, and the browser's own
 * request, for up to 300 seconds with no way for either end to give up.
 *
 * ── AND IT IS THE LAST LIVE HYPOTHESIS FOR THE OWNER'S ITEM 3 ────────────────────────────────────
 * "Clicking a row sometimes freezes the whole page" has not been reproduced in a browser rig: ~250
 * clicks across six patterns at 6× CPU throttle measured a worst frame gap of 76 ms and a heap flat
 * at 37.8 MB. What a browser rig cannot see is a tile request that never settles — and
 * **maplibre-gl caps in-flight image requests at 16** (`MAX_PARALLEL_IMAGE_REQUESTS`, verified in
 * the installed 5.24.0 bundle). A fetch that never resolves holds its slot, so sixteen wedged tiles
 * stop the map loading ANY further tile for as long as the socket hangs: markers keep moving over a
 * grey grid, which a dispatcher would fairly describe as frozen. This does not prove that is what
 * they saw; it removes the mechanism.
 *
 * ── WHY 8 SECONDS ───────────────────────────────────────────────────────────────────────────────
 * Measured against the production key while D-DR22 was weighing jpeg against png: HERE answers a
 * tile in **150–210 ms round trip, 100–170 ms TTFB**, across five tiles from a dense city to open
 * country. 8 s is ~38× the worst of those, so it cannot fire on a slow-but-working tile or on a cold
 * upstream; it fires on a connection that is not coming back. A tile is also the most re-issuable
 * request this app makes — maplibre asks again on the next pan — so the cost of being wrong in that
 * direction is one grey square, and the cost of being wrong in the other is the map.
 */
const TILE_UPSTREAM_TIMEOUT_MS = 8_000;

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
      /**
       * D-DR8: the basemap follows the reader's colour scheme, so the style is a parameter rather
       * than the `explore.day` that was hardcoded here.
       *
       * ⚠ The allowlist lives in `@silvicom/shared` and NOT beside this line, because the web client
       * has to spell the same two vendor strings and a copy here is how the two would come to
       * disagree. It falls back to the light basemap rather than answering `400` — the reasoning is
       * in `basemap.ts`, and it is not the same call as the coordinate check above: a bad coordinate
       * is one broken tile, a rejected style is every tile in the viewport at once.
       *
       * ⚠ `Cache-Control` below is unchanged and stays correct: the style is part of the query
       * string, so the two basemaps occupy different cache keys and a reader toggling schemes does
       * not serve themselves yesterday's day tiles in dark mode.
       */
      const style = resolveBasemapStyle(req.query.style);
      /**
       * ⚠ FORMAT IS A PARAMETER TOO, AND `/png` WAS HARDCODED HERE (D-DR20). Satellite is a
       * photograph: measured on one tile, `satellite.day` is 41 KB as jpeg and 488 KB as png. Serving
       * imagery through the lossless branch would have cost 12× the bytes per tile on the slowest
       * part of this page, so the switcher could not have shipped without this line.
       */
      const format = resolveBasemapFormat(req.query.format);
      const url =
        `https://maps.hereapi.com/v3/base/mc/${z}/${x}/${y}/${format}?style=${style}&size=512` +
        `&apiKey=${encodeURIComponent(env.HERE_API_KEY)}`;
      try {
        const upstream = await fetch(url, { signal: AbortSignal.timeout(TILE_UPSTREAM_TIMEOUT_MS) });
        if (!upstream.ok) {
          res.status(502).json(apiError("tile_upstream_error", `HERE tile HTTP ${upstream.status}`));
          return;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(buf);
      } catch (e) {
        /**
         * A timeout answers 504 and not 502, and the distinction is for the logs rather than for
         * maplibre — which treats every failed tile the same. "HERE refused us" and "HERE stopped
         * answering" are different incidents with different owners, and a single `tile_upstream_error`
         * covering both is what makes an outage take an afternoon to attribute.
         *
         * ⚠ BOTH NAMES ARE CHECKED. `AbortSignal.timeout` rejects with `TimeoutError`, but an abort
         * arriving from anywhere else — a client that went away mid-tile — surfaces as `AbortError`,
         * and neither is an error worth 502's "the upstream said something wrong".
         */
        const aborted = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        if (aborted) {
          res
            .status(504)
            .json(apiError("tile_upstream_timeout", `HERE did not answer in ${TILE_UPSTREAM_TIMEOUT_MS}ms`));
          return;
        }
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
