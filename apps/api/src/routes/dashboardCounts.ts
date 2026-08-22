import { Router } from "express";
import { canViewSection, type DashboardComplianceCounts } from "@fuelguard/shared";
import { asyncHandler } from "../lib/http.js";
import { getAppLocals } from "../lib/appLocals.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { requireAuth, requireOrg } from "../middleware/auth.js";
import { getComplianceOverview } from "../services/complianceOverview.js";
import { loadInquiryQueue } from "../services/inquiryQueue.js";

/**
 * `GET /api/dashboard/compliance-counts` — the three §391 numbers on the dashboard (UI plan U2).
 *
 * ── IT EXISTS TO KEEP A PAYLOAD OFF THE BROWSER, NOT TO ADD AN ANSWER ─────────────────────────
 * Every number here was already computable client-side; the pages that own them do exactly that. The
 * problem is what it costs to ask: `/api/compliance/overview` answers with one row per driver plus
 * nested group and attention arrays — 202 rows on the production carrier — so that a page can reduce
 * them to a rollup. The dashboard is the app's most-loaded page and wants one integer from it.
 *
 * So the reduction happens here, next to the data, and three integers go over the wire.
 *
 * ── THE SAME FUNCTIONS THE PAGES USE, DELIBERATELY ────────────────────────────────────────────
 * `getComplianceOverview` and `loadInquiryQueue` are called unchanged. A `count(*)` that
 * approximated "has no qualification file" or "is overdue" would be a SECOND definition of a derived
 * verdict, and the first time the two drifted the dashboard would send somebody to a page that
 * disagrees with the tile they clicked. D-DQ6's founding invariant is that the queue and the file
 * cannot disagree; P0b is the same lesson learned the expensive way on screening readiness.
 *
 * The applicant count is the exception and is a real `count`: `status = 'applicant'` is the literal
 * predicate `/api/recruitment/pipeline` selects on, not a derivation of it.
 *
 * ── null IS "NOT YOURS TO SEE", AND ZERO IS A NUMBER ──────────────────────────────────────────
 * The dashboard is ungated so drivers keep it, and these three counts span TWO capability sections.
 * Each is computed only for a role that may view its section and is null otherwise — restricting at
 * the projection rather than only at the row, which is RECRUITING-SYSTEM-PLAN §4's rule. A driver
 * must not learn the fleet's overdue investigations from their own home page, and a dispatcher
 * without `recruitment` must not learn the applicant count.
 *
 * ⚠ Not `requireRole` at the router level, for that reason: this route answers 200 with a narrower
 * body rather than 403, because the dashboard row simply does not render what it is given null for.
 */
export function dashboardCountsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/compliance-counts",
    requireOrg,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const role = req.auth!.role;
      const today = new Date().toISOString().slice(0, 10);

      const seesFleet = canViewSection(role, "fleet");
      const seesRecruitment = canViewSection(role, "recruitment");

      // Only the sections this role may see are QUERIED, not merely filtered afterwards — an
      // unauthorised count should not exist in this process, let alone be dropped on the way out.
      const [overview, queue, applicants] = await Promise.all([
        seesFleet ? getComplianceOverview(admin, orgId, today) : null,
        seesRecruitment ? loadInquiryQueue(admin, orgId, today) : null,
        seesRecruitment
          ? admin
              .from("drivers")
              .select("id", { count: "exact", head: true })
              .eq("org_id", orgId)
              .eq("status", "applicant")
          : null,
      ]);

      const counts: DashboardComplianceCounts = {
        driversWithoutQualificationFile:
          overview?.drivers.filter((d) => d.state === "not_started").length ?? null,
        overdueInvestigations: queue?.summary.overdue ?? null,
        applicants: applicants?.count ?? null,
      };

      // These move once a day at most (an expiry date, a hire date, somebody starting an
      // application), and this is the landing page — so let the browser hold it briefly rather than
      // recomputing a fleet-wide rollup on every dashboard visit.
      res.setHeader("Cache-Control", "private, max-age=60");
      res.json(counts);
    }),
  );

  return router;
}
