import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../app.js";
import { loadEnv } from "../../../env.js";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { closeTestServer } from "../../../testing/httpServer.js";
import { hashIngestToken } from "../../../lib/ingestToken.js";

/**
 * The ingest's failure modes (production-readiness audit, 2026-09-28). Each was a defect in merged code:
 *  · a failed roster read made every McLeod code resolve to null, and the projection then UNASSIGNED
 *    the driver, truck and trailer of every load in the batch — now it answers 500 and writes no load;
 *  · a roster over PostgREST's 1,000 rows was silently truncated — now it is paged;
 *  · a failed token lookup answered 401 "Invalid ingest token" for a token that was fine — now 500;
 *  · the body (up to 8 MB) was parsed before the token was checked — now the token comes first;
 *  · a movement whose stops lack a usable sequence failed the whole batch's stop write — now that one
 *    movement is refused by name and the rest are projected.
 * Fixtures follow `tmsIngest.dispatchProjection.test.ts`: the raw read-back is served from the payload.
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

type Over = Partial<Record<"drivers" | "vehicles" | "trailers" | "org_integrations", unknown>>;

/** The projection test's seed, with any table replaceable — that is how each failure is injected. */
function seed(movements: Record<string, unknown>[], over: Over = {}) {
  const rawMovements = movements.map((m) => ({ ...m, company_id: "TMS", closed_at: null }));
  const rawStops = movements.flatMap((m) => (m.stops as Record<string, unknown>[]).map((s) => ({ ...s, movement_id: m.movement_id })));
  const orgOnly = (rows: unknown[]) => (q: RecordedQuery) => (q.filters().some((f) => f.col === "org_id" && f.val === ORG) ? rows : []);
  return createSupabaseRecorder({
    tables: {
      org_integrations: (over.org_integrations as never) ?? ((q: RecordedQuery) =>
        q.filters().some((f) => f.col === "ingest_token_hash" && f.val === hashIngestToken(TOKEN))
          ? [{ org_id: ORG, provider: "mcleod", enabled: true, ingest_token_hash: hashIngestToken(TOKEN), config: {} }]
          : []),
      mcleod_dispatch_movements: (q) => (scoped(q) && !q.write ? rawMovements : []),
      mcleod_dispatch_stops: (q) => (scoped(q) && !q.write ? rawStops : []),
      drivers: (over.drivers as never) ?? orgOnly([{ id: DRIVER_ID, employee_id: null, mcleod_driver_id: "DKELLY" }]),
      vehicles: (over.vehicles as never) ?? orgOnly([{ id: TRUCK_ID, unit_number: "702" }]),
      trailers: (over.trailers as never) ?? [],
      loads: (q) => {
        if (q.write?.method === "insert") {
          return (q.write.payload as { external_id: string }[]).map((r, i) => ({ id: `new-${i}`, external_id: r.external_id }));
        }
        if (q.write) return [];
        return q.filters().some((f) => f.col === "org_id" && f.val === ORG)
          ? [{ id: EXISTING_LOAD, status: "approved", external_id: "TMS:901" }] : [];
      },
    },
  });
}

let server: Server;
let baseUrl: string;
const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
  fetch(`${baseUrl}/api/tms/dispatch-movements`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
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

async function run(over: Over = {}, movements = board()) {
  const rec = seed(movements, over);
  holder.client = rec.client;
  const res = await post({ company_id: "TMS", movements });
  return { rec, res, body: (await res.json()) as Record<string, unknown> & { projection?: { refused: unknown[]; projected: number } } };
}

const loadWrites = (rec: ReturnType<typeof seed>) => rec.forTable("loads").filter((q) => q.write !== null);
const DB_DOWN = { message: "connection terminated unexpectedly" };

describe("a failed roster read never unassigns a load", () => {
  it.each(["drivers", "vehicles", "trailers"] as const)("answers 500 and writes no load when %s cannot be read", async (table) => {
    const { rec, res } = await run({ [table]: { error: DB_DOWN } });
    expect(res.status).toBe(500);
    expect(loadWrites(rec)).toEqual([]);
    expect(rec.writtenRows("load_stops")).toEqual([]);
  });

  it("resolves a truck that sits past PostgREST's first 1,000 rows", async () => {
    const filler = Array.from({ length: 1000 }, (_, i) => ({ id: `v-${i}`, unit_number: `F${i}` }));
    const { rec, res } = await run({ vehicles: { pages: [filler, [{ id: TRUCK_ID, unit_number: "702" }]] } });
    expect(res.status).toBe(200);
    const [created] = rec.writtenRows("loads").filter((r) => r.source === "tms");
    expect(created).toMatchObject({ vehicle_id: TRUCK_ID });
    // Paged in a stable order, or page two could repeat or skip rows.
    const reads = rec.forTable("vehicles").filter((q) => q.write === null);
    expect(reads).toHaveLength(2);
    expect(reads.every((q) => q.ops.some((o) => o.method === "order" && o.args[0] === "id"))).toBe(true);
    expect(reads.map((q) => q.ops.find((o) => o.method === "range")?.args)).toEqual([[0, 999], [1000, 1999]]);
    // Every page, like every other read here, is the caller's org only: the service role bypasses RLS.
    expectOrgScoped(rec, ORG, { exempt: ["org_integrations"] });
  });
});

describe("the ingest token", () => {
  it("answers 500, not 401, when the token lookup itself fails", async () => {
    const { res, body } = await run({ org_integrations: { error: DB_DOWN } });
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/Invalid ingest token/);
  });

  it("is checked before the body is read: a malformed body without a token is a 401, not a 400", async () => {
    holder.client = seed(board()).client;
    const res = await post("{not json", {});
    expect(res.status).toBe(401);
  });

  it("still reads the body once the token is good", async () => {
    holder.client = seed(board()).client;
    const res = await post("{not json");
    expect(res.status).toBe(400);
  });
});

describe("stops without a usable sequence", () => {
  it("refuse that one movement by name, and project the rest of the batch", async () => {
    const movements = board();
    const bad = movements.find((m) => m.movement_id === "900")!;
    const stops = bad.stops as Record<string, unknown>[];
    stops[1] = { ...stops[1], movement_sequence: stops[0]!.movement_sequence }; // a repeated number
    const { res, body } = await run({}, movements);
    expect(res.status).toBe(200);
    expect(body.projection!.refused).toContainEqual({ movement_id: "900", reason: "stop sequence missing or repeated" });
    expect(body.projection!.projected).toBe(1);
  });
});
