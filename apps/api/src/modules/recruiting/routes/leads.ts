import { Router } from "express";
import { z } from "zod";
import { leadFromManual, manualLeadSchema, recordId, type ManualLead } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { displayNameFor } from "../../../lib/memberLabels.js";
import { ingestLead } from "../leads/leadSink.js";
import { convertLead, isConvertError, parseQueueQuery, readLeadQueue } from "../leads/leadQueue.js";

/**
 * The lead queue, office side (ADS-AGENT-BUILD-WORKFLOW.md D1; 0553/0554).
 *
 * `recruitment` view reads the queue; `recruitment` manage adds a lead by hand and converts one — the same
 * doors as every applicant act (`carrierSteps.ts`). A recruiter holds `recruitment: manage`, so converting
 * needs no roster grant: the applicant is created through roster's exported `createDriverRecord`, whose
 * route already admits `recruitment: manage` (`canWriteDriver`) for exactly this person.
 *
 * Nothing here contacts a lead (D-LS6, ruled 2026-09-25): no route sends to one, and the queue is a list a
 * person works through. The audit rows name the lead and the channel, never the person's details — the audit
 * log is readable by admins outside hiring (`notes.ts`' reason).
 */
const convertSchema = z.object({ driver_id: recordId().nullable() });

export function recruitmentLeadsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireSection("recruitment");
  const canView = requireSection("recruitment", "view");

  router.get(
    "/leads",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const q = parseQueueQuery(req.query as Record<string, unknown>);
      if ("error" in q) {
        res.status(400).json(apiError("invalid_request", q.error));
        return;
      }
      res.json(await readLeadQueue(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, q));
    }),
  );

  router.post(
    "/leads",
    requireOrg,
    canManage,
    validateBody(manualLeadSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const input = res.locals.body as ManualLead;
      const result = await ingestLead(admin, orgId, leadFromManual(input), new Date());
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.lead_added",
        entity: "recruiting_leads", entityId: result.lead_id, meta: { channel: input.channel },
      });
      res.status(201).json(result);
    }),
  );

  router.post(
    "/leads/:leadId/convert",
    requireOrg,
    canManage,
    validateBody(convertSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const leadId = String(req.params.leadId ?? "");
      const name = (await displayNameFor(admin, req.auth!.userId, orgId, req.auth!.role ?? null)) ?? req.auth!.email ?? "An office user";
      const result = await convertLead(
        admin, orgId, { userId: req.auth!.userId, name: name.trim().slice(0, 200) || "An office user" },
        leadId, (res.locals.body as z.infer<typeof convertSchema>).driver_id,
      );
      if (isConvertError(result)) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.lead_converted",
        entity: "recruiting_leads", entityId: leadId,
        meta: { driverId: result.driver_id, createdApplicant: result.created_applicant },
      });
      res.status(result.created_applicant ? 201 : 200).json(result);
    }),
  );

  return router;
}
