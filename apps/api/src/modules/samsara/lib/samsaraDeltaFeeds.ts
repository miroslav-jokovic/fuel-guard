/**
 * The vehicle-stats DELTA FEED — `GET /fleet/vehicles/stats/feed`, read two ways.
 *
 * ── WHY THE TWO FETCHERS LIVE TOGETHER ───────────────────────────────────────────────────────────
 * One endpoint, two tiers: the 20-minute stats tier asks for fuel and odometer, the 5-second positions
 * tier asks for gps. They are separated here rather than merged behind a `types` argument because the
 * thing that must never be shared is the CURSOR — a delta is delivered once per cursor position, so a
 * tier that consumed another's deltas would silently starve it (`lib/feedCursor.ts` carries the full
 * argument). Two named fetchers make the wrong thing hard to type; one parameterised fetcher would
 * make it look like the obvious next step.
 *
 * ⚠ NEITHER CALLER MAY LOOP ON `pagination.hasNextPage`. Measured on the live feed 2026-09-01, twelve
 * pages deep, including on a single-sample page and an immediate re-poll of an idle fleet: it is
 * `true` on every page, forever. On a delta feed it means "this stream continues", not "there is more
 * right now". `feedPageHasData` is the termination test.
 *
 * Split out of `lib/samsara.ts` when LM4's second fetcher pushed that file past the 500-line budget
 * (`lint:filesize`) — a split along the seam the file already had, not a waiver.
 */
import type { StatsFeedPage } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { samsaraFetch } from "./samsaraHttp.js";

/**
 * ONE page of the vehicle-stats DELTA FEED, resumed from a caller-supplied cursor (SAM-S2, D-SAM4).
 *
 * Deliberately not `listAllPages`: that helper walks `pagination.endCursor` in a LOCAL variable and
 * returns the merged rows, which is intra-request paging and is exactly the thing the plan identifies
 * as why nothing in this product has ever resumed anything (§0.2). Here the cursor belongs to the
 * caller — it is persisted in `samsara_feed_cursors` between runs — so the fetcher hands back one page
 * plus its cursor and lets the caller decide when to advance it.
 */
export type SamsaraStatsFeedFetcher = (after?: string) => Promise<StatsFeedPage>;

export function makeSamsaraStatsFeedFetcher(env: Env, token: string): SamsaraStatsFeedFetcher {
  return async (after?: string) => {
    const url = new URL("/fleet/vehicles/stats/feed", env.SAMSARA_API_URL);
    url.searchParams.set("types", "obdOdometerMeters,gpsOdometerMeters,fuelPercents");
    if (after) url.searchParams.set("after", after);
    const res = await samsaraFetch(env, token, url);
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    return (await res.json()) as StatsFeedPage;
  };
}

/**
 * ONE page of the same delta feed, asked for POSITIONS instead of fuel and odometer (LM4, D-LM1d).
 *
 * ── WHY A SECOND FETCHER AND NOT A `types` ARGUMENT ON THE FIRST ─────────────────────────────────
 * Because the two callers are two tiers with two cursors, and the fetcher is where that separation is
 * visible. A shared fetcher taking `types` would read as one integration with a parameter, and the
 * first person to reuse it would reuse the cursor with it — which is the silent data loss
 * `lib/feedCursor.ts` explains at length. Two named fetchers cost four lines and make the wrong thing
 * hard to type.
 *
 * ── WHY NO SNAPSHOT BOOTSTRAP ────────────────────────────────────────────────────────────────────
 * Samsara's own guidance is "snapshot once, then deltas", and `makeSamsaraGpsSnapshotFetcher` exists
 * a few lines below. It is deliberately NOT used: a cursorless call to this feed returns every
 * vehicle's current value, which is the same fleet-wide snapshot by another name, and the stats tier
 * has relied on exactly that since SAM-S2 ("seeds from the feed's head"). One mechanism that seeds and
 * resumes beats two that have to agree with each other.
 */
export type SamsaraPositionsFeedFetcher = (after?: string) => Promise<StatsFeedPage>;

export function makeSamsaraPositionsFeedFetcher(env: Env, token: string): SamsaraPositionsFeedFetcher {
  return async (after?: string) => {
    const url = new URL("/fleet/vehicles/stats/feed", env.SAMSARA_API_URL);
    // `gps` alone. Heading, speed, the ECU-speed flag and the reverse-geocoded place name all ride on
    // the gps stat itself — there is no second type to ask for and no second request to make.
    url.searchParams.set("types", "gps");
    if (after) url.searchParams.set("after", after);
    const res = await samsaraFetch(env, token, url);
    if (!res.ok) throw new Error(`Samsara API ${res.status}`);
    return (await res.json()) as StatsFeedPage;
  };
}

