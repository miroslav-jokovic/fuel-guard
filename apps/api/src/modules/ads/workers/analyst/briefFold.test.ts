import { describe, expect, it } from "vitest";
import type { LeadOutcome, LeadOutcomes } from "@silvicom/shared";
import { createSupabaseRecorder, expectOrgScoped } from "../../../../testing/supabaseRecorder.js";
import { cohortsSince, readBriefFold, reportedDay } from "./briefFold.js";

/**
 * F1b's read: yesterday and the month so far from `ads_spend_hourly`, in Central time, through the shared
 * folds. The recorder does not filter (memory: supabaseRecorder does not filter), so every fixture holds
 * hours on both sides of each bound and the assertions prove the CODE drew the line.
 */
const ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
// PostgREST's own format for a timestamptz, which a string comparison against "…Z" would misplace.
const hour = (iso: string) => iso.replace("Z", "+00:00").replace(".000", "");
const spend = (campaign_id: string, at: string, spend_cents: number | string, leads = 0, impressions = 100, clicks = 2) =>
  ({ campaign_id, hour: hour(at), spend_cents, impressions, clicks, leads });

/** A LeadOutcomes that answers `rows` and remembers what it was asked — recruiting's own is tested in recruiting/leads. */
function outcomes(rows: LeadOutcome[] = []): LeadOutcomes & { asked: Array<[string, string]> } {
  const asked: Array<[string, string]> = [];
  return { asked, outcomesSince: async (org, since) => { asked.push([org, since]); return rows; } };
}
const NONE = outcomes();

function world(rows: unknown[] | { pages: unknown[][] }) {
  return createSupabaseRecorder({
    tables: {
      ads_spend_hourly: rows,
      ads_campaigns: [{ id: "c1", name: "Regional Class A — Joliet", connection_id: "k1" }, { id: "c2", name: "Night runs", connection_id: "k1" }],
      ads_platform_connections: [{ id: "k1", provider: "meta" }],
    },
  });
}

describe("reportedDay — the whole Central day before now", () => {
  it("at 07:00 CST on 11/04 reports 11/03, midnight to midnight Central", () => {
    expect(reportedDay(new Date("2026-11-04T13:00:00Z"))).toEqual({ day: "2026-11-03", start: "2026-11-03T06:00:00.000Z", end: "2026-11-04T06:00:00.000Z" });
  });
  it("the day the clocks go back is 25 hours long, and is reported whole", () => {
    expect(reportedDay(new Date("2026-11-02T13:00:00Z"))).toEqual({ day: "2026-11-01", start: "2026-11-01T05:00:00.000Z", end: "2026-11-02T06:00:00.000Z" });
  });
});

describe("readBriefFold — yesterday's campaigns and the month so far, from stored hours", () => {
  it("folds only yesterday's hours into the day, and the month up to yesterday's end into the month", async () => {
    const rec = world([
      spend("c1", "2026-11-03T05:00:00.000Z", 1_000, 1), // 23:00 on 11/02 Central: the month, not the day
      spend("c1", "2026-11-03T06:00:00.000Z", "2500", 2), // the day's first hour (a bigint arrives as text)
      spend("c1", "2026-11-04T05:00:00.000Z", 500, 0), // the day's last hour
      spend("c2", "2026-11-03T18:00:00.000Z", 700, 0),
      spend("c1", "2026-11-04T06:00:00.000Z", 9_999, 9), // today: neither
    ]);
    const fold = await readBriefFold(rec.client, ORG, new Date("2026-11-04T13:00:00Z"), NONE);
    expect(fold).toEqual({
      day: "2026-11-03",
      month: { month: "2026-11", days_left: 27 },
      campaigns: [
        { campaign_id: "c1", name: "Regional Class A — Joliet", spend_cents: 3_000, impressions: 200, clicks: 4, leads: 2, cost_per_lead_cents: 1_500, ctr: 0.02 },
        { campaign_id: "c2", name: "Night runs", spend_cents: 700, impressions: 100, clicks: 2, leads: 0, cost_per_lead_cents: null, ctr: 0.02 },
      ],
      month_to_date: { meta: 4_700 },
      cohorts: [],
    });
    const read = rec.forTable("ads_spend_hourly")[0]!.ops;
    expect(read).toContainEqual({ method: "gte", args: ["hour", "2026-11-01T05:00:00.000Z"] });
    expect(read).toContainEqual({ method: "lt", args: ["hour", "2026-11-04T06:00:00.000Z"] });
    expectOrgScoped(rec, ORG);
  });

  it("on the 1st it reports the last day of the month before, with that month's spend and no day left", async () => {
    const rec = world([spend("c1", "2026-10-31T20:00:00.000Z", 1_200, 1), spend("c1", "2026-10-02T20:00:00.000Z", 800, 0)]);
    const fold = await readBriefFold(rec.client, ORG, new Date("2026-11-01T13:00:00Z"), NONE);
    expect(fold).toMatchObject({ day: "2026-10-31", month: { month: "2026-10", days_left: 0 }, month_to_date: { meta: 2_000 } });
    expect(fold.campaigns.map((c) => c.spend_cents)).toEqual([1_200]);
  });

  it("pages past PostgREST's 1,000-row cap, so a busy month is never cut short", async () => {
    const first = Array.from({ length: 1000 }, (_, i) => spend("c2", new Date(Date.parse("2026-11-01T06:00:00Z") + (i % 40) * 3_600_000).toISOString(), 1));
    const rec = world({ pages: [first, [spend("c1", "2026-11-03T12:00:00.000Z", 5_000, 1)]] });
    const fold = await readBriefFold(rec.client, ORG, new Date("2026-11-04T13:00:00Z"), NONE);
    expect(rec.forTable("ads_spend_hourly")).toHaveLength(2);
    expect(fold.month_to_date).toEqual({ meta: 6_000 });
  });

  it("a carrier with no hours reads no campaign and reports nothing", async () => {
    const rec = world([]);
    const fold = await readBriefFold(rec.client, ORG, new Date("2026-11-04T13:00:00Z"), NONE);
    expect(fold).toMatchObject({ campaigns: [], month_to_date: {} });
    expect(rec.forTable("ads_campaigns")).toHaveLength(0);
  });
});

describe("readBriefFold — cohorts from recruiting's LeadOutcomes (Q-AD34)", () => {
  const lead = (n: number, arrived_at: string, reached: LeadOutcome["reached"]): LeadOutcome =>
    ({ lead_id: `00000000-0000-4000-8000-00000000000${n}`, campaign_id: "c1", arrived_at, reached });

  it("asks this org's leads from the Monday seven weeks before the reported day's week, and folds them by week", async () => {
    const src = outcomes([
      lead(1, "2026-09-22T15:00:00Z", { contacted: "2026-09-22T18:00:00Z", converted: "2026-09-24T15:00:00Z", hired: "2026-10-05T05:00:00Z" }),
      lead(2, "2026-09-23T15:00:00Z", { contacted: "2026-09-23T18:00:00Z" }),
      lead(3, "2026-11-02T15:00:00Z", {}),
    ]);
    const fold = await readBriefFold(world([]).client, ORG, new Date("2026-11-04T13:00:00Z"), src);
    // 11/03 is a Tuesday; its week starts 11/02, and seven weeks before that is 09/14 (CDT, 05:00Z).
    expect(src.asked).toEqual([[ORG, "2026-09-14T05:00:00.000Z"]]);
    expect(fold.cohorts).toEqual([
      { week: "2026-09-21", leads: 2, mature: true,
        reached: { contacted: 2, converted: 1, applied: 0, hired: 1, lost_after_conversion: 0, qualified: "not_recorded", lost_before_conversion: "not_recorded" } },
      { week: "2026-11-02", leads: 1, mature: false,
        reached: { contacted: 0, converted: 0, applied: 0, hired: 0, lost_after_conversion: 0, qualified: "not_recorded", lost_before_conversion: "not_recorded" } },
    ]);
  });

  it("a LeadOutcomes answering outside the shared shape fails the brief, never folds a stage it does not mean", async () => {
    const drifted = outcomes([{ ...lead(1, "2026-10-20T15:00:00Z", {}), reached: { qualified: "2026-10-21T15:00:00Z" } } as unknown as LeadOutcome]);
    await expect(readBriefFold(world([]).client, ORG, new Date("2026-11-04T13:00:00Z"), drifted)).rejects.toThrow();
  });

  it("the window crosses the clocks going back: the Monday is midnight Central in daylight time", () => {
    expect(cohortsSince("2026-11-03")).toBe("2026-09-14T05:00:00.000Z");
    expect(cohortsSince("2026-12-28")).toBe("2026-11-09T06:00:00.000Z");
  });
});
