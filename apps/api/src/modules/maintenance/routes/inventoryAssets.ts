import { Router } from "express";
import { z } from "zod";
import {
  assetCreateSchema,
  assetInputSchema,
  moveAssetSchema,
  reportAssetSchema,
  type AssetMovementInput,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { getAsset, listAssets } from "../inventory/assets.js";
import { createAsset, setAssetImagePath, updateAsset } from "../inventory/assetsWrite.js";
import { listAssetMovements, moveAsset } from "../inventory/assetMovements.js";
import { signPartPhotoUpload, signPartPhotoUrl } from "../inventory/photos.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { isServiceError } from "../inventory/types.js";

/**
 * `/api/maintenance/inventory/assets` — the things with identities (INVENTORY-PLAN.md step I8).
 *
 * ── MOVE AND REPORT ARE TWO ROUTES, NOT ONE `POST /movements` WITH A REASON ────────────────────
 * The same argument `inventoryStock.ts` makes for its five verbs, and it lands harder here because
 * the difference is not cosmetic: a move writes the holder columns and a report deliberately does
 * not (D-INV24 — a fridge reported missing from 654 is still 654's fridge, missing from it). One
 * endpoint taking the union would let a screen built for moving a tablet post `reported_missing`
 * because a `reason` field was bound to the wrong ref, and the holder would silently not move.
 * `moveAssetSchema` and `reportAssetSchema` are the contract's own narrowings, derived from
 * `movesHolder` rather than restating the reason list.
 *
 * ── MOVEMENTS ARE NOT WRITTEN TO `audit_logs` ─────────────────────────────────────────────────
 * `asset_movements` IS the audit — append-only by trigger (`IV021`), carrying its actor, both
 * clocks, both ends of the move and the reason. A second row in `audit_logs` per move would record
 * what the first says better. Creating and editing an ASSET is audited, because the asset row is a
 * description rather than a ledger, and "who renamed A-0412" has nowhere else to live.
 *
 * ── THE PHOTO SIGNER IS THE PARTS ONE, BY PATH AND NOT BY ACCIDENT ────────────────────────────
 * `signPartPhotoUpload` builds `<org>/<subject>/<uuid>.<ext>` into the same `inventory-photos`
 * bucket, and the subject is whatever id it is handed. Writing a second copy for assets would be
 * two spellings of the org-prefix rule that D-INV8 exists to enforce — and that prefix is applied
 * from `req.auth.orgId` and never from the request, because the bucket carries no RLS.
 */

const listSchema = z.object({
  search: z.string().max(120).optional(),
  assetTypeId: z.uuid().optional(),
  status: z.enum(["in_service", "in_repair", "spare", "lost", "retired"]).optional(),
  locationId: z.uuid().optional(),
  vehicleId: z.uuid().optional(),
  trailerId: z.uuid().optional(),
  unassigned: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const historySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const patchSchema = assetInputSchema.partial();

const photoSchema = z.object({
  photoId: z.uuid(),
  contentType: z.string().min(1).max(80),
});

export function inventoryAssetsRouter(): Router {
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
      const result = await listAssets(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * One asset, with a signed URL for its photo.
   *
   * The history is NOT in this response and is a page of its own below. A detail page renders 30
   * movements and a tablet that has been round the fleet for two years has hundreds; folding them
   * in would make the header wait for the tail, and would make "show me more" a second request
   * against a shape that had already answered once.
   */
  router.get(
    "/:id",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const asset = await getAsset(admin, orgId, String(req.params.id ?? ""));
      if (isServiceError(asset)) {
        res.status(statusForServiceError(asset.code)).json(apiError(asset.code, asset.error));
        return;
      }
      if (!asset) {
        res.status(404).json(apiError("not_found", "That asset is not on the books."));
        return;
      }
      res.json({ ok: true, asset, photoUrl: await signPartPhotoUrl(admin, asset.imagePath) });
    }),
  );

  /** One asset's history, paginated. The page the detail's timeline reads. */
  router.get(
    "/:id/movements",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = historySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listAssetMovements(admin, req.auth!.orgId!, {
        ...parsed.data,
        assetId: String(req.params.id ?? ""),
      });
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
    validateBody(assetCreateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { locationId, vehicleId, trailerId, ...input } = res.locals.body as z.infer<
        typeof assetCreateSchema
      >;
      const result = await createAsset(admin, orgId, input, { locationId, vehicleId, trailerId });
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.asset_created",
        entity: "inventory_assets",
        entityId: result.id,
        // The display number and not the UUID: it is what the shop says out loud and writes on a
        // work order, so it is what somebody reading this log will be searching for.
        meta: { displayNo: result.displayNo, name: result.name },
      });
      res.status(201).json({ ok: true, asset: result });
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
      const result = await updateAsset(admin, orgId, String(req.params.id ?? ""), body);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      if (!result) {
        res.status(404).json(apiError("not_found", "That asset is not on the books."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.asset_updated",
        entity: "inventory_assets",
        entityId: result.id,
        meta: { displayNo: result.displayNo, changed: Object.keys(body) },
      });
      res.json({ ok: true, asset: result });
    }),
  );

  /**
   * ⚠ The photo route the parts one has and no screen ever called — the debt I3 recorded and I8 does
   * not repeat: `AssetDrawer.vue` uploads through this on save.
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

      const asset = await getAsset(admin, orgId, id);
      if (isServiceError(asset)) {
        res.status(statusForServiceError(asset.code)).json(apiError(asset.code, asset.error));
        return;
      }
      if (!asset) {
        res.status(404).json(apiError("not_found", "That asset is not on the books."));
        return;
      }

      const signed = await signPartPhotoUpload(admin, orgId, id, photoId, contentType);
      if (isServiceError(signed)) {
        res.status(statusForServiceError(signed.code)).json(apiError(signed.code, signed.error));
        return;
      }
      const attached = await setAssetImagePath(admin, orgId, id, signed.storagePath);
      if (isServiceError(attached)) {
        res.status(statusForServiceError(attached.code)).json(apiError(attached.code, attached.error));
        return;
      }
      res.status(201).json({ ok: true, ...signed });
    }),
  );

  /**
   * One handler for both verbs, because after validation they differ in nothing THIS layer does:
   * which reasons move the holder, where the movement came from, and whether the target may hold it
   * are all decided inside `move_asset`. The two schemas are what make the surface say which half it
   * serves.
   *
   * **201 on a replay too, and that is not a mistake.** `move_asset` returns the existing row for a
   * repeated id (D-INV27), so a queue flushing twice gets the same movement and the same answer both
   * times. Answering the second one differently would make a client that retried correctly look like
   * it had failed. `inventoryStock.ts` says the same thing about the same behaviour.
   */
  const verb = (path: string, schema: z.ZodType<AssetMovementInput>) =>
    router.post(
      path,
      requireOrg,
      canManage,
      validateBody(schema),
      asyncHandler(async (req, res) => {
        const admin = getSupabaseAdmin(getAppLocals(req).env);
        const result = await moveAsset(
          admin,
          req.auth!.orgId!,
          req.auth!.userId,
          res.locals.body as AssetMovementInput,
        );
        if (isServiceError(result)) {
          res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
          return;
        }
        res.status(201).json({ ok: true, movement: result });
      }),
    );

  verb("/move", moveAssetSchema as unknown as z.ZodType<AssetMovementInput>);
  verb("/report", reportAssetSchema as unknown as z.ZodType<AssetMovementInput>);

  return router;
}
