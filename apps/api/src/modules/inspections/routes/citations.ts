import type { RequestHandler, Router } from "express";
import {
  recordId,
  roadsideCitationActionSchema,
  roadsideCitationDispositionSchema,
  roadsideDataqsApproveSchema,
  roadsideDataqsFiledSchema,
  type CalendarDay,
} from "@silvicom/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readInspectionCitations } from "../citation/read.js";
import { actOnCitation } from "../citation/act.js";
import { recordDisposition } from "../citation/dispose.js";
import { approveDataqsRequest, recordDataqsFiled } from "../citation/dataqs.js";
import { orgToday } from "../read/orgToday.js";
import type { DbError } from "../read/inspectionsList.js";

/**
 * An inspection's tickets (IC4): `GET /:id/citations`, each ticket and where it stands; and the safety office's
 * writes on one ticket, each on the safety section's manage level (Q-IC2 (a)) —
 *
 *   POST /:id/citations                     requested from the court, or not contested (0489, R-ADJ1)
 *   POST /:id/citations/dispositions        what the court decided, read from the filed paper (0495, R-ADJ2/3)
 *   POST /:id/citations/dataqs              the DataQs request approved under 18 USC 1001 (0495, R-ADJ2)
 *   POST /:id/citations/dataqs/filed        the RDR number DataQs gave it
 *
 * Registered on the roadside router, which has already required a signed-in member of an org.
 */

type Outcome = { ok: true; id: string } | { ok: false; status: number; code: string; message: string } | { error: DbError };

/** One write: the inspection id, the body through its schema, the service, and its answer. */
function write<S extends z.ZodType>(
  schema: S,
  scope: string,
  failure: string,
  run: (admin: SupabaseClient, orgId: string, inspectionId: string, actorId: string, body: z.infer<S>, today: CalendarDay) => Promise<Outcome>,
): RequestHandler {
  return asyncHandler(async (req, res) => {
    const id = recordId().safeParse(req.params.id);
    if (!id.success) {
      res.status(404).json(apiError("not_found", "Roadside inspection not found"));
      return;
    }
    const body = schema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json(apiError("bad_request", body.error.issues[0]?.message ?? failure));
      return;
    }
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const orgId = req.auth!.orgId!;
    const out = await run(admin, orgId, id.data, req.auth!.userId, body.data, await orgToday(admin, orgId));
    if ("error" in out) {
      dbErrorResponse(res, scope, out.error, failure);
      return;
    }
    if (!out.ok) {
      res.status(out.status).json(apiError(out.code, out.message));
      return;
    }
    res.status(201).json({ ok: true, data: { id: out.id } });
  });
}

export function citationRoutes(router: Router, canView: RequestHandler): void {
  /** The inspection's tickets and where each stands: FMCSA's results, the office's acts, the court's decisions. */
  router.get(
    "/:id/citations",
    canView,
    asyncHandler(async (req, res) => {
      const id = recordId().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json(apiError("not_found", "Roadside inspection not found"));
        return;
      }
      const out = await readInspectionCitations(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, id.data);
      if ("error" in out) {
        dbErrorResponse(res, "roadside-inspections.citations", out.error, "Could not load the tickets");
        return;
      }
      res.json({ ok: true, data: out });
    }),
  );

  router.post(
    "/:id/citations",
    requireSection("safety"),
    write(roadsideCitationActionSchema, "roadside-inspections.citation-act", "Could not record it", (a, o, i, u, b) => actOnCitation(a, o, i, u, b)),
  );
  router.post(
    "/:id/citations/dispositions",
    requireSection("safety"),
    write(roadsideCitationDispositionSchema, "roadside-inspections.citation-disposition", "Could not record the court's result", recordDisposition),
  );
  router.post(
    "/:id/citations/dataqs",
    requireSection("safety"),
    write(roadsideDataqsApproveSchema, "roadside-inspections.dataqs-approve", "Could not approve the request", approveDataqsRequest),
  );
  router.post(
    "/:id/citations/dataqs/filed",
    requireSection("safety"),
    write(roadsideDataqsFiledSchema, "roadside-inspections.dataqs-filed", "Could not record the filing", recordDataqsFiled),
  );
}
