import { Router } from "express";
import { isRecordId } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { fetchInvoiceFile, listWorkOrderFiles, readWorkOrderDetail, readWorkOrderInvoiceIds } from "../../fleetpal/index.js";

/**
 * A work order's vendor paper, and the door the roadside inspection page opens the same drawer by
 * (FLEETPAL-INTEGRATION-PLAN F16, D-FP28). All three sit behind `maintenance: view` — the level the drawer's
 * own `GET /work-orders/:id` already asks — so the inspection page shows its "Open work order" only to a
 * person this gate admits, by asking the same matrix (`session.canView("maintenance")`).
 *
 * The bytes pass THROUGH this API rather than the browser being handed FleetPal's signed link: that link
 * opens the file to anybody holding it for an hour, and it would leave our audit-able, org-scoped door.
 */

/** FleetPal ids are short opaque tokens (`iyzciPyKi9ZW`); anything else is refused before a query. */
const FLEETPAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function workOrderFilesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /** The drawer by FleetPal's id — all a roadside repair's candidate holds (they are snapshots, 0606). */
  router.get(
    "/fleetpal-work-orders/:fleetpalId",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const fleetpalId = String(req.params.fleetpalId);
      if (!FLEETPAL_ID.test(fleetpalId)) {
        res.status(400).json(apiError("bad_request", "That is not a FleetPal work order id."));
        return;
      }
      const data = await readWorkOrderDetail(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, { fleetpalId });
      if (!data) {
        res.status(404).json(apiError("not_found", "That work order is not in FleetPal's record for this fleet."));
        return;
      }
      res.json({ ok: true, data });
    }),
  );

  /** Which files each invoice carries, asked of FleetPal now. Links are never sent. */
  router.get(
    "/work-orders/:id/files",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      if (!isRecordId(id)) {
        res.status(400).json(apiError("bad_request", "That is not a work order id."));
        return;
      }
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const invoiceIds = await readWorkOrderInvoiceIds(admin, orgId, id);
      if (invoiceIds === null) {
        res.status(404).json(apiError("not_found", "That work order is not in FleetPal's record for this fleet."));
        return;
      }
      res.json({ ok: true, data: await listWorkOrderFiles(admin, env, orgId, invoiceIds) });
    }),
  );

  /** One file's bytes. The invoice must be on THIS org's work order, checked in our tables first. */
  router.get(
    "/work-orders/:id/files/:invoiceId/:index",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const invoiceId = String(req.params.invoiceId);
      const index = Number(req.params.index);
      if (!isRecordId(id) || !FLEETPAL_ID.test(invoiceId) || !Number.isInteger(index) || index < 0) {
        res.status(400).json(apiError("bad_request", "That is not a file on a work order."));
        return;
      }
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const invoiceIds = await readWorkOrderInvoiceIds(admin, orgId, id);
      if (!invoiceIds?.includes(invoiceId)) {
        res.status(404).json(apiError("not_found", "That invoice is not on this work order."));
        return;
      }
      const file = await fetchInvoiceFile(admin, env, orgId, invoiceId, index);
      switch (file.kind) {
        case "file":
          res.setHeader("Content-Type", file.contentType);
          res.setHeader("Content-Disposition", `inline; filename="${downloadName(file.filename, file.contentType)}"`);
          res.setHeader("Cache-Control", "private, no-store");
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.send(file.bytes);
          return;
        case "missing":
          res.status(404).json(apiError("not_found", "FleetPal no longer has that file on this invoice."));
          return;
        case "not_connected":
          res.status(503).json(apiError("fleetpal_not_connected", "FleetPal is not connected for this fleet, so its files cannot be opened. An admin connects it under Settings → FleetPal."));
          return;
        case "too_large":
          res.status(502).json(apiError("file_too_large", "That file is too large to open here. Open it in FleetPal."));
          return;
        case "unreachable":
          res.status(502).json(apiError("fleetpal_unreachable", "FleetPal did not hand over the file just now. Try again in a minute."));
          return;
      }
    }),
  );

  return router;
}

/**
 * A header-safe name with an extension. FleetPal's names arrive cut short without one
 * (`WO_Priced_4011391635_00613_2026111713055`, sampled 2026-11-18), so a saved copy would not open.
 */
export function downloadName(filename: string, contentType: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "invoice";
  if (/\.[A-Za-z0-9]{2,5}$/.test(safe)) return safe;
  const ext = contentType === "application/pdf" ? ".pdf" : contentType.startsWith("image/") ? `.${contentType.slice(6).split(";")[0]}` : "";
  return safe + ext;
}
