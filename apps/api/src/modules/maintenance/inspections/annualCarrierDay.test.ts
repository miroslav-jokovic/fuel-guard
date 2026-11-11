import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Shop's two annual-inspection readers judge on the CARRIER's day (F21 carrier-day fix,
 * 2026-11-11). Both used `now.toISOString().slice(0, 10)`, which on a Central evening is tomorrow: a
 * unit whose annual runs out on 11/10 read as overdue from 7 pm that day. The roster and FleetPal reads
 * are stubbed; the org's zone comes from a real `organizations` row through `orgToday`.
 */
const listAnnualInspectionExpiries = vi.fn();
const readFleetPalAnnualDue = vi.fn();
vi.mock("../../roster/index.js", () => ({ listAnnualInspectionExpiries: (...a: unknown[]) => listAnnualInspectionExpiries(...a) }));
vi.mock("../../fleetpal/index.js", () => ({ readFleetPalAnnualDue: (...a: unknown[]) => readFleetPalAnnualDue(...a) }));
const { readAnnualDue } = await import("./annualDue.js");
const { readAnnualDisagreements } = await import("./annualDisagreements.js");
const { createSupabaseRecorder } = await import("../../../testing/supabaseRecorder.js");

const ORG = "org-1";
const NOV_10_EVENING_CT = new Date("2026-11-11T01:30:00Z");
const central = () => createSupabaseRecorder({ tables: { organizations: [{ id: ORG, operating_hours: { tz: "America/Chicago" } }] } }).client as never;

beforeEach(() => {
  listAnnualInspectionExpiries.mockReset();
  listAnnualInspectionExpiries.mockImplementation(async (_a: unknown, _o: unknown, kind: string) =>
    kind === "tractor" ? [{ id: "v1", unitNumber: "819", expiresOn: "2026-11-10" }] : [],
  );
  readFleetPalAnnualDue.mockReset();
  readFleetPalAnnualDue.mockResolvedValue({ byVehicleId: new Map([["v1", "2026-11-09"]]), byTrailerId: new Map() });
});

describe("the annual-inspection readers on a Central evening", () => {
  it("readAnnualDue: an annual that runs out today is due today (0 days), not overdue", async () => {
    const rows = await readAnnualDue(central(), ORG, NOV_10_EVENING_CT);
    expect(rows).toEqual([{ subjectType: "tractor", unitId: "v1", unitNumber: "819", expiresOn: "2026-11-10", daysRemaining: 0 }]);
  });

  it("readAnnualDisagreements: on 11/10 our record says due and FleetPal's 11/09 says overdue, so the shop is shown the disagreement", async () => {
    // On UTC's 11/11 both would read overdue a day apart, and the row would vanish.
    const rows = await readAnnualDisagreements(central(), ORG, NOV_10_EVENING_CT);
    expect(rows).toMatchObject([{ unitNumber: "819", ours: "expiring", fleetpal: "expired", gapDays: -1 }]);
  });
});
