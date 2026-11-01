import { describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * LR6 (LOADS-MIRROR-PLAN.md §3.2): the office's write paths onto a load are GONE, not hidden.
 *
 * Every load is McLeod's and every sync overwrites it (D-LMR2), so an edit, a reassignment or a
 * cancel written here would be silently undone minutes later, and approve/release gate nothing since a
 * load reaches its driver by Dispatch (D-LMR5). Hiding the buttons would have left each of these
 * callable by anything that is not the web app, which is no removal at all — so the router itself
 * must answer 404, as it would for any path it never had.
 *
 * Authenticated, entitled and a dispatcher: the only thing that can produce the 404 is the route's
 * absence. A 401 or a 403 would prove nothing about it.
 */

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LOAD = "11111111-2222-4333-8444-000000000001";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../../lib/audit.js", () => ({ writeAudit: async () => undefined }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "user-1", orgId: ORG, role: "dispatcher", email: "dispatch@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { dispatchRouter } = await import("./dispatch.js");

async function call(method: string, path: string, body: unknown = {}): Promise<number> {
  // The module gate asks the database; it says yes, so it is never the reason for an answer below.
  rec = createSupabaseRecorder({ rpc: { org_module_enabled: true }, tables: { loads: [], load_events: [] } });
  const app = express();
  app.use(express.json());
  app.use("/api/dispatch", dispatchRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dispatch${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });
    return res.status;
  } finally {
    await closeTestServer(server);
  }
}

describe("the retired office write paths (LR6)", () => {
  it.each([
    ["POST", "/loads", "create a load by hand (Q-LMR7)"],
    ["PATCH", `/loads/${LOAD}`, "edit a load McLeod overwrites"],
    ["POST", `/loads/${LOAD}/assign`, "reassign — writes loads.driver_id, which the next sync puts back"],
    ["POST", `/loads/${LOAD}/submit`, "submit for approval"],
    ["POST", `/loads/${LOAD}/approve`, "approve"],
    ["POST", `/loads/${LOAD}/release`, "release — superseded by Dispatch (D-LMR5)"],
    ["POST", `/loads/${LOAD}/reject`, "send back"],
    ["POST", `/loads/${LOAD}/cancel`, "cancel — McLeod's V already projects to canceled"],
    ["POST", "/loads/bulk", "bulk approve / release"],
  ])("%s %s is gone — %s", async (method, path) => {
    expect(await call(method, path, { reason: "x", ids: [LOAD], action: "approve", driver_id: LOAD })).toBe(404);
    expect(rec.writes()).toHaveLength(0);
  });
});

/**
 * Q-DB10 (DISPATCH-BOARD-PLAN.md, ruled (b) 2026-10-16): the assignments board's list and its End
 * shift write are gone with the screen that used them. Production never opened a duty session; the
 * 16-hour sweeper is now the only close of one a driver leaves open.
 */
describe("the retired assignments board (Q-DB10)", () => {
  const SESSION = "33333333-2222-4333-8444-000000000001";
  it.each([
    ["GET", "/assignments", "the duty board's list — no screen has read it since #1426"],
    ["POST", `/assignments/${SESSION}/end`, "End shift from the office"],
  ])("%s %s is gone — %s", async (method, path) => {
    expect(await call(method, path)).toBe(404);
    expect(rec.writes()).toHaveLength(0);
    expect(rec.rpcs().map((r) => r.fn)).not.toContain("end_duty_session_by_id");
  });
});

describe("what stays", () => {
  // The control for the block above: the same harness reaches a live route, so a 404 there is the
  // route's absence and not a harness that 404s everything.
  it("still serves the board", async () => {
    expect(await call("GET", "/loads")).toBe(200);
  });

  it("still lets the office clear an exception a driver's decline raised", async () => {
    const status = await call("POST", `/loads/${LOAD}/exceptions/resolve`, {
      event_id: null,
      kind: "declined",
      action: "reassign",
    });
    expect(status).toBe(200);
  });

  it("still serves the assignment history, which outlives the board it sat beside", async () => {
    expect(await call("GET", "/assignments/history?from=bad")).toBe(400);
  });

  it("still validates Dispatch rather than 404ing it", async () => {
    expect(await call("POST", `/loads/${LOAD}/dispatch`, { driverId: "not-a-uuid" })).toBe(400);
  });

  it("answers the palette's load search rather than reading 'search' as a load id (D-SB8)", async () => {
    expect(await call("GET", "/loads/search?q=1042")).toBe(200);
    expect(rec.queries.some((q) => q.table === "loads" && q.ops.some((o) => o.method === "ilike"))).toBe(true);
  });
});
