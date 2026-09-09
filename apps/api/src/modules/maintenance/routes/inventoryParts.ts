import { Router } from "express";
import { z } from "zod";
import { partInputSchema } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { findPartsByUpc, getPart, listParts } from "../inventory/parts.js";
import { createPart, setPartImagePath, updatePart } from "../inventory/partsWrite.js";
import { signPartPhotoUpload, signPartPhotoUrl } from "../inventory/photos.js";
import { listStock } from "../inventory/stock.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { isServiceError } from "../inventory/types.js";

/**
 * `/api/maintenance/inventory/parts` — the catalogue (INVENTORY-PLAN.md step I3).
 *
 * Creating and retiring a part are audited with the row UUID as `entityId`, because the catalogue is
 * what every quantity in the system is a quantity OF: a part number changed under a shelf renames
 * history nobody watched happen.
 */

const listSchema = z.object({
  search: z.string().max(120).optional(),
  category: z.string().max(64).optional(),
  includeInactive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const patchSchema = partInputSchema.partial();

const photoSchema = z.object({
  photoId: z.uuid(),
  contentType: z.string().min(1).max(80),
});

export function inventoryPartsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireSection("maintenance", "view");
  const canManage = requireSection("maintenance");

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
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listParts(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * The supplier-barcode lookup behind D-INV7's resolver: `/parts/by-upc/:upc`.
   *
   * ⚠ A first draft of this comment claimed the route had to be mounted ABOVE `/:id` or a barcode
   * would fall into the id route. Moving it below `/:id` failed no test, and the reason is that the
   * claim was simply wrong: `/by-upc/:upc` is TWO path segments and `/:id` is one, so Express can
   * never confuse them whatever the order. The ordering is kept because it reads better beside the
   * other list route; it is not load-bearing, and saying it was would have left a warning about a
   * hazard that does not exist.
   */
  router.get(
    "/by-upc/:upc",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await findPartsByUpc(admin, req.auth!.orgId!, String(req.params.upc ?? ""));
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, parts: result });
    }),
  );

  /** One part, with the shelves it sits on and a signed URL for its photo. */
  router.get(
    "/:id",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const part = await getPart(admin, orgId, id);
      if (isServiceError(part)) {
        res.status(statusForServiceError(part.code)).json(apiError(part.code, part.error));
        return;
      }
      if (!part) {
        res.status(404).json(apiError("not_found", "That part is not in the catalogue."));
        return;
      }
      const stock = await listStock(admin, orgId, { partId: id, includeInactive: true });
      if (isServiceError(stock)) {
        res.status(statusForServiceError(stock.code)).json(apiError(stock.code, stock.error));
        return;
      }
      res.json({
        ok: true,
        part,
        stock: stock.lines,
        photoUrl: await signPartPhotoUrl(admin, part.imagePath),
      });
    }),
  );

  router.post(
    "/",
    requireOrg,
    canManage,
    validateBody(partInputSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as z.infer<typeof partInputSchema>;
      const result = await createPart(admin, orgId, body);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.part_created",
        entity: "parts",
        entityId: result.id,
        meta: { partNumber: result.partNumber, description: result.description },
      });
      res.status(201).json({ ok: true, part: result });
    }),
  );

  router.patch(
    "/:id",
    requireOrg,
    canManage,
    validateBody(patchSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const body = res.locals.body as z.infer<typeof patchSchema>;
      const result = await updatePart(admin, orgId, id, body);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      if (!result) {
        res.status(404).json(apiError("not_found", "That part is not in the catalogue."));
        return;
      }
      // Retiring a part is its own action, not an "updated" with a flag buried in `changed`. It is
      // the event somebody searches the log for when a part stops appearing in the issue picker.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: body.active === false ? "maintenance.part_retired" : "maintenance.part_updated",
        entity: "parts",
        entityId: result.id,
        meta: { partNumber: result.partNumber, changed: Object.keys(body) },
      });
      res.json({ ok: true, part: result });
    }),
  );

  /**
   * Start a photo upload. Returns a one-shot signed URL; the bytes go to Storage directly and never
   * through this process (see `inventory/photos.ts` for why this reads step I3's "multipart upload"
   * that way). The part row is pointed at the path immediately, so a client that uploads and then
   * loses its connection has still recorded where the photo will be.
   */
  router.post(
    "/:id/photo",
    requireOrg,
    canManage,
    validateBody(photoSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { photoId, contentType } = res.locals.body as z.infer<typeof photoSchema>;

      const part = await getPart(admin, orgId, id);
      if (isServiceError(part)) {
        res.status(statusForServiceError(part.code)).json(apiError(part.code, part.error));
        return;
      }
      if (!part) {
        res.status(404).json(apiError("not_found", "That part is not in the catalogue."));
        return;
      }

      const signed = await signPartPhotoUpload(admin, orgId, id, photoId, contentType);
      if (isServiceError(signed)) {
        res.status(statusForServiceError(signed.code)).json(apiError(signed.code, signed.error));
        return;
      }
      const attached = await setPartImagePath(admin, orgId, id, signed.storagePath);
      if (isServiceError(attached)) {
        res.status(statusForServiceError(attached.code)).json(apiError(attached.code, attached.error));
        return;
      }
      res.status(201).json({ ok: true, ...signed });
    }),
  );

  return router;
}
