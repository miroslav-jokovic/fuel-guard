import type { Router } from "express";
import { MEDSTOP_ORDER_ROLES, medstopCloseInputSchema, type CalendarDay } from "@silvicom/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { orderClient } from "../order.js";
import { closeOrder, prepareClose, type ReleaseOrderedAppointment } from "../closeOrder.js";

/**
 * Closing an open Med-Stop order (MEDSTOP-PLAN.md §7A.21, MSO2, D-MSO3). The same role gate as ordering
 * (`MEDSTOP_ORDER_ROLES`): whoever may place an order may say it was not kept or is no longer wanted. The
 * same switch too — with ordering off, nothing is written to Med-Stop from here.
 *
 * Every close writes `medstop.order.closed` (the request, the outcome, the comment sent); an unanswered POST
 * writes `medstop.order.close_unknown`, because it may have landed.
 */
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

export function registerCloseRoutes(
  router: Router,
  deps: { orgToday: (admin: SupabaseClient, orgId: string) => Promise<CalendarDay>; releaseOrderedAppointment: ReleaseOrderedAppointment },
): void {
  const canOrder = requireRole(...MEDSTOP_ORDER_ROLES);

  for (const step of ["preview", "send"] as const) {
    router.post(
      step === "preview" ? "/order/:requestId/close/preview" : "/order/:requestId/close",
      canOrder,
      asyncHandler(async (req, res) => {
        const env = getAppLocals(req).env;
        const admin = getSupabaseAdmin(env);
        const orgId = req.auth!.orgId!;
        const requestId = String(req.params.requestId ?? "");
        const input = medstopCloseInputSchema.safeParse(req.body ?? {});
        if (!REQUEST_ID.test(requestId) || !input.success)
          return void res.status(400).json(apiError("bad_request", input.success ? "That is not a Med-Stop order." : (input.error.issues[0]?.message ?? "Check the request.")));
        const opened = await orderClient(admin, env, orgId);
        if ("refusal" in opened) return void res.status(opened.refusal.status).json(apiError(opened.refusal.code, opened.refusal.message));

        if (step === "preview") {
          const prepared = await prepareClose(admin, opened.client, orgId, requestId, input.data);
          if ("refusal" in prepared) return void res.status(prepared.refusal.status).json(apiError(prepared.refusal.code, prepared.refusal.message));
          return void res.json({ ok: true, data: prepared.preview });
        }

        const closed = await closeOrder(admin, opened.client, orgId, requestId, input.data, await deps.orgToday(admin, orgId), deps.releaseOrderedAppointment);
        if ("refusal" in closed) {
          if (closed.refusal.code === "medstop_close_unknown")
            await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "medstop.order.close_unknown", entity: "medstop_requests", entityId: requestId, meta: { ...input.data } });
          return void res.status(closed.refusal.status).json(apiError(closed.refusal.code, closed.refusal.message));
        }
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "medstop.order.closed",
          entity: "medstop_requests",
          entityId: requestId,
          meta: { requestId, status: closed.status, note: input.data.note ?? null, driverId: closed.driverId },
        });
        const { driverId: _driverId, ...body } = closed;
        res.json({ ok: true, data: body });
      }),
    );
  }
}
