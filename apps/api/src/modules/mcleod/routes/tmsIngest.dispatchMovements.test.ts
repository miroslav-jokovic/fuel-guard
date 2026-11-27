import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashIngestToken } from "../../../lib/ingestToken.js";

/**
 * `POST /api/tms/dispatch-movements` (LOADS-MIRROR-PLAN.md LR3) over the wire, fed with the AGENT'S OWN
 * OUTPUT. The agent ships alone and never imports `@silvicom/shared`, so the only thing holding its
 * mapper and this contract together is a test that runs one into the other — a hand-copied fixture
 * would agree with the contract by construction and prove nothing.
 */
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("../../../lib/supabaseAdmin.js", () => ({ getSupabaseAdmin: () => holder.client }));

type Assemble = (rows: unknown[], stops: unknown[]) => { movements: Record<string, unknown>[] };
const AGENT = new URL("../../../../../../tools/mcleod-agent/loads.mjs", import.meta.url).href;
const { assemble } = (await import(/* @vite-ignore */ AGENT)) as { assemble: Assemble };

const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TOKEN = "fgtms_" + "e".repeat(37);
const EARLIER_CLOSE = "2026-09-20T15:00:00.000Z";

// As DISPATCH_LOADS / DISPATCH_LOAD_STOPS return them.
const boardRow = (over: Record<string, unknown> = {}) => ({
  external_id: "TMS:900", company_id: "TMS", movement_id: "900", ref: "0135527", bol_number: "TL1",
  dispatcher_external_id: "romann", driver_codes: "DKELLY,JSMITH", vehicle_unit: "702", trailer_unit: "536686",
  trailer_type: "R", commodity: "paints", total_miles: 812, external_status: "P", loaded: "L",
  customer_id: "BATTSOL", customer_name: "BATTERY SOLUTIONS LLC", weight: 42000, weight_um: "LB", pieces: 24, pallets_how_many: 22, consignee_refno: null,
  ...over,
});
const boardStop = (over: Record<string, unknown> = {}) => ({
  movement_id: "900", stop_id: "zz1", seq: 1, stop_type: "PU", location_id: "BATTSOL1", location_name: "BATTERY SOLUTIONS",
  city: "Howell", state: "MI", address_line: "1 Dock Rd", postal_code: "48843", lat: 42.6, lon_west_positive: 83.93,
  appointment_start: "2026-09-30T17:00:00", appointment_end: null, actual_arrival: null, actual_departure: null,
  eta: "2026-09-30T16:45:00", contact_name: null, phone: null, ponum: null, stop_status: "A",
  ...over,
});

let server: Server;
let baseUrl: string;

const post = (body: unknown) =>
  fetch(`${baseUrl}/api/tms/dispatch-movements`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });

/**
 * Function fixtures, because the recorder does not filter: each answers only a query scoped the way
 * the real one must be, so a missing org or company filter reads as "nothing there" and fails a test.
 */
const scopedTo = (q: { filters(): { col: string; val: unknown }[] }) =>
  q.filters().some((f) => f.col === "org_id" && f.val === ORG) && q.filters().some((f) => f.col === "company_id" && f.val === "TMS");

const seed = (): SupabaseRecorder =>
  createSupabaseRecorder({
    tables: {
      org_integrations: (q) =>
        q.filters().some((f) => f.col === "ingest_token_hash" && f.val === hashIngestToken(TOKEN))
          ? [{ org_id: ORG, provider: "mcleod", enabled: true, ingest_token_hash: hashIngestToken(TOKEN), config: {} }]
          : [],
      // Movement 901 was closed on an earlier sync; the stamp must survive this one.
      mcleod_dispatch_movements: (q) => (scopedTo(q) ? [{ movement_id: "901", closed_at: EARLIER_CLOSE }] : []),
      // A stop McLeod has since removed from movement 900 is still held here.
      mcleod_dispatch_stops: (q) => (scopedTo(q) ? [{ stop_id: "zz1" }, { stop_id: "removed-in-mcleod" }] : []),
    },
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

const board = () =>
  assemble(
    [boardRow(), boardRow({ external_id: "TMS:901", movement_id: "901", external_status: "D" }),
      boardRow({ external_id: "TMS:902", movement_id: "902", external_status: "V" })],
    [boardStop(), boardStop({ stop_id: "zz2", seq: 2, stop_type: "VA" }), boardStop({ movement_id: "901", stop_id: "d1" })],
  ).movements;

// The seven order-charge keys the agent sends since LOAD-RATES-PLAN R4 (D-RATE1). The Board VM runs a connector
// older than R4 until it is updated, so the "older connector" cases below send the agent's own output with
// these removed — that is exactly what the VM's connector posts.
const CHARGE_COLUMNS = ["total_charge", "freight_charge", "otherchargetotal", "total_charge_c", "bill_distance",
  "bill_distance_um", "order_loaded_movements"];
const withoutCharges = (m: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(m).filter(([k]) => !CHARGE_COLUMNS.includes(k)));

// The backfill's payload (DLC4): movement 903, never held, already D, delivered in April; its last stop
// carries the year-2215 placeholder McLeod leaves on some departures.
const backfill = () =>
  assemble(
    [boardRow({ external_id: "TMS:903", movement_id: "903", external_status: "D" })],
    [boardStop({ movement_id: "903", stop_id: "b1", stop_type: "PU", actual_departure: "2026-04-02T09:10:00" }),
      boardStop({ movement_id: "903", stop_id: "b2", seq: 2, stop_type: "SO", actual_departure: "2026-04-03T14:30:00" }),
      boardStop({ movement_id: "903", stop_id: "b3", seq: 3, stop_type: "SO", actual_departure: "2215-01-01T00:00:00" })],
  ).movements;

describe("POST /api/tms/dispatch-movements", () => {
  it("stores the agent's board for the token's org and company, every stop kept, every query scoped", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post({ company_id: "TMS", movements: board() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, received: 3, movements: 3, stops: 3, stopsRemoved: 1, closed: 2 });

    const movements = rec.writtenRows("mcleod_dispatch_movements");
    expect(movements.map((m) => [m.org_id, m.company_id, m.movement_id])).toEqual([
      [ORG, "TMS", "900"], [ORG, "TMS", "901"], [ORG, "TMS", "902"],
    ]);
    const stops = rec.writtenRows("mcleod_dispatch_stops");
    expect(stops.map((s) => [s.movement_id, s.stop_id, s.stop_type])).toEqual([
      ["900", "zz1", "PU"], ["900", "zz2", "VA"], ["901", "d1", "PU"],
    ]);
    expect(stops[0]!.sched_arrive_early).toBe("2026-09-30T22:00:00.000Z");
    expect(stops[0]!.longitude).toBe(-83.93);

    // Every McLeod-side query names the org AND the company; the token lookup is by hash on purpose.
    expectOrgScoped(rec, ORG, { exempt: ["org_integrations"] });
    for (const q of [...rec.forTable("mcleod_dispatch_movements"), ...rec.forTable("mcleod_dispatch_stops")]) {
      if (q.write?.method === "upsert") continue; // the rows themselves carry org and company
      expect(q.filters().some((f) => f.col === "company_id" && f.val === "TMS"), JSON.stringify(q.ops)).toBe(true);
    }
  });

  // D-RLY12: the relink pass is `relinkScheduler.ts`'s now. Inside the request it re-read 60 days of
  // movements and their loads' links after every one-movement batch — most of the route's 1.6 s median.
  it("does not re-read the relink window inside the sync", async () => {
    const rec = seed();
    holder.client = rec.client;
    const res = await post({ company_id: "TMS", movements: board() });
    expect(res.status).toBe(200);
    expect(rec.forTable("mcleod_dispatch_movements").filter((q) => q.ops.some((o) => o.method === "or"))).toEqual([]);
    expect(rec.forTable("loads").filter((q) => q.ops.some((o) => o.method === "select" && String(o.args[0]).includes("co_driver_id")))).toEqual([]);
  });

  it("writes COMPLETE rows — every contract column, and never first_seen_at, so the first sighting survives", async () => {
    const rec = seed();
    holder.client = rec.client;
    await post({ company_id: "TMS", movements: board() });
    const [m] = rec.writtenRows("mcleod_dispatch_movements");
    expect(Object.keys(m!).sort()).toEqual([
      "blnum", "closed_at", "commodity", "company_id", "consignee_refno", "customer_id", "customer_name", "dispatcher_user_id",
      "driver_codes", "last_seen_at", "loaded", "move_distance", "movement_id", "movement_status", "order_id",
      "org_id", "pallets_how_many", "pieces", "tractor_id", "trailer_id", "trailer_type", "weight", "weight_um",
      ...CHARGE_COLUMNS,
    ].sort());
    const [s] = rec.writtenRows("mcleod_dispatch_stops");
    expect(Object.keys(s!)).not.toContain("first_seen_at");
    expect(Object.keys(s!)).toContain("last_seen_at");
  });

  it("closed_at: stamped when McLeod first says D or V, kept on a later sync, null while the movement is open", async () => {
    const rec = seed();
    holder.client = rec.client;
    const before = Date.now();
    await post({ company_id: "TMS", movements: board() });
    const byId = Object.fromEntries(rec.writtenRows("mcleod_dispatch_movements").map((m) => [m.movement_id, m.closed_at]));
    expect(byId["900"]).toBeNull();
    expect(byId["901"]).toBe(EARLIER_CLOSE);
    expect(Date.parse(String(byId["902"]))).toBeGreaterThanOrEqual(before - 1000);
  });

  // D-DLC9: the backfill's movement was closed months ago; dating it "now" would put six months of
  // history on one day and keep it in the relink window for 60 days.
  it("closed_at: a movement never held that arrives already closed is dated by its last recorded departure, never a placeholder", async () => {
    const rec = seed();
    holder.client = rec.client;
    const movements = backfill();
    await post({ company_id: "TMS", movements });
    const sent = movements[0] as { stops: { stop_id: string; actual_departure: string }[] };
    const lastReal = sent.stops.find((s) => s.stop_id === "b2")!.actual_departure;
    expect(lastReal).toMatch(/^2026-04-03T/);
    const row = rec.writtenRows("mcleod_dispatch_movements").find((m) => m.movement_id === "903");
    expect(row?.closed_at).toBe(lastReal);
  });

  it("deletes a stop McLeod removed from a movement it sent — by id, scoped — and nothing else", async () => {
    const rec = seed();
    holder.client = rec.client;
    await post({ company_id: "TMS", movements: board() });
    const deletes = rec.forTable("mcleod_dispatch_stops").filter((q) => q.write?.method === "delete");
    expect(deletes).toHaveLength(1);
    const f = deletes[0]!.filters();
    expect(f).toContainEqual({ col: "org_id", val: ORG });
    expect(f).toContainEqual({ col: "company_id", val: "TMS" });
    expect(f).toContainEqual({ col: "stop_id", val: ["removed-in-mcleod"] });
  });

  it("asks only about the movements it was sent — a movement absent from the payload is not touched", async () => {
    const rec = seed();
    holder.client = rec.client;
    await post({ company_id: "TMS", movements: board().slice(0, 1) });
    const reads = rec.forTable("mcleod_dispatch_stops").filter((q) => !q.write);
    // Two reads since LR4 (the ingest's stop reconcile, then the projection's read-back) — both about 900 only.
    const asked = reads.flatMap((q) => q.filters().filter((f) => f.col === "movement_id").map((f) => f.val));
    expect(asked.length).toBeGreaterThan(0);
    for (const ids of asked) expect(ids).toEqual(["900"]);
  });

  it("refuses McLeod's zoneless time, naming the field, and writes nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    const movements = board();
    (movements[0]!.stops as Record<string, unknown>[])[0]!.eta = "2026-09-30T16:45:00";
    const res = await post({ company_id: "TMS", movements });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("movements.0.stops.0.eta");
    expect(rec.writes()).toHaveLength(0);
  });

  // LOAD-RATES-PLAN D-RATE9: the order's charges (0638) are optional until the Board VM runs the connector
  // that reads them. Since R4 the agent produces them; the cases below set them by hand, and remove them to
  // stand in for the VM's older connector.
  const CHARGES = {
    total_charge: 3620, freight_charge: 3500, otherchargetotal: 120, total_charge_c: "USD",
    bill_distance: 836, bill_distance_um: "MI", order_loaded_movements: 2,
  };
  it("the seven keys this file names are the agent's own, so removing them really is an older connector", () => {
    expect(Object.keys(board()[0]!).filter((k) => CHARGE_COLUMNS.includes(k)).sort()).toEqual([...CHARGE_COLUMNS].sort());
    expect(Object.keys(CHARGES).sort()).toEqual([...CHARGE_COLUMNS].sort());
  });

  it("a connector that does not read charges never names the seven columns, so a stored figure is never overwritten", async () => {
    const rec = seed();
    holder.client = rec.client;
    expect((await post({ company_id: "TMS", movements: board().map(withoutCharges) })).status).toBe(200);
    for (const row of rec.writtenRows("mcleod_dispatch_movements")) {
      for (const col of CHARGE_COLUMNS) expect(Object.keys(row)).not.toContain(col);
    }
  });

  it("a connector that reads charges writes all seven on every movement, blanks as null", async () => {
    const rec = seed();
    holder.client = rec.client;
    const [a, b, c] = board();
    const blanks = Object.fromEntries(CHARGE_COLUMNS.map((k) => [k, null]));
    const res = await post({ company_id: "TMS", movements: [{ ...a, ...CHARGES }, { ...b, ...CHARGES }, { ...c, ...blanks }] });
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(rec.writtenRows("mcleod_dispatch_movements").map((m) => [m.movement_id, m]));
    expect(byId["900"]).toMatchObject(CHARGES);
    expect(byId["902"]).toMatchObject(blanks);
    expectOrgScoped(rec, ORG, { exempt: ["org_integrations"] });
  });

  it("refuses a batch that sends charges for some movements and not others, and writes nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    const [a, b] = board();
    const res = await post({ company_id: "TMS", movements: [{ ...a, ...CHARGES }, withoutCharges(b!)] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("order charges must be sent for every movement in a batch or for none");
    expect(rec.writes()).toHaveLength(0);
  });

  it("refuses a movement that sends only some of the seven, naming what is missing, and writes nothing", async () => {
    const rec = seed();
    holder.client = rec.client;
    const [a] = board();
    const { order_loaded_movements: _gone, ...six } = CHARGES;
    const res = await post({ company_id: "TMS", movements: [{ ...withoutCharges(a!), ...six }] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("missing order_loaded_movements");
    expect(rec.writes()).toHaveLength(0);
  });

  // customer_name is the connector's newest field (Q-LMR5, 0383): a connector older than it must be refused
  // by name, not let through to blank the name a newer sync stored.
  it.each(["customer_id", "customer_name"])(
    "refuses a movement missing %s rather than writing null over what McLeod still has",
    async (field) => {
      const rec = seed();
      holder.client = rec.client;
      const movements = board();
      delete movements[0]![field];
      const res = await post({ company_id: "TMS", movements });
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain(`movements.0.${field}`);
      expect(rec.writes()).toHaveLength(0);
    },
  );
});
