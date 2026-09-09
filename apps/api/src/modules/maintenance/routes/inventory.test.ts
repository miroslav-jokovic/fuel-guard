import { describe, expect, it, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";

/**
 * `/api/maintenance/inventory` (INVENTORY-PLAN.md step I3).
 *
 * ── WHAT THIS LAYER CAN GET WRONG THAT NOTHING BELOW IT CAN CATCH ──────────────────────────────
 * The matrix owns the arithmetic and `inventory.test.ts` owns the service. What is left is exactly
 * the translation, and every item is invisible from either side:
 *
 *   · a named SQLSTATE reaching the shop as a STATUS, not only as a message. `IV010` answering 500
 *     puts "Something went wrong" in front of somebody holding the last filter; answering 409 lets
 *     the screen say "there is one left" and offer a count;
 *   · the org filter, again, because a route builds its own queries and the service role bypasses
 *     RLS. `expectOrgScoped` runs over every request this file makes;
 *   · `POST /transfer` must reach the RPC as ONE call. A route that helpfully split it into two
 *     movements would pass every service test and destroy stock on a half-failure;
 *   · a replayed movement must answer 201 with the same row, because the offline queue flushes
 *     twice and a client that retried correctly must not look like it failed;
 *   · the audit split: creating a PART writes `audit_logs`, recording a MOVEMENT does not — the
 *     ledger is its own audit and a second row per issue would double the busiest table.
 */

const ORG = "org-1";
const USER = "user-1";
const PART = "11111111-1111-4111-8111-111111111111";
const LOCATION = "22222222-2222-4222-8222-222222222222";
const ANNEX = "55555555-5555-4555-8555-555555555555";
const MOVEMENT = "33333333-3333-4333-8333-333333333333";
const VEHICLE = "44444444-4444-4444-8444-444444444444";

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

const { inventoryPartsRouter } = await import("./inventoryParts.js");
const { inventoryLocationsRouter } = await import("./inventoryLocations.js");
const { inventoryStockRouter } = await import("./inventoryStock.js");

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance/inventory/parts", inventoryPartsRouter());
  app.use("/api/maintenance/inventory/locations", inventoryLocationsRouter());
  app.use("/api/maintenance/inventory", inventoryStockRouter());
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
  movement?: { id: string; quantityDelta: number };
  part?: { id: string; partNumber: string };
  parts?: unknown[];
  lines?: Array<{ partId: string }>;
  photoUrl?: string | null;
  uploadUrl?: string;
  storagePath?: string;
}
const bodyOf = async (res: Awaited<ReturnType<typeof fetch>>): Promise<Body> => (await res.json()) as Body;

const post = (base: string, path: string, body: unknown) =>
  fetch(`${base}/api/maintenance/inventory${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const partRow = (over: Record<string, unknown> = {}) => ({
  id: PART,
  part_number: "LF-9009",
  description: "Oil filter",
  manufacturer: null,
  category: "filters",
  unit_of_measure: "each",
  upc: "012345678905",
  image_path: null,
  last_cost: "12.50",
  active: true,
  notes: null,
  ...over,
});

const movementRow = (over: Record<string, unknown> = {}) => ({
  id: MOVEMENT,
  part_id: PART,
  location_id: LOCATION,
  reason: "received",
  adjust_reason: null,
  quantity_delta: 24,
  counted_total: null,
  count_session_id: null,
  unit_cost: null,
  supplier: null,
  vehicle_id: null,
  trailer_id: null,
  work_order_ref: null,
  note: null,
  actor_user_id: USER,
  transfer_group_id: null,
  blind: null,
  occurred_at: "2026-09-09T10:00:00.000Z",
  received_at: "2026-09-09T10:00:02.000Z",
  ...over,
});

const receipt = {
  id: MOVEMENT,
  partId: PART,
  locationId: LOCATION,
  reason: "received" as const,
  quantity: 24,
  occurredAt: "2026-09-09T10:00:00.000Z",
};

beforeEach(() => {
  audit.writeAudit.mockClear();
  rec = createSupabaseRecorder({
    tables: { parts: [partRow()], part_stock: [], part_movements: [movementRow()], stock_locations: [] },
    rpc: { record_part_movement: movementRow() },
  });
});

describe("the movement verbs", () => {
  it("records a receipt and answers 201 with the movement", async () => {
    const res = await withServer((base) => post(base, "/receive", receipt));
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).movement?.id).toBe(MOVEMENT);
    expectOrgScoped(rec, ORG);
  });

  it("does NOT write an audit_logs row — the ledger is its own audit", async () => {
    await withServer((base) => post(base, "/receive", receipt));
    expect(audit.writeAudit).not.toHaveBeenCalled();
  });

  /**
   * The half-failure this design exists to prevent. Two calls would leave stock destroyed at the
   * source and never delivered; the RPC writes both legs inside one transaction.
   */
  it("sends a transfer to the RPC as ONE call, not two movements", async () => {
    await withServer((base) =>
      post(base, "/transfer", {
        id: MOVEMENT,
        partId: PART,
        locationId: LOCATION,
        reason: "transferred",
        quantity: 6,
        toLocationId: ANNEX,
        occurredAt: "2026-09-09T10:00:00.000Z",
      }),
    );
    const calls = rec.rpcs();
    expect(calls).toHaveLength(1);
    expect((calls[0]!.args as { p_row: { toLocationId: string } }).p_row.toLocationId).toBe(ANNEX);
  });

  it("refuses an issue that names both a truck and a trailer", async () => {
    const res = await withServer((base) =>
      post(base, "/issue", {
        id: MOVEMENT,
        partId: PART,
        locationId: LOCATION,
        reason: "issued",
        quantity: 1,
        vehicleId: VEHICLE,
        trailerId: ANNEX,
        occurredAt: "2026-09-09T10:00:00.000Z",
      }),
    );
    expect(res.status).toBe(400);
    expect(rec.rpcs()).toHaveLength(0);
  });

  it("refuses a receipt sent to the adjust route, because the shapes ARE the rules", async () => {
    const res = await withServer((base) => post(base, "/adjust", receipt));
    expect(res.status).toBe(400);
    expect(rec.rpcs()).toHaveLength(0);
  });

  /** D-INV27: the queue flushes twice and the second answer must not look like a failure. */
  it("answers a replay 201 with the same movement", async () => {
    const [first, second] = await withServer(async (base) => [
      await bodyOf(await post(base, "/receive", receipt)),
      await bodyOf(await post(base, "/receive", receipt)),
    ]);
    expect(first.movement?.id).toBe(second.movement?.id);
  });
});

describe("the SQLSTATEs reach the shop as statuses", () => {
  it.each([
    ["IV010", 409, "not enough"],
    ["IV011", 409, "cannot be edited"],
    ["IV012", 422, "not available"],
    ["IV013", 422, "not available"],
    ["IV014", 422, "clock"],
    ["IV016", 409, "already being recorded"],
  ])("%s answers %i", async (code, status, fragment) => {
    rec = createSupabaseRecorder({ rpc: () => ({ error: { code, message: "db" } }) });
    const res = await withServer((base) => post(base, "/receive", receipt));
    expect(res.status).toBe(status);
    const body = await bodyOf(res);
    expect(body.error?.code).toBe(code);
    expect(body.error?.message?.toLowerCase()).toContain(fragment);
  });

  it("an unmapped failure is still a 500 — we do not pretend to know", async () => {
    rec = createSupabaseRecorder({ rpc: () => ({ error: { code: "42P01", message: "db" } }) });
    const res = await withServer((base) => post(base, "/receive", receipt));
    expect(res.status).toBe(500);
  });
});

describe("the catalogue", () => {
  it("audits a part created, with the row UUID as entityId", async () => {
    const res = await withServer((base) =>
      post(base, "/parts", { partNumber: "LF-9009", description: "Oil filter", unitOfMeasure: "each" }),
    );
    expect(res.status).toBe(201);
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "maintenance.part_created", entity: "parts", entityId: PART }),
    );
  });

  it("audits a retirement under its OWN action, not as an update with a flag", async () => {
    await withServer((base) =>
      fetch(`${base}/api/maintenance/inventory/parts/${PART}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
    );
    expect(audit.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "maintenance.part_retired" }),
    );
  });

  it("turns a duplicate part number into a 409 somebody can act on", async () => {
    rec = createSupabaseRecorder({
      tables: { parts: { data: [], writeError: { code: "23505", message: "duplicate key" } } },
    });
    const res = await withServer((base) =>
      post(base, "/parts", { partNumber: "LF-9009", description: "Oil filter", unitOfMeasure: "each" }),
    );
    expect(res.status).toBe(409);
    expect((await bodyOf(res)).error?.code).toBe("duplicate_part_number");
  });

  it("scopes every read to the org", async () => {
    await withServer(async (base) => {
      await fetch(`${base}/api/maintenance/inventory/parts?search=filter`);
      await fetch(`${base}/api/maintenance/inventory/parts/by-upc/012345678905`);
      await fetch(`${base}/api/maintenance/inventory/parts/${PART}`);
      await fetch(`${base}/api/maintenance/inventory/locations`);
      await fetch(`${base}/api/maintenance/inventory/stock`);
      await fetch(`${base}/api/maintenance/inventory/low-stock`);
      await fetch(`${base}/api/maintenance/inventory/movements?partId=${PART}`);
    });
    // `user_profiles` is keyed by auth user id and carries no org — `memberLabels`' own design, and
    // the same exemption `modules/org/routes/members.test.ts:190` takes. It is reached only for an
    // actor who has LEFT the org, and only for ids already read off this org's ledger rows.
    expectOrgScoped(rec, ORG, { exempt: ["user_profiles"] });
  });

  /**
   * Not about route ORDER — that was measured and does not matter, since `/by-upc/:upc` is two
   * segments and `/:id` is one. What this pins is that the barcode is queried as a `upc` and never
   * as an id: the resolver's whole fall-through (D-INV7) is "this string is not one of our tags, try
   * it as the supplier's barcode", and a handler that looked it up by id would answer 404 for every
   * carton in the shop.
   */
  it("looks a barcode up as a upc, never as a part id", async () => {
    await withServer((base) => fetch(`${base}/api/maintenance/inventory/parts/by-upc/012345678905`));
    const q = rec.forTable("parts")[0]!;
    expect(q.filters()).toContainEqual({ col: "upc", val: "012345678905" });
    expect(q.filters().some((f) => f.col === "id")).toBe(false);
  });
});

describe("the photo route", () => {
  it("builds the storage path from the SESSION's org, never from the request", async () => {
    rec = createSupabaseRecorder({
      tables: { parts: [partRow()] },
      storage: {
        createSignedUploadUrl: (path: string) => ({ data: { signedUrl: `https://x/${path}`, token: "t" }, error: null }),
      },
    });
    const photoId = "66666666-6666-4666-8666-666666666666";
    const res = await withServer((base) =>
      post(base, `/parts/${PART}/photo`, { photoId, contentType: "image/jpeg" }),
    );
    expect(res.status).toBe(201);
    expect((await bodyOf(res)).storagePath).toBe(`${ORG}/${PART}/${photoId}.jpg`);
  });

  it("refuses a content type that is not an image", async () => {
    const res = await withServer((base) =>
      post(base, `/parts/${PART}/photo`, {
        photoId: "66666666-6666-4666-8666-666666666666",
        contentType: "application/pdf",
      }),
    );
    expect(res.status).toBe(415);
  });
});

describe("stock-line settings", () => {
  /**
   * The gap this closes is in the PLAN, not in a file: `stockLineSettingsSchema` shipped in I1 with
   * no consumer, no step owned the write, and I12 reads `reorder_point`. Without this route the
   * low-stock screen would have read a column nothing could set.
   */
  it("sets a reorder point on an existing line", async () => {
    rec = createSupabaseRecorder({ tables: { part_stock: [{ part_id: PART }] } });
    const res = await withServer((base) =>
      fetch(`${base}/api/maintenance/inventory/stock/${PART}/${LOCATION}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reorderPoint: 5, reorderQuantity: 24 }),
      }),
    );
    expect(res.status).toBe(200);
    const written = rec.writtenRows("part_stock")[0]!;
    expect(written.reorder_point).toBe(5);
    // The quantity is the ledger's projection and must never appear in a settings write.
    expect(written).not.toHaveProperty("quantity_on_hand");
    expectOrgScoped(rec, ORG);
  });

  /**
   * A reorder point is legitimately set on a pair that has never moved, so the row may not exist.
   * `.upsert()` with the patch would be the partial upsert the gate forbids; the house pattern is a
   * guarded UPDATE and then an INSERT carrying every not-null column.
   */
  it("creates the line at zero when there is none, with a full payload", async () => {
    rec = createSupabaseRecorder({ tables: { part_stock: [] } });
    const res = await withServer((base) =>
      fetch(`${base}/api/maintenance/inventory/stock/${PART}/${LOCATION}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reorderPoint: 5 }),
      }),
    );
    expect(res.status).toBe(200);
    const inserted = rec.writtenRows("part_stock").find((r) => "org_id" in r)!;
    expect(inserted).toMatchObject({
      org_id: ORG,
      part_id: PART,
      location_id: LOCATION,
      quantity_on_hand: 0,
      reorder_point: 5,
    });
    expect(rec.forTable("part_stock").some((q) => q.write?.method === "upsert")).toBe(false);
  });

  it("refuses a body that tries to set the quantity", async () => {
    rec = createSupabaseRecorder({ tables: { part_stock: [{ part_id: PART }] } });
    await withServer((base) =>
      fetch(`${base}/api/maintenance/inventory/stock/${PART}/${LOCATION}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reorderPoint: 5, quantityOnHand: 999 }),
      }),
    );
    // zod STRIPS unknown keys rather than rejecting them (measured in I1), so the proof is not a 400
    // — it is that the value never reaches the database.
    expect(rec.writtenRows("part_stock")[0]!).not.toHaveProperty("quantity_on_hand");
  });
});

describe("the movement ledger names who moved it", () => {
  it("returns an actor NAME, not only a uuid", async () => {
    rec = createSupabaseRecorder({
      tables: { part_movements: [movementRow()] },
      rpc: { org_member_directory: [{ user_id: USER, email: "tech@shop.test", full_name: "Dana Reyes" }] },
    });
    const res = await withServer((base) => fetch(`${base}/api/maintenance/inventory/movements`));
    const body = (await res.json()) as { movements: Array<{ actorName: string | null }> };
    expect(body.movements[0]!.actorName).toBe("Dana Reyes");
  });

  it("carries the supplier and the transfer pairing the schema stores", async () => {
    rec = createSupabaseRecorder({
      tables: {
        part_movements: [movementRow({ supplier: "Fleetpride", transfer_group_id: MOVEMENT })],
      },
      rpc: { org_member_directory: [] },
    });
    const res = await withServer((base) => fetch(`${base}/api/maintenance/inventory/movements`));
    const body = (await res.json()) as {
      movements: Array<{ supplier: string | null; transferGroupId: string | null }>;
    };
    expect(body.movements[0]!.supplier).toBe("Fleetpride");
    expect(body.movements[0]!.transferGroupId).toBe(MOVEMENT);
  });
});
