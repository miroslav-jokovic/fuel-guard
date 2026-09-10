import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/maintenance/inventory/assets` and `/asset-types` (INVENTORY-PLAN.md step I8).
 *
 * 0333's matrix owns the schema's promises and `assets.test.ts` owns the services. What is left is
 * the translation, and each item below is invisible from either side:
 *
 *   · **`IV020` must arrive as a 409 and `IV023` as a 422.** The first is the FLEET refusing a fine
 *     payload — that truck already carries the one it is expected to carry — and the second is the
 *     payload naming something unusable. A 500 would put "Something went wrong" in front of a
 *     technician standing at a truck holding the thing;
 *   · **move and report are two doors and neither accepts the other's reasons.** A report posted to
 *     `/move` must be refused at the edge, because the holder columns are written on that path and a
 *     report that reached them would silently move a thing somebody said was missing;
 *   · **a move writes NO `audit_logs` row and a create does.** `asset_movements` is its own audit;
 *     the asset row is a description, and "who renamed A-0412" has nowhere else to live;
 *   · **the org filter**, because a route builds its own queries and the service role bypasses RLS;
 *   · **the create body cannot name an identifier the system owns.** `display_seq` is allocated by
 *     the database under a lock and a tag is issued at I10 — a route that passed either through
 *     would break no service test.
 */

const ORG = "org-1";
const USER = "user-1";
const ASSET = "11111111-1111-4111-8111-111111111111";
const TYPE = "22222222-2222-4222-8222-222222222222";
const CRIB = "33333333-3333-4333-8333-333333333333";
const T654 = "44444444-4444-4444-8444-444444444444";
const MOVE_ID = "550e8400-e29b-41d4-a716-446655440000";

let rec: SupabaseRecorder;
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => rec.client }));
vi.mock("../../../lib/appLocals.js", () => ({ getAppLocals: () => ({ env: {} }) }));
// Typed with its arguments, so `mock.calls[0][1]` is the audit entry rather than a zero-length
// tuple — the note `CountSessionPage.test.ts` records about the same shape.
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

const { inventoryAssetsRouter } = await import("./inventoryAssets.js");
const { inventoryAssetTypesRouter } = await import("./inventoryAssetTypes.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance/inventory/assets", inventoryAssetsRouter());
  app.use("/api/maintenance/inventory/asset-types", inventoryAssetTypesRouter());
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
  asset?: { id: string; displayNo: string; holder: { kind: string; label: string | null } };
  assets?: Array<{ id: string; displayNo: string }>;
  movement?: { id: string; reason: string };
  movements?: Array<{ id: string }>;
  type?: { id: string; name: string };
  total?: number;
  photoUrl?: string | null;
}
const bodyOf = async (res: Awaited<ReturnType<typeof fetch>>): Promise<Body> => (await res.json()) as Body;

const call = (base: string, path: string, method = "GET", body?: unknown) =>
  fetch(`${base}/api/maintenance/inventory${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const assetRow = (over: Record<string, unknown> = {}) => ({
  id: ASSET,
  tag_code: null,
  display_seq: 412,
  asset_type_id: TYPE,
  name: "Rig tablet",
  serial_number: "SN-1",
  model: null,
  manufacturer: null,
  status: "in_service",
  condition: "good",
  location_id: null,
  vehicle_id: T654,
  trailer_id: null,
  purchased_at: null,
  purchase_cost: "429.00",
  warranty_expires_at: null,
  image_path: null,
  notes: null,
  asset_types: { name: "Tablet" },
  stock_locations: null,
  vehicles: { unit_number: "654", assigned_driver_id: null },
  trailers: null,
  ...over,
});

const movementRow = (over: Record<string, unknown> = {}) => ({
  id: MOVE_ID,
  asset_id: ASSET,
  reason: "assigned",
  from_location_id: CRIB,
  from_vehicle_id: null,
  from_trailer_id: null,
  to_location_id: null,
  to_vehicle_id: T654,
  to_trailer_id: null,
  condition: null,
  note: null,
  actor_user_id: USER,
  actor_driver_id: null,
  count_session_id: null,
  occurred_at: "2026-09-09T10:00:00.000Z",
  received_at: "2026-09-09T10:00:01.000Z",
  ...over,
});

const moveBody = (over: Record<string, unknown> = {}) => ({
  id: MOVE_ID,
  assetId: ASSET,
  reason: "assigned",
  toVehicleId: T654,
  occurredAt: "2026-09-09T10:00:00.000Z",
  ...over,
});

const SCOPED = { exempt: ["user_profiles"] };

beforeEach(() => {
  audit.writeAudit.mockClear();
  rec = createSupabaseRecorder({
    tables: {
      inventory_assets: [assetRow()],
      asset_movements: [movementRow()],
      asset_types: [{ id: TYPE, name: "Tablet", category: null, serialized: true, default_kit_quantity: 1, image_path: null }],
      drivers: [],
    },
    rpc: { move_asset: movementRow() },
  });
});

describe("reading assets", () => {
  it("lists them, scoped to the org", async () => {
    const body = await withServer(async (base) => bodyOf(await call(base, "/assets")));
    expect(body.ok).toBe(true);
    expect(body.assets?.[0]?.displayNo).toBe("A-0412");
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("answers one, with its photo URL slot and no history folded in", async () => {
    const body = await withServer(async (base) => bodyOf(await call(base, `/assets/${ASSET}`)));
    expect(body.asset?.holder).toMatchObject({ kind: "vehicle", label: "654" });
    // The history is a page of its own: a tablet round the fleet for two years has hundreds of
    // movements, and folding them in makes the header wait for the tail.
    expect(body).not.toHaveProperty("movements");
    expect(body).toHaveProperty("photoUrl");
  });

  it("answers 404 for an asset that is not this org's, which is what a missing one also is", async () => {
    rec = createSupabaseRecorder({ tables: { inventory_assets: () => [] } });
    const res = await withServer((base) => call(base, `/assets/${ASSET}`));
    expect(res.status).toBe(404);
  });

  it("pages one asset's history on its own route", async () => {
    const body = await withServer(async (base) =>
      bodyOf(await call(base, `/assets/${ASSET}/movements?limit=30`)),
    );
    expect(body.movements?.[0]?.id).toBe(MOVE_ID);
    const filters = rec.forTable("asset_movements")[0]?.filters() ?? [];
    expect(filters.some((f) => f.col === "asset_id" && f.val === ASSET)).toBe(true);
    expectOrgScoped(rec, ORG, SCOPED);
  });

  it("refuses a filter value it cannot read rather than silently ignoring it", async () => {
    const res = await withServer((base) => call(base, "/assets?status=melted"));
    expect(res.status).toBe(400);
  });

  it("takes a search term through to the list, and refuses one longer than a label", async () => {
    const body = await withServer(async (base) => bodyOf(await call(base, "/assets?search=A-0412")));
    expect(body.ok).toBe(true);
    const res = await withServer((base) => call(base, `/assets?search=${"x".repeat(121)}`));
    expect(res.status).toBe(400);
  });
});

describe("writing an asset", () => {
  const input = {
    assetTypeId: TYPE,
    name: "Rig tablet",
    status: "in_service",
    condition: "good",
    locationId: CRIB,
  };

  it("creates one, audits it by the number the shop says out loud, and never takes an identifier", async () => {
    const body = await withServer(async (base) => bodyOf(await call(base, "/assets", "POST", input)));
    expect(body.asset?.displayNo).toBe("A-0412");
    expect(audit.writeAudit).toHaveBeenCalledTimes(1);
    // ⚠ `displayNo`, not the UUID: it is what a work order names and what somebody reading the log
    // will be searching for.
    expect(audit.writeAudit.mock.calls[0]?.[1]).toMatchObject({
      action: "maintenance.asset_created",
      entity: "inventory_assets",
      meta: { displayNo: "A-0412" },
    });
    const payload = rec.writes().find((w) => w.table === "inventory_assets")?.write?.payload as Record<string, unknown>;
    for (const owned of ["display_seq", "tag_code", "id"]) {
      expect(Object.keys(payload)).not.toContain(owned);
    }
  });

  it("refuses a create that starts an asset in two places", async () => {
    const res = await withServer((base) =>
      call(base, "/assets", "POST", { ...input, vehicleId: T654 }),
    );
    expect(res.status).toBe(400);
  });

  it("audits an edit and reports an unknown asset as gone", async () => {
    await withServer(async (base) => {
      await call(base, `/assets/${ASSET}`, "PATCH", { name: "Renamed" });
      expect(audit.writeAudit.mock.calls[0]?.[1]).toMatchObject({ action: "maintenance.asset_updated" });
    });
    rec = createSupabaseRecorder({ tables: { inventory_assets: () => [] } });
    const res = await withServer((base) => call(base, `/assets/${ASSET}`, "PATCH", { name: "x" }));
    expect(res.status).toBe(404);
  });
});

describe("moving and reporting", () => {
  it("records a move and writes no audit row, because the ledger is the audit", async () => {
    const res = await withServer((base) => call(base, "/assets/move", "POST", moveBody()));
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).movement?.id).toBe(MOVE_ID);
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /**
   * The half a service test cannot see. `move_asset` writes the holder columns on this path, so a
   * `reported_missing` that reached it would move a thing somebody had just said was missing —
   * D-INV24's whole point, refused at the edge by `moveAssetSchema`.
   */
  it("refuses a report on the move door, and a move on the report door", async () => {
    const asReport = await withServer((base) =>
      call(base, "/assets/move", "POST", moveBody({ reason: "reported_missing", toVehicleId: undefined })),
    );
    expect(asReport.status).toBe(400);

    const asMove = await withServer((base) =>
      call(base, "/assets/report", "POST", moveBody({ reason: "assigned", toVehicleId: undefined })),
    );
    expect(asMove.status).toBe(400);
  });

  it("takes a report with no destination and passes the client's id through", async () => {
    const res = await withServer((base) =>
      call(base, "/assets/report", "POST", {
        id: MOVE_ID,
        assetId: ASSET,
        reason: "reported_missing",
        condition: "damaged",
        occurredAt: "2026-09-09T10:00:00.000Z",
      }),
    );
    expect(res.status).toBe(201);
    // D-INV27: the id is the idempotency key, so the route must hand the CLIENT's id to the RPC.
    const args = rec.rpcs()[0]?.args as { p_row: { id: string } };
    expect(args.p_row.id).toBe(MOVE_ID);
  });

  it("answers 201 to a replay, because the RPC returns the movement it already has", async () => {
    await withServer(async (base) => {
      expect((await call(base, "/assets/move", "POST", moveBody())).status).toBe(201);
      expect((await call(base, "/assets/move", "POST", moveBody())).status).toBe(201);
    });
  });

  it("maps the fleet's refusal to 409 and an unusable payload to 422", async () => {
    for (const [code, status] of [
      ["IV020", 409],
      ["IV023", 422],
      ["IV024", 422],
      ["IV012", 422],
    ] as const) {
      rec = createSupabaseRecorder({ rpc: { move_asset: { error: { code, message: code } } } });
      const res = await withServer((base) => call(base, "/assets/move", "POST", moveBody()));
      expect(res.status, code).toBe(status);
      const body = await bodyOf(res);
      expect(body.error?.code).toBe(code);
      expect(body.error?.message).not.toMatch(/went wrong/i);
    }
  });
});

describe("asset types", () => {
  it("lists and creates, and audits the create", async () => {
    const body = await withServer(async (base) => bodyOf(await call(base, "/asset-types")));
    expect(body.ok).toBe(true);
    expectOrgScoped(rec, ORG, SCOPED);

    await withServer(async (base) => {
      await call(base, "/asset-types", "POST", {
        name: "Tablet",
        serialized: true,
        defaultKitQuantity: 1,
      });
    });
    expect(audit.writeAudit.mock.calls[0]?.[1]).toMatchObject({
      action: "maintenance.asset_type_created",
      meta: { name: "Tablet", serialized: true },
    });
  });

  it("reports a duplicate name as a 409 the shop can act on", async () => {
    rec = createSupabaseRecorder({
      tables: { asset_types: () => ({ error: { code: "23505", message: "dupe" } }) },
    });
    const res = await withServer((base) =>
      call(base, "/asset-types", "POST", { name: "Tablet", serialized: true, defaultKitQuantity: 1 }),
    );
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe("duplicate_asset_type");
  });
});
