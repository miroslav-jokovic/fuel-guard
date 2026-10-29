import { Router } from "express";
import { z } from "zod";
import {
  equipmentPurchaseInputSchema,
  purchaseDocumentRegisterSchema,
  recordId,
  type EquipmentPurchaseInput,
  type PurchaseDocumentRegisterRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { findPurchaseOrders } from "../../fleetpal/index.js";
import { getPurchase, listPurchases, recordPurchase } from "../inventory/purchases.js";
import {
  listPurchaseDocuments,
  registerPurchaseDocument,
  signPurchaseDocumentDownload,
} from "../inventory/purchaseDocuments.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { isServiceError, type ServiceError } from "../inventory/types.js";

/**
 * `/api/maintenance/inventory/purchases` — equipment bills (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md
 * §7a.4, M10b; 0530). The Invoices tab on Equipment, Add invoice, the bill's paper, and the FleetPal
 * purchase order a FleetPal-bought strap links to instead of being retyped.
 *
 * The section is the shop's, as for every inventory route: `maintenance` view reads, manage writes.
 * A bill is money, but it is the money for the shop's own equipment — the same people who add a tablet
 * add the bill it came on — and the finance section never sees it (no dollar here reaches
 * `financial_entries`; McLeod matching waits on accounting, Q-MX10).
 *
 * **201 on a replay too.** `record_equipment_purchase` returns the row it already wrote for a repeated
 * id (D-INV27), so a save pressed twice gets the same bill and the same answer — `inventoryAssets.ts`
 * says the same of a movement. The audit line is written once per call, and a replay's says so.
 */

const listSchema = z.object({
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const orderSearchSchema = z.object({ search: z.string().max(120).optional() });

export function inventoryPurchasesRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireSection("maintenance", "view");
  const canManage = requireSection("maintenance");
  const fail = (res: import("express").Response, e: ServiceError) =>
    res.status(statusForServiceError(e.code)).json(apiError(e.code, e.error));
  // A path id that is not a uuid is a bill nobody has, not a database error: Postgres would answer
  // it 22P02 and the route 500. Checked once for every route below that names one.
  for (const name of ["id", "documentId"]) {
    router.param(name, (_req, res, next, value) => {
      if (recordId().safeParse(value).success) return next();
      res.status(404).json(apiError("not_found", "That bill is not on file."));
    });
  }

  router.get(
    "/",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const result = await listPurchases(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) return void fail(res, result);
      res.json({ ok: true, ...result });
    }),
  );

  /** FleetPal's purchase orders a bill can link — before `/:id`, which would otherwise swallow it. */
  router.get(
    "/fleetpal-orders",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const parsed = orderSearchSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the search."));
        return;
      }
      const orders = await findPurchaseOrders(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, parsed.data.search);
      if ("error" in orders) {
        res.status(500).json(apiError("db_error", "Could not load FleetPal's purchase orders."));
        return;
      }
      res.json({ ok: true, orders });
    }),
  );

  router.get(
    "/:id",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const purchase = await getPurchase(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, String(req.params.id));
      if (isServiceError(purchase)) return void fail(res, purchase);
      if (!purchase) {
        res.status(404).json(apiError("not_found", "That bill is not on file."));
        return;
      }
      res.json({ ok: true, purchase });
    }),
  );

  router.post(
    "/",
    requireOrg,
    canManage,
    validateBody(equipmentPurchaseInputSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const input = res.locals.body as EquipmentPurchaseInput;
      const result = await recordPurchase(admin, orgId, req.auth!.userId, input);
      if (isServiceError(result)) return void fail(res, result);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: input.supersedes ? "maintenance.purchase_corrected" : "maintenance.purchase_recorded",
        entity: "equipment_purchases",
        entityId: result.id,
        // The vendor and number, not the UUID: what somebody reading this log searches for.
        meta: { vendor: result.vendor, invoiceNumber: result.invoiceNumber, total: result.total, items: result.itemCount, supersedes: input.supersedes ?? null },
      });
      res.status(201).json({ ok: true, purchase: result });
    }),
  );

  router.get(
    "/:id/documents",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const out = await listPurchaseDocuments(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, String(req.params.id ?? ""));
      if (isServiceError(out)) return void fail(res, out);
      res.json({ ok: true, data: out });
    }),
  );

  router.post(
    "/:id/documents",
    requireOrg,
    canManage,
    validateBody(purchaseDocumentRegisterSchema),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const out = await registerPurchaseDocument(
        getSupabaseAdmin(env),
        env,
        req.auth!.orgId!,
        String(req.params.id ?? ""),
        req.auth!.userId,
        res.locals.body as PurchaseDocumentRegisterRequest,
      );
      if (isServiceError(out)) return void fail(res, out);
      res.status(201).json({ ok: true, data: out });
    }),
  );

  router.get(
    "/:id/documents/:documentId/download",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const out = await signPurchaseDocumentDownload(
        getSupabaseAdmin(getAppLocals(req).env),
        req.auth!.orgId!,
        String(req.params.id ?? ""),
        String(req.params.documentId ?? ""),
        req.auth!.userId,
      );
      if (isServiceError(out)) return void fail(res, out);
      res.json({ ok: true, ...out });
    }),
  );

  return router;
}
