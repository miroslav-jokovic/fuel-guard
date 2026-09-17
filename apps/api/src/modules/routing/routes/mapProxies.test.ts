import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Readable } from "node:stream";
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
 * An async generator as a `Response` body.
 *
 * ⚠ THE SHAPE IS CHOSEN BY A FITNESS FUNCTION, NOT BY TASTE. The obvious way to write these stubs is
 * a hand-built `ReadableStream` whose `pull` ends the stream by calling the controller's terminator —
 * and `testServerTeardown.test.ts` fails any test file that both starts a listener and names that
 * same method, because a suite tearing its own server down that way hangs `afterAll` on keep-alive
 * sockets. On a stream controller it is a false positive, but the honest fix is this side rather than
 * loosening the scan: an async generator ends by returning, so it never names the method, reads
 * better, and leaves a gate that catches a real defect exactly as strict as it was.
 *
 * ⚠ That is also why this comment talks around the method name instead of quoting it — the scan reads
 * the file, not the code, and the first draft of this very note tripped it.
 */
function webBody(chunks: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  return Readable.toWeb(Readable.from(chunks, { objectMode: false })) as ReadableStream<Uint8Array>;
}

/**
 * A tile delivered in several chunks, the way a real body arrives off a socket.
 *
 * ⚠ It matters that this is MULTI-CHUNK and that the assertions count bytes. The stub above answers
 * one byte in a single chunk, which is the shape that cannot tell buffering from streaming apart —
 * every assertion in this file passed against both implementations, which is exactly why B2 needed
 * tests of its own rather than trusting the ones that were already green.
 */
function stubChunkedUpstream(chunks: number, chunkBytes: number, opts: { contentLength?: boolean } = {}) {
  const total = chunks * chunkBytes;
  async function* tileChunks() {
    for (let i = 1; i <= chunks; i += 1) yield Buffer.alloc(chunkBytes, i);
  }
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    upstream.push(String(input));
    upstreamInit.push(init);
    const headers: Record<string, string> = { "content-type": "image/png" };
    if (opts.contentLength) headers["content-length"] = String(total);
    return new Response(webBody(tileChunks()), { status: 200, headers });
  });
  return total;
}

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
    /**
     * ⚠ This asserted `aborted === false` until 2026-09-17, as a proxy for "the deadline did not
     * fire". The deadline is now an AbortController the handler OWNS and closes out in `finally`
     * (that is what releases undici's hold on the body), so the signal is legitimately aborted once
     * the tile has been served. The intent is unchanged and is now stated directly: what must never
     * be true is that it was aborted BY THE DEADLINE.
     */
    expect((init!.signal!.reason as Error | undefined)?.name).not.toBe("TimeoutError");
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

/**
 * An upstream that answers its headers, hands over one chunk, and then fails.
 *
 * ⚠ The pause before the error is load-bearing, and the first draft did not have it. Erroring on the
 * very next pull killed the socket before the client had read the status line, so `tile()` ITSELF
 * rejected and the assertions never ran — the test failed while the code under it was working. The
 * delay lets the headers and the first chunk land, which is the only way to reach the `headersSent`
 * branch these two tests exist to cover.
 */
function stubBrokenBodyUpstream() {
  async function* dyingBody() {
    yield Buffer.alloc(16, 7);
    await new Promise((r) => setTimeout(r, 25));
    throw new Error("HERE stopped mid-body");
  }
  vi.stubGlobal("fetch", async () =>
    new Response(webBody(dyingBody()), { status: 200, headers: { "content-type": "image/png" } }),
  );
}

/**
 * The tile the route streams is the tile HERE sent — whole, and typed as an image.
 *
 * These are the assertions B2 turns on. Before it, the handler read the upstream into a `Buffer` and
 * `res.send` set the length for us; now the bytes pass through a `pipeline` and the length is copied
 * off the upstream, so "did all of it arrive" and "is it still declared correctly" are both things
 * that can now be got wrong without any other test noticing.
 */
/**
 * The outage of 2026-09-17, pinned.
 *
 * `@fleetguard/web` crashed four times on deployment `184f5a44`, exhausted `restartPolicyMaxRetries`
 * and served 502 to every reader for half an hour. `@fleetguard/api` was healthy on the same commit
 * throughout, because only the web service serves the SPA and therefore only it serves tiles.
 *
 * The cause was `AbortSignal.timeout(8_000)`: a timer that cannot be disarmed. maplibre abandons
 * tile requests on every pan, `pipeline` then destroys its source and lets go, and the still-armed
 * timer fired seconds later — undici aborted the request, errored the underlying web stream, and the
 * Node wrapper destroyed a Readable that nothing was listening to. An unhandled `'error'` on a stream
 * does not log; it terminates the process.
 *
 * So the deadline is now an AbortController this handler owns and closes out in `finally`.
 */
describe("the tile proxy's deadline cannot outlive the request it was guarding", () => {
  it("closes out its own deadline once the tile is served, rather than leaving one armed", async () => {
    stubChunkedUpstream(2, 512);
    const res = await tile("");
    expect(res.status).toBe(200);
    await res.arrayBuffer();

    const signal = upstreamInit.at(-1)?.signal;
    expect(signal, "the upstream fetch must carry an abort signal").toBeDefined();
    expect(
      signal!.aborted,
      "the handler must abort its own controller in finally — that is what releases undici's hold " +
        "on the body, so a late fire has nothing left to error",
    ).toBe(true);
    expect(
      (signal!.reason as Error | undefined)?.name,
      "and it must be closed out by US, not by the deadline expiring",
    ).not.toBe("TimeoutError");
  });

  it("disarms the deadline timer itself, rather than leaving it to fire at nothing", async () => {
    /**
     * Deliberately coupled to the mechanism, because the mechanism IS the fix: the crash was a timer
     * that outlived the stream it was guarding. Fake timers cannot be used here — `tile()` makes a
     * real request over a real server, and faking the clock wedges the transport.
     */
    const armed = vi.spyOn(globalThis, "setTimeout");
    const cleared = vi.spyOn(globalThis, "clearTimeout");
    try {
      stubChunkedUpstream(2, 512);
      const res = await tile("");
      expect(res.status).toBe(200);
      await res.arrayBuffer();

      const i = armed.mock.calls.findIndex((c) => c[1] === 8_000);
      expect(i, "the handler must arm an 8s deadline").toBeGreaterThanOrEqual(0);
      const handle = armed.mock.results[i]?.value;
      expect(
        cleared.mock.calls.some((c) => c[0] === handle),
        "the 8s deadline must be cleared when the handler finishes — an armed timer with no stream " +
          "left to guard is what took production down",
      ).toBe(true);
    } finally {
      armed.mockRestore();
      cleared.mockRestore();
    }
  });
});

describe("the tile proxy streams the body through intact (B2)", () => {
  it("delivers every chunk, not just the first one", async () => {
    const total = stubChunkedUpstream(8, 4_096);
    const res = await tile("");
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.byteLength, "a streamed tile must arrive whole").toBe(total);
    // The fill values are the chunk ordinals, so this also proves they arrived in order.
    expect(body[0]).toBe(1);
    expect(body[total - 1]).toBe(8);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
  });

  it("passes the upstream's content-length through rather than re-chunking the tile", async () => {
    const total = stubChunkedUpstream(4, 1_024, { contentLength: true });
    const res = await tile("");
    expect(res.headers.get("content-length")).toBe(String(total));
    expect(Buffer.from(await res.arrayBuffer()).byteLength).toBe(total);
  });

  /**
   * ⚠⚠ THE ONE THAT PROTECTS THE READER'S DISK, AND THE REASON THE CATCH BLOCK CHECKS `headersSent`.
   *
   * Once bytes are flowing the status line is gone, so a body that dies mid-flight cannot be reported
   * as 504 or 502 — but ending the response cleanly would be worse than either: the browser would
   * receive a SHORT PNG that looks complete, under the `Cache-Control: public, max-age=86400` this
   * route sets, and keep that corrupt tile for a day. Destroying the socket makes it a network error
   * instead, and maplibre re-asks on the next pan.
   *
   * So what is asserted is that the client's own body read REJECTS. A truncated-but-clean response
   * would resolve, which is precisely the bug.
   *
   * ⚠ MEASURED WHILE WRITING THIS, AND IT CHANGED WHAT THE SECOND TEST HAD TO BE. A probe inside the
   * handler's catch reported `headersSent=true destroyed=true` — `pipeline` tears down BOTH streams
   * when either fails, so the socket is already gone and the client's network error is `pipeline`'s
   * doing, not the `res.destroy()` in the catch. Swapping that `destroy` for `end()` therefore did
   * not fail this test, and neither did deleting the guard outright. What the guard actually buys is
   * the `return`, and that is what the second test below pins.
   */
  it("breaks the connection when the body dies mid-tile, rather than serving half a PNG", async () => {
    stubBrokenBodyUpstream();
    const res = await tile("");
    // The headers were already on the wire when the body failed, so the status cannot say otherwise.
    expect(res.status).toBe(200);
    await expect(
      res.arrayBuffer(),
      "a half-downloaded tile must reach the browser as a network error, not as a short image",
    ).rejects.toThrow();
  });

  /**
   * ⚠⚠ WHAT THE `headersSent` GUARD IS ACTUALLY FOR, AND THE ONLY TEST THAT CAN SEE IT.
   *
   * The client-visible outcome is identical with or without the guard, because `pipeline` has already
   * destroyed the socket — which is why the test above stayed green through both mutations. What
   * changes is what the SERVER says about it. Without the guard the handler falls through to
   * `res.status(502).json(...)`, whose `setHeader` throws ERR_HTTP_HEADERS_SENT; that reaches
   * `errorResponder`, which logs `[api] unhandled error` and hands it to Sentry.
   *
   * So a HERE body that dies mid-tile — a vendor outage, on the one request in this app that is
   * cheapest to retry — would page us as a defect in our own route. That is exactly the
   * misattribution the 504-vs-502 split above exists to prevent, arriving by a different door.
   */
  it("does not report a mid-tile upstream failure as an unhandled route error", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
    try {
      stubBrokenBodyUpstream();
      const res = await tile("");
      await expect(res.arrayBuffer()).rejects.toThrow();
      // The failure travels through Express asynchronously; give it a turn to arrive before judging.
      await new Promise((r) => setTimeout(r, 100));
    } finally {
      spy.mockRestore();
    }
    expect(
      logged.filter((l) => l.includes("unhandled error")),
      "a vendor body failure must not be logged as a bug in this route",
    ).toEqual([]);
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
