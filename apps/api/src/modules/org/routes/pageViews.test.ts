import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The page-view writer at the API layer (X1, 0435).
 *
 * The PGlite matrix `surface-page-views.test.mjs` proves the function counts and refuses bad shapes.
 * What only this file can prove is what the SERVER puts beside the keys: the org and the role from the
 * token rather than the body, and the org's calendar day rather than UTC's — a view at 8 pm Central is
 * still that day's view, though UTC has moved on.
 */
const ORG = "org-1";
let role: string | null = "dispatcher";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "user-1", orgId: ORG, role, email: "tester@example.test" } as Request["auth"];
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { pageViewsRouter } = await import("./pageViews.js");

/**
 * ONE server for the file. With a server per request, a random test failed with "fetch failed: other
 * side closed" in 2 of 4 local runs (2026-10-07); with one server, 0 of 10. The cause is not proven —
 * see the open api-test-flake question — so this is the measured fix, not an explanation.
 */
let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/page-views", pageViewsRouter());
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await closeTestServer(server);
});

async function post(body: unknown): Promise<number> {
  const res = await fetch(`${base}/api/page-views`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

const seed = (rpcError: unknown = null) =>
  createSupabaseRecorder({
    tables: { organizations: [{ operating_hours: { tz: "America/Los_Angeles" } }] },
    rpc: { record_surface_views: { data: 1, error: rpcError } },
  });

beforeEach(() => {
  role = "dispatcher";
  rec = seed();
  vi.useFakeTimers({ toFake: ["Date"] });
  // 05:30 UTC on 10-08 is 10:30 pm on 10-07 in Los Angeles — and already 10-08 in Chicago, the
  // default zone, so a handler that ignored the org's own zone would record the wrong day.
  vi.setSystemTime(new Date("2026-10-08T05:30:00Z"));
});

describe("page views API", () => {
  it("records the batch with the token's org and role and the org's calendar day", async () => {
    expect(await post({ keys: ["fuel.log", "fuel.log", "fuel.cards"] })).toBe(204);

    expect(rec.rpcs()).toEqual([
      {
        fn: "record_surface_views",
        args: { p_org: ORG, p_day: "2026-10-07", p_role: "dispatcher", p_keys: ["fuel.log", "fuel.log", "fuel.cards"] },
      },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("ignores a role or org in the body — only the token decides them", async () => {
    expect(await post({ keys: ["fuel.log"], role: "admin", orgId: "org-2" })).toBe(204);
    expect(rec.rpcs()[0]!.args).toMatchObject({ p_org: ORG, p_role: "dispatcher" });
  });

  it("drops keys the catalogue does not know and records the rest", async () => {
    expect(await post({ keys: ["fuel.log", "gone.screen"] })).toBe(204);
    expect(rec.rpcs()[0]!.args).toMatchObject({ p_keys: ["fuel.log"] });
  });

  it("writes nothing when no key is known", async () => {
    expect(await post({ keys: ["gone.screen"] })).toBe(204);
    expect(rec.rpcs()).toEqual([]);
  });

  it("writes nothing for a caller with no role", async () => {
    role = null;
    expect(await post({ keys: ["fuel.log"] })).toBe(204);
    expect(rec.rpcs()).toEqual([]);
  });

  it("refuses a path or a query string before anything is read", async () => {
    expect(await post({ keys: ["/drivers/abc"] })).toBe(400);
    expect(await post({ keys: ["fuel.log?card=4111"] })).toBe(400);
    expect(rec.queries).toEqual([]);
  });

  it("answers 500 when the database refuses, so the browser keeps nothing it thinks was saved", async () => {
    rec = seed({ message: "boom" });
    expect(await post({ keys: ["fuel.log"] })).toBe(500);
  });
});
