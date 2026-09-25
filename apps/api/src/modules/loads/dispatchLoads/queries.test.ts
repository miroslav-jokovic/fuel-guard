import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { listLoads } from "./queries.js";

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
});
