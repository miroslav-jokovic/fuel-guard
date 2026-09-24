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
  customer_id: "BATTSOL", weight: 0, weight_um: "LB", pieces: 0, pallets_how_many: null, consignee_refno: "PO-77",
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
function seed(movements: Record<string, unknown>[]) {
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
  });
}

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
    const stops = rec.writtenRows("load_stops");
    expect(stops.filter((s) => s.load_id === "new-0").map((s) => [s.seq, s.kind])).toEqual([[1, "pickup"], [3, "dropoff"]]);
    expect(stops[0]).toMatchObject({ name: "BATTERY SOLUTIONS", appointment_start: "2026-09-30T22:00:00.000Z",
      eta_at: "2026-09-30T21:45:00.000Z", contact_phone: "5555550100", po_number: "PO-9" });
    expect(Object.keys(stops[0]!)).not.toContain("arrived_at");
  });

  it("only a driver's untouched stops are cleared — a worked stop is never deleted", async () => {
    const { rec } = await run();
    const del = rec.forTable("load_stops").find((q) => q.write?.method === "delete")!;
    expect(del.filters()).toContainEqual({ col: "status", val: "pending" });
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
