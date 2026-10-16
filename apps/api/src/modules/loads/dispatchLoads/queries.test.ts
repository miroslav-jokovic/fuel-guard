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
const dispatchers = [
  { provider: "mcleod", external_id: "JSMITH", display_name: "Jo Smith" },
  { provider: "other", external_id: "GHOST", display_name: "Other TMS" },
];

function board() {
  return createSupabaseRecorder({
    tables: {
      loads: [
        { id: L1, source: "tms", provider: "mcleod", dispatcher_external_id: "JSMITH", hazmat: false, drivers: null, vehicles: null, trailers: null },
        { id: L2, source: "tms", provider: "mcleod", dispatcher_external_id: "GHOST", hazmat: false, drivers: null, vehicles: null, trailers: null },
      ],
      load_stops: [],
      load_dispatches: [],
      tms_dispatchers: (q: RecordedQuery) => {
        const ids = filter(q, "external_id") as string[];
        return dispatchers.filter((d) => d.provider === filter(q, "provider") && ids.includes(d.external_id));
      },
    },
  });
}

describe("listLoads", () => {
  it("names each load's McLeod dispatcher, scoped to the org and the load's own TMS", async () => {
    const rec = board();
    const rows = (await listLoads(rec.client, ORG)) as { id: string; dispatcher_name: string | null }[];
    expectOrgScoped(rec, ORG);
    expect(rows.find((r) => r.id === L1)?.dispatcher_name).toBe("Jo Smith");
    // GHOST exists only under another provider: the id is shown, never another TMS's name.
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

