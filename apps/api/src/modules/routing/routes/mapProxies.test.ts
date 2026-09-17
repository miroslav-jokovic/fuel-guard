import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `GET /api/fueling/map-tiles/:z/:x/:y` — the basemap the proxy asks HERE for (D-DR8).
 *
 * ── WHY THIS IS TESTED HERE AND NOT ONLY IN `shared` ─────────────────────────────────────────────
 * `resolveBasemapStyle` has its own tests and they cover the allowlist. What they cannot cover is
 * the thing that actually broke for as long as this route existed: the style was a LITERAL in the
 * upstream URL. A shared allowlist that nothing on this side reads would be just as inert as the
 * icons the operating-metrics strip carried and never drew (DR7a, same programme, same week). So
 * these assertions read the URL handed to `fetch`, which is the only place the two can be seen to
 * agree.
 *
 * ⚠ `fetch` is stubbed rather than a HERE call being allowed out. The upstream is a paid vendor on
 * the carrier's quota, and a test suite that reached it would bill somebody for asserting a query
 * string.
 *
 * ⚠⚠ AND THE TEST CLIENT HOLDS THE REAL `fetch`, captured before the stub is installed. The first
 * draft did not, so `tile()` called the stub instead of the server: every request was answered by
 * the fake PNG without ever reaching Express, which made the anonymous case return 200 and recorded
 * no upstream URL at all. Five failures with one cause, and the cause was the harness — worth the
 * comment because a global stub swallowing the test's own transport fails in a way that reads like
 * the ROUTE being broken.
 */
const realFetch = globalThis.fetch;

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  HERE_API_KEY: "test-here-key",
} as NodeJS.ProcessEnv);

let server: Server;
let baseUrl = "";
const upstream: string[] = [];
/** The second half of each upstream call — what the handler asked for, not just where. */
const upstreamInit: (RequestInit | undefined)[] = [];

beforeAll(async () => {
  const app = createApp(env);
  /**
   * The supported seam for an authenticated request, and the reason this file does NOT `vi.mock` the
   * auth middleware: mocking it out would also remove the 401 case below, so the suite would be
   * unable to notice the gate being deleted. Overriding the verifier keeps the real middleware in
   * the path and only replaces what a token means.
   */
  app.locals.verifyToken = async (token: string): Promise<AuthContext> =>
    ({ userId: `u-${token}`, email: "t@x.test", orgId: "org-1", role: "admin" }) as AuthContext;
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await closeTestServer(server);
});

afterEach(() => {
  upstream.length = 0;
  upstreamInit.length = 0;
  vi.unstubAllGlobals();
});

/**
 * Records the URL the route asks for and answers with a one-byte PNG.
 *
 * ⚠ It records EVERY call and the assertions read the HERE one by prefix, rather than assuming the
 * tile fetch is the only one in flight. A stub that asserted on `calls[0]` would start reporting a
 * wrong style the first time anything else in the request path learned to fetch.
 */
function stubUpstream() {
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    upstream.push(String(input));
    upstreamInit.push(init);
    return new Response(Buffer.from([0]), { status: 200, headers: { "content-type": "image/png" } });
  });
}

const hereUrl = () => upstream.find((u) => u.startsWith("https://maps.hereapi.com/"));

/**
 * ⚠ The route sits behind `requireAuth` on the `/api/fueling` router, so an unauthenticated request
 * never reaches the handler. These tests are about which URL the handler builds, so they assert on
 * the STYLE only in the authenticated case and use the refusal below to prove the gate is still
 * there — rather than quietly disabling auth to make the happy path easier to reach, which would
 * leave the suite unable to notice if the gate were removed.
 */
/** Authenticated unless `anon`, which is how the gate below is exercised without disabling it. */
async function tile(query: string, opts: { anon?: boolean } = {}) {
  return realFetch(`${baseUrl}/api/fueling/map-tiles/5/8/9${query}`, {
    headers: opts.anon ? {} : { Authorization: "Bearer admin" },
  });
}

/**
 * The upstream call is BOUNDED, and the reason is the owner's item 3.
 *
 * `await fetch(url)` with no signal inherits undici's five-minute defaults, and maplibre-gl caps
 * in-flight image requests at 16 — so sixteen wedged tiles stop the map loading any further tile at
 * all, for minutes, while the markers keep moving. That is a map a dispatcher would call frozen, and
 * it is the one mechanism a browser rig cannot see.
 *
 * ⚠ What is asserted is the SIGNAL and the MAPPING, not the clock. A test that waited eight seconds
 * to watch a timer fire would be eight seconds of suite for a `setTimeout` nobody doubts; what can
 * actually rot is the signal being dropped from the call, or an abort being reported as 502 and
 * losing an outage in the logs.
 */
describe("the tile proxy's upstream timeout", () => {
  it("gives HERE a deadline rather than waiting on it forever", async () => {
    stubUpstream();
    await tile("");
    const init = upstreamInit.find((i) => i?.signal);
    expect(init?.signal, "the upstream fetch must carry an abort signal").toBeDefined();
    expect(init!.signal!.aborted).toBe(false);
  });

  it("answers 504 when the upstream stops answering, rather than holding the request open", async () => {
    vi.stubGlobal("fetch", async () => {
      // What `AbortSignal.timeout` throws when it fires — the shape, without the eight-second wait.
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    const res = await tile("");
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("tile_upstream_timeout");
  });

  it("still calls a vendor error a vendor error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("socket hang up");
    });
    const res = await tile("");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("tile_upstream_error");
  });
});

describe("which basemap the tile proxy asks HERE for (D-DR8)", () => {
  it("keeps the route behind the router's auth gate", async () => {
    stubUpstream();
    const res = await tile("", { anon: true });
    expect(res.status).toBe(401);
    // Nothing was fetched upstream, so a refused caller cannot spend the carrier's HERE quota.
    expect(hereUrl()).toBeUndefined();
  });
});

describe("the style parameter reaches the upstream URL", () => {
  it("asks for the night basemap when the client asks for it", async () => {
    stubUpstream();
    await tile("?style=explore.night");
    expect(hereUrl()).toContain("style=explore.night");
  });

  it("asks for the day basemap when the client asks for it", async () => {
    stubUpstream();
    await tile("?style=explore.day");
    expect(hereUrl()).toContain("style=explore.day");
  });

  /**
   * ⚠ The old-client case, and it is what makes D-DR8 safe to merge in one PR rather than two. A web
   * bundle deployed before this change sends no `style` at all — Railway can serve the two services
   * from different commits, so that combination is not hypothetical — and it must keep getting
   * exactly today's basemap rather than an error or a surprise dark map.
   */
  it("serves the light basemap to a client that sends no style at all", async () => {
    stubUpstream();
    await tile("");
    expect(hereUrl()).toContain("style=explore.day");
  });

  /**
   * ⚠ The rejected example had to CHANGE, and that is the test doing its job rather than a nuisance.
   * This read `satellite.day` until Q-DR2 was answered by asking HERE with our own key: satellite is
   * on the plan, so asserting it is refused would now assert the opposite of the shipped behaviour.
   * `hybrid.day` — satellite WITH labels — is the one comp (7) draws that HERE answers 400 for, so it
   * is the honest stand-in for "a style we do not have".
   */
  it("falls back to the light basemap rather than passing an unlisted style upstream", async () => {
    stubUpstream();
    await tile("?style=hybrid.day");
    const url = hereUrl();
    expect(url).toContain("style=explore.day");
    // The interesting half: the rejected value must not reach the vendor at all, in any position.
    expect(url).not.toContain("hybrid");
  });

  it("serves the satellite and terrain basemaps Q-DR2 turned out to allow", async () => {
    stubUpstream();
    await tile("?style=satellite.day&format=jpeg");
    expect(hereUrl()).toContain("style=satellite.day");

    upstream.length = 0;
    upstreamInit.length = 0;
    await tile("?style=topo.day");
    expect(hereUrl()).toContain("style=topo.day");
  });

  /**
   * ⚠ The FORMAT is in the PATH, not the query string, which is why it needs its own assertions: a
   * regression here does not produce a wrong-looking map, it produces the right map at 12× the bytes.
   * Measured on one tile: `satellite.day` is 41 KB as jpeg and 488 KB as png.
   */
  it("puts the requested format in the upstream path, defaulting to png", async () => {
    stubUpstream();
    await tile("?style=satellite.day&format=jpeg");
    expect(hereUrl()).toContain("/5/8/9/jpeg?");

    upstream.length = 0;
    upstreamInit.length = 0;
    await tile("?style=explore.day");
    expect(hereUrl()).toContain("/5/8/9/png?");
  });

  it("refuses a format that is not on the allowlist rather than putting it in a URL path", async () => {
    stubUpstream();
    await tile("?style=explore.day&format=../../etc/passwd");
    const url = hereUrl();
    expect(url).toContain("/5/8/9/png?");
    expect(url).not.toContain("passwd");
  });
});
