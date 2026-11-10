import { describe, expect, it, vi } from "vitest";
import { createSupabaseRecorder, expectOrgScoped } from "../../testing/supabaseRecorder.js";

/**
 * `readFuelReport`'s read options (F21 R1). The assistant asks for the two windows without the
 * per-day trailing MPG or the station menu; what must hold is that this changes what is RETURNED and
 * read, never the two windows' MPG periods — the page and the assistant measure the same span.
 */
const getFleetMpgPeriods = vi.fn((_a: unknown, _o: unknown, periods: unknown[], _vehicles?: unknown) =>
  Promise.resolve(periods.map(() => ({ mpg: 6.4, reason: null, measuredShare: 1, partial: false }))),
);
vi.mock("./fleetMpg.js", () => ({ getFleetMpgPeriods: (...a: unknown[]) => getFleetMpgPeriods(...(a as [unknown, unknown, unknown[], unknown])) }));

const { readFuelReport } = await import("./fuelReport.js");
const ORG = "org-1";
const NO_FILTERS = { vehicleIds: ["v1"], states: [], siteIds: [], networks: [] };

describe("readFuelReport read options", () => {
  it("by default reads the two windows, a trailing week for every day, and the station menu (the page's request)", async () => {
    getFleetMpgPeriods.mockClear();
    const rec = createSupabaseRecorder({ rpc: () => [] });
    const r = await readFuelReport(rec.client, ORG, "2026-10-01", "2026-10-31", NO_FILTERS);
    const periods = getFleetMpgPeriods.mock.calls[0]![2];
    expect(periods).toHaveLength(2 + 31);
    expect(rec.rpcs().map((c) => c.fn)).toContain("fuel_report_sites");
    expect(r.trailingMpg).toHaveLength(31);
    expectOrgScoped(rec, ORG);
  });

  it("trailing:false, sites:false measures exactly the same two windows and skips the rest", async () => {
    getFleetMpgPeriods.mockClear();
    const rec = createSupabaseRecorder({ rpc: () => [] });
    const r = await readFuelReport(rec.client, ORG, "2026-10-01", "2026-10-31", NO_FILTERS, { trailing: false, sites: false });
    expect(getFleetMpgPeriods.mock.calls[0]![2]).toEqual([
      { from: "2026-10-01", to: "2026-10-31" },
      { from: "2026-08-31", to: "2026-09-30" },
    ]);
    expect(getFleetMpgPeriods.mock.calls[0]![3]).toEqual(["v1"]);
    expect(rec.rpcs().map((c) => c.fn)).not.toContain("fuel_report_sites");
    expect(r.trailingMpg).toBeNull();
    expect(r.sites).toEqual([]);
    expect(r.current.efficiency?.mpg.mpg).toBe(6.4);
  });
});
