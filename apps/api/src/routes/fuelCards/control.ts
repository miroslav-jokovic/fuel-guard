import { Router } from "express";
import { rolesThatCanView } from "@fuelguard/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { asyncHandler, dbErrorResponse } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";

/**
 * Changing a fuel card. Five endpoints, one per INTENT.
 *
 * ── EXPLICIT NON-GOALS. Do not add these casually; each is excluded for a stated reason. ─────────
 *
 *  • No `removeCard`. It is a hard delete in the EFS system (p128) with no undo. `Hold` or `Inactive`
 *    is always the answer, and both are reversible from this same router.
 *  • No `setCardPin`. A driver-held secret; handing one over safely is a whole feature, not a field.
 *  • No card ordering (`createOrder`, `replaceLostOrStolenCard`, `reissueDamagedCard`,
 *    `transferCard`). They cost money per card and involve shipping addresses.
 *  • No `managedFuelAction`. Needs `fuel_plans` integration and an "exactly one card per Driver ID"
 *    precondition this product cannot assert.
 *  • No `setPolicy`. Fleet-wide blast radius by construction.
 *  • No product-limit overrides. That p194 recipe requires DELIBERATELY dropping the limits array —
 *    the exact shape of the disaster the echo guard exists to prevent. Phase C, with its own
 *    confirmation and step-up.
 *  • No `setCardRefreshingLimits` / the `…OVER` convention, no bulk actions, no location-group or
 *    blocklist editing, no `handEnter=DISALLOW` (worth doing — it kills a whole skimming class — but
 *    it needs station-compatibility confirmation from WEX first).
 *
 * ── Why one endpoint per intent rather than a PATCH taking a partial card ────────────────────────
 * A generic patch puts the vendor document's shape on the wire, makes the audit action undecidable
 * without diffing two documents, makes per-intent rate limits and approver scopes impossible, and
 * invites precisely the "just send what changed" mental model that EFS's full-document write punishes
 * by deleting everything you left out.
 *
 * ── Why synchronous rather than queued ───────────────────────────────────────────────────────────
 * "Locked" has to mean *EFS says Hold, verified* — three paced calls, two to four seconds. A 202 plus
 * a job to poll gives a dispatcher a spinner and a page they may close, and at 2am when a truck has
 * been broken into, "queued" is the wrong word. The queue is also the wrong tool: `dispatchJob`'s
 * per-(org,kind) slot would serialise every card write in the org, and its dedup key would 409 two
 * dispatchers locking two DIFFERENT cards.
 *
 * TENANCY. `getSupabaseAdmin` is the service role and bypasses RLS, so `orgId` comes from the verified
 * JWT and every query chains `.eq("org_id", orgId)`. A card belonging to another org is a 404, never a
 * 403 — we do not confirm that another tenant's card exists.
 *
 ── What is left here, and what is not ──────────────────────────────────────────────────────────
 * `POST /:id/lock` left in Step 3.5 and `POST /:id/unlock` in Step 3.6, both to the generated router
 * in `apps/api/src/efs/`. What remains is whatever Step 3.6 has not migrated yet; 3.7 deletes this
 * file's handlers entirely. The gate sequence both routers share — idempotency key, kill switch,
 * access, credentials, card, write limiter — lives in `controlPrepare.ts` rather than being copied,
 * because a second copy is a second place for one of those six to be forgotten.
 */

export function fuelCardControlRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // `run()` went with the last capability that used it. The prompts handler below has always had
  // its own inline copy, which is the asymmetry Step 3.6 is about to remove entirely.

  // ── Overrides ───────────────────────────────────────────────────────────────────────────────────

  // `POST /:id/override` left in Step 3.6. Its step-up gate is now `preflightStepUp` on the
  // descriptor, which the generated router answers before `prepare()` — so a refusal still costs
  // nothing against the daily override budget, and that is now a property of the type rather than
  // of this file's statement order.

  // `DELETE /:id/override` left in Step 3.6, as TWO capabilities sharing one intent —
  // `override_clear` (the echo) and `delete_override` (the vendor op). The
  // EFS_CARD_DELETE_OVERRIDE_ENABLED branch that used to live here is now `mountedCapabilities(env)`,
  // which is where Step 4.2 puts the promotion lookup when it retires the flag.

  // ── Prompts ─────────────────────────────────────────────────────────────────────────────────────

  // `POST /:id/prompts` left in Step 3.6, the last of the five. Its removal refusal is now the
  // capability's `precondition`, which the orchestrator runs after the fresh read and before the
  // ledger row opens — the same place, and the same two refusal codes, as the `buildEdits` throw it
  // replaced. This router is reads-and-history only now; Step 3.7 finishes the job.

  // ── History ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * The mutation ledger for one card. A READ, gated like every other card read
   * (rolesThatCanView("fuel"), the same gate read.ts applies): an auditor who cannot change a card
   * is exactly the person who needs to see what changed — and a driver, whose fueling this surface
   * exists to scrutinise, is exactly who must not browse it (audit P1-4).
   */
  router.get("/:id/history", requireOrg, requireRole(...rolesThatCanView("fuel")), asyncHandler(async (req, res) => {
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const orgId = req.auth!.orgId!;
    const { data, error } = await admin
      .from("efs_card_mutations")
      // Explicit columns: the ledger carries before/after documents and redacted vendor XML, and
      // neither belongs in a page render. `select("*")` here would ship both.
      .select("id, intent, status, reason, requested_by, step_up, created_at, completed_at, efs_fault_code, efs_fault_message, drift")
      .eq("org_id", orgId)
      .eq("efs_card_id", String(req.params.id))
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      dbErrorResponse(res, "fuel-cards.history", error, "Could not load the change history");
      return;
    }
    res.json({ mutations: (data ?? []).map(toMutationView) });
  }));

  return router;
}

// ─── Response helpers ──────────────────────────────────────────────────────────────────────────

interface MutationRow {
  id: string; intent: string; status: string; reason: string;
  requested_by: string | null; step_up: boolean;
  created_at: string; completed_at: string | null;
  efs_fault_code: string | null; efs_fault_message: string | null;
  drift: { unexplained?: { path: string }[] } | null;
}

const toMutationView = (row: unknown) => {
  const r = row as MutationRow;
  return {
    id: r.id,
    intent: r.intent,
    status: r.status,
    reason: r.reason,
    requestedBy: r.requested_by,
    stepUp: r.step_up,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    efsFaultCode: r.efs_fault_code,
    efsFaultMessage: r.efs_fault_message,
    driftFields: r.drift?.unexplained?.map((d) => d.path) ?? null,
  };
};
