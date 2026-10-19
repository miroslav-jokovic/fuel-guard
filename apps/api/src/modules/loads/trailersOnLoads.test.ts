import { describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../testing/httpServer.js";

/**
 * The McLeod half of "which trailer is on which truck" (TRAILER-LINK-PLAN TL4): one load per truck, by the
 * map's rule, and the route gated as the Trailers page is. The recorder returns every fixture row, so the
 * choice among them is the reader's.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
let rec: SupabaseRecorder;
const gates: unknown[][] = [];
vi.mock("../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "user-1", orgId: ORG, role: "fleet_manager", email: "fm@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: (...args: unknown[]) => {
    const tag = args.join(":");
    return (req: Request, _res: Response, next: NextFunction) => {
      gates.push([req.path, tag]);
      next();
    };
  },
}));

const { readTrailersOnLoads } = await import("./liveLoadReads.js");
const { dispatchRouter } = await import("./routes/dispatch.js");

const loads = [
  { id: "l-next", vehicle_id: "v-1", trailer_id: "t-next", ref: "300", status: "approved", source: "tms" },
  { id: "l-now", vehicle_id: "v-1", trailer_id: "t-now", ref: "301", status: "in_transit", source: "tms" },
  { id: "l-done", vehicle_id: "v-2", trailer_id: "t-done", ref: "200", status: "delivered", source: "tms" },
  { id: "l-bob", vehicle_id: "v-3", trailer_id: null, ref: "400", status: "in_transit", source: "tms" },
];

describe("readTrailersOnLoads", () => {
  it("names the trailer on the load each truck is driving, one per truck, none for a bobtail", async () => {
    rec = createSupabaseRecorder({ tables: { loads: { data: loads } } });
    expect(await readTrailersOnLoads(rec.client, ORG)).toEqual([{ trailerId: "t-now", vehicleId: "v-1", loadId: "l-now", ref: "301" }]);
    expectOrgScoped(rec, ORG);
  });
});

describe("GET /api/dispatch/trailers-on-loads", () => {
  it("is gated on equipment: view, the Trailers page's own section, not dispatch", async () => {
    rec = createSupabaseRecorder({ rpc: { org_module_enabled: true }, tables: { loads: { data: loads } } });
    const app = express();
    app.use("/api/dispatch", dispatchRouter());
    const server: Server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    try {
      gates.length = 0;
      const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/dispatch/trailers-on-loads`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ trailers: [{ trailerId: "t-now", vehicleId: "v-1", loadId: "l-now", ref: "301" }] });
      expect(gates).toEqual([["/trailers-on-loads", "equipment:view"]]);
    } finally {
      await closeTestServer(server);
    }
  });
});
