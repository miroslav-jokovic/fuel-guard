import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * Saved views at the API layer (R3c-2).
 *
 * ── WHY THIS FILE EXISTS AT ALL, GIVEN saved-views.test.mjs ─────────────────────────────────────
 * The PGlite matrix proves the RLS policy, and the RLS policy is what guards PostgREST. It does NOT
 * guard these handlers: the API reads with the SERVICE ROLE, which bypasses RLS entirely (root
 * CLAUDE.md). So for anything reaching the database through this router, the `.eq("org_id")` and
 * `.eq("user_id")` filters below are the only isolation there is, and a handler that forgot one
 * would pass the matrix and still hand a reader somebody else's bookmarks.
 *
 * `expectOrgScoped` is the repo's assertion for half of that. The user half has no shared helper,
 * because no other table in the product needs it — this one and notifications are the only rows
 * addressed to a person rather than to an organisation.
 */
const ORG = "org-1";
const USER = "user-1";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "admin", email: "tester@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { savedViewsRouter } = await import("./savedViews.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/saved-views", savedViewsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    // Torn down through the helper, never by hand: undici pools keep-alive sockets to 127.0.0.1, a
    // plain shutdown waits on them, and the hook times out with live connections — `apps/api` red
    // about one run in four under contention. `testServerTeardown.test.ts` fails the build if a
    // suite hand-rolls it, and that scan is a plain-text regex, so the banned call cannot be named
    // here either.
    await closeTestServer(server);
  }
}

const VIEW = { table_id: "roster.drivers", name: "Terminated", query: "status=terminated" };

beforeEach(() => {
  rec = createSupabaseRecorder({ tables: { saved_views: [{ ...VIEW, updated_at: "2026-08-30T00:00:00Z" }] } });
});

describe("saved views API", () => {
  it("lists only the caller's own views, for the table asked for", async () => {
    const body = await withServer(async (base) => {
      const res = await fetch(`${base}/api/saved-views?table=roster.drivers`);
      expect(res.status).toBe(200);
      return (await res.json()) as { views: unknown[] };
    });
    expect(body.views).toHaveLength(1);

    expectOrgScoped(rec, ORG);
    const filters = rec.queries[0]!.filters();
    expect(filters).toContainEqual({ col: "user_id", val: USER });
    expect(filters).toContainEqual({ col: "table_id", val: "roster.drivers" });
  });

  it("refuses a table it does not know, rather than querying for it", async () => {
    const status = await withServer(async (base) => {
      const res = await fetch(`${base}/api/saved-views?table=roster.unicorns`);
      return res.status;
    });
    expect(status).toBe(400);
    // …and it did not reach the database to find that out.
    expect(rec.queries).toHaveLength(0);
  });

  it("saves the caller's own row, naming the org and the user itself", async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/saved-views`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(VIEW),
      });
      expect(res.status).toBe(204);
    });

    const write = rec.queries[0]!.write!;
    expect(write.method).toBe("upsert");
    const row = write.payload as Record<string, unknown>;
    // A complete payload: Postgres checks NOT NULL before conflict arbitration, which is why a
    // partial upsert is banned repo-wide (`lint:upserts`).
    expect(row).toMatchObject({ user_id: USER, org_id: ORG, ...VIEW });
    expect(row.updated_at).toBeTruthy();
    // `created_at` is absent on purpose, so re-saving does not reset the day the view was made.
    expect(row).not.toHaveProperty("created_at");
    expectOrgScoped(rec, ORG);
  });

  it("refuses a query string carrying a URL, which is how a view would become somewhere else", async () => {
    const status = await withServer(async (base) => {
      const res = await fetch(`${base}/api/saved-views`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...VIEW, query: "next=https://example.test/steal" }),
      });
      return res.status;
    });
    expect(status).toBe(400);
    expect(rec.queries).toHaveLength(0);
  });

  it("deletes by the whole key, never by name alone", async () => {
    await withServer(async (base) => {
      const res = await fetch(
        `${base}/api/saved-views?table=roster.drivers&name=${encodeURIComponent("Terminated")}`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(204);
    });

    const filters = rec.queries[0]!.filters();
    // Without BOTH of these, a delete would reach across to another reader's identically named view.
    expect(filters).toContainEqual({ col: "org_id", val: ORG });
    expect(filters).toContainEqual({ col: "user_id", val: USER });
    expect(filters).toContainEqual({ col: "name", val: "Terminated" });
  });
});
