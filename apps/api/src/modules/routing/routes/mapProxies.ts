import type { Request as ExpressRequest, Router, Response as ExpressResponse } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { HERE_MAX_TILE_ZOOM, HERE_MAX_VECTOR_ZOOM, TRUCK_PLACES_ZOOM, VECTOR_GLYPH_FONTS, resolveBasemapStyle, resolveBasemapFormat, resolveTileRequest } from "@silvicom/shared";

const GLYPH_FONTS = new Set<string>(VECTOR_GLYPH_FONTS);
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { geocodeSuggest } from "../geocode.js";
import { fetchVehicleCurrentGps } from "../../samsara/lib/samsara.js";
import { loadSamsaraToken } from "../../samsara/lib/samsaraToken.js";
import { hereReverseGeocode } from "../../../lib/hereGeocode.js";
import { apiRateLimitKey } from "../../../middleware/apiRateLimit.js";
import { registerMetricsSection } from "../../../middleware/requestMetrics.js";
import { HERE_TILE_PACING, TilePacer } from "../tilePacer.js";

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

/**
 * How long to wait before the one retry of a tile HERE refused with 429 (D-DR30).
 *
 * HERE's `Retry-After` wins when it sends one, capped at 2 s: a reader waits for a map, not a
 * minute. Otherwise 250–600 ms, jittered so the tiles one burst lost do not all come back on the
 * same millisecond and get refused together again.
 */
export function tileRetryDelayMs(retryAfter: string | null, random: () => number = Math.random): number {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(2_000, seconds * 1_000);
  return 250 + Math.round(random() * 350);
}

/** Wait `ms`, or less if the reader leaves first. Resolves either way; the caller checks `signal`. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * ⚠ An error tile must never be cached. A 502 or 503 has no `Cache-Control` of its own, and a
 * browser or proxy that kept one would show a blank square for a place HERE serves fine a second later.
 */
function noStore(res: ExpressResponse): void {
  res.setHeader("Cache-Control", "no-store");
}

/** Map + geocoding proxies: keep the HERE key / vendor rate server-side, never in the browser. */
export function registerMapRoutes(router: Router): void {
  /**
   * D-DR30: one pacer per process, in front of every tile this process asks HERE for (`tilePacer.ts`
   * has the measurement). Its counts, and what HERE refused, join the per-minute `[metrics]` line so
   * the limit can be watched in production. Nothing per caller is recorded: the totals only.
   */
  const pacer = new TilePacer(HERE_TILE_PACING);
  const refusals = { refused429: 0, retried: 0, retriedOk: 0 };
  /** D-DR34: truck-place tiles asked for, the ones billed at HERE's Advanced rate, so cost is visible. */
  const billed = { advancedTiles: 0 };
  registerMetricsSection("hereTiles", () => {
    const counts = { ...pacer.drainCounts(), ...refusals, ...billed };
    refusals.refused429 = refusals.retried = refusals.retriedOk = billed.advancedTiles = 0;
    return counts;
  });

  /**
   * Ask HERE for one tile through the pacer, retrying a rate refusal once, and stream it to the reader.
   * Shared by the raster road map and the vector one (D-DR31): both are tiles, both count against the
   * same per-second limit of our key, so both go through the one queue.
   */
  async function proxyTile(req: ExpressRequest, res: ExpressResponse, url: string): Promise<void> {
    const deadline = new AbortController();
    /**
     * D-DR30: armed when the tile is first SENT, not when it arrives. A tile that waited its turn
     * in the pacer still gets HERE's full 8 s; the pacer's own `maxWaitMs` bounds the wait before.
     */
    let timer: NodeJS.Timeout | undefined;
    /** Aborted when the reader goes away before the tile is served: maplibre cancelled it. */
    const gone = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) gone.abort();
    });
    const caller = apiRateLimitKey(req);
    /** One paced attempt: wait for this caller's turn, then ask HERE. */
    const attempt = async (): Promise<Response | "busy" | "gone"> => {
      const turn = await pacer.acquire(caller, gone.signal);
      if (turn !== "go") return turn;
      timer ??= setTimeout(
        () => deadline.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
        TILE_UPSTREAM_TIMEOUT_MS,
      );
      return fetch(url, { signal: deadline.signal });
    };
    try {
      let upstream = await attempt();
      /**
       * D-DR30: HERE refusing a tile for rate is retried ONCE, after a short jittered pause. A burst
       * is over in about a second, so one retry turns most refusals into a tile, and two would only
       * add to the burst that caused them. A second 429 is answered 503 with `Retry-After`, never
       * the old 502: "HERE is busy" and "HERE is broken" are different incidents.
       */
      if (typeof upstream !== "string" && upstream.status === 429) {
        refusals.refused429 += 1;
        refusals.retried += 1;
        const wait = tileRetryDelayMs(upstream.headers.get("retry-after"));
        await upstream.body?.cancel().catch(() => {});
        await pause(wait, gone.signal);
        upstream = gone.signal.aborted ? "gone" : await attempt();
        if (typeof upstream !== "string" && upstream.ok) refusals.retriedOk += 1;
        if (typeof upstream !== "string" && upstream.status === 429) refusals.refused429 += 1;
      }
      // The reader cancelled this tile while it waited. Its socket is gone; there is no one to answer.
      if (upstream === "gone") return;
      if (upstream === "busy" || upstream.status === 429) {
        if (upstream !== "busy") await upstream.body?.cancel().catch(() => {});
        noStore(res);
        res.setHeader("Retry-After", "1");
        res.status(503).json(apiError("tile_upstream_busy", "HERE is refusing tiles for rate; try again shortly"));
        return;
      }
      if (!upstream.ok) {
        noStore(res);
        res.status(502).json(apiError("tile_upstream_error", `HERE tile HTTP ${upstream.status}`));
        return;
      }
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      /**
       * Passed through so the browser gets a determinate body rather than a chunked one — and so a
       * truncated tile is a truncated tile to the browser rather than a short-but-valid one.
       *
       * ⚠⚠ ONLY WHEN THE BYTES ARE HERE'S BYTES. HERE gzips its VECTOR tiles (`content-encoding:
       * gzip`), and `fetch` decodes them on the way in, so the body this handler streams is the
       * DECODED tile while HERE's `content-length` is the ENCODED size: 107 391 bytes of body under
       * a header of 72 956, measured 2026-11-10. The browser stopped reading at the header's count,
       * maplibre got a truncated protobuf on every tile, and the vector trial drew a blank map on
       * staging, while every unit test passed because no stub sent an encoding. Raster tiles are
       * jpeg, which HERE does not encode, so the road map never hit it. Pinned by "streams a vector
       * tile HERE gzipped whole, without HERE's encoded length".
       */
      const length = upstream.headers.get("content-length");
      if (length && !upstream.headers.get("content-encoding")) res.setHeader("Content-Length", length);
      if (!upstream.body) {
        res.end();
        return;
      }
      /**
       * Held in a variable, and given its own `'error'` listener, for the same reason the
       * controller above is owned: `pipeline` detaches from this stream the instant it settles, and
       * anything that errors it afterwards would otherwise have nobody listening. `pipeline` is
       * still what REPORTS the failure — it rejects into the catch below and that is where the
       * status is decided; this listener exists only so a late error is inert rather than fatal.
       */
      const source = Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>);
      source.on("error", () => {});
      await pipeline(source, res);
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
      noStore(res);
      if (aborted) {
        res
          .status(504)
          .json(apiError("tile_upstream_timeout", `HERE did not answer in ${TILE_UPSTREAM_TIMEOUT_MS}ms`));
        return;
      }
      res.status(502).json(apiError("tile_upstream_error", e instanceof Error ? e.message : "tile fetch failed"));
    } finally {
      // The deadline has done its job either way. Disarming it is what stops a late fire from
      // erroring a stream nobody owns any more; the abort releases undici's hold on a body we have
      // either finished reading or abandoned. Both are no-ops on the happy path.
      clearTimeout(timer);
      deadline.abort();
    }
  }

  /**
   * D-DR31: HERE's vector tiles for the vector road map, through the same pacer, retry and caching
   * as the raster ones. Under `/map-tiles/` so they count against the tile rate-limit budget and
   * carry the reader's token the same way (`useMapLibre`'s auth fragment). Registered BEFORE the
   * raster route: `/map-tiles/:z/:x/:y` would otherwise read "vector" as a zoom and answer 400.
   *
   * ⚠ HERE serves vector tiles to zoom 17; 18 answers 400 (measured 2026-11-09). maplibre overzooms
   * the 17 tile past that, so the source's `maxzoom` and this check read the same constant.
   *
   * D-DR34: the truck-places route is the same tile with HERE's `advanced_pois` content, which alone
   * carries truck stops and truck parking (measured 2026-11-11, `TRUCK_PLACES_ZOOM`). It bills at
   * the Advanced rate, so it answers for that ONE zoom and refuses every other without asking HERE.
   * ⚠ HERE requires `default` first in `content` (Vector Tile API, "Content").
   */
  const vectorTileRoute = (path: string, zoomServed: (z: number) => boolean, content: string) =>
    router.get(
      path,
      asyncHandler(async (req, res) => {
        const env = getAppLocals(req).env;
        if (!env.HERE_API_KEY) {
          res.status(404).json(apiError("tiles_unavailable", "HERE tiles are not configured"));
          return;
        }
        const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
        if (![z, x, y].every(Number.isInteger) || !zoomServed(z) || x < 0 || y < 0) {
          res.status(400).json(apiError("bad_request", "invalid tile coordinate"));
          return;
        }
        if (content) billed.advancedTiles += 1;
        await proxyTile(req, res, `https://vector.hereapi.com/v2/vectortiles/base/mc/${z}/${x}/${y}/omv?apikey=${encodeURIComponent(env.HERE_API_KEY)}${content}`);
      }),
    );
  vectorTileRoute("/map-tiles/vector/:z/:x/:y", (z) => z >= 0 && z <= HERE_MAX_VECTOR_ZOOM, "");
  vectorTileRoute("/map-tiles/truck-places/:z/:x/:y", (z) => z === TRUCK_PLACES_ZOOM, "&content=default,advanced_pois");

  /**
   * D-DR31: the glyphs the vector map draws its labels with. maplibre renders no text without them.
   * HERE's glyph endpoint is keyless and unbilled; it is proxied so the page's content security
   * policy stays `'self'` and the reader's browser talks only to us.
   *
   * ⚠ Only HERE's two style fonts, and only the range shape maplibre asks for, so this is not an open
   * relay onto HERE's asset host. HERE sends no caching header on glyphs, so none is added here
   * (Platform Terms, Exhibit 2 §1.3). Fira GO is an open font (SIL OFL), so serving our own build
   * of it, cached, is the follow-up if the glyph requests ever show up in the metrics.
   */
  router.get(
    "/map-tiles/glyphs/:fontstack/:range",
    asyncHandler(async (req, res) => {
      const fontstack = String(req.params.fontstack);
      const range = String(req.params.range);
      if (!GLYPH_FONTS.has(fontstack) || !/^\d{1,5}-\d{1,5}\.pbf$/.test(range)) {
        res.status(400).json(apiError("bad_request", "unknown glyph range"));
        return;
      }
      const upstream = await fetch(`https://assets.vector.hereapi.com/fonts/${encodeURIComponent(fontstack)}/${range}`, {
        signal: AbortSignal.timeout(TILE_UPSTREAM_TIMEOUT_MS),
      }).catch(() => null);
      if (!upstream?.ok) {
        noStore(res);
        res.status(502).json(apiError("glyph_upstream_error", `HERE glyphs HTTP ${upstream?.status ?? "failed"}`));
        return;
      }
      res.setHeader("Content-Type", "application/x-protobuf");
      res.send(Buffer.from(await upstream.arrayBuffer()));
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
      if (![z, x, y].every(Number.isInteger) || z < 0 || z > HERE_MAX_TILE_ZOOM || x < 0 || y < 0) {
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
      /**
       * D-DR26: the client asks for a 512 tile at `ppi=200`, which it lays over 256 CSS pixels — the
       * sharp map that names a truck stop a zoom earlier. Validated as one pair in `@silvicom/shared`;
       * a request with neither — a browser still on an older bundle — gets exactly the `size=512` tile
       * this line used to hardcode, because that browser still lays it over 512.
       */
      const { size, ppi } = resolveTileRequest(req.query.size, req.query.ppi);
      const url =
        `https://maps.hereapi.com/v3/base/mc/${z}/${x}/${y}/${format}?style=${style}&size=${size}&ppi=${ppi}` +
        `&apiKey=${encodeURIComponent(env.HERE_API_KEY)}`;
      /**
       * ⚠ THE DEADLINE IS OWNED, NOT FIRE-AND-FORGET, AND THAT COST A PRODUCTION OUTAGE.
       *
       * This was `AbortSignal.timeout(TILE_UPSTREAM_TIMEOUT_MS)`, which arms a timer that keeps
       * running no matter what the response does. maplibre cancels tiles constantly — every pan
       * abandons the requests for the tiles that just left the viewport — and on a cancel `pipeline`
       * destroys the source and rejects into the catch below, which handles it correctly. The timer,
       * though, was still armed. Seconds later it fired, undici aborted the request and errored the
       * underlying web stream, and the Node wrapper destroyed a Readable that `pipeline` had already
       * let go of. Nothing was listening for `'error'` on it by then, and an unhandled `'error'` on a
       * stream does not log — it terminates the process.
       *
       * Measured 2026-09-17: `@fleetguard/web` crashed four times on deployment `184f5a44`, hit
       * `restartPolicyMaxRetries: 3` and stayed down, serving 502 to every reader. `@fleetguard/api`
       * was healthy on the same commit the whole time, because only the web service serves the SPA
       * and therefore only it serves tiles — the bug is reachable only where browsers are.
       *
       * So the controller is ours: `clearTimeout` in `finally` means nothing can fire after this
       * handler is done, and the `abort()` beside it releases undici's hold on a body we are no
       * longer reading. Pinned by "does not crash the process when the deadline fires after the
       * response has already finished".
       */
      await proxyTile(req, res, url);
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
