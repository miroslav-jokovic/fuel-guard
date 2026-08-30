import { Router } from "express";
import type { Request, Response } from "express";
import {
  hazmatCalcRequestSchema, type HazmatCalcRequest,
  hazmatCreateLoadRequestSchema, type HazmatCreateLoadRequest,
  hazmatUpdateLoadRequestSchema, type HazmatUpdateLoadRequest,
  hazmatListLoadsQuerySchema,
  hazmatCancelRequestSchema, type HazmatCancelRequest,
  hazmatLinkLoadRequestSchema, type HazmatLinkLoadRequest,
  hazmatRegisterDocumentRequestSchema, type HazmatRegisterDocumentRequest,
  hazmatPolicyPutRequestSchema, type HazmatPolicyPutRequest,
  hazmatReviewRequestSchema, type HazmatReviewRequest,
  hazmatClearRequestSchema, type HazmatClearRequest,
  hazmatProductsQuerySchema, type HazmatProductsResponse,
  type HazmatAnalyzeResponse,
  HAZMAT_REVIEW_ROLES,
  rolesThatCanView, rolesThatManage,
} from "@silvicom/shared";
import { loadDataset, loadReferenceText } from "@hazmat/data";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  createLoad, listLoads, getLoad, listRuns, listDocuments, updateLoad, transitionLoad, registerDocument,
  linkDispatchLoad, unlinkDispatchLoad,
  getPolicy, putPolicy, recordReview, clearLoad, type ServiceError,
} from "../hazmatLoads.js";
import { startManualAnalysis } from "../hazmatAnalysis.js";
import { startExtractionAnalysis } from "../hazmatExtraction/orchestrate.js";
import { computeCalc } from "../hazmatCalc.js";
import { searchProducts } from "../hazmatProducts.js";
import { notifyDriverOfOutcome } from "../hazmatNotify.js";
import { gatherPacketData, renderPacketPdf } from "../defensePacket.js";
import { reproduceRun } from "../reproduce.js";

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
  code === "not_editable" || code === "illegal_transition" || code === "provisional_dataset" || code === "not_clearable" ? 409 :
  code === "sign_failed" || code === "insert_failed" || code === "update_failed" || code === "upsert_failed" || code === "query_failed" || code === "delete_failed" ? 500 : 400;

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
    const result = computeCalc(res.locals.body as HazmatCalcRequest); // shared with the public M7 calculator
    if ("code" in result) { res.status(400).json(apiError(result.code, result.message)); return; }
    res.json(result);
  }));

  // ── HMT product lookup (manual pickers — H5 calculator + load workspace) ─────
  router.get("/products", canView, asyncHandler(async (req: Request, res: Response) => {
    const parsed = hazmatProductsQuerySchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json(apiError("invalid_query", parsed.error.issues[0]?.message ?? "Invalid query")); return; }
    const dataset = loadDataset();
    const products = searchProducts(dataset.entries, { q: parsed.data.q, limit: parsed.data.limit, marinePollutants: dataset.marinePollutants });
    const response: HazmatProductsResponse = { datasetVersion: dataset.version, products };
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

  // ── analysis runs for a load (immutable history — powers the H5 verdict view) ─
  router.get("/loads/:id/runs", canView, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await listRuns(admin, orgOf(req), param(req, "id"));
    if (isServiceError(result)) { fail(res, result); return; }
    res.json({ runs: result.rows });
  }));

  // ── pending-review count (H7 nav badge) ──────────────────────────────────────
  router.get("/review-count", canView, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const { count } = await admin.from("hazmat_loads").select("id", { count: "exact", head: true })
      .eq("org_id", orgOf(req)).eq("status", "needs_review");
    res.json({ count: count ?? 0 });
  }));

  // ── documents for a load (signed download urls — H7 review evidence) ─────────
  router.get("/loads/:id/documents", canView, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await listDocuments(admin, orgOf(req), param(req, "id"));
    if (isServiceError(result)) { fail(res, result); return; }
    res.json({ documents: result.rows });
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

  // ── the dispatch link (H-C1) ─────────────────────────────────────────────────
  // What makes hazmat a property of a load instead of a parallel product. `canManage` on the hazmat
  // section, not the fleet section: this is a statement about the hazmat record, and the dispatch
  // load is only named by it.
  router.post("/loads/:id/link", canManage, validateBody(hazmatLinkLoadRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = res.locals.body as HazmatLinkLoadRequest;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await linkDispatchLoad(admin, orgOf(req), param(req, "id"), body.loadId);
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, {
      orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_linked",
      entity: "hazmat_loads", entityId: param(req, "id"),
      meta: { loadId: body.loadId, unlinked: result.unlinked },
    });
    res.json(result);
  }));

  router.delete("/loads/:id/link", canManage, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await unlinkDispatchLoad(admin, orgOf(req), param(req, "id"));
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, {
      orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_unlinked",
      entity: "hazmat_loads", entityId: param(req, "id"),
    });
    res.json({ ok: true });
  }));

  // ── analysis (in-process — 202 + runId, executes async) ──────────────────────
  // Dispatches to the PHOTO path (H6 extraction) when the load carries a BOL document and the extraction
  // kill-switch is on; otherwise the MANUAL path (H4). Either way the outcome table + fail-closed rules are
  // identical — extraction just fills the fields a human would otherwise type.
  router.post("/loads/:id/analyze", canManage, asyncHandler(async (req: Request, res: Response) => {
    const env = getAppLocals(req).env;
    const admin = getSupabaseAdmin(env);
    const loadId = param(req, "id");
    const { data: load } = await admin.from("hazmat_loads").select("status").eq("org_id", orgOf(req)).eq("id", loadId).maybeSingle();
    if (!load) { res.status(404).json(apiError("not_found", "Load not found.")); return; }
    const status = (load as { status: string }).status;
    if (status !== "submitted") {
      res.status(409).json(apiError("illegal_transition", `Analysis runs from a submitted load; this load is "${status}".`));
      return;
    }
    const { count } = await admin.from("hazmat_documents").select("id", { count: "exact", head: true })
      .eq("org_id", orgOf(req)).eq("load_id", loadId).eq("kind", "bol");
    const { data: pol } = await admin.from("hazmat_policies").select("policy").eq("org_id", orgOf(req)).maybeSingle();
    const extractionEnabled = ((pol as { policy?: { extractionEnabled?: boolean } } | null)?.policy?.extractionEnabled) !== false;
    const usePhoto = (count ?? 0) > 0 && extractionEnabled;
    const { runId } = usePhoto ? startExtractionAnalysis(admin, orgOf(req), loadId, env) : startManualAnalysis(admin, orgOf(req), loadId, env);
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_analyzed", entity: "hazmat_loads", entityId: loadId, meta: { runId, path: usePhoto ? "extraction" : "manual" } });
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
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action, entity: "hazmat_loads", entityId: param(req, "id"), meta: { action: body.action, runId: body.runId, reason: body.newValue ?? null, fieldPath: body.fieldPath ?? null } });
    if (body.action === "rejected") {
      const { data: ld } = await admin.from("hazmat_loads").select("driver_id").eq("org_id", orgOf(req)).eq("id", param(req, "id")).maybeSingle();
      await notifyDriverOfOutcome(admin, orgOf(req), param(req, "id"), (ld as { driver_id: string | null } | null)?.driver_id ?? null, "rejected");
    }
    res.json({ ok: true, ...(result.to ? { status: result.to } : {}) });
  }));

  router.post("/loads/:id/clear", canReview, validateBody(hazmatClearRequestSchema), asyncHandler(async (req: Request, res: Response) => {
    const body = res.locals.body as HazmatClearRequest;
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const dataset = loadDataset();
    const result = await clearLoad(admin, orgOf(req), userOf(req), param(req, "id"), body.runId, {
      overrideReason: body.overrideReason, spAcknowledged: body.spAcknowledged, datasetProvisional: dataset.provisional,
    });
    if (isServiceError(result)) { fail(res, result); return; }
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.load_cleared", entity: "hazmat_loads", entityId: param(req, "id"), meta: { runId: body.runId, overrideReason: body.overrideReason, datasetVersion: dataset.version } }); // D4: the server-composed attestation is stored on the immutable review row, not here
    const { data: ld } = await admin.from("hazmat_loads").select("driver_id").eq("org_id", orgOf(req)).eq("id", param(req, "id")).maybeSingle();
    await notifyDriverOfOutcome(admin, orgOf(req), param(req, "id"), (ld as { driver_id: string | null } | null)?.driver_id ?? null, "cleared");
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

  // ── cargo-tank profiles: REMOVED (H-C2/D-H3). Capacity + compartments live on the trailers/
  // vehicles rows, written through the fleet surface under the fleet RLS; the analysis paths read
  // them via readEquipmentKind. The /profiles CRUD, its service and its page are gone.

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

  // ── M12.1: Roadside Defense Packet — one tap, self-contained PDF ─────────────
  router.get("/loads/:id/packet", canView, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const runId = typeof req.query.runId === "string" ? req.query.runId : null;
    const data = await gatherPacketData(admin, orgOf(req), param(req, "id"), runId);
    if ("code" in data) { fail(res, data as ServiceError); return; }
    const pdf = await renderPacketPdf(data);
    await writeAudit(admin, { orgId: orgOf(req), actorId: userOf(req), action: "hazmat.packet_generated", entity: "hazmat_loads", entityId: param(req, "id"), meta: { runId: data.run.id, bytes: pdf.length } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="hazmat-packet-${param(req, "id").slice(0, 8)}.pdf"`);
    res.send(pdf);
  }));

  // ── M12.2: reproduce a historical run under its recorded dataset + diff vs current ──────────
  router.get("/loads/:id/runs/:runId/reproduce", canView, asyncHandler(async (req: Request, res: Response) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const result = await reproduceRun(admin, orgOf(req), param(req, "id"), param(req, "runId"));
    if ("code" in result) { fail(res, result as ServiceError); return; }
    res.json(result);
  }));

  return router;
}
