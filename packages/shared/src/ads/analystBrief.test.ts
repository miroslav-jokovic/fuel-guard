import { describe, expect, it } from "vitest";
import { cohortRates, type Cohort } from "./adsReport.js";
import { briefFacts, briefFoldSchema, checkNarration, plainBrief, showMoney, type BriefFold } from "./analystBrief.js";

const reached = (contacted: number, converted: number, applied: number, hired: number, lost_after_conversion: number) =>
  ({ contacted, converted, applied, hired, lost_after_conversion, qualified: "not_recorded" as const, lost_before_conversion: "not_recorded" as const });
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
    expect(FACTS.cohorts[1]).toEqual({ week: "2026-10-26", mature: false, leads: "12", reached: { contacted: "9", converted: "3", applied: "1", hired: "0", lost_after_conversion: "1", qualified: "not recorded", lost_before_conversion: "not recorded" }, rates: null });
    expect(FACTS.cohorts[0]!.rates).toEqual({ contacted: "90.0%", converted: "50.0%", applied: "30.0%", hired: "12.5%", lost_after_conversion: "22.5%", qualified: "not recorded", lost_before_conversion: "not recorded" });
  });

  it("the fold refuses a count for a stage nothing records: qualified must be the not_recorded marker", () => {
    const bad = { ...FOLD, cohorts: [{ ...FOLD.cohorts[0]!, reached: { ...FOLD.cohorts[0]!.reached, qualified: 0 } }] };
    expect(briefFoldSchema.safeParse(bad).success).toBe(false);
  });

  it("the plain brief says the unrecorded stages are not recorded, in words, with no figure for them", () => {
    const points = plainBrief(FACTS).points;
    expect(points).toContain("Which leads were qualified, and which were lost before becoming applicants, is not recorded yet.");
    expect(points.filter((p) => /qualif/i.test(p)).every((p) => !/\d/.test(p))).toBe(true);
    expect(plainBrief(briefFacts({ ...FOLD, cohorts: [] })).points.some((p) => /qualif/i.test(p))).toBe(false);
  });

  it("cohortRates stands behind no rate for an immature cohort or one with no lead", () => {
    const c: Cohort = { week: "2026-09-28", leads: 0, reached: reached(0, 0, 0, 0, 0), mature: true };
    expect(cohortRates(c)).toBeNull();
    expect(cohortRates({ ...c, leads: 4, reached: reached(2, 0, 0, 1, 0), mature: false })).toBeNull();
    expect(cohortRates({ ...c, leads: 4, reached: reached(2, 0, 0, 1, 0) })).toMatchObject({ contacted: 0.5, hired: 0.25 });
  });
});

describe("checkNarration — every figure in the narration is on the sheet", () => {
  it("the sheet names the period in words, and a narration may quote it — the right year only", () => {
    expect(FACTS.period).toEqual({ day: "November 3, 2026", month: "November 2026" });
    expect(kinds("Spend so far in November 2026 is $3,000.00; on November 3, 2026 it was $1,234.56.")).toEqual([]);
    // A wrong year or day is a date the fold did not produce, refused whole.
    expect(kinds("Spend so far in November 2025 is $3,000.00.")).toEqual([["number_not_in_fold", "November 2025"]]);
    expect(kinds("On November 4, 2026 it was $1,234.56.")).toEqual([["number_not_in_fold", "November 4, 2026"]]);
    // The label lends no COUNT: its year and day are not allowed loose (2026 is not a figure on the sheet).
    expect(kinds("2026 leads came in.")).toEqual([["number_not_in_fold", "2026"]]);
  });

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

  it("refuses any figure in a sentence about a stage nothing records, even one the sheet holds for another stage", () => {
    // 3 is on the sheet (the 2026-10-26 cohort's converted count): the digit check alone would pass it.
    expect(kinds("The 2026-10-26 cohort has 3 qualified leads.")).toEqual([["number_for_unrecorded_stage", "2026-10-26"]]);
    expect(kinds("Of its 40 leads, 9 were disqualified.")).toEqual([["number_for_unrecorded_stage", "40"]]);
    expect(kinds("9 leads were lost before they became applicants.")).toEqual([["number_for_unrecorded_stage", "9"]]);
    // A decimal point is not a sentence end: the whole figure is named, not "$41".
    expect(kinds("Qualified leads cost $41.15 each.")).toEqual([["number_for_unrecorded_stage", "$41.15"]]);
    // Said in words, in a sentence of its own, it passes; a recorded loss after conversion is not matched.
    expect(kinds("The 2026-09-28 cohort has 40 leads, 20 made applicants. Which were qualified is not recorded.")).toEqual([]);
    expect(kinds("In the 2026-09-28 cohort, 9 were lost after becoming applicants, at $1,234.56 spent.")).toEqual([]);
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
    expect(plain.points).toContain("Leads from the week of 2026-10-26: 12, 3 made applicants, 0 hired, too young to judge.");
    for (const line of [plain.headline, ...plain.points]) expect(checkNarration(line, FACTS), line).toEqual([]);
  });
});

describe("lead quality on the sheet (LQ3c)", () => {
  const Q = briefFoldSchema.parse({
    ...FOLD,
    lead_quality: [
      { campaign_id: "c1", name: "Regional CDL-A 2026 Joliet", leads: 20, attempted: 10, wrong_number: 4, reached: 5, not_qualified: 7, median_first_attempt_minutes: 12 },
      { campaign_id: "c3", name: "Gary 77 nights", leads: 3, attempted: 0, wrong_number: 0, reached: 0, not_qualified: 0, median_first_attempt_minutes: null },
    ],
  });
  const QF = briefFacts(Q);

  it("a fold saved before LQ3c parses with no lead-quality rows", () => {
    expect(FOLD.lead_quality).toEqual([]);
    expect(FACTS.lead_quality).toEqual({ window_days: "14", campaigns: [] });
  });

  it("formats every figure and share once; nothing called means no share and no minutes, not a zero", () => {
    expect(QF.lead_quality.campaigns).toEqual([
      { name: "Regional CDL-A 2026 Joliet", leads: "20", called: "10", wrong_numbers: "4", reached: "5", missed_a_hard_requirement: "7",
        wrong_number_share_of_called: "40.0%", missed_share_of_leads: "35.0%", median_minutes_to_first_call: "12" },
      { name: "Gary 77 nights", leads: "3", called: "0", wrong_numbers: "0", reached: "0", missed_a_hard_requirement: "0",
        wrong_number_share_of_called: null, missed_share_of_leads: "0.0%", median_minutes_to_first_call: null },
    ]);
  });

  it("the narration may copy its figures, and a lead-quality campaign's name is not read as figures", () => {
    expect(checkNarration("Gary 77 nights had 3 leads in the last 14 days; Regional CDL-A 2026 Joliet: 4 of 10 called were wrong numbers (40.0%), 7 missed a hard requirement.", QF)).toEqual([]);
  });

  it("a share the sheet does not hold is refused, and calling the misses 'unqualified' with a figure is refused", () => {
    // The header's stated limit, pinned so nobody reads more into the check: 40% IS on the sheet (of the called), so
    // misattaching it to "all leads" passes. The check proves every figure came from the fold, not its label.
    expect(checkNarration("Wrong numbers were 40% of all 20 leads.", QF).map((f) => f.kind)).toEqual([]);
    expect(checkNarration("Wrong numbers were 20.0% of all leads.", QF).map((f) => [f.kind, f.text])).toEqual([["number_not_in_fold", "20.0%"]]);
    expect(checkNarration("7 leads were unqualified.", QF).map((f) => f.kind)).toEqual(["number_for_unrecorded_stage"]);
  });

  it("the plain brief states each campaign's quality in fixed words that pass the check, never 'qualified'", () => {
    const plain = plainBrief(QF);
    expect(plain.points).toContain("Regional CDL-A 2026 Joliet, last 14 days: 20 leads, 10 called, 4 wrong numbers, 5 reached, 7 missed a hard requirement, first call after 12 minutes (median).");
    expect(plain.points).toContain("Gary 77 nights, last 14 days: 3 leads, 0 called, 0 wrong numbers, 0 reached, 0 missed a hard requirement, none called yet.");
    for (const line of [plain.headline, ...plain.points]) expect(checkNarration(line, QF), line).toEqual([]);
  });
});
