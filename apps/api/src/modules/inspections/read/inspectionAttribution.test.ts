import { describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import { readInspectionAttribution } from "./inspectionAttribution.js";

/**
 * Who was driving, as the Inspection page reads it (IC5, D-IC7). The recorder does not filter, so each
 * fixture applies the filters its query asked for: a read that forgets the source would show a
 * person's row as the engine's, one that resolves by anything but the Samsara id would name a stranger.
 */

const ORG = "org-1";
const INSP = "insp-1";
const val = (q: RecordedQuery, method: string, col: string) => q.ops.find((o) => o.method === method && o.args[0] === col)?.args[1];
/** The order the query asked for on `created_at`: 1 ascending, -1 descending, 0 (insertion order) when it asked none. */
const orderOf = (q: RecordedQuery) => {
  const o = q.ops.find((op) => op.method === "order" && op.args[0] === "created_at");
  return o ? ((o.args[1] as { ascending?: boolean } | undefined)?.ascending === false ? -1 : 1) : 0;
};
const inList = (q: RecordedQuery, col: string) => (q.ops.find((o) => o.method === "in" && o.args[0] === col)?.args[1] ?? []) as string[];

const row = (extra: Record<string, unknown> = {}) => ({
  id: "eng-1", org_id: ORG, inspection_id: INSP, source: "engine", engine_version: "ic5.1", created_at: "2026-10-14T10:00:00Z",
  outcome: "one_driver", confidence: "high", basis: "bracketing", zone: "America/Chicago", zone_method: "gps",
  started_at: "2026-09-22T18:04:00Z", ended_at: "2026-09-22T18:27:00Z", location_check: "confirmed",
  vehicle_id: "veh-1", samsara_vehicle_id: "2120", samsara_driver_id: "s-ann", samsara_driver_name: "Ann (Samsara)",
  candidates: [
    { samsaraDriverId: "s-ann", name: "Ann (Samsara)", passenger: false, segments: [] },
    { samsaraDriverId: "s-gone", name: "Gone (Samsara)", passenger: true, segments: [] },
  ],
  decided_by: null, driver_id: null, note: null, ...extra,
});
const DRIVERS = [
  { id: "d-ann", org_id: ORG, samsara_driver_id: "s-ann", full_name: "Ann Roster" },
  { id: "d-bob", org_id: ORG, samsara_driver_id: null, full_name: "Bob Roster" },
  { id: "d-twin", org_id: "org-2", samsara_driver_id: "s-gone", full_name: "Another carrier's driver" },
];

function recorder(rows: Record<string, unknown>[]) {
  return createSupabaseRecorder({
    tables: {
      inspection_attributions: (q) =>
        rows
          .filter((r) => r.org_id === val(q, "eq", "org_id") && r.inspection_id === val(q, "eq", "inspection_id") && r.source === val(q, "eq", "source"))
          .sort((a, b) => orderOf(q) * String(a.created_at).localeCompare(String(b.created_at))),
      drivers: (q) => {
        const bySamsara = inList(q, "samsara_driver_id");
        const byId = inList(q, "id");
        return DRIVERS.filter((d) => d.org_id === val(q, "eq", "org_id") && (bySamsara.includes(d.samsara_driver_id!) || byId.includes(d.id)));
      },
    },
    rpc: { org_member_directory: [{ user_id: "u-9", full_name: "Sam Safety", email: "sam@example.test" }] },
  });
}

describe("the reading", () => {
  it("is null until the engine reaches the inspection, and asks for no driver", async () => {
    const rec = recorder([]);
    expect(await readInspectionAttribution(rec.client as never, ORG, INSP)).toEqual({ reading: null, decision: null, basedOn: null, reports: [] });
    expect(rec.forTable("drivers")).toEqual([]);
  });

  it("resolves Samsara's driver to our roster by Samsara id, and leaves one the roster lacks unresolved", async () => {
    const rec = recorder([row()]);
    const a = await readInspectionAttribution(rec.client as never, ORG, INSP);
    if ("error" in a) throw new Error("unexpected");
    expect(a.reading).toEqual({
      id: "eng-1", engineVersion: "ic5.1", readAt: "2026-10-14T10:00:00Z", outcome: "one_driver", confidence: "high", basis: "bracketing",
      zone: "America/Chicago", zoneMethod: "gps", startedAt: "2026-09-22T18:04:00Z", endedAt: "2026-09-22T18:27:00Z", locationCheck: "confirmed",
      samsaraDriver: { id: "s-ann", name: "Ann (Samsara)" },
      driver: { id: "d-ann", name: "Ann Roster" },
      candidates: [
        { samsaraDriverId: "s-ann", name: "Ann (Samsara)", passenger: false, driver: { id: "d-ann", name: "Ann Roster" } },
        // Another carrier holds a driver with this Samsara id; ours does not, so it stays unresolved.
        { samsaraDriverId: "s-gone", name: "Gone (Samsara)", passenger: true, driver: null },
      ],
    });
    expect(a.decision).toBeNull();
    expect(a.basedOn).toBe("eng-1");
    expectOrgScoped(rec, ORG);
  });

  it("is the engine's latest row, whatever its version, never a person's", async () => {
    const rec = recorder([row(), row({ id: "eng-2", engine_version: "ic5.2", created_at: "2026-10-15T10:00:00Z" }), row({ id: "p-1", source: "person", created_at: "2026-10-16T10:00:00Z", decided_by: "u-9" })]);
    const a = await readInspectionAttribution(rec.client as never, ORG, INSP);
    if ("error" in a) throw new Error("unexpected");
    expect([a.reading?.id, a.reading?.engineVersion, a.decision?.id]).toEqual(["eng-2", "ic5.2", "p-1"]);
    // A decision is made over the newest row of either source: here the person's.
    expect(a.basedOn).toBe("p-1");
  });
});

describe("the decision", () => {
  it("a confirmation names its author and carries no driver of its own", async () => {
    const rec = recorder([row(), row({ id: "p-1", source: "person", created_at: "2026-10-14T11:00:00Z", decided_by: "u-9", note: "Matches the log" })]);
    const a = await readInspectionAttribution(rec.client as never, ORG, INSP);
    if ("error" in a) throw new Error("unexpected");
    expect(a.decision).toEqual({
      id: "p-1", kind: "confirmed", driver: null, decidedBy: "Sam Safety", decidedAt: "2026-10-14T11:00:00Z", note: "Matches the log", engineVersion: "ic5.1",
    });
  });

  it("a correction names our driver by roster id", async () => {
    const rec = recorder([row(), row({ id: "p-1", source: "person", created_at: "2026-10-14T11:00:00Z", decided_by: "u-9", driver_id: "d-bob", note: "Bob signed" })]);
    const a = await readInspectionAttribution(rec.client as never, ORG, INSP);
    if ("error" in a) throw new Error("unexpected");
    expect(a.decision).toMatchObject({ kind: "corrected", driver: { id: "d-bob", name: "Bob Roster" } });
  });

  it("a correction whose driver row is gone (merged away) stays a correction, with no name to show", async () => {
    const rec = recorder([row(), row({ id: "p-1", source: "person", created_at: "2026-10-14T11:00:00Z", decided_by: "u-9", driver_id: "d-merged", note: "n" })]);
    const a = await readInspectionAttribution(rec.client as never, ORG, INSP);
    if ("error" in a) throw new Error("unexpected");
    expect(a.decision).toMatchObject({ kind: "corrected", driver: null });
  });
});

describe("a failed read", () => {
  it("is the caller's error, not an empty attribution", async () => {
    const rec = createSupabaseRecorder({ tables: { inspection_attributions: { data: null, error: { message: "boom" } } } });
    expect(await readInspectionAttribution(rec.client as never, ORG, INSP)).toEqual({ error: { message: "boom" } });
  });

  it("of the roster is the caller's error too", async () => {
    const rec = createSupabaseRecorder({
      tables: {
        inspection_attributions: (q) => (val(q, "eq", "source") === "engine" ? [row()] : []),
        drivers: { data: null, error: { message: "roster down" } },
      },
    });
    expect(await readInspectionAttribution(rec.client as never, ORG, INSP)).toEqual({ error: { message: "roster down" } });
  });
});
