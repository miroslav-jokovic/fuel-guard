import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { listLoads } from "./queries.js";
import { IN_LIST_CHUNK } from "../../../lib/paging.js";

/**
 * The board read (LR7). What it must hold on its own, since it reads with the service role: every
 * query scoped to the org, and McLeod's dispatcher resolved to a NAME through `mcleod`'s roster — with
 * the McLeod id as the fallback, so a load that has a dispatcher never shows a blank one.
 *
 * Fixtures are functions of the query, not flat arrays: the recorder applies no filters, so a flat
 * `tms_dispatchers` list would "resolve" a name the real query could never have returned.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const L1 = "11111111-2222-4333-8444-000000000001";
const L2 = "11111111-2222-4333-8444-000000000002";

const filter = (q: RecordedQuery, col: string) => q.filters().find((f) => f.col === col)?.val;
// McLeod's fleet table: JSMITH runs fleet SMITH; GHOST runs none. Display names are not read at all.
const fleets = [{ provider: "mcleod", code: "SMITH", dispatcher_external_id: "JSMITH" }];

function board() {
  return createSupabaseRecorder({
    tables: {
      loads: [
        { id: L1, source: "tms", provider: "mcleod", dispatcher_external_id: "JSMITH", hazmat: false, drivers: null, vehicles: null, trailers: null },
        { id: L2, source: "tms", provider: "mcleod", dispatcher_external_id: "ghost", hazmat: false, drivers: null, vehicles: null, trailers: null },
      ],
      load_stops: [],
      load_dispatches: [],
      tms_dispatchers: [],
      tms_fleets: (q: RecordedQuery) => fleets.filter((f) => f.provider === filter(q, "provider")),
    },
  });
}

describe("listLoads", () => {
  it("names each load's McLeod dispatcher as the board does, in capitals, scoped to the org", async () => {
    const rec = board();
    const rows = (await listLoads(rec.client, ORG)) as { id: string; dispatcher_name: string | null }[];
    expectOrgScoped(rec, ORG);
    // By the fleet they run (owner 2026-10-19: "use all capital names")...
    expect(rows.find((r) => r.id === L1)?.dispatcher_name).toBe("SMITH");
    // ...else by their login, still in capitals, so a load never shows its dispatcher blank.
    expect(rows.find((r) => r.id === L2)?.dispatcher_name).toBe("GHOST");
  });

  it("asks the dispatcher roster nothing when no load names a dispatcher", async () => {
    const rec = createSupabaseRecorder({
      tables: { loads: [{ id: L1, source: "tms", provider: "mcleod", dispatcher_external_id: null, hazmat: false }] },
    });
    const rows = (await listLoads(rec.client, ORG)) as { dispatcher_name: string | null }[];
    expect(rows[0]?.dispatcher_name).toBeNull();
    expect(rec.forTable("tms_dispatchers")).toHaveLength(0);
  });

  /**
   * 2026-10-09: the Board VM's first day put 454 loads on the board, and one `.in()` over all of them
   * overflowed Node 22's header limit — every board read failed with "fetch failed". The reads by load
   * id now go in IN_LIST_CHUNK slices, and the loads read pages past PostgREST's 1,000-row cap.
   */
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `11111111-2222-4333-8444-${String(i).padStart(12, "0")}`,
      source: "tms", provider: "mcleod", dispatcher_external_id: null, hazmat: false,
    }));

  it("reads stops and dispatches for a board larger than one id chunk, every load keeping its own", async () => {
    const loads = many(2 * IN_LIST_CHUNK + 7);
    const rec = createSupabaseRecorder({
      tables: {
        loads: { pages: [loads] },
        load_stops: (q: RecordedQuery) =>
          (filter(q, "load_id") as string[]).map((id) => ({ load_id: id, seq: 1, kind: "pickup" })),
        load_dispatches: (q: RecordedQuery) =>
          (filter(q, "load_id") as string[]).map((id) => ({ id: `d-${id}`, load_id: id, sent_at: "2026-10-09T12:00:00Z", drivers: null })),
      },
    });
    const rows = (await listLoads(rec.client, ORG)) as { id: string; stops: { load_id: string }[]; last_dispatch: { id: string } | null }[];
    expectOrgScoped(rec, ORG);
    for (const table of ["load_stops", "load_dispatches"]) {
      const reads = rec.forTable(table);
      expect(reads).toHaveLength(3);
      for (const q of reads) expect((filter(q, "load_id") as string[]).length).toBeLessThanOrEqual(IN_LIST_CHUNK);
    }
    expect(rows).toHaveLength(loads.length);
    for (const r of rows) {
      expect(r.stops.map((s) => s.load_id)).toEqual([r.id]);
      expect(r.last_dispatch?.id).toBe(`d-${r.id}`);
    }
  });

  it("fails the board when a stops read fails, rather than showing loads without their stops", async () => {
    const rec = createSupabaseRecorder({
      tables: { loads: { pages: [many(3)] }, load_stops: { error: { message: "fetch failed" } } },
    });
    await expect(listLoads(rec.client, ORG)).rejects.toThrow("fetch failed");
  });

  it("returns every load past PostgREST's 1,000-row page", async () => {
    const loads = many(1003);
    const rec = createSupabaseRecorder({ tables: { loads: { pages: [loads.slice(0, 1000), loads.slice(1000)] } } });
    const rows = (await listLoads(rec.client, ORG)) as { id: string }[];
    expect(rows).toHaveLength(1003);
    expect(rec.forTable("loads")).toHaveLength(2);
  });
});


/**
 * LOADS-ACTIVITY-PLAN D-LA6: with a delivery window, open loads come back whole and closed ones only
 * inside it. Delivered is judged by the LAST drop's departure (`loadDeliveredAt`), so a load whose first
 * drop is in the window and last is not is a candidate and is then dropped. D-LA2: a team's second seat
 * comes back by name.
 */
describe("listLoads with a delivered window", () => {
  const FROM = "2026-10-12T05:00:00.000Z";
  const BEFORE = "2026-10-19T05:00:00.000Z";
  const OPEN = "11111111-2222-4333-8444-0000000000a1";
  const INSIDE = "11111111-2222-4333-8444-0000000000a2";
  const SPILLS = "11111111-2222-4333-8444-0000000000a3";
  const VOID = "11111111-2222-4333-8444-0000000000a4";
  const HOUSTON = "d0000000-0000-4000-8000-000000000002";
  const row = (id: string, status: string, over: Record<string, unknown> = {}) =>
    ({ id, status, source: "tms", provider: "mcleod", dispatcher_external_id: null, hazmat: false, created_at: "2026-10-10T00:00:00Z", ...over });
  const stops: Record<string, { load_id: string; seq: number; kind: string; actual_departure_at: string | null }[]> = {
    [INSIDE]: [{ load_id: INSIDE, seq: 1, kind: "pickup", actual_departure_at: "2026-10-13T10:00:00Z" }, { load_id: INSIDE, seq: 2, kind: "dropoff", actual_departure_at: "2026-10-14T10:00:00Z" }],
    // First drop inside the window, last drop after it: delivered AFTER the window.
    [SPILLS]: [{ load_id: SPILLS, seq: 1, kind: "dropoff", actual_departure_at: "2026-10-18T10:00:00Z" }, { load_id: SPILLS, seq: 2, kind: "dropoff", actual_departure_at: "2026-10-19T10:00:00Z" }],
  };
  const has = (q: RecordedQuery, method: string) => q.ops.some((o) => o.method === method);

  function rig() {
    return createSupabaseRecorder({
      tables: {
        loads: (q: RecordedQuery) => {
          // Plain arrays: the recorder keeps ONE page queue per table, so `pages` from a function would
          // serve the first read's queue to the next.
          if (has(q, "not")) return [row(OPEN, "in_transit", { co_driver_id: HOUSTON })];
          if (filter(q, "status") === "canceled") return [row(VOID, "canceled", { external_closed_at: "2026-10-15T00:00:00Z" })];
          return [row(INSIDE, "delivered"), row(SPILLS, "delivered")].filter((r) => (filter(q, "id") as string[]).includes(r.id));
        },
        // The candidate read selects only load_id; the stops read selects the board's columns.
        load_stops: (q: RecordedQuery) => {
          const ids = filter(q, "load_id") as string[] | undefined;
          if (!ids) return q.ops.some((o) => o.method === "gte" && o.args[0] === "actual_departure_at") ? [{ load_id: INSIDE }, { load_id: SPILLS }] : [];
          return ids.flatMap((id) => stops[id] ?? []);
        },
        drivers: (q: RecordedQuery) => ((filter(q, "id") as string[]).includes(HOUSTON) ? [{ id: HOUSTON, full_name: "Marcus Houston" }] : []),
        load_dispatches: [],
      },
    });
  }

  it("returns the open loads, the deliveries whose LAST drop left inside the window, and voids closed inside it", async () => {
    const rec = rig();
    const rows = (await listLoads(rec.client, ORG, { from: FROM, before: BEFORE })) as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual([OPEN, INSIDE, VOID].sort());
    expectOrgScoped(rec, ORG);
  });

  it("asks the stops for delivery departures inside the window, half-open", async () => {
    const rec = rig();
    await listLoads(rec.client, ORG, { from: FROM, before: BEFORE });
    const candidate = rec.forTable("load_stops").find((q) => q.ops.some((o) => o.method === "gte" && o.args[0] === "actual_departure_at"))!;
    expect(candidate.ops.find((o) => o.method === "gte")?.args).toEqual(["actual_departure_at", FROM]);
    expect(candidate.ops.find((o) => o.method === "lt")?.args).toEqual(["actual_departure_at", BEFORE]);
    expect(filter(candidate, "kind")).toBe("dropoff");
  });

  it("names a team load's second driver, read from the org's own roster", async () => {
    const rec = rig();
    const rows = (await listLoads(rec.client, ORG, { from: FROM, before: BEFORE })) as { id: string; co_driver_name: string | null }[];
    expect(rows.find((r) => r.id === OPEN)?.co_driver_name).toBe("Marcus Houston");
    expect(rows.find((r) => r.id === INSIDE)?.co_driver_name).toBeNull();
    expect(filter(rec.forTable("drivers")[0]!, "org_id")).toBe(ORG);
  });
});
