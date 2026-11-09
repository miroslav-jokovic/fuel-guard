import { z } from "zod";

/**
 * When an AD is tired (ADS-CREATIVE-QUALITY-PLAN CQ9; D-AD23), judged from OUR per-ad hours (`ads_ad_spend_hourly`,
 * 0577) against the ad's OWN first week — never against another ad, never against a number somebody invented. Pure:
 * facts in, a verdict out; the monitor reads the rows and acts on `retire`.
 *
 * ── THE RULE, AND WHERE EACH NUMBER COMES FROM (plan §1 R6, read 2026-11-09) ─────────────────────
 * Practitioners judge fatigue as a COMPOSITE against the ad's own baseline, never on frequency alone: click-through
 * falling 15–30 % against the prior period while frequency is up, with a minimum of 7–10 days before judging at all
 * (Triple Whale's framework, the most-cited; AdScale, adsights, makometrics agree on the shape and differ on the
 * number). The settings carry the numbers with that source labelled; these are the defaults:
 *   · `min_days` 7 — nothing is judged before the ad has a full first week to be compared against;
 *   · `ctr_drop_pct` 25 — the last 7 days' click-through, against the FIRST 7 days', fallen by at least this much;
 *   · `min_impressions` 2,000 in each window — below that a click-through rate is noise.
 * Frequency stays the ad-set figure the monitor already pauses on (`frequency_max`, B5b): Meta reports it per ad set,
 * and one ad's frequency inside a set that rotates five is not a number Meta gives.
 *
 * A verdict is `retire` only when every condition holds; `hold` says which one did not, so the daily brief can
 * explain "P2 is not judged yet: 4 days old". A window with zero impressions is `hold`, not a 100 % drop.
 */

export const adsCreativeRefreshSchema = z.object({
  /** Off = the monitor computes and reports the verdict but retires nothing (the alert-only first weeks, like Q-AD51). */
  retire: z.boolean().default(false),
  min_days: z.number().int().min(3).max(60).default(7),
  ctr_drop_pct: z.number().int().min(5).max(90).default(25),
  min_impressions: z.number().int().min(100).max(1_000_000).default(2000),
});
export type AdsCreativeRefresh = z.infer<typeof adsCreativeRefreshSchema>;
export const ADS_CREATIVE_REFRESH_DEFAULT: AdsCreativeRefresh = adsCreativeRefreshSchema.parse({});

/** One ad's hour, as stored. */
export interface AdHour {
  hour: string;
  impressions: number;
  clicks: number;
}

export interface FatigueFacts {
  /** The ad's hours, any order; the first hour with an impression is its birth. */
  hours: readonly AdHour[];
  /** Now, for "the last 7 days". */
  now: Date;
}

export type FatigueVerdict =
  | { kind: "retire"; first_ctr: number; last_ctr: number; drop_pct: number; age_days: number }
  | { kind: "hold"; why: "too_young" | "too_few_impressions_first" | "too_few_impressions_last" | "no_drop"; age_days: number; first_ctr: number | null; last_ctr: number | null; drop_pct: number | null };

const DAY = 86_400_000;
const WINDOW_DAYS = 7;

function window(hours: readonly AdHour[], from: number, to: number): { impressions: number; clicks: number } {
  let impressions = 0, clicks = 0;
  for (const h of hours) {
    const t = Date.parse(h.hour);
    if (t >= from && t < to) { impressions += h.impressions; clicks += h.clicks; }
  }
  return { impressions, clicks };
}

/** Click-through as a share (0.0123 = 1.23 %), or null with no impressions. */
export const ctrOf = (w: { impressions: number; clicks: number }): number | null => (w.impressions > 0 ? w.clicks / w.impressions : null);

export function fatigueVerdict(settings: AdsCreativeRefresh, facts: FatigueFacts): FatigueVerdict {
  const born = facts.hours.filter((h) => h.impressions > 0).map((h) => Date.parse(h.hour)).reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
  const now = facts.now.getTime();
  const age_days = Number.isFinite(born) ? Math.floor((now - born) / DAY) : 0;
  if (!Number.isFinite(born) || age_days < settings.min_days) return { kind: "hold", why: "too_young", age_days, first_ctr: null, last_ctr: null, drop_pct: null };
  const first = window(facts.hours, born, born + WINDOW_DAYS * DAY);
  const last = window(facts.hours, now - WINDOW_DAYS * DAY, now);
  const first_ctr = ctrOf(first);
  const last_ctr = ctrOf(last);
  if (first.impressions < settings.min_impressions || first_ctr === null) return { kind: "hold", why: "too_few_impressions_first", age_days, first_ctr, last_ctr, drop_pct: null };
  if (last.impressions < settings.min_impressions || last_ctr === null) return { kind: "hold", why: "too_few_impressions_last", age_days, first_ctr, last_ctr, drop_pct: null };
  const drop_pct = Math.round(((first_ctr - last_ctr) / first_ctr) * 100);
  if (drop_pct < settings.ctr_drop_pct) return { kind: "hold", why: "no_drop", age_days, first_ctr, last_ctr, drop_pct };
  return { kind: "retire", first_ctr, last_ctr, drop_pct, age_days };
}
