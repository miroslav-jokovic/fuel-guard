import { Router } from "express";
import { z } from "zod";
import { AUDIT_VERDICTS, CASE_RULE_ID, computeRecallMetrics } from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";

const verdictSchema = z.object({
  verdict: z.enum(AUDIT_VERDICTS),
  note: z.string().trim().max(2000).optional(),
});

/** Lean shape the reviewer needs to judge a sampled fill (raw rows come from the RPC). */
interface SampledRow {
  id: string;
  fueled_at: string;
  vehicle_id: string | null;
  driver_id: string | null;
  gallons: number | string | null;
  odometer: number | string | null;
  samsara_odometer: number | string | null;
  computed_mpg: number | string | null;
  price_per_gal: number | string | null;
  total_cost: number | string | null;
  location_text: string | null;
  city: string | null;
  state: string | null;
  samsara_location_confidence: string | null;
  fueling_time_basis: string | null;
  samsara_observed_state: string | null;
  samsara_observed_city: string | null;
}

export function auditRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // A fresh random sample of cleared, covered fills to review (never the same audited ones twice).
  router.get(
    "/sample",
    requireOrg,
    requireRole("admin", "fleet_manager", "auditor"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const n = Math.min(Math.max(Number(req.query.n) || 20, 1), 50);
      const { data, error } = await admin.rpc("sample_clear_transactions", { p_org: orgId, p_limit: n });
      if (error) {
        res.status(500).json(apiError("sample_failed", error.message));
        return;
      }
      const rows = ((data ?? []) as SampledRow[]).map((r) => ({
        id: r.id,
        fueledAt: r.fueled_at,
        vehicleId: r.vehicle_id,
        driverId: r.driver_id,
        gallons: r.gallons == null ? null : Number(r.gallons),
        odometer: r.odometer == null ? null : Number(r.odometer),
        samsaraOdometer: r.samsara_odometer == null ? null : Number(r.samsara_odometer),
        computedMpg: r.computed_mpg == null ? null : Number(r.computed_mpg),
        pricePerGal: r.price_per_gal == null ? null : Number(r.price_per_gal),
        totalCost: r.total_cost == null ? null : Number(r.total_cost),
        locationText: r.location_text,
        city: r.city,
        state: r.state,
        locationConfidence: r.samsara_location_confidence,
        fuelingTimeBasis: r.fueling_time_basis,
        observedState: r.samsara_observed_state,
        observedCity: r.samsara_observed_city,
      }));
      res.json({ rows });
    }),
  );

  // Record a reviewer verdict on a sampled fill (managers only — this feeds the measured recall number).
  router.post(
    "/transaction/:id",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    validateBody(verdictSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { verdict, note } = res.locals.body as z.infer<typeof verdictSchema>;

      const { data: upd } = await admin
        .from("fuel_transactions")
        .update({ audit_verdict: verdict, audit_note: note ?? null, audit_by: req.auth!.userId, audit_at: new Date().toISOString() })
        .eq("id", id)
        .eq("org_id", orgId)
        .select("id")
        .maybeSingle();
      if (!upd) {
        res.status(404).json(apiError("not_found", "Transaction not found"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "audit.verdict_recorded",
        entity: "fuel_transactions",
        entityId: id,
        meta: { verdict },
      });
      res.json({ ok: true });
    }),
  );

  // Measured recall: sampled miss rate extrapolated over the covered-clear population.
  router.get(
    "/recall-metrics",
    requireOrg,
    requireRole("admin", "fleet_manager", "auditor"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;

      // Keep miss-rate numerator/denominator on the SAME population as coveredClears: cleared,
      // telematics-covered, non-reefer fills. So a fill re-flagged after it was audited drops out of
      // both the audited count and the pool together, and the extrapolation stays consistent.
      const covered = () =>
        admin
          .from("fuel_transactions")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("has_anomaly", false)
          .not("samsara_recon_at", "is", null)
          .neq("tank_type", "reefer");
      const [auditedRes, missedRes, coveredRes, confirmedRes] = await Promise.all([
        covered().not("audit_verdict", "is", null),
        covered().eq("audit_verdict", "missed"),
        covered(),
        admin.from("anomalies").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("rule_id", CASE_RULE_ID).eq("disposition", "confirmed"),
      ]);

      res.json(
        computeRecallMetrics({
          audited: auditedRes.count ?? 0,
          missed: missedRes.count ?? 0,
          confirmed: confirmedRes.count ?? 0,
          coveredClears: coveredRes.count ?? 0,
        }),
      );
    }),
  );

  return router;
}
