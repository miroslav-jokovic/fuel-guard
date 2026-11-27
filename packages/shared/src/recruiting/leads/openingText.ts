import type { AD_MONEY_PER } from "../../ads/contracts.js";
import type { OPENING_BONUS_KINDS, OPENING_EQUIPMENT, OPENING_SCHEDULES, OpeningFacts } from "./opening.js";

/**
 * How an opening's facts read in words: the Openings editor's labels and the public careers page's sentences
 * (APPLY-PAGE-PLAN AP3). One home, because the office types a fact in the editor and an applicant reads it on the
 * page; two label maps would let "Over the road" on one screen be "OTR" on the other. Moved here from the web's
 * `features/recruitment/openingForm.ts` on 2026-11-22, when the careers page became the second reader. tsc holds
 * each map to its list, both ways.
 */

type Equipment = (typeof OPENING_EQUIPMENT)[number];
type PayPer = (typeof AD_MONEY_PER)[number];
type Schedule = (typeof OPENING_SCHEDULES)[number];
type BonusKind = (typeof OPENING_BONUS_KINDS)[number];

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  dry_van: "Dry van",
  reefer: "Reefer",
  flatbed: "Flatbed",
  tanker: "Tanker",
  intermodal: "Intermodal",
};
export const PAY_PER_LABEL: Record<PayPer, string> = {
  mile: "Per mile",
  week: "Per week",
  year: "Per year",
  hour: "Per hour",
  day: "Per day",
  load: "Per load",
};
export const SCHEDULE_LABEL: Record<Schedule, string> = { otr: "Over the road", regional: "Regional", local: "Local" };
export const BONUS_KIND_LABEL: Record<BonusKind, string> = { "sign-on bonus": "Sign-on bonus", "referral bonus": "Referral bonus" };
/**
 * The benefit boxes are the claim checker's own catalogue (`OPENING_BENEFIT_TERMS`, derived from `PROMISE_TERMS`),
 * read as labels by capitalising the key: a term the checker learns is a box, and a line on the page, with no edit.
 */
export const benefitLabel = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

/**
 * Dollars from cents as a person writes them, with cents shown only when there are any: "$0.62", "$1,500",
 * "$1,500.50". en-US grouping, because the page is English (D-AP8) and pay is in US dollars.
 */
export function dollarsText(cents: number): string {
  const whole = cents % 100 === 0;
  const digits = whole ? 0 : 2;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/**
 * The pay range as the careers page states it: "$0.62–$0.70 per mile", or one figure when the range is one. A
 * published opening always has a top (D-AP2, the Illinois Equal Pay Act). A null top is said as "From …" rather than
 * hidden, so a reader that is handed an unpublished opening still says nothing untrue.
 */
export function openingPayText(pay: OpeningFacts["pay"]): string {
  const per = PAY_PER_LABEL[pay.per].toLowerCase();
  if (pay.max_cents === null) return `From ${dollarsText(pay.min_cents)} ${per}`;
  if (pay.max_cents === pay.min_cents) return `${dollarsText(pay.min_cents)} ${per}`;
  return `${dollarsText(pay.min_cents)}–${dollarsText(pay.max_cents)} ${per}`;
}
