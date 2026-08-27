import { Router } from "express";
import { EFS_MILEAGE_CODES, overrideMileageSchema } from "@silvicom/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { enforceCardWriteLimit } from "../../middleware/cardWriteLimit.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { applyMileageOverride, readUnitMileage } from "../../services/efsMileageOverride.js";
import { getEfsSoapCredentials } from "../../services/efsSoapCredentials.js";

/**
 * `POST /api/fuel-cards/unit-mileage` — correct the odometer reading EFS holds for one unit
 * (`docs/37` §6 E′), and `GET` it beside our own.
 *
 * ── The path is one segment, and that is not cosmetic ───────────────────────────────────────────
 * `/mileage/override` was the natural spelling and would have been a live defect: every rate-limit
 * pattern in `cardWriteLimits.ts` matches `/api/fuel-cards/<something>/<verb>`, so that path is
 * caught by the `card_override` pattern with its wildcard binding to "mileage". The odometer
 * correction would have been metered out of the fuel-override budget and named as one in every
 * limiter message an operator sees. A flat segment cannot collide with any of them.
 *
 * ── What this route does NOT have, stated because it is a departure ─────────────────────────────
 * Every other vendor write in this product goes through the capability registry and gets a ledger
 * row, an OEG proof run, a promotion gate and a background reconciler. This one does not, because it
 * targets a unit and all of that machinery keys on a card (`docs/37` §4). §6 recommends the trade
 * and `services/efsMileageOverride.ts` records what it costs. The compensation is that landing is
 * judged from a re-read here and now, and BOTH readings go into the audit row — so the evidence a
 * ledger would have held is in `audit_logs` instead of nowhere.
 */
export function fuelCardUnitMileageRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /**
   * What EFS holds, beside what we hold.
   *
   * The comparison is the point. Samsara gives us the odometer this product already trusts for
   * detection; EFS keeps its own copy and that copy going stale is the whole reason the override
   * exists. Showing both is what turns "override the mileage" from a blind form into a decision.
   */
  router.get(
    "/unit-mileage",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      const unit = typeof req.query.unit === "string" ? req.query.unit.trim() : "";
      if (!unit) {
        res.status(400).json(apiError("invalid_request", "A unit number is required."));
        return;
      }
      const code = EFS_MILEAGE_CODES.find((c) => c === req.query.code) ?? "ODRD";

      /**
       * ⚠ An unknown unit is NOT refused here, unlike on the write below.
       *
       * The POST 404s on a unit that is not one of this company's trucks, and should: that is the
       * typo boundary, and `688` versus `868` are both plausible units the vendor would accept
       * without complaint. A READ has no such failure. Refusing one would hide the single most
       * interesting thing this endpoint can find — **a unit EFS holds a reading for that our fleet
       * does not model at all** — behind a 404 that reads as "no such truck", when the truth is
       * "no such truck HERE, and EFS disagrees".
       *
       * So the vendor is always asked, and `knownVehicle` says whether the comparison half is real.
       */
      const { vehicle } = await findVehicle(admin, orgId, unit);

      const creds = await getEfsSoapCredentials(admin, env, orgId);
      if (!creds?.enabled) {
        res.status(409).json(apiError("efs_not_configured", "EFS is not connected for this company."));
        return;
      }

      const efs = await readUnitMileage(env, creds, unit, code, { priority: "interactive" });
      const ours = vehicle?.current_odometer ?? null;
      res.json({
        unit,
        code,
        /** EFS's copy — the one a SecureFuel pump compares the driver's entry against. */
        efsMileage: efs,
        /**
         * False when no vehicle in this company carries this unit number. Reported rather than
         * refused: paired with a non-null `efsMileage` it means EFS is tracking a truck we do not
         * model, which is a real gap and not an error.
         */
        knownVehicle: vehicle !== null,
        /**
         * Ours, and ADVISORY (`vehicles.current_odometer` is marked so in migration 0003). Reported
         * with its offset rather than pre-adjusted: `odometer_offset` is the dash↔Samsara
         * calibration (migration 0025), and an operator deciding what to send EFS needs to see that
         * a 400-mile gap is a known cluster offset rather than drift.
         */
        ourMileage: ours,
        odometerOffset: vehicle?.odometer_offset ?? null,
        /** Null on either side means "no comparison", never zero. */
        drift: efs === null || ours === null ? null : Math.round(ours - efs),
      });
    }),
  );

  router.post(
    "/unit-mileage",
    requireOrg,
    /**
     * Admin only, and no step-up.
     *
     * Step-up defends against a hijacked session doing something an attacker profits from. There is
     * no profit here — a wrong baseline strands a truck or widens a plausibility band; neither hands
     * anybody fuel the way `override_grant` does. The failure this operation actually has is the
     * wrong unit or a fat-fingered digit, which is what the vehicle-ownership check and
     * `EFS_MILEAGE_MAX` address. Same reasoning as `card_deactivate`'s recorded no-step-up decision.
     */
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;

      const parsed = overrideMileageSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid request"));
        return;
      }
      const { unit, code, mileage } = parsed.data;

      /**
       * The unit must be a truck in THIS company, checked before the vendor is dialled.
       *
       * The EFS session is already org-scoped, so this is not the account boundary — it is the typo
       * boundary, and that is the failure that actually happens. `688` and `868` are both plausible
       * units, the vendor accepts either, and the operation returns nothing that would say the
       * reading landed on the wrong truck. A truck we have never heard of is the one signal
       * available before the write, so it is spent here.
       */
      const { vehicle, lookupFailed } = await findVehicle(admin, orgId, unit);
      if (lookupFailed) {
        // Refuse, but do not claim the truck is absent — we did not find out.
        res.status(503).json(apiError(
          "vehicle_lookup_failed",
          "Could not check which trucks this company has, so the unit was not confirmed. Nothing was sent to EFS.",
        ));
        return;
      }
      if (!vehicle) {
        res.status(404).json(apiError(
          "unknown_unit",
          `No vehicle in this company has unit number ${unit}. This is checked against Silvicom 360's own `
            + "vehicle list, not against EFS — a unit that exists on an EFS card still needs a matching "
            + "truck here before its mileage can be corrected.",
        ));
        return;
      }

      // AFTER validation and ownership, BEFORE the vendor: a refusal must not spend a rate slot, and
      // a rate-limited request must not spend a vendor call.
      if (!(await enforceCardWriteLimit(req, res))) return;

      const creds = await getEfsSoapCredentials(admin, env, orgId);
      if (!creds?.enabled) {
        res.status(409).json(apiError("efs_not_configured", "EFS is not connected for this company."));
        return;
      }

      const outcome = await applyMileageOverride(env, creds, { unit, code, mileage }, { priority: "interactive" });

      /**
       * Audited on EVERY outcome, including the ones that did not write.
       *
       * This row is the only durable record that exists — there is no ledger entry to fall back on —
       * so it carries both readings and the verdict, not just the request. `not_landed` and
       * `indeterminate` are the rows somebody will need most, and an audit trail that recorded only
       * successes would be missing exactly them.
       *
       * `entityId` is the VEHICLE's uuid, not the unit string: `audit_logs.entity_id` is a uuid
       * column, and a non-uuid there is moved to `meta` with a stderr line — losing the field that
       * makes the row findable (the 2026-08-15 sweep, `lib/audit.ts`).
       */
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "efs.unit_mileage_overridden",
        entity: "vehicle",
        entityId: vehicle.id,
        meta: {
          unit, code,
          requested: outcome.requested,
          before: outcome.before,
          after: outcome.after,
          landing: outcome.landing,
          dispatched: outcome.dispatched,
        },
      });

      /**
       * 200 for every outcome, with the verdict in the body.
       *
       * `not_landed` is tempting to return as a 502, and it would be wrong: the request was
       * well-formed, authorised, dispatched and verified. What failed is the vendor's action, which
       * the caller must SEE rather than catch — a thrown error loses `before` and `after`, and those
       * two numbers are the whole evidence of what happened.
       */
      res.json({ ok: outcome.landing === "landed" || outcome.landing === "already_current", ...outcome });
    }),
  );

  return router;
}

interface VehicleRow {
  id: string;
  current_odometer: number | null;
  odometer_offset: number | null;
}

/**
 * The org's own truck with this unit number. Org-scoped in the query, never after it.
 *
 * ── Three outcomes, not two ─────────────────────────────────────────────────────────────────────
 * This used to answer `null` for a query ERROR as well as for a genuine miss, and the caller turned
 * both into *"No vehicle in this company has unit number 991."* That sentence is a factual claim
 * about the fleet, and on a database error it is a claim we did not check — it sends somebody to
 * add a truck that may already be there. Fail closed either way, but say which.
 */
async function findVehicle(
  admin: ReturnType<typeof getSupabaseAdmin>,
  orgId: string,
  unit: string,
): Promise<{ vehicle: VehicleRow | null; lookupFailed: boolean }> {
  const { data, error } = await admin
    .from("vehicles")
    .select("id, current_odometer, odometer_offset")
    .eq("org_id", orgId)
    .eq("unit_number", unit)
    .maybeSingle();
  if (error) return { vehicle: null, lookupFailed: true };
  return { vehicle: (data as VehicleRow | null) ?? null, lookupFailed: false };
}
