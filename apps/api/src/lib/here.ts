/**
 * Live HERE Routing v8 truck-route fetch. The request build + response parse are pure in @silvicom/shared
 * (unit-tested); this is the thin I/O layer with retry/backoff (reuses samsaraHttp's backoff). Requires
 * HERE_API_KEY — absent -> NoHereKeyError, so the caller degrades to an explicit "routing unavailable" state
 * rather than a bad plan.
 */
import { buildTruckRouteUrl, parseHereRoute, type HereRouteRequest, type ParsedHereRoute } from "@silvicom/shared";
import type { Env } from "../env.js";
import { backoffMs } from "../modules/samsara/lib/samsaraHttp.js";

export class NoHereKeyError extends Error {
  constructor() {
    super("HERE_API_KEY is not configured");
    this.name = "NoHereKeyError";
  }
}

/**
 * HERE kept answering 429/5xx (or not at all) through every retry: the service is down for us, not the
 * request wrong. From 2026-10-16 ~20:32Z every Routing v8 call with the production key answered `503
 * Timeout processing request` in ~0.1 s while geocoding on the same key worked, and the plain Error this
 * used to be reached `errorResponder` as a 500 "Unexpected server error" on the live map. A caller
 * answers it the way it answers a missing key: routing is unavailable, say so, keep the rest.
 */
export class HereUnavailableError extends Error {
  constructor(detail: string) {
    super(`HERE routing failed after retries (${detail})`);
    this.name = "HereUnavailableError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch a truck-legal route from HERE. Retries 429/5xx with backoff; throws on a persistent error. */
export async function fetchTruckRoute(env: Env, req: HereRouteRequest): Promise<ParsedHereRoute> {
  const key = env.HERE_API_KEY;
  if (!key) throw new NoHereKeyError();
  const url = buildTruckRouteUrl(req, key, env.HERE_ROUTER_URL);
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      await sleep(backoffMs(attempt));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`;
      await sleep(backoffMs(attempt));
      continue;
    }
    if (!res.ok) throw new Error(`HERE routing ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const parsed = parseHereRoute(await res.json());
    if (!parsed || parsed.polyline.length === 0) throw new Error("HERE returned no usable route");
    return parsed;
  }
  throw new HereUnavailableError(lastErr);
}
