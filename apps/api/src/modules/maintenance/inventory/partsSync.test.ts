import { beforeEach, describe, expect, it } from "vitest";
import { createSupabaseRecorder, expectOrgScoped, type SupabaseRecorder } from "../../../testing/supabaseRecorder.js";
import { syncFleetpalPart, type FleetpalPartCandidate } from "./partsSync.js";

/**
 * The one writer the FleetPal sync reaches `parts` through (F12, D-FP2). The fixture answers the two
 * lookups on the filters the service actually sent, so "found by FleetPal id" and "found by number"
 * are the database's answers and not the fixture's.
 */
const ORG = "org-1";
type Row = { id: string; part_number: string; fleetpal_id: string | null };
let rec: SupabaseRecorder;
let rows: Row[];
const recorder = () =>
  createSupabaseRecorder({
    tables: {
      parts: (q) => {
        const f = new Map(q.filters().map((x) => [x.col, x.val]));
        const like = q.ops.find((o) => o.method === "ilike");
        if (f.has("fleetpal_id")) return rows.filter((r) => r.fleetpal_id === f.get("fleetpal_id"));
        if (like) return rows.filter((r) => r.part_number.toLowerCase() === String(like.args[1]).replace(/\\(.)/g, "$1").toLowerCase());
        return [{ id: "new-id" }];
      },
    },
  });
const candidate = (over: Partial<FleetpalPartCandidate> = {}): FleetpalPartCandidate => ({
  fleetpalId: "fp-1",
  partNumber: "LF9009",
  description: "Oil filter",
  unitOfMeasure: "each",
  fleetpalUnit: "ea",
  upc: null,
  ...over,
});

beforeEach(() => {
  rows = [];
  rec = recorder();
});

describe("syncFleetpalPart", () => {
  it("creates a part the catalogue has never seen, carrying FleetPal's id and unit, and scopes every read to the org", async () => {
    const r = await syncFleetpalPart(rec.client, ORG, candidate({ upc: "012345678905" }));
    expect(r).toEqual({ outcome: "created", partId: "new-id" });
    expect(rec.writtenRows("parts")).toEqual([
      { org_id: ORG, fleetpal_id: "fp-1", part_number: "LF9009", description: "Oil filter", unit_of_measure: "each", fleetpal_unit: "ea", upc: "012345678905" },
    ]);
    expectOrgScoped(rec, ORG);
  });

  it("updates a part found by FleetPal id in place — a renumbered part does not double", async () => {
    rows = [{ id: "p-1", part_number: "OLD-1", fleetpal_id: "fp-1" }];
    const r = await syncFleetpalPart(rec.client, ORG, candidate({ partNumber: "NEW-1" }));
    expect(r).toEqual({ outcome: "updated", partId: "p-1" });
    const write = rec.writes().find((w) => w.table === "parts")!;
    expect(write.write?.method).toBe("update");
    expect(write.write?.payload).toMatchObject({ part_number: "NEW-1", description: "Oil filter", unit_of_measure: "each", fleetpal_unit: "ea" });
    expect(write.write?.payload).not.toHaveProperty("fleetpal_id");
    expect(write.write?.payload).not.toHaveProperty("manufacturer");
    expect(write.write?.payload).not.toHaveProperty("active");
    expect(write.filters()).toEqual(expect.arrayContaining([{ col: "org_id", val: ORG }, { col: "id", val: "p-1" }]));
  });

  it("adopts a hand-typed part with the same number, case-insensitively, instead of colliding on the index", async () => {
    rows = [{ id: "p-7", part_number: "lf9009", fleetpal_id: null }];
    const r = await syncFleetpalPart(rec.client, ORG, candidate());
    expect(r).toEqual({ outcome: "adopted", partId: "p-7" });
    const write = rec.writes().find((w) => w.table === "parts")!;
    expect(write.write?.method).toBe("update");
    expect(write.write?.payload).toMatchObject({ fleetpal_id: "fp-1", description: "Oil filter" });
  });

  it("reports a second FleetPal entry carrying a number another entry already holds, and writes nothing", async () => {
    rows = [{ id: "p-7", part_number: "LF9009", fleetpal_id: "fp-other" }];
    const r = await syncFleetpalPart(rec.client, ORG, candidate());
    expect(r).toEqual({ outcome: "skipped_duplicate_number", partId: "p-7" });
    expect(rec.writes().filter((w) => w.table === "parts")).toHaveLength(0);
  });

  it("stores an unmappable unit as unmapped with FleetPal's word beside it", async () => {
    const r = await syncFleetpalPart(rec.client, ORG, candidate({ unitOfMeasure: "unmapped", fleetpalUnit: "disp" }));
    expect(r).toMatchObject({ outcome: "created" });
    expect(rec.writtenRows("parts")[0]).toMatchObject({ unit_of_measure: "unmapped", fleetpal_unit: "disp" });
  });
});
