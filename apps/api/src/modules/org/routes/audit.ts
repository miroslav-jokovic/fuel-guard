import { Router } from "express";
import { z } from "zod";
import {
  AUDIT_LOG_PAGE_SIZE,
  AUDIT_VERDICTS,
  CASE_RULE_ID,
  auditLogCursor,
  auditLogQuerySchema,
  computeRecallMetrics,
  type AuditLog,
  type AuditLogPage,
} from "@silvicom/shared";
import { requireAuth, requireSection, requireOrg } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, dbErrorResponse, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";

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

  // The Audit log screen (SETTINGS-PERMISSIONS-PLAN.md SP4). It used to read `audit_logs` through
  // PostgREST, where `audit_select` let only the admin and auditor ROLES see rows — so a fleet manager
  // the admin gave the screen opened it to an empty table. The screen's grant decides now: the
  // section, then the screen itself (D-SURF5: only the Audit log reaches this endpoint).
  //
  // The service role bypasses RLS, so the org filter below is the whole tenant boundary.
  // ⚠ No `count`, by Q-SET5: an exact count is a sequential scan of the org's ~5 M rows (the table
  // is 1.2 GB), and the service role has no statement timeout to stop it — 36.9 s cold, measured.
  router.get(
    "/log",
    requireOrg,
    requireSection("settings", "view"),
    requireSurface("admin.settings.audit"),
    asyncHandler(async (req, res) => {
      const parsed = auditLogQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid query"));
        return;
      }
      const { action, before, after } = parsed.data;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      // The keyset predicate on (created_at, id), one side of a row. Both halves were parsed to a
      // timestamp and an id, so neither can carry a `,` or `)` into the filter. Ties on `created_at`
      // are real: one transaction's rows share its `now()`.
      const side = (op: "lt" | "gt", c: { createdAt: string; id: string }) =>
        `created_at.${op}.${c.createdAt},and(created_at.eq.${c.createdAt},id.${op}.${c.id})`;
      const read = (columns: string, ascending: boolean, limit: number, edge: string | null) => {
        let q = admin
          .from("audit_logs")
          .select(columns)
          .eq("org_id", orgId)
          .order("created_at", { ascending })
          .order("id", { ascending })
          .limit(limit);
        // A typed `%` or `_` is a character to find, not a wildcard (`\` is ilike's default escape).
        if (action) q = q.ilike("action", `${action.replace(/[\\%_]/g, "\\$&")}%`);
        if (edge) q = q.or(edge);
        return q;
      };

      // D-US12: `after` reads the NEWER side ascending, nearest the cursor first, and turns it round,
      // so Newer from a pasted link shows the rows that sit just above that link's page. One row more
      // than a page tells each read whether its own direction goes on, without counting (Q-SET5).
      const ascending = Boolean(after);
      const main = await read(
        "id, org_id, actor_id, action, entity, entity_id, meta, created_at",
        ascending,
        AUDIT_LOG_PAGE_SIZE + 1,
        after ? side("gt", after) : before ? side("lt", before) : null,
      );
      if (main.error) {
        dbErrorResponse(res, "audit log read", main.error, "Could not load the audit log");
        return;
      }
      const batch = (main.data ?? []) as unknown as AuditLog[];
      const more = batch.length > AUDIT_LOG_PAGE_SIZE;
      const rows = more ? batch.slice(0, AUDIT_LOG_PAGE_SIZE) : batch;
      if (ascending) rows.reverse();
      const newest = rows[0];
      const oldest = rows.at(-1);

      // The far side is ASKED, one row, never assumed from the cursor having come from somewhere: a
      // hand-edited or filtered-out cursor must not offer a Newer that opens onto nothing. From the
      // newest page there is no newer side to ask about.
      let farSide = false;
      const edge = ascending ? (oldest ?? null) : (newest ?? null);
      const from = edge ? { createdAt: edge.created_at, id: edge.id } : (after ?? before);
      if (from && (before || after)) {
        const probe = await read("id", !ascending, 1, side(ascending ? "lt" : "gt", from));
        if (probe.error) {
          dbErrorResponse(res, "audit log read", probe.error, "Could not load the audit log");
          return;
        }
        farSide = (probe.data ?? []).length > 0;
      }
      const hasOlder = ascending ? farSide : more;
      const hasNewer = ascending ? more : farSide;
      const page: AuditLogPage = {
        rows,
        hasNext: hasOlder,
        nextCursor: hasOlder && oldest ? auditLogCursor(oldest) : null,
        hasNewer,
        newerCursor: hasNewer && newest ? auditLogCursor(newest) : null,
      };
      res.json(page);
    }),
  );

  // A fresh random sample of cleared, covered fills to review (never the same audited ones twice).
  // ⚠ `settings`, and the section is not obvious from the path. This router backs the Recall audit
  // and Reports screens (`useRecallAudit.ts`, `ReportsPage.vue`), both catalogued `settings` in S1 —
  // and the two hand-written lists it carried were exactly that section's view and manage sets.
  router.get(
    "/sample",
    requireOrg,
    requireSection("settings", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const n = Math.min(Math.max(Number(req.query.n) || 20, 1), 50);
      const { data, error } = await admin.rpc("sample_clear_transactions", { p_org: orgId, p_limit: n });
      if (error) {
        dbErrorResponse(res, "sample_clear_transactions rpc", error, "Could not sample transactions", "sample_failed");
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
    requireSection("settings"),
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
    requireSection("settings", "view"),
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
