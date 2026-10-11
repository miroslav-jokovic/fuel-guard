import { describe, expect, it } from "vitest";
import { DEFAULT_IDLE_AVOIDABLE_SETTINGS, idleAvoidableTotals, idleStopVerdict, type IdleStopMeasure } from "./avoidable.js";

/**
 * D-IE4's rules on one park (IE3). Every fixture park has DIFFERENT seconds in each duty part (rest
 * 7,000 · on duty 5,000 · excluded 300 · unknown 700), so a rule reading the wrong part, or two
 * parts swapped, lands on a different number.
 */
const park = (o: Partial<IdleStopMeasure> = {}): IdleStopMeasure => ({
  durationSec: 20_000, runningSec: 13_000,
  runningRestSec: 7_000, runningOnDutySec: 5_000, runningExcludedSec: 300, runningUnknownSec: 700,
  ambientMilliC: 15_000, // 59 °F, inside the band
  ...o,
});
const parts = (v: ReturnType<typeof idleStopVerdict>) =>
  v.allowedSec + v.avoidableSec + v.equipmentOpportunitySec + v.unjudgedSec;

describe("idleStopVerdict", () => {
  it("battery APU: rest allowed up to half the park, on duty past the first hour avoidable, unknown avoidable", () => {
    const v = idleStopVerdict(park(), "battery_apu");
    // rest 7,000 > 10,000 allowance? no — all 7,000 allowed; on duty 3,600 allowed + 1,400 avoidable;
    // excluded 300 allowed; unknown 700 avoidable.
    expect(v).toMatchObject({ allowedSec: 7_000 + 3_600 + 300, avoidableSec: 1_400 + 700, avoidableNoLogSec: 700, equipmentOpportunitySec: 0, unjudgedSec: 0 });
    expect(parts(v)).toBe(13_000);
  });

  it("battery APU: rest past half the PARK's duration is avoidable (Q-IE3 is a share, not a run cap)", () => {
    const v = idleStopVerdict(park({ durationSec: 10_000 }), "battery_apu");
    expect(v.allowedSec).toBe(5_000 + 3_600 + 300);
    expect(v.avoidableSec).toBe(2_000 + 1_400 + 700);
  });

  it("no APU: the rest is an equipment opportunity, not the driver's", () => {
    const v = idleStopVerdict(park(), "no_apu");
    expect(v).toMatchObject({ equipmentOpportunitySec: 7_000, avoidableSec: 1_400 + 700, allowedSec: 3_600 + 300 });
    expect(parts(v)).toBe(13_000);
  });

  it("an undeclared truck's rest is unjudged, never guessed", () => {
    for (const eq of ["not_entered", "other"] as const) {
      const v = idleStopVerdict(park(), eq);
      expect(v.unjudgedSec, eq).toBe(7_000);
      expect(parts(v), eq).toBe(13_000);
    }
  });

  it("outside the comfort band every running second is allowed; an unknown temperature exempts nothing", () => {
    const cold = idleStopVerdict(park({ ambientMilliC: -10_000 }), "no_apu"); // 14 °F
    const hot = idleStopVerdict(park({ ambientMilliC: 31_000 }), "no_apu"); // 87.8 °F
    for (const v of [cold, hot]) expect(v).toMatchObject({ outsideComfort: true, allowedSec: 13_000, avoidableSec: 0, equipmentOpportunitySec: 0 });
    expect(idleStopVerdict(park({ ambientMilliC: null }), "no_apu").outsideComfort).toBe(false);
    // the band's edges are inside it: 20 °F and 85 °F
    expect(idleStopVerdict(park({ ambientMilliC: -6_666 }), "no_apu").outsideComfort).toBe(false);
    expect(idleStopVerdict(park({ ambientMilliC: 29_444 }), "no_apu").outsideComfort).toBe(false);
  });

  it("a temperature exactly on the band's edge is inside it", () => {
    // 15 °C is exactly 59.0 °F, so a band edged at 59 is hit exactly (20 and 85 °F are not whole milli-°C).
    const s = { ...DEFAULT_IDLE_AVOIDABLE_SETTINGS, comfortLowF: 59, comfortHighF: 59 };
    expect(idleStopVerdict(park({ ambientMilliC: 15_000 }), "no_apu", s).outsideComfort).toBe(false);
  });

  it("on duty for less than an hour is all allowed", () => {
    const v = idleStopVerdict(park({ runningOnDutySec: 3_000, runningSec: 11_000 }), "battery_apu");
    expect(v.avoidableSec).toBe(700);
  });

  it("an unmeasured park is in no part at all", () => {
    const v = idleStopVerdict(park({ runningRestSec: null, runningOnDutySec: null, runningExcludedSec: null, runningUnknownSec: null }), "no_apu");
    expect(v).toMatchObject({ measured: false, allowedSec: 0, avoidableSec: 0, equipmentOpportunitySec: 0 });
  });

  it("reads the org's settings, not constants", () => {
    const s = { ...DEFAULT_IDLE_AVOIDABLE_SETTINGS, batteryApuShare: 0.3, onDutyGraceSec: 1_800 };
    const v = idleStopVerdict(park(), "battery_apu", s);
    expect(v.avoidableSec).toBe((7_000 - 6_000) + (5_000 - 1_800) + 700);
  });
});

describe("idleAvoidableTotals", () => {
  it("sums the parts, counts unmeasured parks apart, and names the temperature exemption", () => {
    const rows = [
      park(),
      park({ ambientMilliC: -10_000, runningSec: 4_000, runningRestSec: 4_000, runningOnDutySec: 0, runningExcludedSec: 0, runningUnknownSec: 0 }),
      park({ runningSec: 900, runningRestSec: null, runningOnDutySec: null, runningExcludedSec: null, runningUnknownSec: null }),
    ].map((stop) => ({ stop, verdict: idleStopVerdict(stop, "no_apu") }));
    const t = idleAvoidableTotals(rows);
    expect(t).toMatchObject({
      parks: 3, runningSec: 17_900, unmeasuredParks: 1, unmeasuredRunningSec: 900, outsideComfortSec: 4_000,
      allowedSec: 3_900 + 4_000, avoidableSec: 2_100, avoidableNoLogSec: 700, equipmentOpportunitySec: 7_000, unjudgedSec: 0,
    });
    expect(t.allowedSec + t.avoidableSec + t.equipmentOpportunitySec + t.unjudgedSec + t.unmeasuredRunningSec).toBe(t.runningSec);
  });
});
