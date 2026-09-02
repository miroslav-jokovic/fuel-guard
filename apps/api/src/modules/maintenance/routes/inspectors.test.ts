import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The §396.19 register's write routes.
 *
 * ── WHY THE DELETE IS TESTED AND THE RETIREMENT MOSTLY IS NOT ──────────────────────────────────
 * Retiring is an UPDATE of one nullable column and the register page proves the behaviour. Deleting
 * is the route that can destroy evidence if its boundary is wrong, and its boundary is not in this
 * code — it is 0280's `on delete restrict`. So what has to be pinned here is the TRANSLATION: that a
 * constraint violation becomes a 409 saying "retire them instead" rather than a 500, and that the
 * delete still carries its `org_id` so one carrier cannot remove another's inspector.
 *
 * The API reads with the service role, which bypasses RLS (root CLAUDE.md), so `expectOrgScoped` is
 * the only tenancy boundary on the query below.
 */
const ORG = "org-1";
const USER = "user-1";
const INSPECTOR = "33333333-3333-4333-8333-333333333333";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
const audit = vi.hoisted(() => ({ writeAudit: vi.fn(async () => true) }));
vi.mock("../../../lib/audit.js", () => audit);
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: USER, orgId: ORG, role: "technician", email: "shop@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  // P3 swapped this router's gates to `requireSection`; the stubs open the door the same way
  // `requireRole`'s always has. What each gate ADMITS is proved in middleware/requireSection.test.ts
  // against the real implementation — stubbing it here would only prove the stub.
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { inspectorsRouter } = await import("./inspectors.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance/inspectors", inspectorsRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await closeTestServer(server);
  }
}

interface Body {
  ok?: boolean;
  error?: { code?: string; message?: string };
}

const del = (base: string, id = INSPECTOR) =>
  fetch(`${base}/api/maintenance/inspectors/${id}`, { method: "DELETE" });

/** `Response` is express's in this file — this one is fetch's. */
const bodyOf = async (res: Awaited<ReturnType<typeof fetch>>): Promise<Body> => (await res.json()) as Body;

beforeEach(() => {
  audit.writeAudit.mockClear();
});

describe("removing somebody from the register", () => {
  it("removes a row nothing points at, and audits that it did", async () => {
    rec = createSupabaseRecorder({ tables: { maintenance_inspectors: { data: [], count: 1 } } });
    const body = await withServer(async (base) => bodyOf(await del(base)));

    expect(body.ok).toBe(true);
    const write = rec.writes().find((w) => w.table === "maintenance_inspectors");
    expect(write?.write?.method).toBe("delete");
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "maintenance.inspector_deleted", entityId: INSPECTOR }),
    );
  });

  it("scopes the delete to the caller's org, because the service role bypasses RLS", async () => {
    rec = createSupabaseRecorder({ tables: { maintenance_inspectors: { data: [], count: 1 } } });
    await withServer(async (base) => del(base));
    expectOrgScoped(rec, ORG);
  });

  it("refuses with a 409 and the retire sentence when a report names them", async () => {
    // What Postgres raises when `on delete restrict` bites (0280). The whole point of the route is
    // that this arrives as an answerable refusal rather than as a 500 nobody can act on.
    rec = createSupabaseRecorder({
      tables: {
        maintenance_inspectors: {
          data: [],
          writeError: { code: "23503", message: "violates foreign key constraint" },
        },
      },
    });
    const res = await withServer(async (base) => del(base));
    const body = await bodyOf(res);

    expect(res.status).toBe(409);
    expect(body.error?.code).toBe("has_inspections");
    expect(body.error?.message).toContain("Retire them instead");
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  it("is a 404 when the id belongs to nobody", async () => {
    rec = createSupabaseRecorder({ tables: { maintenance_inspectors: { data: [], count: 0 } } });
    const res = await withServer(async (base) => del(base));
    expect(res.status).toBe(404);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });
});
