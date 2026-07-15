/**
 * Live HERE Routing v8 truck-route fetch. The request build + response parse are pure in @fuelguard/shared
 * (unit-tested); this is the thin I/O layer with retry/backoff (reuses samsaraHttp's backoff). Requires
 * HERE_API_KEY — absent -> NoHereKeyError, so the caller degrades to an explicit "routing unavailable" state
 * rather than a bad plan.
 */
import { buildTruckRouteUrl, parseHereRoute, type HereRouteRequest, type ParsedHereRoute } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { backoffMs } from "./samsaraHttp.js";

export class NoHereKeyError extends Error {
  constructor() {
    super("HERE_API_KEY is not configured");
    this.name = "NoHereKeyError";
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
  throw new Error(`HERE routing failed after retries (${lastErr})`);
}
