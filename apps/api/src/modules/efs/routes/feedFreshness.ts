import type { Router } from "express";
import { describeFeedFreshness, type FeedFreshness } from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";

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
 */
export interface FeedFreshnessResponse {
  posted: FeedFreshness;
  rejected: FeedFreshness;
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
      } satisfies FeedFreshnessResponse);
    }),
  );
}
