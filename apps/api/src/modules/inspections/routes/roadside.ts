import { Router } from "express";
import {
  ROADSIDE_CARD_PERIOD,
  isCalendarDay,
  organizationTimezone,
  roadsidePeriodStart,
  shiftDay,
  summarizeRoadside,
  todayInZone,
  type RoadsideSummary,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readRoadsideInspections } from "../read/inspectionsList.js";

/**
 * `GET /api/roadside-inspections` — the Inspections inbox's first slice — and `/summary`, the
 * Operations tab's Roadside card (INSPECTION-CHALLENGE-PLAN §6, D-IC12: the `safety` section;
 * FLEET-MANAGER-HOME-PLAN FM5, Q-FM7 (a)). Read-only: nothing here is a case or a filing yet.
 *
 * ── THE CARD'S WINDOW IS CUT ON THE CARRIER'S CALENDAR, HERE ───────────────────────────────────
 * "Last 90 days" ends on today in the org zone, not on the server's (UTC on Railway, so a Chicago
 * evening would already be tomorrow). The answer names its first day (`from`), and the page asks for
 * the same window with `roadsidePeriodStart` on its own clock, so the page's row count is the card's
 * figure (D-FM7) — the summary is that list's rows counted by `summarizeRoadside`, not a second query.
 */
export function roadsideInspectionsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);
  const canView = requireSection("safety", "view");

  router.get(
    "/summary",
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
      const today = todayInZone(new Date(), organizationTimezone(org?.operating_hours));
      const from = roadsidePeriodStart(ROADSIDE_CARD_PERIOD, today)!;
      const rows = await readRoadsideInspections(admin, orgId, { from });
      if ("error" in rows) {
        dbErrorResponse(res, "roadside-inspections.summary", rows.error, "Could not load the roadside inspections");
        return;
      }
      const data: RoadsideSummary = summarizeRoadside(from, rows);
      res.json({ ok: true, data });
    }),
  );

  /** The whole list from `?from=` (or the whole record), unpaginated: a list that stopped early would be believed. */
  router.get(
    "/",
    canView,
    asyncHandler(async (req, res) => {
      const from = typeof req.query.from === "string" ? req.query.from : null;
      // `isCalendarDay` is shape only; a day that does not exist (02-31) would reach Postgres and come
      // back a 500, so it must also survive a round trip through the calendar unchanged.
      if (from !== null && (!isCalendarDay(from) || shiftDay(from, 0) !== from)) {
        res.status(400).json(apiError("bad_request", "from must be a calendar day, YYYY-MM-DD."));
        return;
      }
      const rows = await readRoadsideInspections(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, {
        from,
        withUnits: true,
      });
      if ("error" in rows) {
        dbErrorResponse(res, "roadside-inspections.list", rows.error, "Could not load the roadside inspections");
        return;
      }
      res.json({ ok: true, data: rows });
    }),
  );

  return router;
}
