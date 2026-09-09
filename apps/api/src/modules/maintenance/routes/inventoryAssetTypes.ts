import { Router } from "express";
import { z } from "zod";
import { assetTypeInputSchema } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { createAssetType, listAssetTypes, updateAssetType } from "../inventory/assetTypes.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { isServiceError } from "../inventory/types.js";

/**
 * `/api/maintenance/inventory/asset-types` — the kinds of thing (INVENTORY-PLAN.md step I8).
 *
 * ── ITS OWN PREFIX, AND NOT `/assets/types` ───────────────────────────────────────────────────
 * `/assets/types` and `/assets/:id` are both one segment under the same router, so Express would
 * resolve them by declaration order and the ordering would be load-bearing with nothing stating it.
 * `inventoryParts.ts` carries a corrected comment about exactly this: `/parts/by-upc/:upc` was
 * claimed to need mounting above `/parts/:id`, and it does not, because two segments cannot collide
 * with one. Here they genuinely would. A separate prefix removes the question rather than answering
 * it in a comment somebody later moves.
 *
 * ── NO DELETE ────────────────────────────────────────────────────────────────────────────────
 * `inventory_assets.asset_type_id` is `on delete restrict`, so a type that has ever been used cannot
 * be removed and the database says so rather than this route remembering to. `assetTypes.ts` carries
 * the rest of the reasoning; `partsWrite.ts` makes the same call for the same reason.
 */

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const patchSchema = assetTypeInputSchema.partial();

export function inventoryAssetTypesRouter(): Router {
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
      const result = await listAssetTypes(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  router.post(
    "/",
    requireOrg,
    canManage,
    validateBody(assetTypeInputSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const result = await createAssetType(
        admin,
        orgId,
        res.locals.body as z.infer<typeof assetTypeInputSchema>,
      );
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      // Audited, unlike a movement: a type decides whether individual identity is tracked at all
      // (`serialized`) and how many of it a unit is expected to hold, so "who made this a type that
      // only comes one to a truck" is a question with consequences and nowhere else to live.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.asset_type_created",
        entity: "asset_types",
        entityId: result.id,
        meta: { name: result.name, serialized: result.serialized },
      });
      res.status(201).json({ ok: true, type: result });
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
      const body = res.locals.body as z.infer<typeof patchSchema>;
      const result = await updateAssetType(admin, orgId, String(req.params.id ?? ""), body);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      if (!result) {
        res.status(404).json(apiError("not_found", "That asset type does not exist."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.asset_type_updated",
        entity: "asset_types",
        entityId: result.id,
        meta: { name: result.name, changed: Object.keys(body) },
      });
      res.json({ ok: true, type: result });
    }),
  );

  return router;
}
