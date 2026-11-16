import { describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * The roll-up over HTTP (FLEETPAL-INTEGRATION-PLAN.md F9d). The bucketing arithmetic is proved pure in
 * `packages/shared/src/fleetpalRollup.test.ts`; this proves the rules that live in the read: the
 * refusal names its months, the bucket day is the carrier's and not UTC's, units page, every read is
 * org-scoped. F9b's own refusal is `fleetpalCost.test.ts`'s.
 */
const ORG = "org-1";
let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
vi.mock("../../org/index.js", async (orig) => ({ ...((await orig()) as object), orgTimezone: async () => "America/Chicago" }));
vi.mock("../../../middleware/auth.js", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { userId: "user-1", orgId: ORG, role: "fleet_manager", email: "shop@example.test" };
    next();
  },
  requireOrg: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireRole: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireSection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAnySection: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));
const { fleetpalCostRouter } = await import("./fleetpalCost.js");

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = express();
  app.use("/api/maintenance", fleetpalCostRouter());
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/maintenance${path}`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    await closeTestServer(server);
  }
}

const gl = (month: string) => ({
  period_start: `${month}-01`, period_end: `${month}-28`, swept_at: "2026-10-01T00:00:00Z",
  post_module: "AP", glid: "30230000", line_count: 1, net_amount: 10_000, abs_amount: 10_000,
});

function recorderWith(opts: { gl?: unknown[]; repairs?: unknown[]; units?: unknown[] }) {
  return createSupabaseRecorder({
    tables: {
      mcleod_gl_totals: () => ({ data: opts.gl ?? [gl("2026-06"), gl("2026-07")], error: null }),
      fleetpal_po_invoices: () => ({ data: [], error: null }),
      mcleod_ap_vouchers: () => ({ data: [], error: null }),
      fleetpal_units: () => ({
        data: opts.units ?? [
          { fleetpal_id: "U1", number: "777", vehicle_id: "truck-777", trailer_id: null },
          { fleetpal_id: "U2", number: "T9", vehicle_id: null, trailer_id: "trailer-9" },
        ],
        error: null,
      }),
      fleetpal_service_history: () => ({ data: opts.repairs ?? [], error: null }),
    },
  });
}

describe("GET /fleetpal/rollup", () => {
  it("⚠ refuses a window touching an unswept ledger month, and names the month", async () => {
    rec = recorderWith({ gl: [gl("2026-07")] });
    const { status, body } = await get("/fleetpal/rollup?from=2026-07-01&to=2026-09-01");
    expect(status).toBe(409);
    expect((body.error as { message: string }).message).toContain("2026-08");
    expect((body.error as { message: string }).message).not.toContain("2026-07");
    expect(JSON.stringify(body)).not.toContain("operational");
  });

  it("buckets on the carrier's calendar day: 03:00 UTC on 1 July is still 30 June in Chicago", async () => {
    rec = recorderWith({
      repairs: [
        { id: "a", unit_fleetpal_id: "U1", completed: "2026-07-01T03:00:00Z", total: 100, total_labor: 40 },
        { id: "b", unit_fleetpal_id: "U2", completed: "2026-07-15T15:00:00Z", total: 50, total_labor: null },
      ],
    });
    const { status, body } = await get("/fleetpal/rollup?from=2026-06-01&to=2026-08-01&bucket=month");
    expect(status).toBe(200);
    const buckets = body.buckets as Array<{ key: string; fleet: { operational: number | null; external: number | null }; byKind: Record<string, { operational: number | null }> }>;
    expect(buckets.map((b) => [b.key, b.fleet.operational, b.fleet.external])).toEqual([
      ["2026-06", 100, 60],
      ["2026-07", 50, 50],
    ]);
    expect(buckets[1]!.byKind.trailer!.operational).toBe(50);
    expect((body.coverage as unknown[]).length).toBe(2);
  });

  it("pages the unit rows and says how many there are", async () => {
    rec = recorderWith({
      repairs: [
        { id: "a", unit_fleetpal_id: "U1", completed: "2026-07-10T15:00:00Z", total: 100, total_labor: 0 },
        { id: "b", unit_fleetpal_id: "U2", completed: "2026-07-10T15:00:00Z", total: 50, total_labor: 0 },
      ],
    });
    const { body } = await get("/fleetpal/rollup?from=2026-07-01&to=2026-08-01&limit=1&offset=1");
    expect(body.unitTotal).toBe(2);
    expect((body.units as Array<{ label: string }>).map((u) => u.label)).toEqual(["T9"]);
  });

  it("reads every table org-scoped", async () => {
    rec = recorderWith({});
    await get("/fleetpal/rollup?from=2026-07-01&to=2026-08-01&bucket=week&kind=tractor");
    expectOrgScoped(rec, ORG);
  });

  it("refuses a bucket or kind it does not know", async () => {
    rec = recorderWith({});
    expect((await get("/fleetpal/rollup?from=2026-07-01&to=2026-08-01&bucket=day")).status).toBe(400);
    expect((await get("/fleetpal/rollup?from=2026-07-01&to=2026-08-01&kind=bus")).status).toBe(400);
  });
});
