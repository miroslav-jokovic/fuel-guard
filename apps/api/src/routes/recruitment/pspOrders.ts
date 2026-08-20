import { Router } from "express";
import {
  canReadInvestigationHistory,
  pspOrderRequestSchema,
  rolesThatManage,
  type PspOrderRequest,
} from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { hasFreshAuth, stepUpRequired } from "../../middleware/requireFreshAuth.js";
import { orderPspRecord, pspOrderPreflight } from "../../services/pspOrder.js";
import { fetchRecordPdf, requestRecord } from "../../psp/client.js";

/**
 * Ordering a PSP record — the surface P6 and P7 were built behind (P9).
 *
 * Separate from `psp.ts` because the two do different things to the world. Importing files a PDF the
 * carrier already owns and costs nothing; ordering spends money against a live account-holder
 * agreement, on a request that bills whether it matches or not (§8). One router per act keeps the
 * guards, the audit actions and the failure modes from being read as interchangeable.
 *
 * ── STEP-UP IS A REFUSAL, NOT A MIDDLEWARE ─────────────────────────────────────────────────────
 * `requireFreshAuth()` would refuse before anything else ran, and that is the wrong order. The
 * service refuses in the sequence legality → authority → budget → correctness for a reason its
 * header states: asking "can we afford it" before "are we allowed" is the wrong question first. The
 * same applies to the password — being made to re-authenticate and only then told the driver never
 * signed the disclosure teaches the operator nothing except that we wasted their time. So the route
 * passes `hasFreshAuth(req)` in and lets the service decide where the password sits in the queue.
 */
export function recruitmentPspOrdersRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // The same intersection the import uses, for the same reason: manage the section AND be permitted
  // to read a §391.53(a)(1) record. Ordering adds a second argument for it — a fleet_manager cannot
  // read the report they would be spending the carrier's money on.
  const canOrder = requireRole(...rolesThatManage("recruitment").filter(canReadInvestigationHistory));

  /** What it would cost and what stands in the way. No vendor call, so this is free to ask. */
  router.get(
    "/psp-orders/preflight",
    requireOrg,
    canOrder,
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const driverId = typeof req.query.driverId === "string" ? req.query.driverId : "";
      if (!driverId) {
        res.status(400).json(apiError("bad_query", "driverId is required"));
        return;
      }
      res.json(await pspOrderPreflight(admin, env, { orgId: req.auth!.orgId!, driverId }));
    }),
  );

  router.post(
    "/psp-orders",
    requireOrg,
    canOrder,
    validateBody(pspOrderRequestSchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as PspOrderRequest;

      let result;
      try {
        result = await orderPspRecord(
          admin,
          env,
          {
            orgId,
            driverId: body.driver_id,
            userId: req.auth!.userId,
            stepUp: hasFreshAuth(req),
            // §5.4.1 requires it and never defines it for a system-to-system caller (Q4). The
            // operator's IP is the honest value: it makes the field an audit fact about who
            // authorised the spend rather than filler. `trust proxy` is set in app.ts.
            userIPAddress: req.ip ?? null,
          },
          { requestRecord, fetchRecordPdf },
        );
      } catch (e) {
        // The vendor call failed AFTER the ledger row was written, and the row already records
        // whether we believe we were charged. Never retried (client.ts) — a blind retry on a
        // transport error is how one order becomes two invoices.
        res.status(502).json(apiError("psp_unavailable", e instanceof Error ? e.message : "PSP call failed"));
        return;
      }

      if ("code" in result) {
        if (result.code === "step_up_required") {
          stepUpRequired(res, 300, result.message);
          return;
        }
        const status =
          result.code === "authorization_missing" ? 403
          : result.code === "budget_exceeded" ? 429
          : result.code === "already_in_flight" ? 409
          : result.code === "psp_disabled" || result.code === "psp_not_configured" ? 503
          : 400;
        res.status(status).json({ ...apiError(result.code, result.message), ...result });
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.psp_record_ordered",
        entity: "psp_requests",
        entityId: result.requestId,
        // What it cost the carrier, in the two terms that matter at reconciliation time: whether PSP
        // billed, and what came back. Never the driver's licence number or date of birth.
        meta: {
          driverId: body.driver_id,
          outcome: result.report.outcome,
          billed: result.report.billed,
          recordId: result.recordId,
          documentId: result.documentId,
        },
      });

      res.status(201).json(result);
    }),
  );

  return router;
}
