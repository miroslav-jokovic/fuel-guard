import { Router } from "express";
import { z } from "zod";
import { fleetpalShelfInputSchema, stockLocationInputSchema } from "@silvicom/shared";
import { requireAdminOnly, requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { listLocations } from "../inventory/stock.js";
import { createLocation, setFleetpalShelf, updateLocation } from "../inventory/locationsWrite.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { isServiceError } from "../inventory/types.js";

/**
 * `/api/maintenance/inventory/locations` — where stock is held (D-INV1).
 *
 * Reads take the section's view roles, writes take its manage roles, and neither carries a
 * `requireSurface` gate: a location list fills the picker on the Parts screen, the count session and
 * the scanner's transfer sheet, so it belongs to the SECTION and not to any one page (D-SURF5, the
 * same reasoning `inspectors.ts` records for the register).
 */

const listSchema = z.object({ includeInactive: z.coerce.boolean().optional() });
const patchSchema = stockLocationInputSchema.partial();

export function inventoryLocationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listLocations(admin, req.auth!.orgId!, parsed.data);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, locations: result });
    }),
  );

  router.post(
    "/",
    requireOrg,
    requireSection("maintenance"),
    validateBody(stockLocationInputSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as z.infer<typeof stockLocationInputSchema>;
      const result = await createLocation(admin, orgId, body);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.stock_location_created",
        entity: "stock_locations",
        entityId: result.id,
        meta: { name: result.name, code: result.code },
      });
      res.status(201).json({ ok: true, location: result });
    }),
  );

  /**
   * Rename, re-address, or close a shelf. Closing is `active: false` and is audited under its own
   * action, because "the bay was closed" is the sentence somebody will be looking for when a
   * movement starts failing `IV012` — the RPC refuses an inactive location outright.
   */
  router.patch(
    "/:id",
    requireOrg,
    requireSection("maintenance"),
    validateBody(patchSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const body = res.locals.body as z.infer<typeof patchSchema>;
      const result = await updateLocation(admin, orgId, id, body);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      if (!result) {
        res.status(404).json(apiError("not_found", "That stock location no longer exists."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: body.active === false ? "maintenance.stock_location_closed" : "maintenance.stock_location_updated",
        entity: "stock_locations",
        entityId: result.id,
        meta: { changed: Object.keys(body) },
      });
      res.json({ ok: true, location: result });
    }),
  );

  /**
   * Start or stop this place following FleetPal (F13, D-FP23). Admin-only under the same named grant
   * as the FleetPal key (`fleetpal.connection`): it decides which shelf an outside system moves every
   * hour, which is the connection's business, not a shelf edit. The start is the server's now — the
   * body carries no date, so nobody can backdate it and replay FleetPal's history onto an uncounted
   * shelf. Audited under its own two actions, because "when did the shelf start following FleetPal"
   * is the first question when a number on it looks wrong.
   */
  router.post(
    "/:id/fleetpal",
    requireOrg,
    requireAdminOnly("fleetpal.connection"),
    validateBody(fleetpalShelfInputSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { follows } = res.locals.body as z.infer<typeof fleetpalShelfInputSchema>;
      const result = await setFleetpalShelf(admin, orgId, id, follows);
      if (isServiceError(result)) {
        res.status(statusForServiceError(result.code)).json(apiError(result.code, result.error));
        return;
      }
      if (!result) {
        res.status(404).json(apiError("not_found", "That stock location no longer exists."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: follows ? "maintenance.stock_location_fleetpal_started" : "maintenance.stock_location_fleetpal_stopped",
        entity: "stock_locations",
        entityId: result.id,
        meta: { fleetpalFrom: result.fleetpalFrom ?? null },
      });
      res.json({ ok: true, location: result });
    }),
  );

  return router;
}
