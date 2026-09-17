import type { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
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

/**
 * ── WHY THE TILE IS STREAMED AND NOT BUFFERED (B2) ───────────────────────────────────────────────
 * This handler read `Buffer.from(await upstream.arrayBuffer())` and then `res.send(buf)`, which
 * cannot emit a status line until the LAST byte of the tile is in this process's memory. So the
 * browser's time-to-headers was HERE's TTFB *plus* HERE's entire body transfer, and every tile was
 * held twice — once as the `ArrayBuffer`, once as the `Buffer` copied from it.
 *
 * Measured on the route itself, against a stand-in HERE answering headers in 120 ms and dribbling a
 * 47 KB body over the next 50 ms (D-DR22's measured shape: 100-170 ms TTFB, 150-210 ms round trip),
 * ten runs after a warm-up:
 *
 *   buffered   time-to-headers 181.6 · 181.0 · 180.9 ms    complete ~181.4 ms
 *   streamed   time-to-headers 129.9 · 129.2 · 129.7 ms    complete ~181.1 ms
 *
 * The headers now arrive on HERE's clock instead of after the download — **~52 ms earlier per
 * tile**, which is very nearly the whole body transfer — and the completion time is unchanged,
 * because the bytes still take as long as they take. This is a latency and allocation change, not a
 * bandwidth one, and a viewport is dozens of tiles deep.
 *
 * ⚠ It also stops paying for a tile nobody is waiting for. `pipeline` destroys its source when the
 * destination closes, so a reader who pans away mid-tile now aborts the upstream body instead of
 * leaving this process to finish downloading it into a buffer it will never send.
 */

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
        res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        /**
         * Passed through so the browser gets a determinate body rather than a chunked one — and so a
         * truncated tile is a truncated tile to the browser rather than a short-but-valid one. HERE
         * sends it; the branch is here because nothing in this handler should require that it does.
         */
        const length = upstream.headers.get("content-length");
        if (length) res.setHeader("Content-Length", length);
        if (!upstream.body) {
          res.end();
          return;
        }
        await pipeline(Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>), res);
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
        /**
         * ⚠ ONCE THE TILE IS STREAMING THERE IS NO STATUS LEFT TO SEND, AND THE SOCKET IS ALREADY GONE.
         *
         * `pipeline` destroys BOTH of its streams when either end fails, so by the time a mid-body
         * upstream error reaches this catch the response is already torn down — measured rather than
         * assumed, with a probe in this block: `headersSent=true destroyed=true writableEnded=false`.
         * That teardown is what the browser sees as a network error, and it is the outcome we want:
         * ending the response cleanly instead would hand it a SHORT PNG that looks complete, which
         * `Cache-Control: public, max-age=86400` above would then keep on the reader's disk for a day.
         * maplibre re-asks for a failed tile on the next pan, the same cheap recovery the 8 s deadline
         * is priced against.
         *
         * ⚠⚠ SO THE `destroy` BELOW IS BELT AND BRACES — IT IS THE `return` THAT EARNS THIS BRANCH.
         * Without it the handler falls through to `res.status(502).json(...)`, whose `setHeader` throws
         * ERR_HTTP_HEADERS_SENT on a response whose headers left minutes ago; that throw reaches
         * `errorResponder`, which logs `[api] unhandled error` and reports it to Sentry. A HERE outage
         * would arrive in our own alerting as a bug in this route, which is the misattribution the 504
         * above exists to prevent. The `destroy` is kept for the case `pipeline` did not cause (a
         * future writer here that fails before it pipes) and costs nothing on an already-dead socket.
         *
         * Pinned by "does not report a mid-tile upstream failure as an unhandled route error".
         */
        if (res.headersSent) {
          res.destroy(e instanceof Error ? e : undefined);
          return;
        }
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
