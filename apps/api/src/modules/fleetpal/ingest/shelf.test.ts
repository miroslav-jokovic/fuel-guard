import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FleetpalPoReceiptItem } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";

/**
 * F13: receipts in, consumption out. The ledger is faked here as what `record_part_movement` is —
 * keyed on the movement id, refusing to go below zero — so "twice is once" and "short, then lands"
 * are properties of the sweep's ids and order, not of a fixture that always says yes. The SQL side of
 * the same promises is `supabase/tests/inventory-stock.test.mjs` rule 13.
 */
const ledger = vi.hoisted(() => ({
  shelf: null as null | { locationId: string; from: string },
  rows: new Map<string, { partId: string; delta: number; m: Record<string, unknown> }>(),
  onHand: new Map<string, number>(),
  inactive: new Set<string>(),
}));
vi.mock("../../maintenance/index.js", () => ({
  getFleetpalShelf: async () => ledger.shelf,
  partIdsByFleetpalId: async (_a: unknown, _o: string, ids: string[]) =>
    new Map(ids.filter((id) => !id.startsWith("hidden")).map((id) => [id, `our-${id}`])),
  recordFleetpalMovement: async (_a: unknown, _o: string, m: Record<string, unknown> & { id: string; partId: string; reason: string; quantity: number; occurredAt: string }) => {
    if (ledger.rows.has(m.id)) return { outcome: "recorded", movement: {} };
    if (ledger.shelf && m.occurredAt < ledger.shelf.from) return { outcome: "before_start" };
    if (ledger.inactive.has(m.partId)) return { outcome: "part_inactive" };
    const delta = m.reason === "issued" ? -m.quantity : m.quantity;
    const have = ledger.onHand.get(m.partId) ?? 0;
    if (have + delta < 0) return { outcome: "short" };
    ledger.onHand.set(m.partId, have + delta);
    ledger.rows.set(m.id, { partId: m.partId, delta, m });
    return { outcome: "recorded", movement: {} };
  },
}));
const { ingestShelf, wholeQuantity, receiptMovementId, consumptionMovementId } = await import("./shelf.js");

const ORG = "org-1";
const NOW = new Date("2026-11-16T12:00:00Z");
const START = "2026-11-15T00:00:00Z";

const receipt = (over: Partial<FleetpalPoReceiptItem> = {}): FleetpalPoReceiptItem => ({
  url: "https://openapi.fleetpal.io/v1/purchase-order-receipt-items/r1/",
  id: "r1",
  receipt: "rc1",
  purchase_order_item: "poi-1",
  type: "RECEIVE",
  quantity: 4,
  price: 28.4567,
  total: 113.83,
  created: "2026-11-16T09:00:00Z",
  ...over,
});

let receipts: FleetpalPoReceiptItem[];
let jobItems: Array<Record<string, unknown>>;
let rec: SupabaseRecorder;
let walk: ReturnType<typeof vi.fn>;

const inIds = (q: RecordedQuery) => {
  const op = q.ops.find((o) => o.method === "in");
  return new Set((op?.args[1] as string[]) ?? []);
};
const byId = (rows: Array<{ fleetpal_id: string } & Record<string, unknown>>) => (q: RecordedQuery) =>
  rows.filter((r) => inIds(q).has(r.fleetpal_id));

beforeEach(() => {
  ledger.shelf = { locationId: "loc-main", from: START };
  ledger.rows.clear();
  ledger.onHand.clear();
  ledger.inactive.clear();
  receipts = [receipt()];
  jobItems = [
    { fleetpal_id: "ji-1", job_fleetpal_id: "job-1", part_fleetpal_id: "part-a", quantity: 3, price: "41.5", vendor_created_at: "2026-11-16T10:00:00Z" },
  ];
  rec = createSupabaseRecorder({
    tables: {
      fleetpal_po_items: byId([
        { fleetpal_id: "poi-1", part_fleetpal_id: "part-a", purchase_order_fleetpal_id: "po-1" },
        { fleetpal_id: "poi-fee", part_fleetpal_id: null, purchase_order_fleetpal_id: "po-1" },
      ]),
      fleetpal_purchase_orders: byId([{ fleetpal_id: "po-1", reference_number: "PO-1001", work_order_fleetpal_id: "wo-1" }]),
      fleetpal_work_orders: byId([{ fleetpal_id: "wo-1", reference_number: "WO-55", unit_fleetpal_id: "u-1" }]),
      fleetpal_jobs: byId([{ fleetpal_id: "job-1", work_order_fleetpal_id: "wo-1" }]),
      fleetpal_units: byId([{ fleetpal_id: "u-1", vehicle_id: "truck-777", trailer_id: null }]),
      fleetpal_job_items: (q) => {
        const gte = q.ops.find((o) => o.method === "gte");
        return jobItems.filter((r) => String(r.vendor_created_at) >= String(gte?.args[1] ?? ""));
      },
      fleetpal_sync_state: [],
    },
  });
  walk = vi.fn(async () => receipts);
});
const ctx = () => ({ admin: rec.client, orgId: ORG, client: { walk } as never });
const run = () => ingestShelf(ctx(), () => NOW);

describe("ingestShelf", () => {
  it("moves nothing, and says why, when no shop place follows FleetPal", async () => {
    ledger.shelf = null;
    const r = await run();
    expect(r.idle).toMatch(/No shop place follows FleetPal/);
    expect(walk).not.toHaveBeenCalled();
    expect(ledger.rows.size).toBe(0);
  });

  it("receives a delivery and then issues the part fitted from it, in that order, on the one shelf", async () => {
    const r = await run();
    expect(r.error).toBeNull();
    expect(r.tally).toMatchObject({ recorded: 2, short: 0 });
    expect(ledger.onHand.get("our-part-a")).toBe(1);
    const received = ledger.rows.get(receiptMovementId(ORG, "r1"))!.m;
    expect(received).toMatchObject({
      reason: "received", locationId: "loc-main", quantity: 4, unitCost: 28.46, occurredAt: "2026-11-16T09:00:00Z",
      workOrderRef: "WO-55", note: "Received in FleetPal on purchase order PO-1001.",
    });
    const issued = ledger.rows.get(consumptionMovementId(ORG, "ji-1"))!.m;
    expect(issued).toMatchObject({ reason: "issued", quantity: 3, vehicleId: "truck-777", trailerId: null, workOrderRef: "WO-55", unitCost: 41.5 });
  });

  it("two sweeps over the same lines are one receipt and one issue — the id is FleetPal's line, not the run", async () => {
    // Stock on the shelf first, so a second issue WOULD fit: without it a duplicate is refused as short
    // and this test would pass whatever the id was (measured: a run-dependent id survived it).
    ledger.onHand.set("our-part-a", 10);
    await run();
    await run();
    expect(ledger.rows.size).toBe(2);
    expect(ledger.onHand.get("our-part-a")).toBe(11);
  });

  it("a CANCEL line is never a movement, even when FleetPal ignores the type filter", async () => {
    receipts = [receipt({ id: "r-cancel", type: "CANCEL" })];
    jobItems = [];
    await run();
    expect(walk.mock.calls[0]![2]).toMatchObject({ type: "RECEIVE" });
    expect(ledger.rows.size).toBe(0);
  });

  it("a part used before its delivery is swept is short this hour and lands the next (D-FP25)", async () => {
    receipts = [];
    const first = await run();
    expect(first.tally).toMatchObject({ recorded: 0, short: 1 });
    receipts = [receipt()];
    const second = await run();
    expect(second.tally).toMatchObject({ recorded: 2, short: 0 });
    expect(ledger.onHand.get("our-part-a")).toBe(1);
  });

  it("asks for a week at most, and never before the shelf's start", async () => {
    await run();
    expect(walk.mock.calls[0]![2]).toMatchObject({ created_after: START });
    ledger.shelf = { locationId: "loc-main", from: "2026-01-01T00:00:00Z" };
    await run();
    expect(walk.mock.calls[1]![2]).toMatchObject({ created_after: "2026-11-09T12:00:00.000Z" });
  });

  it("counts, and does not write, a fractional quantity, a fee line and a part outside the catalogue (D-FP26)", async () => {
    receipts = [receipt({ id: "r-frac", quantity: 2.5 }), receipt({ id: "r-fee", purchase_order_item: "poi-fee" })];
    jobItems = [{ fleetpal_id: "ji-h", job_fleetpal_id: "job-1", part_fleetpal_id: "hidden-1", quantity: 1, price: 1, vendor_created_at: "2026-11-16T10:00:00Z" }];
    const r = await run();
    expect(r.tally).toMatchObject({ recorded: 0, fractional: 1, notInCatalogue: 2 });
    expect(ledger.rows.size).toBe(0);
  });

  it("names neither unit when a FleetPal unit resolved to both a truck and a trailer (D-INV5)", async () => {
    rec = createSupabaseRecorder({
      tables: {
        ...Object.fromEntries(["fleetpal_po_items", "fleetpal_purchase_orders", "fleetpal_sync_state"].map((t) => [t, []])),
        fleetpal_jobs: byId([{ fleetpal_id: "job-1", work_order_fleetpal_id: "wo-1" }]),
        fleetpal_work_orders: byId([{ fleetpal_id: "wo-1", reference_number: "WO-55", unit_fleetpal_id: "u-1" }]),
        fleetpal_units: byId([{ fleetpal_id: "u-1", vehicle_id: "truck-777", trailer_id: "trailer-9" }]),
        fleetpal_job_items: () => jobItems,
      },
    });
    receipts = [];
    ledger.onHand.set("our-part-a", 5);
    await run();
    expect(ledger.rows.get(consumptionMovementId(ORG, "ji-1"))!.m).toMatchObject({ vehicleId: null, trailerId: null });
  });

  it("scopes every staged read to the org", async () => {
    await run();
    expectOrgScoped(rec, ORG);
  });
});

describe("wholeQuantity", () => {
  it("takes whole positive units and nothing else", () => {
    expect(wholeQuantity(3)).toBe(3);
    expect(wholeQuantity("2.000")).toBe(2);
    expect(wholeQuantity(2.5)).toBeNull();
    expect(wholeQuantity(0)).toBeNull();
    expect(wholeQuantity(null)).toBeNull();
  });
});
