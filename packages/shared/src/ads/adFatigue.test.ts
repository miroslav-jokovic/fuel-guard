import { describe, expect, it } from "vitest";
import { ADS_CREATIVE_REFRESH_DEFAULT, adsCreativeRefreshSchema, ctrOf, fatigueVerdict, type AdHour } from "./adFatigue.js";

/** The ad's own first week against its last week (CQ9, D-AD23): the defaults are R6's, labelled in the schema. */
const NOW = new Date("2026-11-20T12:00:00Z");
const born = Date.parse("2026-11-01T06:00:00Z");
/** `days` of hours from birth, `perDay` impressions each day, click-through `ctr` (a share); one row per day. */
const hours = (days: number, perDay: number, ctr: (day: number) => number): AdHour[] =>
  Array.from({ length: days }, (_, d) => ({ hour: new Date(born + d * 86_400_000).toISOString(), impressions: perDay, clicks: Math.round(perDay * ctr(d)) }));
const S = ADS_CREATIVE_REFRESH_DEFAULT;

describe("fatigueVerdict", () => {
  it("retires an ad whose last week's click-through fell past the share, against its own first week", () => {
    const v = fatigueVerdict(S, { hours: hours(19, 1000, (d) => (d < 7 ? 0.02 : d < 12 ? 0.015 : 0.01)), now: NOW });
    expect(v).toMatchObject({ kind: "retire", first_ctr: 0.02, last_ctr: 0.01, drop_pct: 50, age_days: 19 });
  });

  it("holds an ad younger than min_days, whatever its numbers", () => {
    const v = fatigueVerdict(S, { hours: hours(5, 1000, (d) => (d < 2 ? 0.05 : 0.001)), now: new Date(born + 5 * 86_400_000) });
    expect(v).toMatchObject({ kind: "hold", why: "too_young", age_days: 5 });
  });

  it("holds when either window has too few impressions for a rate to mean anything", () => {
    const thin = fatigueVerdict(S, { hours: hours(19, 100, (d) => (d < 7 ? 0.02 : 0.005)), now: NOW });
    expect(thin).toMatchObject({ kind: "hold", why: "too_few_impressions_first" });
    const lastThin = [...hours(7, 1000, () => 0.02), ...hours(19, 10, () => 0.001).slice(7)];
    expect(fatigueVerdict(S, { hours: lastThin, now: NOW })).toMatchObject({ kind: "hold", why: "too_few_impressions_last" });
  });

  it("holds an ad whose click-through held up, and says by how much it moved", () => {
    const v = fatigueVerdict(S, { hours: hours(19, 1000, (d) => (d < 7 ? 0.02 : 0.018)), now: NOW });
    expect(v).toMatchObject({ kind: "hold", why: "no_drop", drop_pct: 10 });
  });

  it("the threshold is the setting's: the same ad retires at 10 % and holds at 25 %", () => {
    const facts = { hours: hours(19, 1000, (d) => (d < 7 ? 0.02 : 0.017)), now: NOW };
    expect(fatigueVerdict(S, facts).kind).toBe("hold");
    expect(fatigueVerdict({ ...S, ctr_drop_pct: 10 }, facts).kind).toBe("retire");
  });

  it("an ad with no impressions at all is too young, not a 100 % drop; a window with none is a hold, never a division by zero", () => {
    expect(fatigueVerdict(S, { hours: [], now: NOW })).toMatchObject({ kind: "hold", why: "too_young", age_days: 0 });
    expect(ctrOf({ impressions: 0, clicks: 0 })).toBeNull();
  });

  it("the settings group defaults to off with R6's numbers, and refuses a drop share outside 5–90", () => {
    expect(adsCreativeRefreshSchema.parse({})).toEqual({ retire: false, min_days: 7, ctr_drop_pct: 25, min_impressions: 2000 });
    expect(adsCreativeRefreshSchema.safeParse({ ctr_drop_pct: 95 }).success).toBe(false);
  });
});
