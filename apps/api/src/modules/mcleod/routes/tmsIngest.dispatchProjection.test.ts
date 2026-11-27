import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashIngestToken } from "../../../lib/ingestToken.js";

/**
 * LR4 over the wire: `POST /api/tms/dispatch-movements` stores raw, then projects raw → `loads` /
 * `load_stops` / `load_events` (LOADS-MIRROR-PLAN.md LR4; D-LMR2, D-LMR7, D-LMR8).
 *
 * The recorder does not persist writes, so the raw rows the projection READS BACK are served by
 * fixtures built from the same agent output that was posted — the read-back is real code, the
 * storage is not. The database half (guard, scopes) is `loads-mirror-status-guard.test.mjs`.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

type Assemble = (rows: unknown[], stops: unknown[]) => { movements: Record<string, unknown>[] };
const AGENT = new URL("../../../../../../tools/mcleod-agent/loads.mjs", import.meta.url).href;
const { assemble } = (await import(/* @vite-ignore */ AGENT)) as { assemble: Assemble };

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOKEN = "fgtms_" + "f".repeat(37);
const DRIVER_ID = "d0000000-0000-4000-8000-000000000001";
const TRUCK_ID = "v0000000-0000-4000-8000-000000000001";
const EXISTING_LOAD = "l0000000-0000-4000-8000-000000000901";

const boardRow = (over: Record<string, unknown> = {}) => ({
  external_id: "TMS:900", company_id: "TMS", movement_id: "900", ref: "0135527", bol_number: "TL1",
  dispatcher_external_id: "romann", driver_codes: "DKELLY", vehicle_unit: "702", trailer_unit: "NOPE9",
  trailer_type: "R", commodity: "paints", total_miles: 812, external_status: "P", loaded: "L",
  customer_id: "BATTSOL", customer_name: "BATTERY SOLUTIONS LLC", weight: 0, weight_um: "LB", pieces: 0, pallets_how_many: null, consignee_refno: "PO-77",
  ...over,
});
const boardStop = (over: Record<string, unknown> = {}) => ({
  movement_id: "900", stop_id: "zz1", seq: 1, stop_type: "PU", location_id: "BATTSOL1", location_name: "BATTERY SOLUTIONS",
  city: "Howell", state: "MI", address_line: "1 Dock Rd", postal_code: "48843", lat: 42.6, lon_west_positive: 83.93,
  appointment_start: "2026-09-30T17:00:00", appointment_end: null, actual_arrival: null, actual_departure: null,
  eta: "2026-09-30T16:45:00", contact_name: null, phone: "5555550100", ponum: "PO-9", stop_status: "A",
  ...over,
});

const board = () =>
  assemble(
    [boardRow(), boardRow({ external_id: "TMS:901", movement_id: "901", ref: "0135528", external_status: "D" }),
      boardRow({ external_id: "TMS:902", movement_id: "902", ref: null })],
    [boardStop(), boardStop({ stop_id: "zz2", seq: 2, stop_type: "VA" }), boardStop({ stop_id: "zz3", seq: 3, stop_type: "SO" }),
      boardStop({ movement_id: "901", stop_id: "d1", stop_status: "D" })],
  ).movements;

const scoped = (q: RecordedQuery) =>
  q.filters().some((f) => f.col === "org_id" && f.val === ORG) && q.filters().some((f) => f.col === "company_id" && f.val === "TMS");

/** Serve the raw tables as the ingest just wrote them: the payload, in the raw tables' shape. */
function seed(movements: Record<string, unknown>[], refuse: Record<string, string> = {}) {
  const rawMovements = movements.map((m) => ({ ...m, company_id: "TMS", closed_at: m.movement_status === "D" ? "2026-09-24T18:00:00.000Z" : null }));
  const rawStops = movements.flatMap((m) => (m.stops as Record<string, unknown>[]).map((s) => ({ ...s, movement_id: m.movement_id })));
  return createSupabaseRecorder({
    tables: {
      org_integrations: (q) =>
        q.filters().some((f) => f.col === "ingest_token_hash" && f.val === hashIngestToken(TOKEN))
          ? [{ org_id: ORG, provider: "mcleod", enabled: true, ingest_token_hash: hashIngestToken(TOKEN), config: {} }]
          : [],
      mcleod_dispatch_movements: (q) => (scoped(q) && !q.write ? rawMovements : []),
      mcleod_dispatch_stops: (q) => (scoped(q) && !q.write ? rawStops : []),
      drivers: (q) => (q.filters().some((f) => f.col === "org_id" && f.val === ORG)
        ? [{ id: DRIVER_ID, employee_id: null, mcleod_driver_id: "DKELLY" }] : []),
      vehicles: (q) => (q.filters().some((f) => f.col === "org_id" && f.val === ORG) ? [{ id: TRUCK_ID, unit_number: "702" }] : []),
      trailers: [],
      // Movement 901 already has a load, still pending approval from the old feed.
      loads: (q) => {
        if (q.write?.method === "insert") {
          return (q.write.payload as { external_id: string }[]).map((r, i) => ({ id: `new-${i}`, external_id: r.external_id }));
        }
        if (q.write) return [];
        return q.filters().some((f) => f.col === "org_id" && f.val === ORG)
          ? [{ id: EXISTING_LOAD, status: "pending_approval", external_id: "TMS:901" }] : [];
      },
    },
    // 0660's answer: every load written unless the test names it refused (by load id, with the reason).
    rpc: (fn, args) => {
      if (fn !== "apply_mcleod_load_stops") return null;
      const ids = (args as StopRpcArgs).p_loads.map((l) => l.load_id);
      return {
        written: ids.filter((id) => !refuse[id]),
        refused: ids.filter((id) => refuse[id]).map((id) => ({ load_id: id, reason: refuse[id] })),
      };
    },
  });
}

type StopRpcArgs = { p_org: string; p_loads: { load_id: string; stops: Record<string, unknown>[] }[] };
/** What the projection handed `apply_mcleod_load_stops`, every call in order. */
const stopCalls = (rec: ReturnType<typeof seed>) =>
  rec.rpcs().filter((c) => c.fn === "apply_mcleod_load_stops").map((c) => c.args as StopRpcArgs);
const rpcStops = (rec: ReturnType<typeof seed>) => stopCalls(rec).flatMap((a) => a.p_loads.flatMap((l) => l.stops.map((s): Record<string, unknown> => ({ load_id: l.load_id, ...s }))));

let server: Server;
let baseUrl: string;
const post = (body: unknown) =>
  fetch(`${baseUrl}/api/tms/dispatch-movements`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const app = createApp(loadEnv({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});
afterAll(async () => closeTestServer(server));

async function run() {
  const movements = board();
  const rec = seed(movements);
  holder.client = rec.client;
  const res = await post({ company_id: "TMS", movements });
  return { rec, res, body: (await res.json()) as { projection: Record<string, unknown> & { unmatched: string[] } } };
}

describe("LR4 — the projection, raw → core", () => {
  it("creates the new McLeod load in McLeod's status, updates the known one, refuses the one with no order", async () => {
    const { rec, res, body } = await run();
    expect(res.status).toBe(200);
    expect(body.projection).toMatchObject({ projected: 2, created: 1, updated: 1, statusChanged: 1 });
    expect(body.projection.refused).toEqual([{ movement_id: "902", reason: "no order attached" }]);
    const [created] = rec.writtenRows("loads").filter((r) => r.source === "tms");
    expect(created).toMatchObject({ org_id: ORG, provider: "mcleod", external_id: "TMS:900", ref: "0135527", status: "approved" });
    const updated = rec.forTable("loads").find((q) => q.write?.method === "update")!;
    expect(updated.filters()).toEqual(expect.arrayContaining([{ col: "id", val: EXISTING_LOAD }, { col: "org_id", val: ORG }]));
    expect(updated.write!.payload).toMatchObject({ status: "delivered", external_closed_at: "2026-09-24T18:00:00.000Z" });
    expectOrgScoped(rec, ORG, { exempt: ["org_integrations"] });
  });

  it("the customer's name reaches the load from raw, on the new load and the known one alike (Q-LMR5)", async () => {
    const { rec } = await run();
    const [created] = rec.writtenRows("loads").filter((r) => r.source === "tms");
    expect(created).toMatchObject({ customer_code: "BATTSOL", customer_name: "BATTERY SOLUTIONS LLC" });
    const patch = rec.forTable("loads").find((q) => q.write?.method === "update")!.write!.payload as Record<string, unknown>;
    expect(patch.customer_name).toBe("BATTERY SOLUTIONS LLC");
    // The fake serves every column whatever is asked for, so the read-back must be seen to ASK for it.
    // (The ingest's own closed_at lookup is a select on the same table; the read-back is the one naming status.)
    const readBack = rec.forTable("mcleod_dispatch_movements").flatMap((q) => q.ops)
      .find((o) => o.method === "select" && /\bmovement_status\b/.test(String(o.args[0])));
    expect(readBack, "no projection read-back on mcleod_dispatch_movements").toBeDefined();
    expect(String(readBack!.args[0])).toMatch(/\bcustomer_name\b/);
  });

  it("a McLeod weight and piece count of 0 land as null — D-LMR8", async () => {
    const { rec } = await run();
    const [created] = rec.writtenRows("loads").filter((r) => r.source === "tms");
    expect(created!.weight_lbs).toBeNull();
    expect(created!.pieces).toBeNull();
  });

  it("writes only what McLeod owns — never hazmat, notes, or the approval and release stamps", async () => {
    const { rec } = await run();
    const patch = rec.forTable("loads").find((q) => q.write?.method === "update")!.write!.payload as Record<string, unknown>;
    for (const k of ["hazmat", "notes", "approved_by", "approved_at", "released_at", "created_by", "source"]) {
      expect(Object.keys(patch)).not.toContain(k);
    }
  });

  it("resolves McLeod's codes, and reports the one it cannot rather than guessing", async () => {
    const { rec, body } = await run();
    const [created] = rec.writtenRows("loads").filter((r) => r.source === "tms");
    expect(created).toMatchObject({ driver_id: DRIVER_ID, vehicle_id: TRUCK_ID, trailer_id: null });
    expect(body.projection.unmatched).toContain("NOPE9");
  });

  it("draws PU and SO with McLeod's name, times and contact; the VA stays in raw", async () => {
    const { rec } = await run();
    const stops = rpcStops(rec);
    expect(stops.filter((s) => s.load_id === "new-0").map((s) => [s.seq, s.kind])).toEqual([[1, "pickup"], [3, "dropoff"]]);
    expect(stops[0]).toMatchObject({ name: "BATTERY SOLUTIONS", appointment_start: "2026-09-30T22:00:00.000Z",
      eta_at: "2026-09-30T21:45:00.000Z", contact_phone: "5555550100", po_number: "PO-9" });
    expect(Object.keys(stops[0]!)).not.toContain("arrived_at");
  });

  // The literal values, not `requiredPhotosFor`: this test is what notices the shared rule changing.
  it("the mirror writes the shared required photos on every stop it writes", async () => {
    const { rec } = await run();
    const stops = rpcStops(rec);
    expect(stops.length).toBeGreaterThan(0);
    for (const s of stops) {
      expect(s.required_photos).toEqual(s.kind === "pickup" ? ["trailer", "bol"] : ["bol"]);
    }
    expect(new Set(stops.map((s) => s.kind))).toEqual(new Set(["pickup", "dropoff"]));
  });

  // T1 N-7 (S0b). The column list is 0660's insert; the driver's four are the ones it must never set.
  it("stops go through apply_mcleod_load_stops with every projected column and none of the driver's", async () => {
    const { rec, body } = await run();
    const calls = stopCalls(rec);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.p_org).toBe(ORG);
    expect(calls[0]!.p_loads.map((l) => l.load_id).sort()).toEqual([EXISTING_LOAD, "new-0"].sort());
    const PROJECTED = [
      "mcleod_stop_id", "seq", "kind", "name", "address_line", "city", "state", "postal_code", "lat", "lon",
      "appointment_start", "appointment_end", "location_name", "location_code", "external_status",
      "actual_arrival_at", "actual_departure_at", "eta_at", "contact_name", "contact_phone", "po_number", "required_photos",
    ];
    for (const s of calls[0]!.p_loads.flatMap((l) => l.stops)) {
      expect(Object.keys(s).sort()).toEqual([...PROJECTED].sort());
    }
    // No table write on load_stops at all: the old delete-and-reinsert is gone.
    expect(rec.forTable("load_stops").filter((q) => q.write)).toEqual([]);
    expect(body.projection).toMatchObject({ stops: 3, stopsRefused: [] });
  });

  it("a refused load is reported in stopsRefused, not thrown", async () => {
    const movements = board();
    const rec = seed(movements, { [EXISTING_LOAD]: "stop_tail_over_200" });
    holder.client = rec.client;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await post({ company_id: "TMS", movements });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { projection: Record<string, unknown> };
      expect(body.projection.stopsRefused).toEqual([{ loadId: EXISTING_LOAD, reason: "stop_tail_over_200" }]);
      // The written load's stops still count; the refused one's do not.
      expect(body.projection.stops).toBe(2);
      expect(warn).toHaveBeenCalledWith("[mcleod-mirror] stops refused: 1");
    } finally {
      warn.mockRestore();
    }
  });

  it("a re-sent movement keeps its stop ids", async () => {
    // Identity is McLeod's stop id, handed to the RPC that upserts on (load_id, mcleod_stop_id). Sent twice,
    // the same load names the same McLeod stops both times, and nothing deletes or re-inserts a row.
    const movements = board();
    const rec = seed(movements);
    holder.client = rec.client;
    expect((await post({ company_id: "TMS", movements })).status).toBe(200);
    expect((await post({ company_id: "TMS", movements })).status).toBe(200);
    const calls = stopCalls(rec);
    expect(calls).toHaveLength(2);
    const ids = (a: StopRpcArgs) => Object.fromEntries(a.p_loads.map((l) => [l.load_id, l.stops.map((s) => s.mcleod_stop_id)]));
    expect(ids(calls[0]!)).toEqual({ "new-0": ["zz1", "zz3"], [EXISTING_LOAD]: ["d1"] });
    expect(ids(calls[1]!)).toEqual(ids(calls[0]!));
    expect(rec.forTable("load_stops").filter((q) => q.write)).toEqual([]);
  });

  // LOAD-RATES-PLAN D-RATE2/D-RATE3. The charges are added to the agent's output by hand until R4 makes the
  // agent produce them; the raw read-back serves exactly what was posted.
  it("prices a loaded load in load_charges, and clears the price of one McLeod no longer prices — every query scoped", async () => {
    const CHARGES = {
      total_charge: 3620, freight_charge: 3500, otherchargetotal: 120, total_charge_c: "USD",
      bill_distance: 836, bill_distance_um: "MI", order_loaded_movements: 2,
    };
    // 900: loaded and new. 901: known, now an EMPTY movement of its order (D-RATE3). 902: no order, refused.
    const [m900, m901, m902] = board();
    const movements = [{ ...m900, ...CHARGES }, { ...m901, ...CHARGES, loaded: "E" }, { ...m902, ...CHARGES }];
    const rec = seed(movements);
    holder.client = rec.client;
    const res = await post({ company_id: "TMS", movements });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { projection: { charges: number } }).projection.charges).toBe(1);

    expect(rec.writtenRows("load_charges")).toEqual([{
      load_id: "new-0", org_id: ORG, total_charge: 3620, linehaul: 3500, other_charges: 120, currency: "USD",
      billed_miles: 836, order_loaded_movements: 2, updated_at: expect.any(String),
    }]);
    const upsert = rec.forTable("load_charges").find((q) => q.write?.method === "upsert")!;
    expect(upsert.ops.find((o) => o.method === "upsert")!.args[1]).toEqual({ onConflict: "load_id" });
    const del = rec.forTable("load_charges").find((q) => q.write?.method === "delete")!;
    expect(del.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "load_id", val: [EXISTING_LOAD] }]));
    // The price never rides on `loads`, which every org member can read from a browser (0085).
    for (const row of rec.writtenRows("loads")) expect(Object.keys(row)).not.toContain("charge");
    expectOrgScoped(rec, ORG, { exempt: ["org_integrations"] });
  });

  it("before the connector reads charges, nothing is priced and no price is written", async () => {
    const { rec, body } = await run();
    expect(body.projection.charges).toBe(0);
    expect(rec.forTable("load_charges").filter((q) => q.write?.method === "upsert")).toEqual([]);
  });

  it("records the history: created for the new load, completed when McLeod delivers the known one", async () => {
    const { rec } = await run();
    const events = rec.writtenRows("load_events");
    expect(events.map((e) => [e.load_id, e.kind, e.from_status, e.to_status])).toEqual([
      ["new-0", "created", null, "approved"],
      [EXISTING_LOAD, "completed", "pending_approval", "delivered"],
    ]);
  });
});
