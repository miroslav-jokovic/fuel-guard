import { Router } from "express";
import type { UnitShopFileDto } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readUnitShopRecord } from "../../fleetpal/index.js";
import { getUnitShopFacts } from "../../roster/index.js";
import { readUnitsAttention } from "../unitAttention.js";

/**
 * The truck's page (MAINTENANCE-SECTION-REDESIGN-PROPOSAL.md §4.3, D-MX3; FLEETPAL-INTEGRATION-PLAN.md
 * F10 + F11) — two reads, both `maintenance: view`, both at the section root beside F9b's
 * `/units/:kind/:id/maintenance` and for the same reason: the caller holds OUR unit's id.
 *
 *   · `GET /units/attention` — every unit on the worklist and why; the Trucks & trailers list's
 *     default view and the page's first section (one derivation, `unitAttention.ts`).
 *   · `GET /units/:kind/:id/shop-file` — the roster's identity and meter (through roster's door) and
 *     FleetPal's record (through the collector's). 404 for a unit this org does not have; the
 *     FleetPal half answers empty, not 404, for a unit the reconciliation has not matched — the
 *     page says "not linked to FleetPal", which is a fact about the mapping and not about the truck.
 *
 * `/units/attention` is mounted BEFORE `/units/:kind/:id/…` so Express never reads "attention" as a
 * kind; the kind check below would refuse it anyway, but an order nothing states is a dependency on
 * a file that has no reason to know this route exists.
 */
export function unitHubRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireSection("maintenance", "view");

  router.get(
    "/units/attention",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const rows = await readUnitsAttention(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!);
      if ("error" in rows) {
        dbErrorResponse(res, "maintenance.units.attention", rows.error, "Could not load what needs attention");
        return;
      }
      res.json({ ok: true, data: rows });
    }),
  );

  router.get(
    "/units/:kind/:id/shop-file",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const kind = String(req.params.kind);
      if (kind !== "tractor" && kind !== "trailer") {
        res.status(400).json(apiError("bad_request", "kind must be tractor or trailer"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const unit = await getUnitShopFacts(admin, orgId, kind, String(req.params.id));
      if (!unit) {
        res.status(404).json(apiError("not_found", "That truck or trailer is not on the fleet."));
        return;
      }
      const record = await readUnitShopRecord(admin, orgId, kind, unit.id, unit.odometerMiles, new Date());
      const data: UnitShopFileDto = { unit, ...record };
      res.json({ ok: true, data });
    }),
  );

  return router;
}
