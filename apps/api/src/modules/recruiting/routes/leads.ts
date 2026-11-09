import { Router, type Request } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { leadContactSchema, leadFromManual, manualLeadSchema, recordId, type LeadContactInput, type ManualLead } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { displayNameFor } from "../../../lib/memberLabels.js";
import { ingestLead } from "../leads/leadSink.js";
import { logLeadContact, readLeadContacts } from "../leads/leadContacts.js";
import { liftDoNotContact, markDoNotContact, type DoNotContactOutcome } from "../leads/doNotContact.js";
import { convertLead, isConvertError, parseQueueQuery, readLead, readLeadQueue } from "../leads/leadQueue.js";

/**
 * The lead queue, office side (ADS-AGENT-BUILD-WORKFLOW.md D1; 0553/0554).
 *
 * `recruitment` view reads the queue; `recruitment` manage adds a lead by hand and converts one — the same
 * doors as every applicant act (`carrierSteps.ts`). A recruiter holds `recruitment: manage`, so converting
 * needs no roster grant: the applicant is created through roster's exported `createDriverRecord`, whose
 * route already admits `recruitment: manage` (`canWriteDriver`) for exactly this person.
 *
 * Nothing here contacts a lead (D-LS6, ruled 2026-09-25): no route sends to one, and the queue is a list a
 * person works through. `contacts` records a call a person already made, and reads back who already made one
 * (`leads/leadContacts.ts`).
 * `do-not-contact` records that a person asked not to be contacted, and lifts the
 * office's own record of it (`leads/doNotContact.ts`). The audit rows name the lead and the channel, never the person's details — the audit
 * log is readable by admins outside hiring (`notes.ts`' reason).
 */
const convertSchema = z.object({ driver_id: recordId().nullable() });

/** The name a person's act is recorded under; both evidence rows that carry one need it not blank (0553). */
async function actorName(req: Request, admin: SupabaseClient, orgId: string): Promise<string> {
  const name = (await displayNameFor(admin, req.auth!.userId, orgId, req.auth!.role ?? null)) ?? req.auth!.email ?? "An office user";
  return name.trim().slice(0, 200) || "An office user";
}

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
      res.json(await readLeadQueue(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, { ...q, assigned: q.mine ? req.auth!.userId : null }));
    }),
  );

  // One lead by id, for a notification's link and the drawer (E4b). A purged lead answers as its tombstone.
  router.get(
    "/leads/:leadId",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const leadId = String(req.params.leadId ?? "");
      const lead = recordId().safeParse(leadId).success
        ? await readLead(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, leadId)
        : null;
      if (!lead) {
        res.status(404).json(apiError("not_found", "Lead not found"));
        return;
      }
      res.json(lead);
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
      const result = await convertLead(
        admin, orgId, { userId: req.auth!.userId, name: await actorName(req, admin, orgId) },
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

  // Who already reached this lead (E4a), for anyone who can view the queue it sits in.
  router.get(
    "/leads/:leadId/contacts",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const leadId = String(req.params.leadId ?? "");
      if (!recordId().safeParse(leadId).success) {
        res.status(404).json(apiError("not_found", "Lead not found"));
        return;
      }
      const out = await readLeadContacts(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, leadId);
      if (out.kind === "refused") {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      res.json({ contacts: out.contacts });
    }),
  );

  // A call, text or email a person made (D2a). Audited by lead id and the kind of contact, never the note:
  // it may name the person, and the audit log is read outside hiring.
  router.post(
    "/leads/:leadId/contacts",
    requireOrg,
    canManage,
    validateBody(leadContactSchema),
    asyncHandler(async (req, res) => {
      const leadId = String(req.params.leadId ?? "");
      if (!recordId().safeParse(leadId).success) {
        res.status(404).json(apiError("not_found", "Lead not found"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const input = res.locals.body as LeadContactInput;
      const out = await logLeadContact(admin, orgId, { userId: req.auth!.userId, name: await actorName(req, admin, orgId) }, leadId, input, new Date());
      if (out.kind === "refused") {
        res.status(out.status).json(apiError(out.code, out.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.lead_contact_logged",
        entity: "recruiting_leads", entityId: leadId,
        meta: { contactId: out.contact_id, direction: input.direction, method: input.method, outcome: input.outcome, status: out.status },
      });
      res.status(201).json({ contact_id: out.contact_id, status: out.status });
    }),
  );

  // A person asked not to be contacted (lead-path audit H3). POST holds the number; DELETE lifts the
  // office's hold (never a STOP the person texted). Audited by lead id, never by number.
  for (const [method, act] of [["post", "held"], ["delete", "lifted"]] as const) {
    router[method](
      "/leads/:leadId/do-not-contact",
      requireOrg,
      canManage,
      asyncHandler(async (req, res) => {
        const leadId = String(req.params.leadId ?? "");
        if (!recordId().safeParse(leadId).success) {
          res.status(404).json(apiError("not_found", "Lead not found"));
          return;
        }
        const admin = getSupabaseAdmin(getAppLocals(req).env);
        const orgId = req.auth!.orgId!;
        const out: DoNotContactOutcome = act === "held" ? await markDoNotContact(admin, orgId, leadId) : await liftDoNotContact(admin, orgId, leadId, new Date());
        if (out.kind === "refused") {
          res.status(out.status).json(apiError(out.code, out.message));
          return;
        }
        await writeAudit(admin, {
          orgId, actorId: req.auth!.userId, action: `recruitment.lead_do_not_contact_${act}`,
          entity: "recruiting_leads", entityId: leadId,
          meta: out.kind === "held" ? { newly: out.newly, applicantId: out.applicant_id } : { lifted: out.lifted, stopRemains: out.stop_remains },
        });
        res.json(out);
      }),
    );
  }

  return router;
}
