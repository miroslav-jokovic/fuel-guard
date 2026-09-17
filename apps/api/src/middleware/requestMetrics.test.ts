import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { loadEnv } from "../env.js";
import { closeTestServer } from "../testing/httpServer.js";
import {
  normalizeRoutePath,
  snapshotRequestMetrics,
  resetRequestMetrics,
  formatMetricsLine,
  startRequestMetricsReporter,
} from "./requestMetrics.js";

/**
 * C7 — the API can say what it is serving.
 *
 * Before this it could not: no `morgan`, no `pino`, no middleware, no logging dependency, and zero
 * log lines from either Railway service for any route. Three performance changes shipped in one
 * afternoon and none of them could be observed working in production.
 *
 * ⚠ The two constraints are as load-bearing as the feature. It must not cost a log line per tile
 * (the proxy serves dozens per dispatcher per camera move), and it must not record anything
 * identifying — the repo's rule is never to log PII, and a raw request path is full of it.
 */

const env = loadEnv({
  NODE_ENV: "test",
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} as NodeJS.ProcessEnv);

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app = createApp(env);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await closeTestServer(server);
});

beforeEach(() => resetRequestMetrics());
afterEach(() => resetRequestMetrics());

/**
 * ⚠⚠ THE PRIVACY RULES, AND THEY ARE RULES RATHER THAN TIDINESS. Every one of these is a way a
 * person could otherwise end up in a log line, and each is a real path shape in this product.
 */
describe("what a request path is reduced to before it is recorded", () => {
  it("drops the query string entirely, which is where people are", () => {
    expect(normalizeRoutePath("/api/roster/drivers?q=ana.ruiz%40example.com&status=active")).toBe(
      "/api/roster/drivers",
    );
    expect(normalizeRoutePath("/api/reports?email=someone@example.com")).not.toContain("@");
  });

  /**
   * ⚠ Two rules catch a uuid, and that is deliberate belt and braces: the explicit pattern, and the
   * length guard below it. Measured by mutation — disabling the pattern alone does NOT fail this,
   * because a uuid is 36 characters and the opaque-token rule collects it anyway. Recorded rather
   * than presented as one assertion proving one rule.
   */
  it("collapses a uuid in a path to a placeholder", () => {
    expect(normalizeRoutePath("/api/roster/drivers/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/credentials")).toBe(
      "/api/roster/drivers/:id/credentials",
    );
  });

  it("collapses numeric ids, so a tile coordinate is one route and not thousands", () => {
    expect(normalizeRoutePath("/api/fueling/map-tiles/5/8/9")).toBe("/api/fueling/map-tiles/:n/:n/:n");
    expect(normalizeRoutePath("/api/fueling/map-tiles/12/1063/1541")).toBe(
      "/api/fueling/map-tiles/:n/:n/:n",
    );
  });

  it("collapses a long opaque token, which is what an invite link carries", () => {
    const token = "a".repeat(43);
    const shape = normalizeRoutePath(`/api/public/invites/${token}`);
    expect(shape).toBe("/api/public/invites/:id");
    expect(shape).not.toContain(token);
  });

  it("does not enumerate the SPA and its per-deploy asset hashes", () => {
    expect(normalizeRoutePath("/assets/index-D4f8Ka1b.js")).toBe("<non-api>");
    expect(normalizeRoutePath("/dashboard")).toBe("<non-api>");
    // The health check is worth seeing by name — it is how uptime is judged.
    expect(normalizeRoutePath("/healthz")).toBe("/healthz");
  });

  it("caps depth, so a generated path cannot invent keys forever", () => {
    const deep = normalizeRoutePath("/api/" + Array.from({ length: 30 }, (_, i) => `seg${i}`).join("/"));
    expect(deep.split("/").length).toBeLessThanOrEqual(10);
    expect(deep.endsWith("…")).toBe(true);
  });
});

describe("what the middleware records", () => {
  it("counts a served request under its route shape, with a duration", async () => {
    await fetch(`${baseUrl}/api/version`);
    const s = snapshotRequestMetrics();
    expect(s.requests).toBe(1);
    expect(s.statusClasses["2xx"]).toBe(1);
    expect(s.byRoute[0]?.route).toBe("GET /api/version");
    expect(s.max).toBeGreaterThanOrEqual(0);
  });

  /**
   * ⚠⚠ THE ASSERTION C7 EXISTS FOR. C1 shipped because thirty dispatchers were being refused and
   * nobody could see it. A limiter answers a refused request and returns, so a metrics middleware
   * mounted below one counts none of them.
   *
   * ⚠ WHAT THIS PINS, EXACTLY. Moving the mount below `mountApiRouters` fails this and three others,
   * so "above the routers" is held. It does NOT separately hold "above `mountGeneralRateLimits`":
   * that limiter sits between the mount and the routers, and reaching it costs 1 200 requests —
   * a suite of that for one counter is a worse trade than the gap. Said out loud because the first
   * draft of this comment claimed the stronger property, and a mutation moving the mount between the
   * two passed.
   */
  it("counts a refusal, which is the thing nobody could see", async () => {
    const app = createApp(env);
    const rig = app.listen(0);
    await new Promise<void>((r) => rig.once("listening", () => r()));
    const url = `http://127.0.0.1:${(rig.address() as AddressInfo).port}/api/public/invites/redeem`;
    try {
      resetRequestMetrics();
      // `/api/public/invites` carries its own 20-per-minute bucket, so 25 requests cross it —
      // reachable in a test, unlike the general 1 200 budget.
      for (let i = 0; i < 25; i += 1) await fetch(url, { method: "POST" });
      const s = snapshotRequestMetrics();
      expect(s.requests).toBe(25);
      expect(s.refused429).toBeGreaterThan(0);
      expect(s.statusClasses["4xx"]).toBeGreaterThan(0);
    } finally {
      await closeTestServer(rig);
    }
  });

  it("folds many requests into one window rather than one record each", async () => {
    for (let i = 0; i < 12; i += 1) await fetch(`${baseUrl}/api/version`);
    const s = snapshotRequestMetrics();
    expect(s.requests).toBe(12);
    // Twelve requests, ONE route shape — which is the property that makes a summary possible.
    expect(s.distinctRoutes).toBe(1);
    expect(s.byRoute[0]?.count).toBe(12);
  });
});

describe("the summary that reaches the log", () => {
  /**
   * ⚠ The constraint from the plan, as an assertion: "must not cost a log line per tile". A hundred
   * requests must produce exactly one line, or the tile proxy alone would flood Railway's stream.
   */
  it("emits one line per window however many requests it covers", async () => {
    const lines: string[] = [];
    const timer = startRequestMetricsReporter(20, (l) => lines.push(l));
    try {
      for (let i = 0; i < 100; i += 1) await fetch(`${baseUrl}/api/version`);
      await new Promise((r) => setTimeout(r, 60));
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThan(5);
      const covered = lines.reduce((n, l) => n + (JSON.parse(l.replace("[metrics] ", "")) as { requests: number }).requests, 0);
      expect(covered).toBeGreaterThanOrEqual(100);
    } finally {
      clearInterval(timer);
    }
  });

  it("says nothing at all when nothing was served", async () => {
    const lines: string[] = [];
    const timer = startRequestMetricsReporter(20, (l) => lines.push(l));
    try {
      await new Promise((r) => setTimeout(r, 70));
      expect(lines).toEqual([]);
    } finally {
      clearInterval(timer);
    }
  });

  it("is one greppable line carrying the numbers a summary is read for", async () => {
    await fetch(`${baseUrl}/api/version`);
    const line = formatMetricsLine(snapshotRequestMetrics());
    expect(line.startsWith("[metrics] ")).toBe(true);
    expect(line).not.toContain("\n");
    const parsed = JSON.parse(line.replace("[metrics] ", "")) as Record<string, unknown>;
    expect(parsed).toHaveProperty("rps");
    expect(parsed).toHaveProperty("refused429");
    expect((parsed.latencyMs as Record<string, number>).p95).toBeGreaterThanOrEqual(0);
  });

  /**
   * ⚠ The timer must not hold the event loop open. Without `unref` every process that started one —
   * including every test run — would refuse to exit, which is a hang rather than a failure and is
   * read as a flake.
   */
  it("does not keep the process alive", () => {
    const timer = startRequestMetricsReporter(1_000, () => {});
    try {
      expect(timer.hasRef()).toBe(false);
    } finally {
      clearInterval(timer);
    }
  });
});
