import { describe, expect, it } from "vitest";
import { foldCampaignSpend, foldLeadCohorts, monthContext, monthToDateByPlatform, type SpendHourRow } from "./adsReport.js";

const row = (campaign_id: string, hour: string, spend_cents: number, leads = 0, impressions = 0, clicks = 0): SpendHourRow =>
  ({ campaign_id, hour, spend_cents, impressions, clicks, leads });

describe("monthContext — the carrier's month, in Central time", () => {
  it("the last evening of October in Chicago is still October, though it is November in UTC", () => {
    const m = monthContext(new Date("2026-11-01T03:30:00Z")); // 22:30 CDT on 10/31
    expect(m).toEqual({ month: "2026-10", start: "2026-10-01T05:00:00.000Z", end: "2026-11-01T05:00:00.000Z", days_left: 1 });
  });
  it("November starts at 05:00Z (CDT) and ends at 06:00Z (CST) — DST lands inside the month", () => {
    const m = monthContext(new Date("2026-11-01T12:00:00Z"));
    expect(m).toEqual({ month: "2026-11", start: "2026-11-01T05:00:00.000Z", end: "2026-12-01T06:00:00.000Z", days_left: 30 });
  });
  it("December rolls into January of the next year", () => {
    expect(monthContext(new Date("2026-12-31T18:00:00Z"))).toMatchObject({ month: "2026-12", end: "2027-01-01T06:00:00.000Z", days_left: 1 });
  });
});

describe("foldCampaignSpend", () => {
  it("sums each campaign's hours, with cost per lead and CTR", () => {
    const t = foldCampaignSpend([
      row("b", "2026-11-02T14:00:00Z", 1_000, 1, 500, 10),
      row("a", "2026-11-02T14:00:00Z", 2_500, 0, 1_000, 5),
      row("b", "2026-11-02T15:00:00Z", 2_001, 2, 500, 30),
    ]);
    expect(t).toEqual([
      { campaign_id: "a", spend_cents: 2_500, impressions: 1_000, clicks: 5, leads: 0, cost_per_lead_cents: null, ctr: 0.005 },
      { campaign_id: "b", spend_cents: 3_001, impressions: 1_000, clicks: 40, leads: 3, cost_per_lead_cents: 1_000, ctr: 0.04 },
    ]);
  });
  it("no rows, no campaigns", () => {
    expect(foldCampaignSpend([])).toEqual([]);
  });
});

describe("monthToDateByPlatform", () => {
  const month = monthContext(new Date("2026-11-15T12:00:00Z"));
  const platformOf = new Map([["a", "meta" as const], ["b", "tiktok" as const]]);
  it("counts only hours inside the month's [start, end), by platform", () => {
    const r = monthToDateByPlatform([
      row("a", "2026-11-01T04:00:00Z", 999), // 23:00 CDT on 10/31 — October's
      row("a", "2026-11-01T05:00:00Z", 100), // the month's first hour
      row("a", "2026-11-20T10:00:00Z", 200),
      row("b", "2026-11-20T10:00:00Z", 50),
      row("a", "2026-12-01T06:00:00Z", 999), // December's first hour
    ], platformOf, month);
    expect(r).toEqual({ by_platform: { meta: 300, tiktok: 50 }, unattributed_campaigns: [] });
  });
  it("a campaign with no known platform is reported, never guessed into one", () => {
    const r = monthToDateByPlatform([row("zzz", "2026-11-10T10:00:00Z", 70)], platformOf, month);
    expect(r).toEqual({ by_platform: {}, unattributed_campaigns: ["zzz"] });
  });
});

describe("foldLeadCohorts", () => {
  const lead = (id: string, created_at: string, stages: ("contacted" | "qualified" | "applied" | "hired" | "lost")[]) =>
    ({ lead_id: id, campaign_id: "a", created_at, stages });
  it("groups by the Central Monday and counts each stage once per lead", () => {
    const c = foldLeadCohorts([
      lead("1", "2026-10-05T15:00:00Z", ["contacted", "contacted", "hired"]),
      lead("2", "2026-10-11T23:00:00Z", ["contacted"]), // Sunday 18:00 CDT — the same week
      lead("3", "2026-10-12T04:00:00Z", []),            // Sunday 23:00 CDT — still the same week
      lead("4", "2026-10-12T06:00:00Z", ["lost"]),      // Monday 01:00 CDT — the next week
    ], new Date("2026-11-20T12:00:00Z"));
    expect(c.map((x) => [x.week, x.leads, x.reached.contacted, x.reached.hired, x.reached.lost])).toEqual([
      ["2026-10-05", 3, 2, 1, 0],
      ["2026-10-12", 1, 0, 0, 1],
    ]);
  });
  it("a cohort is mature only 28 days after its week ends — young cohorts are greyed", () => {
    // Week of 10/05 ends 10/12; mature from 11/09 (Central). Week of 10/12 matures 11/16.
    const leads = [lead("1", "2026-10-06T15:00:00Z", []), lead("2", "2026-10-13T15:00:00Z", [])];
    expect(foldLeadCohorts(leads, new Date("2026-11-09T12:00:00Z")).map((x) => x.mature)).toEqual([true, false]);
    expect(foldLeadCohorts(leads, new Date("2026-11-08T12:00:00Z")).map((x) => x.mature)).toEqual([false, false]);
    expect(foldLeadCohorts(leads, new Date("2026-11-16T12:00:00Z")).map((x) => x.mature)).toEqual([true, true]);
  });
});
