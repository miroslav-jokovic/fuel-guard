import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Route } from "@playwright/test";
import { resolveBasemapFormat, resolveBasemapStyle } from "@silvicom/shared";
import {
  allLoads, dispatchBoard, driverRows, drivenPath, liveMapPositions, loadDetail, loadRoute, trailerRows,
} from "./fixtures/endpoints";
import { DISPATCHER, ORG, TIMEZONE } from "./fixtures/world";
import { TUTORIAL_SUPABASE_URL } from "./session";

/**
 * The tutorials' whole backend — every request the page makes is answered here or refused here.
 *
 * ── NOTHING REAL CAN BE REACHED, AND NOTHING CAN BE WRITTEN ─────────────────────────────────────
 * The requirement is "synthetic data only, never modify a production record". It is met by
 * construction rather than by care: the build knows no real Supabase (`TUTORIAL_SUPABASE_URL`) and no
 * API origin, every request outside the page's own static files lands in `handle` below, and `handle`
 * answers from `fixtures/` or refuses. A write the scenario did not declare is refused AND recorded,
 * and `assertClean()` fails the run on it — so a tutorial that wandered onto a Save button fails
 * instead of filming a "Saved" toast that saved nothing and teaches a lie.
 *
 * The ONE outbound call is a basemap tile, fetched from HERE with `HERE_API_KEY` exactly as the API's
 * `/api/fueling/map-tiles` proxy does (`mapProxies.ts`) — public map imagery, no customer data — and
 * cached on disk, so a regeneration fetches nothing it already has. Without a key the map draws no
 * basemap, and says so in the log; the trucks, routes and cards still render.
 *
 * ── RAW JSON, EXCEPT WHERE THE ROUTE IS NOT ─────────────────────────────────────────────────────
 * `apiFetch` wraps a body itself, so stubs send the endpoint's RAW object — except the two livemap
 * routes whose real body is `{ ok, data }` — the board, the map, and a load's route and driven path
 * (`useDispatchBoard.ts`, `useLiveMapBoard.ts`, `useLoadRoute.ts`, `useDrivenPath.ts`). Getting this
 * wrong does not error: the page shows its loading skeleton for ever (memory: dev-bypass mocks).
 */

const TILE_CACHE = path.resolve(import.meta.dirname, ".cache/tiles");

export interface StubOptions {
  /** `METHOD /path` writes the scenario expects (e.g. a calculation POST); anything else is refused. */
  allowWrites?: RegExp[];
}

export interface Stub {
  /** Requests nothing here answers — a clean run has none. */
  unstubbed: string[];
  /** Writes refused because the scenario did not declare them. */
  refusedWrites: string[];
  assertClean(): void;
}

type Json = unknown;
type Handler = (url: URL, body: Json) => Json | Promise<Json> | undefined;

/** The calculator's answers come from the real engine, in-process — see `hazmatCalc` below. */
const ALWAYS_ALLOWED_WRITES = [/^POST \/api\/hazmat\/calc$/];

/**
 * Background sends the app makes on its own clock, not because of anything a tutorial did: answered
 * 204 and thrown away. `POST /api/page-views` is the anonymous screen counter (`lib/pageViews.ts`,
 * X1), flushed once a minute — so a recording, which runs for minutes, always meets it and a fast
 * `check` run never does. Listed by name so the write guard stays exact for everything else.
 */
const BACKGROUND_BEACONS = [/^POST \/api\/page-views$/];

/** The livemap family answers `{ ok, data }`; a missing record is still a 404. */
const envelope = <T>(data: T | null): { ok: true; data: T } | undefined => (data === null ? undefined : { ok: true, data });

const API: Array<[RegExp, Handler]> = [
  [/^\/api\/me$/, () => ({ fullName: DISPATCHER.fullName, surfaces: { "safety.placard-calculator": true } })],
  [/^\/api\/version$/, () => ({ commit: "tutorial", release: null, migration: null })],
  [/^\/api\/me\/notifications$/, () => ({ notifications: [], unread: 0 })],
  [/^\/api\/hazmat\/review-count$/, () => ({ count: 0 })],
  [/^\/api\/saved-views$/, () => ({ views: [] })],
  [/^\/api\/dashboard-layout$/, () => ({ layout: null })],
  [/^\/api\/livemap\/dispatch-board$/, () => dispatchBoard()],
  [/^\/api\/livemap\/positions$/, () => liveMapPositions()],
  [/^\/api\/livemap\/loads\/([^/]+)\/route$/, (u) => envelope(loadRoute(u.pathname.split("/")[4]!))],
  [/^\/api\/livemap\/loads\/([^/]+)\/driven$/, (u) => envelope(drivenPath(u.pathname.split("/")[4]!))],
  [/^\/api\/dispatch\/loads$/, () => ({ loads: allLoads(), history_from: "2026-03-27T05:00:00.000Z" })],
  [/^\/api\/dispatch\/loads\/([^/]+)$/, (u) => loadDetail(u.pathname.split("/")[4]!) ?? undefined],
  [/^\/api\/dispatch\/loads\/([^/]+)\/events$/, () => ({ events: [] })],
  [/^\/api\/dispatch\/exceptions$/, () => ({ exceptions: [] })],
  [/^\/api\/fueling\/map-config$/, () => ({ tilesEnabled: Boolean(process.env.HERE_API_KEY) })],
  [/^\/api\/hazmat\/products$/, (u) => hazmatProducts(u)],
  [/^\/api\/hazmat\/calc$/, (_u, body) => hazmatCalc(body)],
];

const REST: Record<string, (single: boolean) => Json> = {
  org_modules: () => [
    { module_key: "dispatch", enabled: true, config: {} },
    { module_key: "hazmatguard", enabled: true, config: {} },
  ],
  organizations: (single) => {
    const row = { id: ORG.id, name: ORG.name, timezone: TIMEZONE, operating_hours: null };
    return single ? row : [row];
  },
  drivers: () => driverRows(),
  trailers: () => trailerRows(),
};

/**
 * The calculator, answered by the code production answers it with. `computeCalc` and the product
 * search are pure (`@hazmat/engine`, `@hazmat/data`), so the tutorial shows the engine's real verdict
 * for a real UN number rather than a placard somebody typed into a fixture. Loaded lazily, by path, so
 * the web typecheck does not walk the API's module graph.
 */
const API_HAZMAT = path.resolve(import.meta.dirname, "../../api/src/modules/hazmat");
const HAZMAT_DATA = path.resolve(import.meta.dirname, "../../../packages/hazmat-data/src/index.ts");
async function hazmatCalc(body: Json): Promise<Json> {
  const { computeCalc } = (await import(path.join(API_HAZMAT, "hazmatCalc.ts"))) as { computeCalc: (b: Json) => Json };
  return computeCalc(body);
}
async function hazmatProducts(u: URL): Promise<Json> {
  const { productsByRef, searchProducts } = (await import(path.join(API_HAZMAT, "hazmatProducts.ts"))) as {
    productsByRef: (e: unknown, r: string[], m: unknown) => Json;
    searchProducts: (e: unknown, o: { q?: string; limit?: number; marinePollutants: unknown }) => Json;
  };
  const { loadDataset } = (await import(HAZMAT_DATA)) as { loadDataset: () => { version: string; entries: unknown; marinePollutants: unknown } };
  const dataset = loadDataset();
  const refs = u.searchParams.get("refs");
  const products = refs
    ? productsByRef(dataset.entries, refs.split(","), dataset.marinePollutants)
    : searchProducts(dataset.entries, { q: u.searchParams.get("q") ?? undefined, limit: Number(u.searchParams.get("limit") ?? 20), marinePollutants: dataset.marinePollutants });
  return { datasetVersion: dataset.version, products };
}

async function tile(route: Route, u: URL): Promise<void> {
  const key = process.env.HERE_API_KEY;
  if (!key) return route.fulfill({ status: 204 });
  const [z, x, y] = u.pathname.split("/").slice(-3);
  const style = resolveBasemapStyle(u.searchParams.get("style"));
  const format = resolveBasemapFormat(u.searchParams.get("format"));
  const file = path.join(TILE_CACHE, style, `${z}-${x}-${y}.${format}`);
  if (!fs.existsSync(file)) {
    const res = await fetch(`https://maps.hereapi.com/v3/base/mc/${z}/${x}/${y}/${format}?style=${style}&size=512&apiKey=${encodeURIComponent(key)}`);
    if (!res.ok) return route.fulfill({ status: 204 });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return route.fulfill({ path: file, contentType: format === "jpeg" ? "image/jpeg" : "image/png" });
}

export async function installStub(context: BrowserContext, origin: string, opts: StubOptions = {}): Promise<Stub> {
  const unstubbed: string[] = [];
  const refusedWrites: string[] = [];
  const allowed = [...ALWAYS_ALLOWED_WRITES, ...(opts.allowWrites ?? [])];
  const supabaseHost = new URL(TUTORIAL_SUPABASE_URL).host;
  if (!process.env.HERE_API_KEY) console.warn("[tutorials] HERE_API_KEY is not set: the live map will draw no basemap.");

  await context.route(/.*/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const method = req.method();
    const sig = `${method} ${u.pathname}`;
    if (u.origin === origin && !u.pathname.startsWith("/api/")) return route.continue();
    if (u.origin === origin && u.pathname.startsWith("/api/fueling/map-tiles/")) return tile(route, u);

    if (u.origin === origin && BACKGROUND_BEACONS.some((re) => re.test(sig))) return route.fulfill({ status: 204 });
    if (method !== "GET" && method !== "HEAD" && !allowed.some((re) => re.test(sig))) {
      refusedWrites.push(sig);
      return route.fulfill({ status: 403, json: { error: { code: "tutorial_read_only", message: "Tutorials never write." } } });
    }
    if (u.origin === origin) {
      const hit = API.find(([re]) => re.test(u.pathname));
      const body = hit ? await hit[1](u, req.postDataJSON() as Json) : undefined;
      if (body !== undefined) return route.fulfill({ json: body });
      if (!hit) unstubbed.push(sig);
      return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Not in the tutorial world." } } });
    }
    if (u.host === supabaseHost && u.pathname.startsWith("/rest/v1/")) {
      const table = u.pathname.slice("/rest/v1/".length);
      const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      const answer = REST[table];
      if (answer) return route.fulfill({ json: answer(single) });
      unstubbed.push(sig);
      // `.single()` waits for an object; 406 is PostgREST's "no row", which every caller handles.
      return single ? route.fulfill({ status: 406, json: { code: "PGRST116", message: "No rows" } }) : route.fulfill({ json: [] });
    }
    unstubbed.push(`${sig} @ ${u.host}`);
    return route.abort("blockedbyclient");
  });

  return {
    unstubbed, refusedWrites,
    assertClean() {
      if (refusedWrites.length) throw new Error(`The tutorial tried to write: ${[...new Set(refusedWrites)].join(", ")}`);
      if (unstubbed.length) throw new Error(`Requests the tutorial world does not answer: ${[...new Set(unstubbed)].join(", ")}`);
    },
  };
}
