import { Router } from "express";
import { z } from "zod";
import {
  stockLineSettingsSchema,
  adjustStockSchema,
  countStockSchema,
  issueStockSchema,
  receiveStockSchema,
  returnStockSchema,
  transferStockSchema,
  type PartMovementInput,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { listLowStock, listStock } from "../inventory/stock.js";
import { updateStockLine } from "../inventory/stockSettings.js";
import { listMovements, recordMovement } from "../inventory/movements.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { isServiceError } from "../inventory/types.js";

/**
 * `/api/maintenance/inventory` — the shelves and the ledger (INVENTORY-PLAN.md step I3).
 *
 * ── THE FIVE VERBS ARE FIVE ROUTES, NOT ONE `POST /movements` WITH A REASON ────────────────────
 * `partMovementInputSchema` is a discriminated union precisely so the shapes ARE the rules: an issue
 * cannot be built without a unit, an adjustment cannot be built without a reason, a count carries an
 * absolute total rather than a delta. One endpoint taking the union would validate the same rules,
 * and would also let a client send `reason: "adjusted"` to a screen built for receiving. Five routes
 * make the surface say what it does, and each one's schema is the contract's own.
 *
 * ── MOVEMENTS ARE NOT AUDITED INTO `audit_logs` ────────────────────────────────────────────────
 * Deliberate, and the opposite of the parts and locations routes beside them. `part_movements` IS
 * the audit — append-only by trigger, carrying its actor, both clocks and the reason. A second row
 * in `audit_logs` for every issue would double the busiest table in the module to record what the
 * first one already says better. Creating or retiring a PART is audited, because the catalogue is
 * not itself a ledger.
 */

const stockListSchema = z.object({
  locationId: z.uuid().optional(),
  partId: z.uuid().optional(),
  includeInactive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** No `limit`/`offset`: the answer is the whole list or it is misleading (see the route). */
const lowStockSchema = z.object({ locationId: z.uuid().optional() });

const movementListSchema = z.object({
  partId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  vehicleId: z.uuid().optional(),
  trailerId: z.uuid().optional(),
  countSessionId: z.uuid().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function inventoryStockRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireSection("maintenance", "view");
  const canManage = requireSection("maintenance");

  router.get(
    "/stock",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = stockListSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listStock(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * What needs ordering. Its OWN reader, not a flag on `/stock`, and not paginated: this list must be
   * complete or it is worse than absent — a low-stock screen that under-reports says "nothing to
   * order" and is believed. `listLowStock` pages to the end over the lines that have a reorder point
   * at all, then asks `isLowStock` (`inventoryRules.ts`), which stays the only place the rule lives.
   */
  router.get(
    "/low-stock",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = lowStockSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listLowStock(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  router.get(
    "/movements",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = movementListSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listMovements(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * The reorder point, the optional bin fragments, and whether the line is still carried.
   *
   * ⚠ Added by the 2026-09-09 review of I0–I3: `stockLineSettingsSchema` shipped in I1 with no
   * consumer and no step owning the write, while I12 reads `reorder_point`. Notably absent from the
   * body, and from the service behind it, is the QUANTITY — that is the ledger's projection and
   * `record_part_movement` is its only writer (D-INV4).
   *
   * The line is addressed by its natural key, because `part_stock` has no surrogate id: a stock line
   * IS the pair.
   */
  router.patch(
    "/stock/:partId/:locationId",
    requireOrg,
    canManage,
    validateBody(stockLineSettingsSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await updateStockLine(
        admin,
        req.auth!.orgId!,
        String(req.params.partId ?? ""),
        String(req.params.locationId ?? ""),
        res.locals.body as z.infer<typeof stockLineSettingsSchema>,
      );
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true });
    }),
  );

  /**
   * One handler for all five verbs, because after validation they differ in nothing this layer does:
   * the sign of the delta, the count's variance and the transfer's second leg are all decided inside
   * `record_part_movement`. A per-verb handler here would be five copies of the same six lines, and
   * the fifth copy is where the status mapping would be forgotten.
   *
   * **201 on a replay too, and that is not a mistake.** `record_part_movement` returns the existing
   * row for a repeated id (D-INV27), so an offline queue flushing twice gets the same movement and
   * the same answer both times. Answering the second one differently would make a client that
   * retried correctly look like it had failed.
   */
  const verb = (path: string, schema: z.ZodType<PartMovementInput>) =>
    router.post(
      path,
      requireOrg,
      canManage,
      validateBody(schema),
      asyncHandler(async (req, res) => {
        const admin = getSupabaseAdmin(getAppLocals(req).env);
        const result = await recordMovement(
          admin,
          req.auth!.orgId!,
          req.auth!.userId,
          res.locals.body as PartMovementInput,
        );
        if (isServiceError(result)) {
          res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
          return;
        }
        res.status(201).json({ ok: true, movement: result });
      }),
    );

  verb("/receive", receiveStockSchema as unknown as z.ZodType<PartMovementInput>);
  verb("/issue", issueStockSchema as unknown as z.ZodType<PartMovementInput>);
  verb("/adjust", adjustStockSchema as unknown as z.ZodType<PartMovementInput>);
  verb("/transfer", transferStockSchema as unknown as z.ZodType<PartMovementInput>);
  verb("/return", returnStockSchema as unknown as z.ZodType<PartMovementInput>);
  verb("/count", countStockSchema as unknown as z.ZodType<PartMovementInput>);

  return router;
}
