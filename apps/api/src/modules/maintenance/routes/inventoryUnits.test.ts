import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/maintenance/inventory/units` and `/kit-expectations` (INVENTORY-PLAN.md step I9).
 *
 * `units.test.ts` owns the resolution and `deriveKitStatus` has its own tests in shared. What is
 * left is the translation, and each item below is invisible from either side:
 *
 *   · **a unit is addressed by (kind, id), and a kind that is neither is a 400** — not a 500 and not
 *     an empty list, because a URL naming a third kind of unit is a caller mistake with a sentence;
 *   · **setting a kit rule is a PUT and is idempotent.** The same body twice must not make two rules
 *     — the operation's key is (type, unit kind, unit), and a POST that sometimes creates and
 *     sometimes updates is a verb that tells the caller nothing;
 *   · **the rule writes are audited and the reads are not.** `kit_expectations` keeps no history of
 *     its own, so "who said this trailer needs only one load bar" has nowhere else to live — and the
 *     audit has to say WHICH LAYER, because "every dry van carries two" and "T-4102 carries one"
 *     read identically without it;
 *   · **the org filter**, because a route builds its own queries and the service role bypasses RLS.
 */

const ORG = "org-1";
const USER = "user-1";
const TRUCK = "11111111-1111-4111-8111-111111111111";
const DRYVAN = "22222222-2222-4222-8222-222222222222";
const BAR = "55555555-5555-4555-8555-555555555555";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
const audit = vi.hoisted(() => ({
  writeAudit: vi.fn(async (_admin: unknown, _entry: Record<string, unknown>) => true),
}));
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

const { inventoryUnitsRouter, kitExpectationsRouter } = await import("./inventoryUnits.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance/inventory/units", inventoryUnitsRouter());
  app.use("/api/maintenance/inventory/kit-expectations", kitExpectationsRouter());
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
  units?: Array<{ unitNumber: string; kind: string; state: string }>;
  unit?: { unitNumber: string; kind: string };
  assets?: unknown[];
  expectation?: { id: string };
  expectations?: unknown[];
  total?: number;
}
const bodyOf = async (res: Awaited<ReturnType<typeof fetch>>): Promise<Body> => (await res.json()) as Body;

const call = (base: string, path: string, method = "GET", body?: unknown) =>
  fetch(`${base}/api/maintenance/inventory${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const expectationRow = {
  id: "k-1",
  asset_type_id: BAR,
  unit_kind: "trailer",
  vehicle_id: null,
  trailer_id: null,
  quantity: 2,
  asset_types: { name: "Load bar" },
};

const fleet = () => ({
  vehicles: () => [{ id: TRUCK, unit_number: "654", vin: null, plate: null }],
  trailers: () => [{ id: DRYVAN, unit_number: "T-4102", vin: null, plate: null, is_reefer: false, trailer_type: "dry_van" }],
  asset_types: () => [{ id: BAR, name: "Load bar", default_kit_quantity: 2 }],
  kit_expectations: () => [expectationRow],
  inventory_assets: () => [],
  drivers: () => [],
});

const SCOPED = { exempt: ["user_profiles"] };

beforeEach(() => {
  audit.writeAudit.mockClear();
  rec = createSupabaseRecorder({ tables: fleet() });
});

describe("reading units", () => {
  it("lists the fleet with its kit, scoped to the org", async () => {
    const body = await withServer(async (base) => bodyOf(await call(base, "/units")));
    expect(body.ok).toBe(true);
    expect(body.units?.map((u) => u.unitNumber).sort()).toEqual(["654", "T-4102"]);
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("answers one unit with what it is carrying", async () => {
    const body = await withServer(async (base) => bodyOf(await call(base, `/units/trailer/${DRYVAN}`)));
    expect(body.unit?.unitNumber).toBe("T-4102");
    expect(body.assets).toEqual([]);
  });

  /**
   * A third kind of unit does not exist. Answering 404 would say "we looked and it is not there",
   * and an empty list would say "you have none" — both are wrong about a URL the caller mistyped.
   */
  it("refuses a kind that is neither a tractor nor a trailer", async () => {
    const res = await withServer((base) => call(base, `/units/spaceship/${DRYVAN}`));
    expect(res.status).toBe(400);
  });

  it("answers 404 for a unit that is not this org's, which is what a missing one also is", async () => {
    rec = createSupabaseRecorder({ tables: { ...fleet(), vehicles: () => [], trailers: () => [] } });
    const res = await withServer((base) => call(base, `/units/trailer/${DRYVAN}`));
    expect(res.status).toBe(404);
  });

  it("refuses a filter value it cannot read rather than silently ignoring it", async () => {
    const res = await withServer((base) => call(base, "/units?kind=lorry"));
    expect(res.status).toBe(400);
  });
});

describe("the kit rules", () => {
  const rule = { assetTypeId: BAR, unitKind: "trailer" as const, quantity: 2 };

  it("sets one with PUT, and says which layer it was in the audit", async () => {
    const body = await withServer(async (base) => bodyOf(await call(base, "/kit-expectations", "PUT", rule)));
    expect(body.ok).toBe(true);
    expect(audit.writeAudit.mock.calls[0]?.[1]).toMatchObject({
      action: "maintenance.kit_expectation_set",
      entity: "kit_expectations",
      // ⚠ Without `scope`, "every dry van now carries two" and "trailer T-4102 carries one" are the
      // same log line.
      meta: { scope: "fleet", assetType: "Load bar", quantity: 2 },
    });
  });

  it("...and calls a per-unit override what it is", async () => {
    rec = createSupabaseRecorder({
      tables: { ...fleet(), kit_expectations: () => [{ ...expectationRow, trailer_id: DRYVAN, quantity: 1 }] },
    });
    await withServer((base) => call(base, "/kit-expectations", "PUT", { ...rule, trailerId: DRYVAN, quantity: 1 }));
    expect(audit.writeAudit.mock.calls[0]?.[1]).toMatchObject({ meta: { scope: "unit" } });
  });

  /**
   * The operation's key is (type, unit kind, unit), so the same body twice is one rule. The service
   * is UPDATE-then-INSERT behind this; what the ROUTE has to get right is not offering a verb that
   * implies otherwise.
   */
  it("is idempotent: the same rule sent twice writes no second row", async () => {
    await withServer(async (base) => {
      await call(base, "/kit-expectations", "PUT", rule);
      await call(base, "/kit-expectations", "PUT", rule);
    });
    const writes = rec.writes().filter((w) => w.table === "kit_expectations");
    expect(writes.map((w) => w.write?.method)).toEqual(["update", "update"]);
  });

  it("refuses a rule that names both a truck and a trailer, at the edge", async () => {
    const res = await withServer((base) =>
      call(base, "/kit-expectations", "PUT", { ...rule, vehicleId: TRUCK, trailerId: DRYVAN }),
    );
    expect(res.status).toBe(400);
  });

  it("turns the org guard's refusal into a sentence about the unit, not a 500", async () => {
    rec = createSupabaseRecorder({
      tables: {
        ...fleet(),
        kit_expectations: (q) => (q.write ? { error: { code: "IV012", message: "not ours" } } : []),
      },
    });
    const res = await withServer((base) => call(base, "/kit-expectations", "PUT", rule));
    expect(res.status).toBe(422);
    expect((await bodyOf(res)).error?.code).toBe("IV012");
  });

  it("removes one, audits it, and reports an unknown id as gone", async () => {
    await withServer(async (base) => {
      const res = await call(base, "/kit-expectations/k-1", "DELETE");
      expect(res.status).toBe(200);
    });
    expect(audit.writeAudit.mock.calls[0]?.[1]).toMatchObject({ action: "maintenance.kit_expectation_removed" });

    rec = createSupabaseRecorder({ tables: { ...fleet(), kit_expectations: () => [] } });
    const gone = await withServer((base) => call(base, "/kit-expectations/nope", "DELETE"));
    expect(gone.status).toBe(404);
  });

  it("scopes the read to the org", async () => {
    await withServer((base) => call(base, "/kit-expectations?fleetOnly=true"));
    expectOrgScoped(rec, ORG, SCOPED);
  });
});
