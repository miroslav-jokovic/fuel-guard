import { z } from "zod";
import { AD_PLATFORMS, type AdPlatform, type OutcomeStage } from "./contracts.js";
import { cohortRates, sumCampaignTotals, type CampaignTotals, type Cohort, type MonthContext } from "./adsReport.js";

/**
 * The analyst's two pure halves (ADS-AGENT-BUILD-WORKFLOW F1; plan D-AD5 "numbers come from a fold; the
 * model only narrates"): the FACT SHEET the model is shown, built from `adsReport.ts`'s folds and nothing
 * else, and the NUMBER CHECK every sentence it writes back must pass.
 *
 * ── THE MODEL NEVER SEES A RAW NUMBER ──────────────────────────────────────────────────────────────
 * Every figure on the sheet is a display string we formatted ("$1,234.56", "4,210", "1.4%"), so the
 * model has nothing to convert, round or add up; the prompt tells it to copy figures exactly. An
 * immature cohort gets its counts and NO rates (`cohortRates` is null): its hire rate is still climbing,
 * and a rate the sheet does not hold is a rate the narration cannot state.
 *
 * ── THE CHECK IS "EVERY DIGIT IS ON THE SHEET", AS THE COPY CHECK IS (adClaims.ts) ─────────────────
 * The allowed figures are the sheet's own strings read by the SAME tokenizer as the narration, so the
 * two can never format a number differently. Each figure is read with its kind — money, percent, a
 * date, a plain count — and must equal a figure of that kind on the sheet: "$12" passes for "$12.00",
 * "$1,235" does not pass for "$1,234.56" (a rounding is a number the fold did not produce), and "12%"
 * does not pass for a count of 12. Numbers written in words ("twelve", "a dozen", "twice") are refused
 * outright: they would route a figure around the check. "One" is not on that list, because "no one",
 * "the one in Joliet" are not figures; a count of one the model writes as "1" is checked like any other.
 * A campaign's name is the advertiser's text, not a figure: its exact occurrences are blanked before
 * the scan, so "CDL-A 2026" in a name is not read as 2026 — and the same digits outside it are.
 *
 * What it does NOT prove: that a figure is attached to the right label ("leads" vs "clicks"). It proves
 * §4R's bar — 0 numbers in the narration that the fold did not produce — and a person reads the brief.
 * A sign is a word ("fell", "down"), so figures are compared by magnitude.
 */

const fold = z.object({
  campaign_id: z.string(),
  name: z.string().min(1),
  spend_cents: z.number().int(),
  impressions: z.number().int(),
  clicks: z.number().int(),
  leads: z.number().int(),
  cost_per_lead_cents: z.number().int().nullable(),
  ctr: z.number().min(0).nullable(),
}).strict() satisfies z.ZodType<CampaignTotals & { name: string }>;
const stageCounts = z.object({ contacted: z.number().int(), qualified: z.number().int(), applied: z.number().int(), hired: z.number().int(), lost: z.number().int() }).strict();

/** What the brief is built from: the day's `foldCampaignSpend` (named), `monthToDateByPlatform`, `foldLeadCohorts`. */
export const briefFoldSchema = z.object({
  /** The day reported, zone-local "YYYY-MM-DD" (yesterday, when the brief runs in the morning). */
  day: z.iso.date(),
  month: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), days_left: z.number().int().min(0) }).strict() satisfies z.ZodType<Pick<MonthContext, "month" | "days_left">>,
  campaigns: z.array(fold),
  month_to_date: z.partialRecord(z.enum(AD_PLATFORMS), z.number().int()),
  cohorts: z.array(z.object({ week: z.iso.date(), leads: z.number().int(), reached: stageCounts, mature: z.boolean() }).strict() satisfies z.ZodType<Cohort>),
}).strict();
export type BriefFold = z.infer<typeof briefFoldSchema>;

type Stages = Record<OutcomeStage, string>;
type Figures = { spend: string; impressions: string; clicks: string; leads: string; cost_per_lead: string | null; click_rate: string | null };
export interface BriefFacts {
  day: string;
  /** Every campaign together (`sumCampaignTotals`), so "how many leads yesterday" is a figure, not a sum the model makes. */
  day_totals: Figures & { campaigns_ran: string };
  campaigns: Array<Figures & { name: string }>;
  month: { month: string; days_left: string; spend_by_platform: Partial<Record<AdPlatform, string>> };
  cohorts: Array<{ week: string; mature: boolean; leads: string; reached: Stages; rates: Stages | null }>;
}

const grouped = (n: number) => String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const sign = (n: number) => (n < 0 ? "-" : "");
export const showMoney = (cents: number) => `${sign(cents)}$${grouped(Math.trunc(Math.abs(cents) / 100))}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
export const showCount = (n: number) => `${sign(n)}${grouped(n)}`;
export const showShare = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const showStages = (r: Record<OutcomeStage, number>, show: (n: number) => string) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, show(v)])) as Stages;

/** The sheet the model is shown: every figure formatted once, here. */
function figures(c: Omit<CampaignTotals, "campaign_id">): Figures {
  return {
    spend: showMoney(c.spend_cents),
    impressions: showCount(c.impressions),
    clicks: showCount(c.clicks),
    leads: showCount(c.leads),
    cost_per_lead: c.cost_per_lead_cents === null ? null : showMoney(c.cost_per_lead_cents),
    click_rate: c.ctr === null ? null : showShare(c.ctr),
  };
}

export function briefFacts(f: BriefFold): BriefFacts {
  const total = sumCampaignTotals(f.campaigns);
  return {
    day: f.day,
    day_totals: { campaigns_ran: showCount(total.campaigns), ...figures(total) },
    campaigns: f.campaigns.map((c) => ({ name: c.name, ...figures(c) })),
    month: {
      month: f.month.month,
      days_left: showCount(f.month.days_left),
      spend_by_platform: Object.fromEntries(Object.entries(f.month_to_date).map(([p, cents]) => [p, showMoney(cents)])),
    },
    cohorts: f.cohorts.map((c) => {
      const rates = cohortRates(c);
      return { week: c.week, mature: c.mature, leads: showCount(c.leads), reached: showStages(c.reached, showCount), rates: rates && showStages(rates, showShare) };
    }),
  };
}

/**
 * The brief with no model: the day's figures in fixed sentences, every one copied from the sheet. Sent when
 * the analyst is switched off or out of budget, or when its narration was refused twice — the office still
 * gets yesterday's numbers, and a narration that stated a figure the fold did not produce is never what
 * stands in for them.
 */
export function plainBrief(f: BriefFacts): { headline: string; points: string[] } {
  const t = f.day_totals;
  const each = (c: Figures) => `${c.spend} spent, ${c.leads} leads${c.cost_per_lead ? ` at ${c.cost_per_lead} per lead` : ""}, ${c.impressions} impressions, ${c.clicks} clicks`;
  const spend = Object.entries(f.month.spend_by_platform).map(([p, v]) => `${p} ${v}`).join(", ");
  return {
    headline: `${f.day}, campaigns that ran: ${t.campaigns_ran}. Together: ${each(t)}.`,
    points: [
      ...f.campaigns.map((c) => `${c.name}: ${each(c)}.`),
      `Spend so far in ${f.month.month}: ${spend || "none"}, with ${f.month.days_left} days left.`,
      ...f.cohorts.map((c) => `Leads from the week of ${c.week}: ${c.leads}, ${c.reached.hired} hired${c.rates ? ` (${c.rates.hired})` : ", too young to judge"}.`),
    ],
  };
}

// ── the check ───────────────────────────────────────────────────────────────────────────────────
export type NarrationFindingKind = "number_not_in_fold" | "number_in_words";
export interface NarrationFinding {
  kind: NarrationFindingKind;
  text: string;
  index: number;
}

// A date first (so 2026-11-03 is one figure, not three), then money, then a number with its unit if any.
const FIGURE = /(?<![\d.,])(\d{4}-\d{2}(?:-\d{2})?)(?![\d])|\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?|(?<![\d.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\s?%|\s?percent\b|\s?per ?cent\b)?/gi;
const NUMBER_WORDS = /\b(zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|dozens?|twice|triple[ds]?|quadruple[ds]?)\b/gi;

function figuresIn(text: string): Array<{ key: string; text: string; index: number }> {
  const out: Array<{ key: string; text: string; index: number }> = [];
  for (const m of text.matchAll(FIGURE)) {
    const n = (whole: string, frac: string | undefined) => Number(`${whole.replace(/,/g, "")}.${frac ?? "0"}`);
    const key = m[1] !== undefined ? `date:${m[1]}`
      : m[2] !== undefined ? `money:${n(m[2], m[3])}`
      : `${m[6] ? "percent" : "count"}:${n(m[4]!, m[5])}`;
    out.push({ key, text: m[0].trim(), index: m.index });
  }
  return out;
}

/** Every string on the sheet but the names: those are the advertiser's words, not the fold's figures. */
function sheetStrings(v: unknown, key = ""): string[] {
  if (typeof v === "string") return key === "name" ? [] : [v];
  if (Array.isArray(v)) return v.flatMap((x) => sheetStrings(x));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => sheetStrings(x, k));
  return [];
}

export function checkNarration(text: string, facts: BriefFacts): NarrationFinding[] {
  const allowed = new Set(sheetStrings(facts).flatMap((s) => figuresIn(s).map((f) => f.key)));
  let scanned = text;
  for (const name of new Set(facts.campaigns.map((c) => c.name))) scanned = scanned.split(name).join(" ".repeat(name.length));
  const findings: NarrationFinding[] = [];
  for (const f of figuresIn(scanned)) if (!allowed.has(f.key)) findings.push({ kind: "number_not_in_fold", text: f.text, index: f.index });
  for (const m of scanned.matchAll(NUMBER_WORDS)) findings.push({ kind: "number_in_words", text: m[0], index: m.index });
  return findings.sort((a, b) => a.index - b.index);
}
