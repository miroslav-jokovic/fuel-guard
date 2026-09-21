import { Router } from "express";
import { fleetpalUnitLinkSchema, type FleetpalUnitLink } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { censusOf, listUnits, resolveStagedUnits, setMatch } from "../../fleetpal/index.js";

/**
 * `/api/maintenance/fleetpal/units` — the reconciliation surface (FLEETPAL-INTEGRATION-PLAN.md F5).
 *
 * The collector lives in `modules/fleetpal` and this router is in `maintenance` because that is the
 * SECTION a shop manager reaches it through — the same arrangement as `financial`'s reads appearing
 * under maintenance's repair-spend page. Nothing here parses a FleetPal payload (D-ARC1); it calls
 * the collector's exported functions and shapes the answer for a screen.
 *
 * ── WHY A SCREEN EXISTS FOR THIS AT ALL ────────────────────────────────────────────────────────
 * Because §2.6 refuses to guess. 415 of 474 units resolve by VIN and 11 more by number (measured
 * 2026-09-21); the remaining 48 are mostly sold or superseded equipment, and the product's answer
 * to them is a row a person can see and link, not a fuzzy match that is wrong for ever. D-FP14 then
 * requires the unmatched COUNT to travel beside every per-unit cost figure, so this endpoint's
 * census is not decoration — it is what F9's page has to print next to the money.
 */

export function fleetpalUnitsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/units",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const units = await listUnits(admin, req.auth!.orgId!);
      res.json({ ok: true, units, census: censusOf(units) });
    }),
  );

  /**
   * Re-run the matcher over everything staged.
   *
   * It takes the manage roles rather than view: it writes `fleetpal_units`, and although it can only
   * ever move a row between the answers the matcher itself produces, a verb that rewrites match
   * state is not a read. Manual links survive it — `resolveStagedUnits` says why, at length.
   */
  router.post(
    "/units/resolve",
    requireOrg,
    requireSection("maintenance"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const outcome = await resolveStagedUnits(admin, orgId);
      if ("error" in outcome) {
        res.status(502).json(apiError("db_error", outcome.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "maintenance.fleetpal_units_resolved",
        entity: "fleetpal_units",
        meta: { ...outcome, errors: outcome.errors.length },
      });
      res.json({ ok: true, outcome });
    }),
  );

  /**
   * Link a unit by hand, or return it to unmatched.
   *
   * The write goes through `setMatch`, which does not re-check the three database constraints that
   * already hold this shape — one side only, method and match agreeing, and the equipment belonging
   * to this org (IV012). A bad `equipmentId` therefore comes back as a constraint violation rather
   * than as a silent cross-tenant link, which is the guarantee that matters and the one no
   * hand-written check in here could add to.
   */
  router.post(
    "/units/:fleetpalId/link",
    requireOrg,
    requireSection("maintenance"),
    validateBody(fleetpalUnitLinkSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const fleetpalId = String(req.params.fleetpalId);
      const body = res.locals.body as FleetpalUnitLink;

      const result =
        "unlink" in body
          ? await setMatch(admin, orgId, fleetpalId, { method: "unmatched" })
          : body.kind === "tractor"
            ? await setMatch(admin, orgId, fleetpalId, { method: "manual", vehicleId: body.equipmentId })
            : await setMatch(admin, orgId, fleetpalId, { method: "manual", trailerId: body.equipmentId });

      if ("error" in result) {
        res.status(400).json(apiError("bad_request", result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "unlink" in body ? "maintenance.fleetpal_unit_unlinked" : "maintenance.fleetpal_unit_linked",
        entity: "fleetpal_units",
        entityId: fleetpalId,
        meta: "unlink" in body ? {} : { kind: body.kind, equipmentId: body.equipmentId },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
