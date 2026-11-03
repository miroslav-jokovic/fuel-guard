import type { Router } from "express";
import { z } from "zod";
import { MEDSTOP_ORDER_REASONS, MEDSTOP_ORDER_ROLES, canReadTestingRecords, medstopDefaultGoBy, medstopOrderInputSchema, type CalendarDay, recordId } from "@silvicom/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { getCredential } from "../credentials.js";
import { findSites, orderablePeople, orderClient, placeOrder, prepareOrder, siteObservedFor, truckPositionOf, type OrderRefusal } from "../order.js";
import { followUpPlacedOrder, type FillOrderedAppointment } from "../orderFollowUp.js";

/**
 * Order a Med-Stop test (MEDSTOP-PLAN.md §7A.4, UX3). Gated on `MEDSTOP_ORDER_ROLES` (owner answer 1:
 * admin, safety manager, recruiter — D-MSUX1), NOT on the safety section: the recruiter orders from the
 * hiring step (UX4) without seeing Safety, and ordering is not reading a result.
 *
 * Every placed order writes `medstop.order.placed`, with what was sent (no personal data: Med-Stop's
 * ids, the reason, the site and the day — the office contact is the org's own).
 */
// The reason (and, for an observed test, the person) decides which sites can collect — UX5d.
const planned = {
  service: z.enum(["drug", "alcohol"]), reason: z.enum(MEDSTOP_ORDER_REASONS), medstopId: z.string().trim().min(1).optional(), requestDate: z.string(), requestTime: z.string(),
  // MSO3: a recollection the office chose to have observed searches for this donor's observer too.
  observed: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
};
const sitesQuery = z.union([
  z.object({ ...planned, zip: z.string().regex(/^\d{5}$/) }),
  z.object({ ...planned, driverId: recordId() }),
]);

export interface OrderRouteDeps {
  /** Today, and the zone it is today in, on the carrier's clock — a collection day is a calendar day there. */
  orgClock: (admin: SupabaseClient, orgId: string) => Promise<{ today: CalendarDay; timeZone: string }>;
  /** Recruiting's appointment writer (MSO1), handed in by `app.ts` — see `orderFollowUp.ts` for why. */
  fillOrderedAppointment: FillOrderedAppointment;
}

/**
 * MSO3 (D-MSO4): a recollection names a negative-dilute RESULT, and choosing observation reveals one — both are
 * testing records (§382.401(a)). The recruiter still orders; only the result's readers order a recollection.
 */
const recollectionRefused = (role: Parameters<typeof canReadTestingRecords>[0], q: { recollectionOf?: string; observed?: boolean }): boolean =>
  (q.recollectionOf !== undefined || q.observed === true) && !canReadTestingRecords(role);
const RECOLLECTION_FORBIDDEN = "Only the people who read drug-test results order a recollection.";

export function registerOrderRoutes(router: Router, deps: OrderRouteDeps): void {
  const orgToday = async (admin: SupabaseClient, orgId: string) => (await deps.orgClock(admin, orgId)).today;
  const canOrder = requireRole(...MEDSTOP_ORDER_ROLES);
  const refused = (res: Parameters<Parameters<typeof asyncHandler>[0]>[1], r: OrderRefusal) => res.status(r.status).json(apiError(r.code, r.message));

  router.get(
    "/order/context",
    canOrder,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const credential = await getCredential(admin, orgId);
      const clock = await deps.orgClock(admin, orgId);
      res.json({
        ok: true,
        data: {
          enabled: credential?.ordersEnabled === true,
          contactSet: Boolean(credential?.orderContactEmail && credential?.orderContactPhone),
          people: await orderablePeople(admin, orgId),
          // D-MSO2: the drawer's "Go by" starts at the next business day, 4 pm, on the CARRIER's clock —
          // computed here so the office's laptop zone never moves it.
          today: clock.today,
          timeZone: clock.timeZone,
          goBy: medstopDefaultGoBy(clock.today),
        },
      });
    }),
  );

  router.get(
    "/order/sites",
    canOrder,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const q = sitesQuery.safeParse(req.query);
      if (!q.success) return void res.status(400).json(apiError("bad_request", "Give the test, its reason, the day and time, and a 5-digit ZIP or the driver."));
      if (recollectionRefused(req.auth!.role, q.data)) return void res.status(403).json(apiError("forbidden", RECOLLECTION_FORBIDDEN));
      const opened = await orderClient(admin, env, orgId);
      if ("refusal" in opened) return void refused(res, opened.refusal);
      let near: { zip: string } | { lat: number; lng: number };
      let where: string | null = null;
      if ("zip" in q.data) near = { zip: q.data.zip };
      else {
        const fix = await truckPositionOf(admin, orgId, q.data.driverId);
        if (!fix) return void res.status(404).json(apiError("no_truck_position", "This driver has no assigned truck with a recent position. Search by ZIP instead."));
        near = { lat: fix.lat, lng: fix.lng };
        where = fix.where;
      }
      const observed = await siteObservedFor(admin, opened.client, orgId, q.data);
      if ("refusal" in observed) return void refused(res, observed.refusal);
      const sites = await findSites(opened.client, { service: q.data.service, requestDate: q.data.requestDate, requestTime: q.data.requestTime, ...observed, ...near });
      res.json({ ok: true, data: { sites, near: where } });
    }),
  );

  router.post(
    "/order/preview",
    canOrder,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const input = medstopOrderInputSchema.safeParse(req.body ?? {});
      if (!input.success) return void res.status(400).json(apiError("bad_request", input.error.issues[0]?.message ?? "Check the order."));
      if (recollectionRefused(req.auth!.role, input.data)) return void res.status(403).json(apiError("forbidden", RECOLLECTION_FORBIDDEN));
      const opened = await orderClient(admin, env, orgId);
      if ("refusal" in opened) return void refused(res, opened.refusal);
      const preview = await prepareOrder(admin, opened.client, opened.contact, orgId, input.data, await orgToday(admin, orgId));
      if ("refusal" in preview) return void refused(res, preview.refusal);
      res.json({ ok: true, data: preview });
    }),
  );

  router.post(
    "/order",
    canOrder,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const input = medstopOrderInputSchema.safeParse(req.body ?? {});
      if (!input.success) return void res.status(400).json(apiError("bad_request", input.error.issues[0]?.message ?? "Check the order."));
      if (recollectionRefused(req.auth!.role, input.data)) return void res.status(403).json(apiError("forbidden", RECOLLECTION_FORBIDDEN));
      const opened = await orderClient(admin, env, orgId);
      if ("refusal" in opened) return void refused(res, opened.refusal);
      const today = await orgToday(admin, orgId);
      const placed = await placeOrder(admin, opened.client, opened.contact, orgId, input.data, today);
      if ("refusal" in placed) {
        // An unanswered POST may have been placed: that attempt is audited too, so the trail shows it.
        if (placed.refusal.code === "medstop_order_unknown")
          await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "medstop.order.unknown", entity: "medstop_requests", meta: { ...input.data } });
        return void refused(res, placed.refusal);
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "medstop.order.placed",
        entity: "medstop_requests",
        entityId: placed.requestId,
        meta: { ...input.data, requestId: placed.requestId, driverId: placed.person.driverId, payment: placed.payload.payment, sendsms: "N", sendemail: "N" },
      });
      // After the audit, never before: the order is placed and recorded whatever the follow-up comes to.
      const followed = await followUpPlacedOrder(
        admin, opened.client, orgId, req.auth!.userId, input.data,
        { requestId: placed.requestId, driverId: placed.person.driverId }, today, deps.fillOrderedAppointment,
      );
      res.json({ ok: true, data: followed });
    }),
  );
}
