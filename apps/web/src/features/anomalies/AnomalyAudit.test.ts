import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import AnomalyAudit from "./AnomalyAudit.vue";

/**
 * D-US6 — the audit tab's three comparisons (odometer, time, location) are FactLists: one label and
 * one value per row, and a figure telematics never supplied is the shared em dash, not a "— mi".
 */
const txn = (extra: Record<string, unknown> = {}) =>
  ({
    id: "t1", state: "IL", fueled_at: "2026-10-01T15:30:00Z", odometer: 412_000, samsara_odometer: 411_990,
    samsara_recon_at: null, samsara_recon_status: "success", samsara_recon_checked_at: null,
    fueling_time_basis: null, location_text: "Joliet, IL", city: null,
    samsara_observed_address: null, samsara_observed_city: null, samsara_observed_state: null,
    samsara_location_confidence: null, ...extra,
  }) as never;

const facts = (w: ReturnType<typeof mount>, i: number) => {
  const dl = w.findAll("dl")[i]!;
  return Object.fromEntries(dl.findAll("dt").map((dt, j) => [dt.text(), dl.findAll("dd")[j]!.text()]));
};

describe("the anomaly audit facts", () => {
  it("pairs each comparison's label with its value, and a missing reading shows a dash", () => {
    const w = mount(AnomalyAudit, { props: { txn: txn(), odometerOffset: 0, tz: null } });
    expect(facts(w, 0)).toEqual({
      "Driver entered (report)": "412,000 mi",
      "Samsara (telematics)": "411,990 mi",
      Difference: "+10 mi",
    });
    expect(facts(w, 1)["Actual (telematics)"]).toBe("—");
    expect(facts(w, 2)).toEqual({ "EFS station": "Joliet, IL", "Samsara observed": "—" });
  });

  it("shows the calibration offset and the raw difference only when one is learned", () => {
    const w = mount(AnomalyAudit, { props: { txn: txn({ samsara_odometer: 411_900 }), odometerOffset: 50, tz: null } });
    const odo = facts(w, 0);
    expect(odo["Calibration offset"]).toBe("+50 mi");
    expect(odo.Difference).toBe("+50 mi (raw +100 mi)");
    expect(w.findAll("dl")[0]!.findAll("dd").at(-1)!.classes()).toContain("text-danger-700");
  });

  it("shows a dash, not a unit, when nothing can be compared", () => {
    const w = mount(AnomalyAudit, { props: { txn: txn({ samsara_odometer: null }), odometerOffset: 0, tz: null } });
    expect(facts(w, 0)).toEqual({ "Driver entered (report)": "412,000 mi", "Samsara (telematics)": "—", Difference: "—" });
  });
});
