import { graphError } from "./fakeMetaShapes.js";
import type { FakeMetaAccount } from "./fakeMeta.js";

/**
 * FakeMeta's account insights, the one read the guard needs before B5's monitor exists (2026-11-03 audit
 * H4): what the account has spent in a date range. Apart from `fakeMeta.ts` for the file budget. Shape
 * from the Insights API reference (read 2026-11-03):
 *   GET /{v}/act_{id}/insights?fields=spend&level=account&time_range={"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}
 *     → `{ data: [{ spend: "123.45", date_start, date_stop }] }`, `spend` in the account currency's
 *       MAJOR unit as a decimal string (unlike the account's `amount_spent`, which is in cents), and
 *       `data: []` when nothing was spent in the range.
 * https://developers.facebook.com/docs/marketing-api/insights
 *
 * The fake does not model days: an account's `month_spend_cents` is what every in-month range reads.
 * Enough for the guard's question ("this month so far"); B5's hourly pull brings the real breakdown.
 */
export function accountInsights(a: FakeMetaAccount, b: Record<string, string>, trace: string): { status: number; body: unknown } {
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
  const cents = a.month_spend_cents ?? 0;
  if (cents === 0) return { status: 200, body: { data: [] } };
  return { status: 200, body: { data: [{ spend: (cents / 100).toFixed(2), date_start: range.since, date_stop: range.until }] } };
}
