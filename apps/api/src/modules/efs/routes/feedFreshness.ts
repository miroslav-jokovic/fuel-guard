import type { Router } from "express";
import { describeFeedFreshness, detectFeedGaps, type FeedFreshness, type FeedGapReport } from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { eachPage } from "../../../lib/paging.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * When each EFS feed last delivered (FUEL-T5 / A7).
 *
 * ── WHY THIS IS NOT THE EXISTING `/efs-soap/config` ROUTE ──────────────────────────────────────
 * That one is `requireRole("admin")` and returns the whole integration — endpoint, username, TLS
 * material metadata, cursors. The people who need this fact are the ones reading Transactions and
 * Rejections, which is `rolesThatCanView("fuel")` — an accountant or an auditor looking at a short
 * list needs to know whether it is short because nothing happened or because nothing arrived. Reusing
 * an admin route would have meant either widening it (leaking the integration to everyone who reads a
 * fuel page) or putting the caveat only in front of admins, which is nobody's idea of honest.
 *
 * So this returns two sentences and four timestamps, and nothing that is not already implied by being
 * allowed to read the rows themselves. **No credential, cursor, endpoint or error TEXT crosses this
 * boundary** — the error text can carry a username or a certificate subject, and "EFS is refusing this
 * feed" is the whole of what a fuel reader can act on anyway.
 *
 * ── THE GATE IS DERIVED ────────────────────────────────────────────────────────────────────────
 * `requireSection("fuel", "view")`, not a hand-listed role array (CLAUDE.md; the pattern FUEL-T2
 * generalised across the section).
 *
 * ── AND SINCE 2026-09-05 IT ALSO ANSWERS "DID ANYTHING GO MISSING IN THE MIDDLE?" ───────────────
 * Freshness catches a poller that has stopped. It cannot catch one that stopped and started again:
 * production carried **17 consecutive days with no fill at all** — 2026-04-18 to 2026-05-04, roughly
 * 119,000 gallons and $590,000 of fuel — while this endpoint correctly reported that purchases had
 * last arrived minutes ago, every day, for four months. The hole was found by a person comparing two
 * unrelated numbers. Same question, same readers, same gate, so it answers here rather than from a
 * second route nobody would think to open.
 */
export interface FeedFreshnessResponse {
  posted: FeedFreshness;
  rejected: FeedFreshness;
  /** Holes in the fill record over the window asked about. `lead` is null when there are none. */
  gaps: FeedGapReport;
}

/** The widest window this will count fills across, for the reason every other bounded read has one. */
const MAX_GAP_WINDOW_DAYS = 400;
/**
 * The default when a caller names no window.
 *
 * Ninety days rather than the thirty a fuel page usually shows: a gap is worth finding while somebody
 * still remembers the fortnight it covers, and a month-wide default would have needed the reader to be
 * looking at April in April. It is also the cost ceiling — ~5,600 dates for this fleet, six pages.
 */
const DEFAULT_GAP_WINDOW_DAYS = 90;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Count canonical fills per BUSINESS DATE over the window, and hand them to the rule.
 *
 * `business_date` (0287) rather than `fueled_at`, for the reason T1 gave: a fill's day is the
 * STATION's, and a window of instants asks a different question than the pages this line appears on.
 * Only the date column is selected — the rule needs a count per day and nothing else, and this runs on
 * every fuel page load.
 */
async function readFillGaps(
  admin: SupabaseClient,
  orgId: string,
  rawFrom: unknown,
  rawTo: unknown,
  now: Date,
): Promise<FeedGapReport> {
  const to = typeof rawTo === "string" && YMD.test(rawTo) ? rawTo : ymd(now);
  const fallbackFrom = ymd(new Date(Date.parse(`${to}T00:00:00Z`) - DEFAULT_GAP_WINDOW_DAYS * 86_400_000));
  let from = typeof rawFrom === "string" && YMD.test(rawFrom) ? rawFrom : fallbackFrom;
  if (from > to) from = fallbackFrom;
  // Clamped rather than refused: this rides along with a freshness line, and a 400 here would take a
  // sentence off four pages because somebody pasted a five-year range into the address bar.
  const earliest = ymd(new Date(Date.parse(`${to}T00:00:00Z`) - MAX_GAP_WINDOW_DAYS * 86_400_000));
  if (from < earliest) from = earliest;

  const counts = new Map<string, number>();
  await eachPage<{ business_date: string | null }>(
    (a, b) =>
      admin
        .from("fuel_transactions")
        .select("business_date")
        // The service role bypasses RLS; this is the only tenant boundary on the read.
        .eq("org_id", orgId)
        .eq("is_canonical", true)
        .gte("business_date", from)
        .lte("business_date", to)
        .order("business_date", { ascending: true })
        .range(a, b),
    (rows) => {
      for (const r of rows) {
        if (r.business_date == null) continue;
        counts.set(r.business_date, (counts.get(r.business_date) ?? 0) + 1);
      }
    },
  );
  return detectFeedGaps([...counts].map(([day, fills]) => ({ day, fills })));
}

export function registerFeedFreshnessRoutes(router: Router): void {
  router.get(
    "/feed-freshness",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);

      // Read with the service role, which bypasses RLS — so the org filter is this handler's own
      // responsibility, and its test asserts it.
      const { data, error } = await admin
        .from("efs_soap_credentials")
        .select(
          "posted_last_success_at, posted_last_polled_at, posted_last_error, " +
            "rejected_last_success_at, rejected_last_polled_at, rejected_last_error",
        )
        .eq("org_id", req.auth!.orgId!)
        .maybeSingle();
      if (error) throw new Error(error.message);

      const row = (data ?? {}) as Record<string, string | null>;
      const now = new Date();
      const gaps = await readFillGaps(admin, req.auth!.orgId!, req.query.from, req.query.to, now);
      // The cadences the poller actually promises, from the same env it reads — not a constant copied
      // into a second place that would keep saying "every 15 minutes" after somebody tuned it.
      res.json({
        posted: describeFeedFreshness(
          "posted",
          {
            lastSuccessAt: row.posted_last_success_at ?? null,
            lastPolledAt: row.posted_last_polled_at ?? null,
            // Reduced to a BOOLEAN at the boundary: the caller needs to know there is an error, and
            // the text can name a username or a certificate subject.
            lastError: row.posted_last_error ? "refused" : null,
          },
          env.EFS_SOAP_POSTED_POLL_MINUTES,
          now,
        ),
        rejected: describeFeedFreshness(
          "rejected",
          {
            lastSuccessAt: row.rejected_last_success_at ?? null,
            lastPolledAt: row.rejected_last_polled_at ?? null,
            lastError: row.rejected_last_error ? "refused" : null,
          },
          env.EFS_SOAP_REJECTED_POLL_MINUTES,
          now,
        ),
        gaps,
      } satisfies FeedFreshnessResponse);
    }),
  );
}
