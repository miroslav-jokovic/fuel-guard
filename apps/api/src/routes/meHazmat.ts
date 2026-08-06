import { Router, type Request, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hazmatCreateLoadRequestSchema,
  hazmatRegisterDocumentRequestSchema,
  type HazmatCreateLoadRequest,
  type HazmatRegisterDocumentRequest,
} from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { requireModule } from "../middleware/requireModule.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { resolveDriverId } from "../services/dutySessions.js";
import {
  createLoad,
  registerDocument,
  getLoad,
  listRuns,
  transitionLoad,
  type ServiceError,
} from "../services/hazmatLoads.js";
import { startExtractionAnalysis } from "../services/hazmatExtraction/orchestrate.js";
import { startManualAnalysis } from "../services/hazmatAnalysis.js";

const isServiceError = (v: unknown): v is ServiceError =>
  typeof v === "object" && v !== null && "code" in v && "error" in v;

const httpFor = (code: string): number =>
  code === "not_found" ? 404 :
  code === "not_editable" || code === "illegal_transition" || code === "too_many_pages" ? 409 :
  code === "sign_failed" || code === "insert_failed" || code === "update_failed" || code === "query_failed" ? 500 :
  400;

/**
 * Driver-facing HazmatGuard capture surface (M6). A driver CAPTURES and SUBMITS a BOL; a driver never
 * clears or attests (that stays with review roles on `/api/hazmat/*` — HazmatGuard PLAN line 381).
 *
 * Identity is resolved from the verified JWT; the driver may only touch loads THEY created. Ownership is
 * enforced here in code (`created_by === caller`) because this router uses the service-role client;
 * 0092's `hazmat_loads_driver_scope` / `hazmat_documents_driver_insert` RLS is the same rule at the other
 * door (belt-and-braces). Module entitlement is gated exactly like the manager surface.
 */
export function meHazmatRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("hazmatguard"), requireRole("driver"));

  const orgOf = (req: Request): string => req.auth!.orgId!;
  const userOf = (req: Request): string => req.auth!.userId;
  const param = (req: Request, name: string): string => {
    const v = req.params[name];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };
  const fail = (res: Response, e: ServiceError): void => {
    res.status(httpFor(e.code)).json(apiError(e.code, e.error));
  };

  /** The load exists in this org AND was created by this driver — else null (treated as not-found). */
  const ownLoad = async (
    admin: SupabaseClient,
    orgId: string,
    userId: string,
    loadId: string,
  ): Promise<{ driverId: string | null } | null> => {
    const { data } = await admin
      .from("hazmat_loads")
      .select("id, created_by, driver_id")
      .eq("org_id", orgId)
      .eq("id", loadId)
      .maybeSingle();
    if (!data) return null;
    const row = data as { created_by: string | null; driver_id: string | null };
    if (row.created_by !== userId) return null;
    return { driverId: row.driver_id };
  };

  // POST /api/me/hazmat/loads — open a capture (minimal draft; driver_id forced to the caller).
  router.post(
    "/loads",
    validateBody(hazmatCreateLoadRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const body = res.locals.body as HazmatCreateLoadRequest;
      const driverId = await resolveDriverId(admin, orgOf(req), userOf(req));
      if (!driverId) {
        res.status(404).json(apiError("no_driver_record", "No driver record is linked to this account"));
        return;
      }
      // A driver only ever creates their OWN load — force driver_id to the resolved roster id.
      const result = await createLoad(admin, orgOf(req), userOf(req), { ...body, driverId });
      if (isServiceError(result)) {
        fail(res, result);
        return;
      }
      await writeAudit(admin, {
        orgId: orgOf(req),
        actorId: userOf(req),
        action: "hazmat.load_created",
        entity: "hazmat_loads",
        entityId: result.id,
        meta: { via: "driver_capture" },
      });
      res.status(201).json({ id: result.id });
    }),
  );

  // POST /api/me/hazmat/loads/:id/documents — register a captured page; returns a signed upload URL.
  router.post(
    "/loads/:id/documents",
    validateBody(hazmatRegisterDocumentRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const own = await ownLoad(admin, orgOf(req), userOf(req), param(req, "id"));
      if (!own) {
        res.status(404).json(apiError("not_found", "Load not found."));
        return;
      }
      const body = res.locals.body as HazmatRegisterDocumentRequest;
      const result = await registerDocument(admin, orgOf(req), userOf(req), param(req, "id"), body);
      if (isServiceError(result)) {
        fail(res, result);
        return;
      }
      res.status(201).json(result);
    }),
  );

  // POST /api/me/hazmat/loads/:id/submit — submit + analyze in one driver action; returns runId (202).
  router.post(
    "/loads/:id/submit",
    asyncHandler(async (req: Request, res: Response) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const loadId = param(req, "id");
      const own = await ownLoad(admin, orgOf(req), userOf(req), loadId);
      if (!own) {
        res.status(404).json(apiError("not_found", "Load not found."));
        return;
      }
      const transition = await transitionLoad(admin, orgOf(req), loadId, "submit");
      if (isServiceError(transition)) {
        // Idempotent replay: a load already submitted/analyzed on a prior (re-drained) call must not
        // 409 the outbox into a dead-letter — return the latest run instead (no re-analyze).
        if (transition.code === "illegal_transition") {
          const runs = await listRuns(admin, orgOf(req), loadId);
          const latest = !isServiceError(runs) && runs.rows[0] ? (runs.rows[0] as { id: string }).id : null;
          res.status(200).json({ runId: latest, idempotent: true });
          return;
        }
        fail(res, transition);
        return;
      }
      // Photo (H6 extraction) when a BOL is attached + extraction is enabled; else manual (H4). Same
      // outcome table + fail-closed rules either way — extraction just fills what a human would type.
      const { count } = await admin
        .from("hazmat_documents")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgOf(req))
        .eq("load_id", loadId)
        .eq("kind", "bol");
      const { data: pol } = await admin.from("hazmat_policies").select("policy").eq("org_id", orgOf(req)).maybeSingle();
      const extractionEnabled =
        ((pol as { policy?: { extractionEnabled?: boolean } } | null)?.policy?.extractionEnabled) !== false;
      const usePhoto = (count ?? 0) > 0 && extractionEnabled;
      const { runId } = usePhoto
        ? startExtractionAnalysis(admin, orgOf(req), loadId, env)
        : startManualAnalysis(admin, orgOf(req), loadId, env);
      await writeAudit(admin, {
        orgId: orgOf(req),
        actorId: userOf(req),
        action: "hazmat.load_submitted",
        entity: "hazmat_loads",
        entityId: loadId,
        meta: { via: "driver_capture", runId, path: usePhoto ? "extraction" : "manual" },
      });
      res.status(202).json({ runId });
    }),
  );

  // GET /api/me/hazmat/loads/:id — the driver's own load (verdict header).
  router.get(
    "/loads/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const own = await ownLoad(admin, orgOf(req), userOf(req), param(req, "id"));
      if (!own) {
        res.status(404).json(apiError("not_found", "Load not found."));
        return;
      }
      const load = await getLoad(admin, orgOf(req), param(req, "id"));
      if (!load) {
        res.status(404).json(apiError("not_found", "Load not found."));
        return;
      }
      res.json({ load });
    }),
  );

  // GET /api/me/hazmat/loads/:id/runs — the immutable analysis history = the verdict (reasons + citations).
  router.get(
    "/loads/:id/runs",
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const own = await ownLoad(admin, orgOf(req), userOf(req), param(req, "id"));
      if (!own) {
        res.status(404).json(apiError("not_found", "Load not found."));
        return;
      }
      const result = await listRuns(admin, orgOf(req), param(req, "id"));
      if (isServiceError(result)) {
        fail(res, result);
        return;
      }
      res.json(result);
    }),
  );

  return router;
}
