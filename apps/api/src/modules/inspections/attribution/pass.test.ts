import { describe, expect, it, vi } from "vitest";
import { ATTRIBUTION_ENGINE_VERSION } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped, type RecordedQuery } from "../../../testing/supabaseRecorder.js";
import type { SamsaraRawFetcher } from "../../samsara/index.js";
import { attributeBacklog } from "./pass.js";

/**
 * The backlog (IC5): which inspections a tick reads, in what order, and what it leaves for later. The
 * recorder does not filter, so each fixture applies the filters the query asked for — a read that
 * forgets the engine version would see an old version's rows as done, one that forgets `vanished_at`
 * would attribute a removed record.
 */

const ORG = "org-1";
const val = (q: RecordedQuery, method: string, col: string) => q.ops.find((o) => o.method === method && o.args[0] === col)?.args[1];
const inList = (q: RecordedQuery, col: string) => (q.ops.find((o) => o.method === "in" && o.args[0] === col)?.args[1] ?? []) as string[];

const insp = (id: string, day: string, extra: Record<string, unknown> = {}) => ({
  id, org_id: ORG, inspection_date: day, start_hhmm: "1304", end_hhmm: "1327", report_state: "LA", vanished_at: null, ...extra,
});
const INSPECTIONS = [
  insp("a", "2026-10-01"), insp("b", "2026-09-22"), insp("c", "2026-08-01"), insp("d", "2026-07-01"),
  insp("gone", "2026-10-05", { vanished_at: "2026-10-06T00:00:00Z" }),
  insp("theirs", "2026-10-09", { org_id: "org-2" }),
  insp("nodate", "2026-10-10", { inspection_date: null }),
];
const ATTRIBUTED = [
  { org_id: ORG, inspection_id: "b", source: "engine", engine_version: ATTRIBUTION_ENGINE_VERSION },
  { org_id: ORG, inspection_id: "c", source: "engine", engine_version: "ic5.0" }, // an older version: due again
  { org_id: ORG, inspection_id: "d", source: "person", engine_version: null }, // a person's row is not the engine's
];
const UNITS = [
  { org_id: ORG, inspection_id: "a", unit_seq: 1, vehicle_id: "veh-1", vanished_at: null },
  { org_id: ORG, inspection_id: "a", unit_seq: 2, vehicle_id: null, vanished_at: null },
  // "c" has no unit yet: FMCSA's unit file is a day behind.
  { org_id: ORG, inspection_id: "d", unit_seq: 1, vehicle_id: null, vanished_at: null },
];

function recorder() {
  return createSupabaseRecorder({
    tables: {
      inspection_attributions: (q) =>
        q.write
          ? []
          : ATTRIBUTED.filter((r) => r.org_id === val(q, "eq", "org_id") && r.source === val(q, "eq", "source") && r.engine_version === val(q, "eq", "engine_version")),
      roadside_inspections: (q) => {
        const current = q.ops.some((o) => o.method === "is" && o.args[0] === "vanished_at");
        const dated = q.ops.some((o) => o.method === "not" && o.args[0] === "inspection_date");
        return INSPECTIONS.filter((r) => r.org_id === val(q, "eq", "org_id") && (!current || !r.vanished_at) && (!dated || r.inspection_date))
          .sort((x, y) => String(y.inspection_date).localeCompare(String(x.inspection_date)));
      },
      roadside_inspection_units: (q) => UNITS.filter((u) => u.org_id === val(q, "eq", "org_id") && inList(q, "inspection_id").includes(u.inspection_id) && !u.vanished_at),
      vehicles: (q) => [{ id: "veh-1", samsara_vehicle_id: "212014918176522", org_id: ORG }].filter((v) => v.org_id === val(q, "eq", "org_id") && inList(q, "id").includes(v.id)),
      inspection_evidence_snapshots: { data: [{ id: "s" }], error: null },
    },
  });
}
const empty: SamsaraRawFetcher = async () => ({ status: 200, pages: ['{"data":[]}'], complete: true });
const written = (rec: ReturnType<typeof recorder>) =>
  rec.forTable("inspection_attributions").filter((q) => q.write).map((q) => [(q.write!.payload as { inspection_id: string }).inspection_id, (q.write!.payload as { outcome: string }).outcome]);

describe("the attribution backlog", () => {
  it("reads every current, dated inspection of ours without a reading at this version, newest first, once its units are in", async () => {
    const rec = recorder();
    const tally = await attributeBacklog(rec.client as never, ORG, empty, Date.parse("2026-10-14T15:00:00Z"));
    // a: our truck → Samsara asked, nobody assigned. d: an unmatched unit → no Samsara call. c: no units yet → next tick.
    expect(written(rec)).toEqual([["a", "no_assignment"], ["d", "no_matched_tractor"]]);
    expect(tally).toEqual({ no_assignment: 1, no_matched_tractor: 1 });
    expectOrgScoped(rec, ORG);
  });

  it("takes at most a batch per tick", async () => {
    const rec = recorder();
    await attributeBacklog(rec.client as never, ORG, empty, Date.now(), 1);
    expect(written(rec)).toEqual([["a", "no_assignment"]]);
  });

  it("goes on past an inspection whose attribution fails, and reports what it read", async () => {
    const rec = recorder();
    const broken: SamsaraRawFetcher = async (path) => {
      if (path === "/fleet/vehicles/stats/history") throw new Error("socket hang up");
      return empty(path, {});
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await attributeBacklog(rec.client as never, ORG, broken, Date.now())).toEqual({ no_matched_tractor: 1 });
    expect(err.mock.calls[0]!.join(" ")).toMatch(/inspection a: socket hang up/);
    err.mockRestore();
  });

  it("does nothing when every inspection is read", async () => {
    const rec = recorder();
    ATTRIBUTED.push(...["a", "c", "d"].map((id) => ({ org_id: ORG, inspection_id: id, source: "engine", engine_version: ATTRIBUTION_ENGINE_VERSION })));
    try {
      expect(await attributeBacklog(rec.client as never, ORG, empty, Date.now())).toEqual({});
      expect(rec.forTable("roadside_inspection_units")).toEqual([]);
    } finally {
      ATTRIBUTED.splice(3);
    }
  });
});
