import { describe, expect, it } from "vitest";
import { cohortRates, type Cohort } from "./adsReport.js";
import { briefFacts, briefFoldSchema, checkNarration, plainBrief, showMoney, type BriefFold } from "./analystBrief.js";

const reached = (contacted: number, qualified: number, applied: number, hired: number, lost: number) => ({ contacted, qualified, applied, hired, lost });
const FOLD: BriefFold = briefFoldSchema.parse({
  day: "2026-11-03",
  month: { month: "2026-11", days_left: 28 },
  campaigns: [
    { campaign_id: "c1", name: "Regional CDL-A 2026 Joliet", spend_cents: 123_456, impressions: 42_100, clicks: 610, leads: 30, cost_per_lead_cents: 4_115, ctr: 0.01449 },
    { campaign_id: "c2", name: "Owner operators", spend_cents: 0, impressions: 0, clicks: 0, leads: 0, cost_per_lead_cents: null, ctr: null },
  ],
  month_to_date: { meta: 300_000 },
  cohorts: [
    { week: "2026-09-28", leads: 40, reached: reached(36, 20, 12, 5, 9), mature: true },
    { week: "2026-10-26", leads: 12, reached: reached(9, 3, 1, 0, 1), mature: false },
  ],
});
const FACTS = briefFacts(FOLD);
const kinds = (text: string) => checkNarration(text, FACTS).map((f) => [f.kind, f.text]);

describe("the fact sheet — every figure from the fold, formatted once", () => {
  it("formats money, counts and shares the way the narration must copy them", () => {
    expect(FACTS.campaigns[0]).toEqual({ name: "Regional CDL-A 2026 Joliet", spend: "$1,234.56", impressions: "42,100", clicks: "610", leads: "30", cost_per_lead: "$41.15", click_rate: "1.4%" });
    expect(FACTS.month).toEqual({ month: "2026-11", days_left: "28", spend_by_platform: { meta: "$3,000.00" } });
    expect(showMoney(-1_250)).toBe("-$12.50");
    expect(showMoney(7)).toBe("$0.07");
  });

  it("the day's totals are the fold's sum, so the model never adds campaigns up itself", () => {
    expect(FACTS.day_totals).toEqual({ campaigns_ran: "2", spend: "$1,234.56", impressions: "42,100", clicks: "610", leads: "30", cost_per_lead: "$41.15", click_rate: "1.4%" });
    expect(briefFacts({ ...FOLD, campaigns: [] }).day_totals).toEqual({ campaigns_ran: "0", spend: "$0.00", impressions: "0", clicks: "0", leads: "0", cost_per_lead: null, click_rate: null });
  });

  it("a campaign with no lead and no impression gets no cost per lead and no click rate, not a zero", () => {
    expect(FACTS.campaigns[1]).toMatchObject({ spend: "$0.00", leads: "0", cost_per_lead: null, click_rate: null });
  });

  it("an immature cohort gets its counts and no rates; a mature one gets both", () => {
    expect(FACTS.cohorts[1]).toEqual({ week: "2026-10-26", mature: false, leads: "12", reached: { contacted: "9", qualified: "3", applied: "1", hired: "0", lost: "1" }, rates: null });
    expect(FACTS.cohorts[0]!.rates).toEqual({ contacted: "90.0%", qualified: "50.0%", applied: "30.0%", hired: "12.5%", lost: "22.5%" });
  });

  it("cohortRates stands behind no rate for an immature cohort or one with no lead", () => {
    const c: Cohort = { week: "2026-09-28", leads: 0, reached: reached(0, 0, 0, 0, 0), mature: true };
    expect(cohortRates(c)).toBeNull();
    expect(cohortRates({ ...c, leads: 4, reached: reached(2, 0, 0, 1, 0), mature: false })).toBeNull();
    expect(cohortRates({ ...c, leads: 4, reached: reached(2, 0, 0, 1, 0) })).toMatchObject({ contacted: 0.5, hired: 0.25 });
  });
});

describe("checkNarration — every figure in the narration is on the sheet", () => {
  it("passes figures copied from the sheet, in any of their written forms", () => {
    expect(kinds("Regional CDL-A 2026 Joliet spent $1,234.56 on 2026-11-03 for 30 leads ($41.15 each, 1.4% of 42,100 views clicked).")).toEqual([]);
    expect(kinds("Meta has spent $3000 in 2026-11 with 28 days left; the 2026-09-28 week hired 12.5 percent of its 40 leads.")).toEqual([]);
  });

  it("refuses a planted number, a rounding of a real one, and a figure of the wrong kind", () => {
    expect(kinds("Spend was $1,234.56 and 31 leads came in.")).toEqual([["number_not_in_fold", "31"]]);
    expect(kinds("Spend was about $1,235.")).toEqual([["number_not_in_fold", "$1,235"]]);
    expect(kinds("The click rate was 1.4.")).toEqual([["number_not_in_fold", "1.4"]]); // 1.4% is a rate on the sheet; 1.4 is not
    expect(kinds("Cost per lead was 41.15.")).toEqual([["number_not_in_fold", "41.15"]]);
  });

  it("refuses a rate for the young cohort, which the sheet does not hold", () => {
    expect(kinds("The 2026-10-26 cohort has hired 0.0% so far.")).toEqual([["number_not_in_fold", "0.0%"]]);
    expect(kinds("The 2026-10-26 cohort has 12 leads, 9 contacted.")).toEqual([]);
  });

  it("refuses numbers written in words, so a figure cannot route around the check", () => {
    expect(kinds("Spend doubled; leads were twice last week's, a dozen more than twenty.")).toEqual([
      ["number_in_words", "twice"], ["number_in_words", "dozen"], ["number_in_words", "twenty"],
    ]);
    expect(kinds("No one has been hired from the one campaign that ran.")).toEqual([]);
  });

  it("reads a campaign's name as the advertiser's words, and the same digits outside it as a figure", () => {
    expect(kinds("Regional CDL-A 2026 Joliet led the day.")).toEqual([]);
    expect(kinds("The 2026 campaign led the day.")).toEqual([["number_not_in_fold", "2026"]]);
  });

  it("a date the sheet does not hold is a figure the fold did not produce", () => {
    expect(kinds("Since 2026-11-01 spend is $3,000.00.")).toEqual([["number_not_in_fold", "2026-11-01"]]);
  });
});

describe("plainBrief — the figures with no model", () => {
  it("states every figure as the sheet holds it, so it passes the same check a narration must", () => {
    const plain = plainBrief(FACTS);
    expect(plain.headline).toBe("2026-11-03, campaigns that ran: 2. Together: $1,234.56 spent, 30 leads at $41.15 per lead, 42,100 impressions, 610 clicks.");
    expect(plain.points).toContain("Owner operators: $0.00 spent, 0 leads, 0 impressions, 0 clicks.");
    expect(plain.points).toContain("Leads from the week of 2026-10-26: 12, 0 hired, too young to judge.");
    for (const line of [plain.headline, ...plain.points]) expect(checkNarration(line, FACTS), line).toEqual([]);
  });
});
