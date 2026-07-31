import { Router } from "express";
import type { Request, Response } from "express";
import {
  hazmatCalcRequestSchema, type HazmatCalcRequest, type HazmatCalcResponse,
  hazmatCreateLoadRequestSchema, type HazmatCreateLoadRequest,
  hazmatUpdateLoadRequestSchema, type HazmatUpdateLoadRequest,
  hazmatListLoadsQuerySchema,
  hazmatCancelRequestSchema, type HazmatCancelRequest,
  hazmatRegisterDocumentRequestSchema, type HazmatRegisterDocumentRequest,
  hazmatPolicyPutRequestSchema, type HazmatPolicyPutRequest,
  hazmatReviewRequestSchema, type HazmatReviewRequest,
  hazmatClearRequestSchema, type HazmatClearRequest,
  type HazmatAnalyzeResponse,
  HAZMAT_REVIEW_ROLES,
  rolesThatCanView, rolesThatManage,
} from "@fuelguard/shared";
import { evaluateLoad, type LoadInput } from "@hazmat/engine";
import { loadDataset, loadReferenceText, LATEST_DATASET_VERSION, listDatasetVersions } from "@hazmat/data";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { requireModule } from "../../middleware/requireModule.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import {
  createLoad, listLoads, getLoad, updateLoad, transitionLoad, registerDocument,
  getPolicy, putPolicy, recordReview, clearLoad, type ServiceError,
} from "../../services/hazmatLoads.js";
import { startManualAnalysis } from "../../services/hazmatAnalysis.js";

/**
 * HazmatGuard API (plan H4). Mounted at `/api/hazmat/*` behind auth + the `hazmatguard` module
 * entitlement. Role gating uses the `hazmat` section matrix (packages/shared/src/auth.ts); RLS (0092)
 * is the direct-PostgREST backstop. The load state machine is enforced via `transitionLoad`
 * (hazmatLifecycle). Analysis runs in-process (H4-4 orchestrator); clearing/review is restricted to
 * HAZMAT_REVIEW_ROLES (separation of duties: dispatchers create loads, they do not clear them).
 */
const isServiceError = (v: unknown): v is ServiceError =>
  typeof v === "object" && v !== null && "code" in v && "error" in v;
const httpFor = (code: string): number =>
  code === "not_found" ? 404 :
  code === "not_editable" || code === "illegal_transition" || code === "provisional_dataset" ? 409 :
  code === "sign_failed" || code === "insert_failed" || code === "update_failed" || code === "upsert_failed" ? 500 : 400;

export function hazmatRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("hazmatguard"));

  const canView = requireRole(...rolesThatCanView("hazmat"));
  const canManage = requireRole(...rolesThatManage("hazmat"));
  const canReview = requireRole(...HAZMAT_REVIEW_ROLES);
  const orgOf = (req: Request): string => req.auth!.orgId!;
  const userOf = (req: Request): string => req.auth!.userId;
  const param = (req: Request, name: string): string => {
    const v = req.params[name];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };
  const fail = (res: Response, e: ServiceError): void => { res.status(httpFor(e.code)).json(apiError(e.code, e.error)); };

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, module: "hazmatguard" });
  });

  // ── stateless calculator (also the H12 licensed-API surface) ────────────────
  router.post("/calc", validateBody(hazmatCalcRequestSchema), asyncHandler(async (_req: Request, res: Response) => {
    const body = res.locals.body as HazmatCalcRequest;
    const version = body.datasetVersion ?? LATEST_DATASET_VERSION;
    if (body.datasetVersion && !listDatasetVersions().includes(version)) {
      res.status(400).json(apiError("unknown_dataset", `Unknown hazmat dataset version "${version}".`));
      return;
    }
    const dataset = loadDataset(version);
    const input = { evaluatedAt: new Date().toISOString(), ...(body.load as Record<string, unknown>), dataset } as unknown as LoadInput;
    let verdict;
    try {
      verdict = evaluateLoad(input);
    } catch (e) {
      res.status(400).json(apiError("invalid_load", e instanceof Error ? e.message : "Invalid load input"));
      return;
    }
    const response: HazmatCalcResponse = {
      engineVersion: verdict.engineVersion, datasetVersion: dataset.version,
      datasetProvisional: dataset.provisional, verdict,
    };
    res.json(response);
  }));

  // ── loads CRUD ───────────────────────────────────────────────────────────────
  router.post("/loads", canManage, validateBody(hazmatCreateLoadRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = res.locals.body as HazmatCreateLoadRequest;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await createLoad(admin, orgOf(req), userOf(req), body);
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_created", entity: "hazmat_loads", entityId: result.id });
    res.status(201).json({ id: result.id });
  }));

  router.get("/loads", canView, asyncHandler(async (req: Request, res: Response) => {
    const parsed = hazmatListLoadsQuerySchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json(apiError("invalid_query", parsed.error.issues[0]?.message ?? "Invalid query")); return; }
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const { rows, nextCursor } = await listLoads(admin, orgOf(req), parsed.data);
    res.json({ loads: rows, nextCursor });
  }));

  router.get("/loads/:id", canView, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const load = await getLoad(admin, orgOf(req), param(req, "id"));
    if (!load) { res.status(404).json(apiError("not_found", "Load not found.")); return; }
    res.json(load);
  }));

  router.patch("/loads/:id", canManage, validateBody(hazmatUpdateLoadRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = res.locals.body as HazmatUpdateLoadRequest;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await updateLoad(admin, orgOf(req), param(req, "id"), body);
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_updated", entity: "hazmat_loads", entityId: param(req, "id") });
    res.json({ ok: true });
  }));

  router.post("/loads/:id/submit", canManage, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await transitionLoad(admin, orgOf(req), param(req, "id"), "submit");
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_submitted", entity: "hazmat_loads", entityId: param(req, "id") });
    res.json({ status: result.to });
  }));

  router.post("/loads/:id/cancel", canManage, validateBody(hazmatCancelRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = res.locals.body as HazmatCancelRequest;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await transitionLoad(admin, orgOf(req), param(req, "id"), "cancel");
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_cancelled", entity: "hazmat_loads", entityId: param(req, "id"), meta: { reason: body.reason } });
    res.json({ status: result.to });
  }));

  // ── analysis (in-process manual path — 202 + runId, executes async) ──────────
  router.post("/loads/:id/analyze", canManage, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const loadId = param(req, "id");
    const { data: load } = await admin.from("hazmat_loads").select("status").eq("org_id", orgOf(req)).eq("id", loadId).maybeSingle();
    if (!load) { res.status(404).json(apiError("not_found", "Load not found.")); return; }
    const status = (load as { status: string }).status;
    if (status !== "submitted") {
      res.status(409).json(apiError("illegal_transition", `Analysis runs from a submitted load; this load is "${status}".`));
      return;
    }
    const { runId } = startManualAnalysis(admin, orgOf(req), loadId);
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_analyzed", entity: "hazmat_loads", entityId: loadId, meta: { runId } });
    const response: HazmatAnalyzeResponse = { runId };
    res.status(202).json(response);
  }));

  // ── review + clear (HAZMAT_REVIEW_ROLES — dispatchers create loads, they do NOT clear them) ──
  router.post("/loads/:id/review", canReview, validateBody(hazmatReviewRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = res.locals.body as HazmatReviewRequest;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await recordReview(admin, orgOf(req), userOf(req), param(req, "id"), body);
    if (isServiceError(result)) { fail(res, result); return; }
    const action = body.action === "rejected" ? "hazmat.load_rejected" : body.action === "override" ? "hazmat.load_overridden" : "hazmat.load_reviewed";
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action, entity: "hazmat_loads", entityId: param(req, "id"), meta: { action: body.action, runId: body.runId } });
    res.json({ ok: true, ...(result.to ? { status: result.to } : {}) });
  }));

  router.post("/loads/:id/clear", canReview, validateBody(hazmatClearRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = res.locals.body as HazmatClearRequest;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const dataset = loadDataset();
    const result = await clearLoad(admin, orgOf(req), userOf(req), param(req, "id"), body.runId, body.attestation, dataset.provisional);
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_cleared", entity: "hazmat_loads", entityId: param(req, "id"), meta: { runId: body.runId, attestation: body.attestation, datasetVersion: dataset.version } });
    res.json({ status: result.to });
  }));

  // ── document registration → signed upload URL ────────────────────────────────
  router.post("/loads/:id/documents", canManage, validateBody(hazmatRegisterDocumentRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = res.locals.body as HazmatRegisterDocumentRequest;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await registerDocument(admin, orgOf(req), userOf(req), param(req, "id"), body);
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.document_registered", entity: "hazmat_documents", entityId: result.documentId });
    res.status(201).json(result);
  }));

  // ── policy ───────────────────────────────────────────────────────────────────
  router.get("/policy", canView, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    res.json((await getPolicy(admin, orgOf(req))) ?? { policy: null });
  }));

  router.put("/policy", requireRole("admin"), validateBody(hazmatPolicyPutRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = res.locals.body as HazmatPolicyPutRequest;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await putPolicy(admin, orgOf(req), userOf(req), body.policy);
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.policy_updated", entity: "hazmat_policies", entityId: orgOf(req) });
    res.json({ ok: true });
  }));

  // ── CFR reference text (D12) — display + audit only; NEVER fed to the engine ─────────────────
  router.get("/reference/:section", canView, asyncHandler(async (req: Request, res: Response) => {
    const store = loadReferenceText();
    const sectionNumber = param(req, "section");
    const section = store.sections[sectionNumber];
    if (!section) {
      res.status(404).json(apiError("not_found", `No reference text for section "${sectionNumber}".`));
      return;
    }
    res.json({ storeVersion: store.version, provisional: store.provisional, source: store.source, section });
  }));

  return router;
}
