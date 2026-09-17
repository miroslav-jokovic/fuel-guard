import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Readable } from "node:stream";
import http from "node:http";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@silvicom/shared";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { closeTestServer } from "./testing/httpServer.js";

/**
 * C2 — API responses are compressed.
 *
 * ── WHAT THIS IS WORTH, AND WHY IT NEEDS A TEST AT ALL ──────────────────────────────────────────
 * Nothing compressed anything before this. The live map's board is 68.4 KB of 171 near-identical
 * JSON objects and gzips ~93% smaller, which at 30 dispatchers polling every 5 s is the difference
 * between 27.3 and 2.0 MB per minute of egress.
 *
 * `app.use(compression())` is one line, so the risk is not that it is written wrongly — it is that it
 * is MOUNTED wrongly, or later moved below the routers, where it silently does nothing. Compression
 * works by wrapping `res.write`/`res.end`, so it only affects handlers registered after it, and a
 * regression here produces no error anywhere: just a product that quietly costs 13× the bandwidth.
 *
 * ⚠ The second describe is the one with teeth. A basemap tile is an already-compressed photograph,
 * and re-encoding it would spend CPU to make it bigger — and would re-buffer a route that was
 * deliberately changed to stream (B2, #853).
 */
const realFetch = globalThis.fetch;

/**
 * A GET that does NOT decode the body.
 *
 * ⚠ Written because the first draft asserted on `content-length` and got `NaN`. `compression`
 * switches to chunked transfer encoding when it encodes, so there IS no declared length — and
 * `fetch` decompresses transparently besides, so neither the header nor the decoded body can show
 * what actually crossed the wire. Counting raw chunks off `node:http` is the only honest measurement
 * of a saving expressed in bytes.
 */
function rawGet(
  url: string,
  acceptEncoding: string,
): Promise<{ bytes: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { "accept-encoding": acceptEncoding } }, (res) => {
      let bytes = 0;
      res.on("data", (c: Buffer) => {
        bytes += c.length;
      });
      res.on("end", () => resolve({ bytes, headers: res.headers }));
    });
    req.on("error", reject);
  });
}

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  HERE_API_KEY: "test-here-key",
} as NodeJS.ProcessEnv);

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = createApp(env);
  app.locals.verifyToken = async (token: string): Promise<AuthContext> =>
    ({ userId: `u-${token}`, email: "t@x.test", orgId: "org-1", role: "admin" }) as AuthContext;
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API responses are compressed (C2)", () => {
  /**
   * ⚠ `/api/version` is JSON but SHORT, and `compression` has a 1 KB threshold by default — so the
   * honest assertion on a small response is not "it is gzipped" but "the compressor saw it".
   * Asserting `content-encoding` here would pin a behaviour that does not exist, and would fail for
   * the right reason the day somebody tuned the threshold.
   *
   * `Vary: Accept-Encoding` is what the middleware sets on everything it handles, threshold or not,
   * and nothing else in this app sets it — so it is the cheapest proof that the mount is in the
   * chain at all. The size saving is measured separately, on a body built to clear the threshold.
   */
  it("advertises that it varies on accept-encoding, which only the compressor sets", async () => {
    const res = await realFetch(`${baseUrl}/api/version`, {
      headers: { "accept-encoding": "gzip" },
    });
    // `compression` sets `Vary: Accept-Encoding` on every response it handles, threshold or not.
    // Nothing else in this app sets that header, so it is the proof the middleware is in the chain.
    expect(res.headers.get("vary") ?? "").toMatch(/accept-encoding/i);
  });

  it("gzips a response that clears the size threshold", async () => {
    // A body of repeated JSON, which is the shape every list endpoint in this product returns.
    const big = JSON.stringify({ rows: Array.from({ length: 400 }, (_, i) => ({ id: i, unit: `unit-${i}`, note: "Green Bay, WI" })) });
    expect(big.length).toBeGreaterThan(1024);

    const app = createApp(env);
    app.get("/api/_rig/big", (_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(big);
    });
    const rig = app.listen(0);
    await new Promise<void>((r) => rig.once("listening", () => r()));
    const url = `http://127.0.0.1:${(rig.address() as AddressInfo).port}/api/_rig/big`;
    try {
      const gz = await rawGet(url, "gzip");
      expect(gz.headers["content-encoding"]).toBe("gzip");
      const plain = await rawGet(url, "identity");
      expect(plain.headers["content-encoding"]).toBeUndefined();

      expect(plain.bytes).toBe(big.length);
      // The whole point, as a number rather than a claim: repeated JSON of this shape is the live
      // map's own shape, and it goes over the wire at a fraction of its size.
      expect(gz.bytes).toBeLessThan(big.length / 5);
    } finally {
      await closeTestServer(rig);
    }
  });

  it("leaves a client that cannot accept an encoding alone", async () => {
    const res = await realFetch(`${baseUrl}/api/version`, { headers: { "accept-encoding": "identity" } });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.status).toBe(200);
  });
});

/**
 * ⚠⚠ THE TILE PROXY MUST STAY OUT OF THE COMPRESSOR, AND THIS IS THE ASSERTION THAT SAYS SO.
 *
 * A basemap tile is an already-compressed photograph: gzipping it spends CPU to make it marginally
 * bigger. Worse, B2 (#853) changed that route to STREAM its body precisely so the browser's headers
 * arrive on HERE's clock — and an encoder in the path re-buffers it.
 *
 * `compression` gets this right on its own by consulting `compressible(content-type)`, which is false
 * for `image/png`. That is a property of a dependency rather than of our code, which is exactly why it
 * is pinned here: it would change under us silently.
 */
describe("the basemap tile is not re-encoded", () => {
  it("serves a png tile with no content-encoding", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        Readable.toWeb(Readable.from(
          (async function* () {
            for (let i = 0; i < 8; i += 1) yield Buffer.alloc(4096, i + 1);
          })(),
          { objectMode: false },
        )) as ReadableStream<Uint8Array>,
        { status: 200, headers: { "content-type": "image/png" } },
      ),
    );
    const res = await realFetch(`${baseUrl}/api/fueling/map-tiles/5/8/9`, {
      headers: { Authorization: "Bearer admin", "accept-encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-encoding")).toBeNull();
    // And the whole tile still arrives — the stream survived the middleware being in the chain.
    expect(Buffer.from(await res.arrayBuffer()).byteLength).toBe(8 * 4096);
  });
});
