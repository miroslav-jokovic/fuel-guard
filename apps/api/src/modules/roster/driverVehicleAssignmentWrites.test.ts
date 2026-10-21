// The 30-day assignment history write. On 2026-10-21 production showed no history refresh since
// 10/20 06:00Z while the pass kept running — a refused upsert returned `{ error }` and nobody read it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";
import { writeAssignmentHistory } from "./driverVehicleAssignmentWrites.js";

const ORG = "org-1";
const iv = (vehicle: string, driver: string, start: string) => ({
  vehicleSamsaraId: vehicle, driverSamsaraId: driver, startMs: Date.parse(start), endMs: null,
});

afterEach(() => vi.restoreAllMocks());

describe("writeAssignmentHistory", () => {
  it("counts every row written and logs nothing when the database accepts them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = createSupabaseRecorder({ tables: { driver_vehicle_assignments: { data: [] } } });
    const out = await writeAssignmentHistory(rec.client, ORG, [iv("sv-797", "s-1", "2026-10-21T19:26:53Z")]);
    expect(out).toEqual({ rows: 1, written: 1, failedBatches: 0, duplicateKeys: 0, firstError: null });
    expect(log).not.toHaveBeenCalled();
    expectOrgScoped(rec, ORG);
  });

  it("reports a refused batch with the database's words and the duplicate keys in the read", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const rec = createSupabaseRecorder({
      tables: {
        driver_vehicle_assignments: {
          data: [],
          writeError: { code: "21000", message: "ON CONFLICT DO UPDATE command cannot affect row a second time" },
        },
      },
    });
    // The same segment twice — what a 30-day read that pages for minutes can return.
    const seg = iv("sv-785", "s-2", "2026-10-20T17:30:40Z");
    const out = await writeAssignmentHistory(rec.client, ORG, [seg, seg]);
    expect(out).toMatchObject({ rows: 2, written: 0, failedBatches: 1, duplicateKeys: 1 });
    expect(out.firstError).toBe("21000 ON CONFLICT DO UPDATE command cannot affect row a second time");
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]![0])).toContain("wrote 0 of 2 rows; 1 batch(es) refused (1 duplicate key(s) in the read)");
  });
});
