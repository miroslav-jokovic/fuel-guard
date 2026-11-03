import { graphError } from "./fakeMetaShapes.js";

/**
 * FakeMeta's campaign insights at HOURLY grain — what B5a's monitor pulls into `ads_spend_hourly`. Apart
 * from `fakeMeta.ts` for its file budget; held in a WeakMap keyed by the fake so that file gains no field.
 * Shape from Meta's pages, read 2026-11-03:
 *
 *   GET /{v}/{campaign_id}/insights
 *       ?level=campaign&fields=campaign_id,spend,impressions,clicks,actions,account_currency
 *       &breakdowns=hourly_stats_aggregated_by_advertiser_time_zone
 *       &time_range={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}&time_increment=1&limit=…&after=…
 *     → `{ data: [{ campaign_id, date_start, date_stop, hourly_stats_aggregated_by_advertiser_time_zone:
 *          "HH:00:00 - HH:59:59", spend: "12.34", impressions: "100", clicks: "3",
 *          actions: [{ action_type, value }], account_currency }], paging: { cursors: { after }, next? } }`
 *   https://developers.facebook.com/docs/marketing-api/insights/breakdowns ("Hourly breakdown aggregated by
 *   the time ads were delivered in the advertiser's time zone"; sample buckets "00:00:00 - 00:59:59"; no
 *   unique fields — reach and frequency read 0 — and no video fields with it; 13 months kept).
 *   https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/insights/ (`time_range`
 *   is days, `until` inclusive; `time_increment` 1 = one row set per day; `spend` is "estimated").
 *   https://developers.facebook.com/docs/marketing-api/insights/best-practices ("We report ad insights
 *   data in the ad account's timezone"; refreshed every ~15 minutes, final after 28 days).
 *
 * ⚠ OUR READINGS, not Meta's word, until L4 re-runs this against the sandbox (§4R):
 *   · No page says `time_increment=1` may be combined with an hourly breakdown, or that `date_start` is the
 *     LOCAL day the bucket belongs to. The fake answers that way; the sandbox will say.
 *   · On a fall-back day the local hour 01:00 happens twice. Meta's buckets are wall-clock hours, so this
 *     fake (like our reading of Meta) reports ONE bucket holding both; on a spring-forward day 02:00 has
 *     no bucket at all. A bucket is planted by local day + local hour, so a test plants exactly that.
 *   · An hour with no delivery has no row (the account insights' `data: []` rule, applied per bucket).
 *
 * Planted, never generated: a test (or a staging walk-through) plants each hour with `plantHour`, plants
 * it again lower to model Meta revising a number DOWN, and plants a new hour after a run to model a late
 * hour. The simulator's campaigns therefore report no spend until someone plants it — honest for a
 * platform that never delivers.
 */

export const HOURLY_BREAKDOWN = "hourly_stats_aggregated_by_advertiser_time_zone";

export interface PlantedHour {
  spend_cents: number;
  impressions: number;
  clicks: number;
  leads: number;
}

/** campaign id → `YYYY-MM-DD|HH` (local day, local hour) → numbers. */
type Store = Map<string, Map<string, PlantedHour>>;
const stores = new WeakMap<object, Store>();
const storeOf = (fake: object): Store => {
  let s = stores.get(fake);
  if (!s) stores.set(fake, (s = new Map()));
  return s;
};

/** Meta's default page size for an edge; the monitor asks for more, a test can ask for less. */
const DEFAULT_LIMIT = 25;

/** What Meta reports for one campaign's local wall-clock hour, as of now — replacing any earlier answer. */
export function plantHour(fake: object, campaignId: string, localDay: string, localHour: number, n: Partial<PlantedHour>): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDay) || !Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
    throw new Error(`plantHour: ${localDay} ${localHour} is not a local day and hour`);
  }
  const s = storeOf(fake);
  if (!s.has(campaignId)) s.set(campaignId, new Map());
  s.get(campaignId)!.set(`${localDay}|${String(localHour).padStart(2, "0")}`, { spend_cents: 0, impressions: 0, clicks: 0, leads: 0, ...n });
}

/** Meta stopped reporting an hour it reported before (a revision to nothing). */
export function forgetHour(fake: object, campaignId: string, localDay: string, localHour: number): void {
  storeOf(fake).get(campaignId)?.delete(`${localDay}|${String(localHour).padStart(2, "0")}`);
}

/** Every planted hour forgotten — a test's clean slate. */
export function forgetAllHours(fake: object): void {
  storeOf(fake).clear();
}

export function campaignHourlyInsights(fake: object, campaignId: string, currency: string, b: Record<string, string>, trace: string): { status: number; body: unknown } {
  if (b.breakdowns !== HOURLY_BREAKDOWN) {
    return graphError(400, 100, "OAuthException", `(#100) FakeMeta answers campaign insights only with breakdowns=${HOURLY_BREAKDOWN}`, trace);
  }
  if (b.time_increment !== "1") return graphError(400, 100, "OAuthException", "(#100) FakeMeta answers hourly insights only with time_increment=1", trace);
  let range: { since?: unknown; until?: unknown };
  try {
    range = JSON.parse(b.time_range ?? "null") ?? {};
  } catch {
    return graphError(400, 100, "OAuthException", "(#100) param time_range must be a JSON object", trace);
  }
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof range.since !== "string" || typeof range.until !== "string" || !day.test(range.since) || !day.test(range.until) || range.since > range.until) {
    return graphError(400, 100, "OAuthException", "(#100) time_range needs since <= until, as YYYY-MM-DD", trace);
  }
  const { since, until } = range as { since: string; until: string };
  const planted = [...(storeOf(fake).get(campaignId) ?? new Map<string, PlantedHour>()).entries()]
    .filter(([k, n]) => k.slice(0, 10) >= since && k.slice(0, 10) <= until && (n.spend_cents > 0 || n.impressions > 0 || n.clicks > 0 || n.leads > 0))
    .sort(([a], [z]) => (a < z ? -1 : a > z ? 1 : 0));
  const limit = Math.max(1, Number(b.limit) || DEFAULT_LIMIT);
  const from = Math.max(0, Number(b.after ? Buffer.from(b.after, "base64").toString("utf8") : 0) || 0);
  const page = planted.slice(from, from + limit).map(([k, n]) => {
    const [d, hh] = k.split("|") as [string, string];
    return {
      campaign_id: campaignId, date_start: d, date_stop: d,
      [HOURLY_BREAKDOWN]: `${hh}:00:00 - ${hh}:59:59`,
      spend: (n.spend_cents / 100).toFixed(2), impressions: String(n.impressions), clicks: String(n.clicks),
      ...(n.leads > 0 ? { actions: [{ action_type: "onsite_conversion.lead_grouped", value: String(n.leads) }, { action_type: "lead", value: String(n.leads) }] } : {}),
      account_currency: currency,
    };
  });
  const next = from + limit < planted.length ? Buffer.from(String(from + limit)).toString("base64") : null;
  return { status: 200, body: { data: page, paging: { cursors: { after: next ?? "" }, ...(next ? { next: `fake://insights?after=${next}` } : {}) } } };
}
