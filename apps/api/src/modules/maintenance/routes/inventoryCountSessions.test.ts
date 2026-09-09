import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/maintenance/inventory/count-sessions` (INVENTORY-PLAN.md step I5, PR 2a).
 *
 * The matrix owns 0332's promises and `countSessions.test.ts` owns the service. What is left is the
 * translation, and each item below is invisible from either side:
 *
 *   · **`IV017` must arrive as a 409.** 0332's trigger raises it for a second close; a 500 would put
 *     "Something went wrong" in front of somebody who simply closed the walk twice — which is what a
 *     phone with a bad connection does by design;
 *   · **the body carries no session id.** The route must not accept one: D-INV27 makes a MOVEMENT's
 *     id the client's, and a session's is the server's, so a route that passed a client id through
 *     would let two taps of Start make two walks and would break no service test;
 *   · **the org filter**, because a route builds its own queries and the service role bypasses RLS;
 *   · **no `audit_logs` row.** The same split the movement routes draw: a walk records who opened it
 *     and when, and an audit row would carry less than the thing it describes.
 */

const ORG = "org-1";
const USER = "user-1";
const SESSION = "11111111-1111-4111-8111-111111111111";
const BAY = "22222222-2222-4222-8222-222222222222";

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
  // What each gate ADMITS is proved in middleware/requireSection.test.ts against the real
  // implementation; stubbing it here would only prove the stub.
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { inventoryCountSessionsRouter } = await import("./inventoryCountSessions.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance/inventory/count-sessions", inventoryCountSessionsRouter());
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
  session?: { id: string; status: string; blind: boolean; holderLabel: string | null };
  sessions?: Array<{ id: string }>;
  total?: number;
}
const bodyOf = async (res: Awaited<ReturnType<typeof fetch>>): Promise<Body> => (await res.json()) as Body;

const call = (base: string, path: string, method: string, body?: unknown) =>
  fetch(`${base}/api/maintenance/inventory/count-sessions${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: SESSION,
  kind: "location",
  location_id: BAY,
  vehicle_id: null,
  trailer_id: null,
  started_by: USER,
  blind: true,
  status: "open",
  opened_at: "2026-09-09T10:00:00.000Z",
  closed_at: null,
  note: null,
  stock_locations: { name: "Main bay" },
  vehicles: null,
  trailers: null,
  ...over,
});

beforeEach(() => {
  audit.writeAudit.mockClear();
  rec = createSupabaseRecorder({ tables: { stock_count_sessions: [sessionRow()] } });
});

describe("reading the walks", () => {
  it("lists them, org-scoped", async () => {
    const body = await withServer(async (base) => bodyOf(await call(base, "", "GET")));
    expect(body.ok).toBe(true);
    expect(body.sessions?.[0]?.id).toBe(SESSION);
    expectOrgScoped(rec, ORG, { exempt: ["user_profiles"] });
  });

  it("refuses a filter value it does not understand rather than ignoring it", async () => {
    const res = await withServer((base) => call(base, "?status=halfway", "GET"));
    expect(res.status).toBe(400);
  });

  it("answers 404 for an id that is not this org's", async () => {
    rec = createSupabaseRecorder({ tables: { stock_count_sessions: () => [] } });
    const res = await withServer((base) => call(base, `/${SESSION}`, "GET"));
    expect(res.status).toBe(404);
  });
});

describe("opening a walk", () => {
  it("answers 201 with the session, and writes no audit row", async () => {
    const res = await withServer((base) =>
      call(base, "", "POST", { kind: "location", locationId: BAY, blind: true }),
    );
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).session?.id).toBe(SESSION);
    // The same split the movement routes draw — see this file's header.
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /**
   * ⚠ The one that would break the offline story silently. A session's id is the SERVER's; a
   * movement's is the CLIENT's (D-INV27). `countSessionInputSchema` carries no `id`, and zod STRIPS
   * unknown keys rather than rejecting them — so the proof has to be what was WRITTEN, not a 400.
   * That is the correction I1 already had to make once about this same class of assertion.
   */
  it("never lets a client-supplied id reach the row", async () => {
    await withServer((base) =>
      call(base, "", "POST", { id: "cafe0000-0000-4000-8000-000000000000", kind: "location", locationId: BAY, blind: true }),
    );
    const written = rec.writtenRows("stock_count_sessions")[0] ?? {};
    expect(Object.keys(written)).not.toContain("id");
  });

  it("refuses a walk about two places, with the rule rather than a 500", async () => {
    const res = await withServer((base) =>
      call(base, "", "POST", { kind: "location", locationId: BAY, trailerId: BAY, blind: true }),
    );
    // Caught by the contract's own refinement before it reaches the database.
    expect(res.status).toBe(400);
  });

  it("turns the database's holder refusal into a 422 that names the place", async () => {
    rec = createSupabaseRecorder({
      tables: { stock_count_sessions: () => ({ error: { code: "23503", message: "fk" } }) },
    });
    const res = await withServer((base) =>
      call(base, "", "POST", { kind: "location", locationId: BAY, blind: true }),
    );
    expect(res.status).toBe(422);
    expect((await bodyOf(res)).error?.code).toBe("IV012");
  });
});

describe("closing a walk", () => {
  it("closes it and answers with the closed session", async () => {
    rec = createSupabaseRecorder({
      tables: { stock_count_sessions: [sessionRow({ status: "closed", closed_at: "2026-09-09T11:00:00.000Z" })] },
    });
    const body = await withServer(async (base) => bodyOf(await call(base, `/${SESSION}/close`, "POST", {})));
    expect(body.session?.status).toBe("closed");
  });

  /**
   * The assertion this file exists for. A phone that closes a walk and loses its connection retries;
   * the second close hits 0332's trigger. 409 lets the screen say "already closed"; a 500 says
   * nothing anybody can act on, and the walk really did close.
   */
  it("answers 409 when the walk is already closed, not 500", async () => {
    rec = createSupabaseRecorder({
      tables: { stock_count_sessions: () => ({ error: { code: "IV017", message: "closed" } }) },
    });
    const res = await withServer((base) => call(base, `/${SESSION}/close`, "POST", {}));
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe("IV017");
  });

  it("answers 404 for a walk that is not this org's", async () => {
    rec = createSupabaseRecorder({ tables: { stock_count_sessions: () => [] } });
    const res = await withServer((base) => call(base, `/${SESSION}/close`, "POST", {}));
    expect(res.status).toBe(404);
  });

  it("keeps a 500 meaning what it means everywhere else", async () => {
    // An unmapped SQLSTATE is not swept into the IV table — `42P01` is a bug, not a shelf condition.
    rec = createSupabaseRecorder({
      tables: { stock_count_sessions: () => ({ error: { code: "42P01", message: "no such table" } }) },
    });
    const res = await withServer((base) => call(base, `/${SESSION}/close`, "POST", {}));
    expect(res.status).toBe(500);
  });
});
