import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The per-person Dashboard layout at the API layer (LM10, D-DW3).
 *
 * ── WHY THIS FILE EXISTS AT ALL, GIVEN user-dashboard-layout.test.mjs ───────────────────────────
 * The PGlite matrix proves 0343's own-row policy, and that policy guards PostgREST. It does NOT
 * guard these handlers: the API reads with the SERVICE ROLE, which bypasses RLS entirely (root
 * CLAUDE.md). For anything reaching the database through this router the `.eq("org_id")` and
 * `.eq("user_id")` filters are the only isolation there is, exactly as `savedViews.test.ts` records
 * for the other table in this product addressed to a person rather than to an organisation.
 *
 * ── AND WHAT IT PINS THAT THE MATRIX CANNOT ────────────────────────────────────────────────────
 * That `null` survives the round trip. "No row" is D-DW3's third state and it is the one a
 * well-meaning handler flattens into `{ widgetKeys: [], hiddenKeys: [] }` — which reads as "this
 * person chose to see nothing" and would silently freeze their dashboard empty for ever.
 */
const ORG = "org-1";
const USER = "user-1";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "dispatcher", email: "tester@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { dashboardLayoutRouter } = await import("./dashboardLayout.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard-layout", dashboardLayoutRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}

/** Real catalogue keys — the router checks against `DASHBOARD_WIDGETS`, so invented ones would 400. */
const KEPT = ["dispatch.live-map", "fleet.kpi-hero"];
const HIDDEN = ["fleet.severity"];

const seed = (rows: unknown[]) => createSupabaseRecorder({ tables: { user_dashboard_layout: rows } });

beforeEach(() => {
  rec = seed([{ widget_keys: KEPT, hidden_keys: HIDDEN }]);
});

async function getLayout() {
  return withServer(async (base) => {
    const res = await fetch(`${base}/api/dashboard-layout`);
    expect(res.status).toBe(200);
    return (await res.json()) as { layout: { widgetKeys: string[]; hiddenKeys: string[] } | null };
  });
}

describe("dashboard layout API", () => {
  it("returns the caller's own row, scoped by both org and user", async () => {
    const body = await getLayout();
    expect(body.layout).toEqual({ widgetKeys: KEPT, hiddenKeys: HIDDEN });

    expectOrgScoped(rec, ORG);
    expect(rec.queries[0]!.filters()).toContainEqual({ col: "user_id", val: USER });
  });

  it("answers null for a caller with no row, rather than an empty layout", async () => {
    rec = seed([]);
    const body = await getLayout();
    // ⚠ Not `{ widgetKeys: [], hiddenKeys: [] }`. That is a different answer and it means
    // "show me nothing" — see D-DW3 and this file's header.
    expect(body.layout).toBeNull();
  });

  it("saves the whole row in one upsert, naming the org and the user itself", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/dashboard-layout`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ widgetKeys: KEPT, hiddenKeys: HIDDEN }),
      });
      expect(res.status).toBe(204);
    });

    const write = rec.queries[0]!.write!;
    expect(write.method).toBe("upsert");
    const row = write.payload as Record<string, unknown>;
    // A complete payload: Postgres checks NOT NULL before conflict arbitration, which is why a
    // partial upsert is banned repo-wide (`lint:upserts`).
    expect(row).toMatchObject({
      org_id: ORG,
      user_id: USER,
      widget_keys: KEPT,
      hidden_keys: HIDDEN,
    });
    expect(row.updated_at).toBeTruthy();
  });

  it("stores an empty kept list, because that is a real choice and not a missing field", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/dashboard-layout`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ widgetKeys: [], hiddenKeys: KEPT }),
      });
      expect(res.status).toBe(204);
    });
    expect((rec.queries[0]!.write!.payload as Record<string, unknown>).widget_keys).toEqual([]);
  });

  it("refuses a key the catalogue does not know, rather than storing it", async () => {
    const status = await withServer(async (base) => {
      const res = await fetch(`${base}/api/dashboard-layout`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ widgetKeys: ["fleet.unicorns"], hiddenKeys: [] }),
      });
      return res.status;
    });
    expect(status).toBe(400);
    // …and it did not reach the database to find that out.
    expect(rec.queries).toHaveLength(0);
  });

  it("refuses a key that is both kept and hidden, as 0343's CHECK does", async () => {
    const status = await withServer(async (base) => {
      const res = await fetch(`${base}/api/dashboard-layout`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ widgetKeys: ["fleet.severity"], hiddenKeys: ["fleet.severity"] }),
      });
      return res.status;
    });
    expect(status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });

  it("restores the default by deleting the caller's own row and nobody else's", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/dashboard-layout`, { method: "DELETE" });
      expect(res.status).toBe(204);
    });

    const filters = rec.queries[0]!.filters();
    // Without BOTH of these, a reset would reach across to another reader's arrangement.
    expect(filters).toContainEqual({ col: "org_id", val: ORG });
    expect(filters).toContainEqual({ col: "user_id", val: USER });
  });
});
