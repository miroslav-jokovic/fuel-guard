import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { listAssignments, listLoads } from "./queries.js";

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

/**
 * The Assignments board's load column (2026-09-28). The same question as the live map, "what is this
 * driver hauling right now", answered by the same shared rule (`isLoadWithDriver`), so a McLeod `P`
 * McLeod has planned but not started (`approved`) appears against its driver, and a driver holding two
 * loads shows the one under way whatever order the rows come back in.
 */
describe("listAssignments", () => {
  const D1 = "22222222-2222-4333-8444-000000000001";
  const load = (o: Record<string, unknown>) => ({ id: L1, ref: "0001", driver_id: D1, source: "tms", external_status: "P", ...o });
  const assignments = (loads: unknown[]) =>
    createSupabaseRecorder({
      tables: {
        drivers: [{ id: D1, full_name: "Ana Ruiz", status: "active", current_hos_status: "driving", current_hos_vehicle: null, current_location: null }],
        driver_duty_sessions: [],
        loads,
        vehicles: [],
        trailers: [],
        hos_duty_segments: [],
      },
    });
  const row = async (loads: unknown[]) => (await listAssignments(assignments(loads).client, ORG))[0]!;

  it("shows a McLeod load McLeod has planned onto the driver, with what the board needs to word it", async () => {
    expect(await row([load({ status: "approved" })])).toMatchObject({
      load_id: L1, load_status: "approved", load_source: "tms", load_external_status: "P",
    });
  });

  it("leaves off an office-approved load that did not come from McLeod, and McLeod's A", async () => {
    expect((await row([load({ status: "approved", source: "manual" })])).load_id).toBeNull();
    expect((await row([load({ status: "pending_approval", external_status: "A" })])).load_id).toBeNull();
  });

  it("still shows a non-McLeod load offered to the driver in the app", async () => {
    expect((await row([load({ status: "offered", source: "manual", external_status: null })])).load_id).toBe(L1);
  });

  it("shows the load under way when the driver holds two, whichever order the rows arrive in", async () => {
    const current = load({ id: L1, ref: "0009", status: "in_transit" });
    const next = load({ id: L2, ref: "0001", status: "approved" });
    expect((await row([current, next])).load_id).toBe(L1);
    expect((await row([next, current])).load_id).toBe(L1);
  });

  it("scopes every read to the caller's org and asks only for statuses some source can accept", async () => {
    const rec = assignments([load({ status: "in_transit" })]);
    await listAssignments(rec.client, ORG);
    expectOrgScoped(rec, ORG);
    const statuses = rec.forTable("loads")[0]!.ops.find((o) => o.method === "in" && o.args[0] === "status")?.args[1] as string[];
    expect([...statuses].sort()).toEqual(["accepted", "approved", "in_transit", "offered"]);
  });
});
