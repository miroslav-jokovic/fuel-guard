import { Router } from "express";
import { z } from "zod";
import { kitExpectationInputSchema } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { getUnitKit, listUnitKits } from "../inventory/units.js";
import {
  deleteKitExpectation,
  listKitExpectations,
  setKitExpectation,
} from "../inventory/kitExpectations.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { isServiceError } from "../inventory/types.js";

/**
 * `/api/maintenance/inventory/units` and `/kit-expectations` (INVENTORY-PLAN.md step I9).
 *
 * ── A UNIT IS ADDRESSED BY (kind, id), NEVER BY AN ID ALONE ───────────────────────────────────
 * A truck and a trailer share neither a table nor a number space. `/units/:kind/:id` carries the
 * pair so no handler has to guess which table an id belongs to — and `kind` here is the ROSTER's
 * two words (`tractor` | `trailer`), not the three KIT kinds, because a reefer is a trailer as far
 * as the fleet tables are concerned. `unitKindOf` draws that distinction once, in shared.
 *
 * ── THE KIT IS DERIVED ON EVERY READ, AND STORED NOWHERE ──────────────────────────────────────
 * There is no kit-status column and no cache. Held-against-expected goes stale the moment an asset
 * moves, and this repo has already paid once for a compliance fact kept in two unsynchronised
 * places (CDL and medical expiry, D-ARC3). Four reads and some arithmetic is what a screen costs.
 *
 * ── THE EXPECTATION ROUTES ARE AUDITED; THE READS ARE NOT ─────────────────────────────────────
 * A kit rule is a decision about what a truck must carry, so "who said this trailer needs only one
 * load bar" is a question with consequences and nowhere else to live — `kit_expectations` is not a
 * ledger and keeps no history of its own. Movements are the opposite and are audited by being
 * `asset_movements` rows; the routes in `inventoryAssets.ts` say so.
 */

const listSchema = z.object({
  kind: z.enum(["tractor", "trailer"]).optional(),
  shortOnly: z.coerce.boolean().optional(),
});

const expectationListSchema = z.object({
  unitKind: z.enum(["tractor", "trailer", "reefer_trailer"]).optional(),
  vehicleId: z.uuid().optional(),
  trailerId: z.uuid().optional(),
  fleetOnly: z.coerce.boolean().optional(),
});

export function inventoryUnitsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  // Read-only, deliberately: nothing about a unit is EDITED here. The kit rules are the router
  // below, and moving a thing onto a truck is `/assets/move` — one door, D-INV3.
  const canView = requireSection("maintenance", "view");

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
      const result = await listUnitKits(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * One unit's kit, and the assets it is actually carrying.
   *
   * This is also the endpoint D-AVI17's read-only card on the vehicle and trailer pages reads —
   * gated `maintenance: view`, so a fleet manager without the shop section gets nothing rather than
   * a card full of blanks, and there is no edit affordance on that surface at all.
   */
  router.get(
    "/:kind/:id",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const kind = String(req.params.kind ?? "");
      if (kind !== "tractor" && kind !== "trailer") {
        res.status(400).json(apiError("bad_request", "A unit is a tractor or a trailer."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await getUnitKit(admin, req.auth!.orgId!, kind, String(req.params.id ?? ""));
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      if (!result) {
        res.status(404).json(apiError("not_found", "That unit is not on the fleet."));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  return router;
}

/** `/api/maintenance/inventory/kit-expectations` — the rules behind the numbers above. */
export function kitExpectationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireSection("maintenance", "view");
  const canManage = requireSection("maintenance");

  router.get(
    "/",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = expectationListSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listKitExpectations(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, ...result });
    }),
  );

  /**
   * Set one rule. PUT rather than POST, because the operation is idempotent by its natural key —
   * (type, unit kind, unit) — and the service is UPDATE-then-INSERT behind it. Sending the same body
   * twice must not make two rules, and a POST that sometimes creates and sometimes updates is a
   * verb that tells the caller nothing.
   */
  router.put(
    "/",
    requireOrg,
    canManage,
    validateBody(kitExpectationInputSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as z.infer<typeof kitExpectationInputSchema>;
      const result = await setKitExpectation(admin, orgId, body);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.kit_expectation_set",
        entity: "kit_expectations",
        entityId: result.id,
        meta: {
          assetType: result.assetTypeName,
          unitKind: result.unitKind,
          quantity: result.quantity,
          // Which layer this row IS, so the log distinguishes "every dry van now carries two" from
          // "trailer T-4102 carries one". They read identically without it.
          scope: result.vehicleId || result.trailerId ? "unit" : "fleet",
        },
      });
      res.json({ ok: true, expectation: result });
    }),
  );

  /**
   * Remove a rule — a real delete, unlike anything else in this module.
   *
   * An expectation is not evidence of anything that happened; it is a rule about a unit that still
   * exists, which is also why 0333 gives its unit references `on delete cascade` where every
   * movement's are `restrict`. Removing a per-unit override puts that unit back on the fleet
   * default, which is the whole point of the two layers.
   */
  router.delete(
    "/:id",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const result = await deleteKitExpectation(admin, orgId, id);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      if (!result) {
        res.status(404).json(apiError("not_found", "That kit rule does not exist."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.kit_expectation_removed",
        entity: "kit_expectations",
        entityId: id,
        meta: {},
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
