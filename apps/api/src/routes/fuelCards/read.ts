import { Router } from "express";
import { z } from "zod";
import { maskPan, mergeEffectiveConfig, policyNumberSchema, rolesThatCanView, rolesThatManage } from "@fuelguard/shared";
import { getAppLocals } from "../../lib/appLocals.js";
import { EfsSoapError } from "../../lib/efsSoapSession.js";
import { getPolicy } from "../../lib/efsCardOps.js";
import { searchLocation } from "../../lib/efsLocationSearch.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import {
  EFS_CARD_DETAIL_COLS,
  EFS_CARD_LIST_COLS,
  loadCardNumber,
  refreshCardDetail,
} from "../../services/efsCardMirror.js";
import { loadCardControlAccess } from "../../services/efsCardControlAccess.js";
import { getEfsSoapCredentials } from "../../services/efsSoapCredentials.js";
import { dispatchJob } from "../../services/queue/dispatch.js";

/**
 * Reading EFS cards. No writes here — see the docblock in efsCardOps.ts for why the write half waits
 * on the entitlement probe, and why this half is worth shipping on its own.
 *
 * TENANCY. `getSupabaseAdmin` is the SERVICE ROLE and bypasses RLS, so every query in this file
 * derives `orgId` from the verified JWT (never the body, never a query param) and chains
 * `.eq("org_id", orgId)`. A row that does not match is a 404, never a 403 — we do not confirm that
 * another tenant's card exists.
 *
 * PANs. Every route keys on `efs_cards.id`, a uuid. No card number appears in a path, an access log,
 * a Referer header or browser history, and `card_number_sealed` is never in a select list — the
 * column lists in efsCardMirror.ts are explicit for exactly that reason.
 */

const listQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().trim().max(64).optional(),
  /**
   * ⚠ This was capped at 200, and the fleet that shipped it has 199 cards. One more card and the
   * inventory page would have started silently hiding one — no error, no warning, just a shorter
   * list than the account owns. The page also filters and paginates client-side, so a truncated
   * response quietly narrows every facet on the screen as well.
   *
   * 2000 is not a page size; it is a ceiling that a real fleet will not reach, on a query that reads
   * fifteen small columns from one indexed table. `total` below reports the count EFS-side of the
   * limit, so a fleet that ever does reach it can be told rather than shortchanged.
   */
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

const locationQuerySchema = z.object({
  state: z.string().trim().max(2).optional(),
  city: z.string().trim().max(30).optional(),
  name: z.string().trim().max(45).optional(),
  locId: z.string().trim().regex(/^[0-9]{1,7}$/).optional(),
  country: z.enum(["USA", "CAN", "MXN"]).optional(),
});

interface CardRow {
  id: string;
  card_last4: string;
  status: string;
  policy_number: number | null;
  driver_id_prompt: string | null;
  unit_prompt: string | null;
  driver_name: string | null;
  override_uses: number | null;
  override_all_locations: boolean | null;
  location_override_id: string | null;
  last_used_date: string | null;
  fuel_card_id: string | null;
  synced_at: string;
  sync_error: string | null;
}

const toSummary = (row: CardRow) => ({
  id: row.id,
  last4: row.card_last4,
  maskedRef: maskPan(row.card_last4),
  status: row.status,
  policyNumber: row.policy_number,
  driverIdPrompt: row.driver_id_prompt,
  unitPrompt: row.unit_prompt,
  driverName: row.driver_name,
  overrideUses: row.override_uses,
  // Both halves of an active exception, not just the count: "2 uses left" and "2 uses left at ONE
  // truck stop" are different facts, and the action drawer has to say which one it is replacing.
  overrideAllLocations: row.override_all_locations,
  locationOverrideId: row.location_override_id,
  lastUsedDate: row.last_used_date,
  fuelCardId: row.fuel_card_id,
  syncedAt: row.synced_at,
  syncError: row.sync_error,
});

/**
 * When the browser should start calling this mirror stale.
 *
 * Derived from the sweep cadence rather than fixed, because the two are the same question. The page
 * used to assume sixty minutes while the sweep runs daily, so it spent twenty-three hours a day
 * telling an operator that a perfectly current page needed refreshing. One sweep plus two hours of
 * grace: late enough that a working system is quiet, early enough that a sweep which did not run is
 * visible before the next one is due.
 */
const staleAfterMinutes = (env: { EFS_CARD_SYNC_HOURS: number }): number =>
  Math.round(env.EFS_CARD_SYNC_HOURS * 60) + 120;

/** Map a vendor failure to a status an operator can act on, without echoing EFS verbatim. */
function efsErrorResponse(res: import("express").Response, error: unknown): void {
  if (!(error instanceof EfsSoapError)) throw error;
  const status = error.code === "account_locked" || error.code === "auth" ? 502 : 502;
  res.status(status).json(apiError(`efs_${error.code}`, error.message));
}

export function fuelCardsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("fuel"));
  const canManage = requireRole(...rolesThatManage("fuel"));

  // ── Fixed paths first. `/:id` would otherwise swallow "locations", "policies" and "sync". ───────

  /** Location search for the override picker. An operator knows "the Love's on I-57", not a 6-digit id. */
  router.get("/locations", requireOrg, canView, asyncHandler(async (req, res) => {
    const parsed = locationQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid search"));
      return;
    }
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const creds = await getEfsSoapCredentials(admin, env, req.auth!.orgId!);
    if (!creds?.enabled) {
      res.status(409).json(apiError("efs_not_configured", "EFS is not connected for this company."));
      return;
    }
    try {
      res.json({ locations: await searchLocation(env, creds, parsed.data) });
    } catch (error) {
      efsErrorResponse(res, error);
    }
  }));

  /**
   * Policy-level configuration. Needed because getCardv2 returns CARD-level records ONLY, even when
   * the source says BOTH (p36) — without this the page shows half the rules the pump enforces.
   */
  router.get("/policies/:policyNumber", requireOrg, canView, asyncHandler(async (req, res) => {
    // One shared rule rather than an inline copy: a policy number we CHOOSE is strict, unlike one EFS
    // reports (see policyNumberSchema / vendorInt in cardControlContract.ts).
    const policy = policyNumberSchema.safeParse(req.params.policyNumber);
    if (!policy.success) {
      res.status(400).json(apiError("invalid_request", "Policy numbers are 1 to 99."));
      return;
    }
    const policyNumber = policy.data;
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const creds = await getEfsSoapCredentials(admin, env, req.auth!.orgId!);
    if (!creds?.enabled) {
      res.status(409).json(apiError("efs_not_configured", "EFS is not connected for this company."));
      return;
    }
    try {
      res.json({ policy: await getPolicy(env, creds, policyNumber) });
    } catch (error) {
      efsErrorResponse(res, error);
    }
  }));

  /** Queue a full mirror refresh. 202 + jobId; the ledger refuses a second concurrent sweep per org. */
  router.post("/sync", requireOrg, canManage, asyncHandler(async (req, res) => {
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    // Refuse here rather than queueing a job that can only no-op. The handler ALSO checks, because a
    // scheduled sweep has no request to answer — but a person who just pressed a button deserves the
    // reason now, not a silent "skipped" buried in a job row they have no way to look at.
    const creds = await getEfsSoapCredentials(admin, env, req.auth!.orgId!);
    if (!creds?.enabled) {
      res.status(409).json(apiError(
        "efs_not_configured",
        "EFS is not connected for this company. Connect it in Settings → EFS Integration, then refresh the card list.",
      ));
      return;
    }
    const result = await dispatchJob(admin, env, "efs_card_sync", {
      orgId: req.auth!.orgId!,
      payload: { orgId: req.auth!.orgId! },
      requestedBy: req.auth!.userId,
    });
    if ("conflict" in result) {
      res.status(409).json(apiError("job_running", "A card refresh is already running — watch its progress."));
      return;
    }
    res.status(202).json({ ok: true, queued: true, jobId: result.jobId });
  }));

  // ── The list ────────────────────────────────────────────────────────────────────────────────────

  router.get("/", requireOrg, canView, asyncHandler(async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid filter"));
      return;
    }
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const orgId = req.auth!.orgId!;

    // `count: exact` so `total` is what the company OWNS, not what this response happened to carry.
    let query = admin
      .from("efs_cards")
      .select(EFS_CARD_LIST_COLS, { count: "exact" })
      .eq("org_id", orgId);
    // ilike, not eq: the filter's values come from the documented enum (Active/Hold/…) while a
    // production account stores ACTIVE/HOLD. `eq` matched nothing and the page looked empty.
    if (parsed.data.status) query = query.ilike("status", parsed.data.status);
    if (parsed.data.search) {
      // Last four, unit number or driver id — the three things an operator actually has to hand.
      const term = parsed.data.search.replace(/[%,()]/g, "");
      // driver_name included because the list now SHOWS it — a column you can read but not search for
      // is a column people scroll past looking for the name they already know.
      query = query.or(
        `card_last4.ilike.%${term}%,unit_prompt.ilike.%${term}%,driver_id_prompt.ilike.%${term}%,driver_name.ilike.%${term}%`,
      );
    }
    const { data, error, count } = await query
      .order("card_last4")
      .limit(parsed.data.limit ?? 2000);
    if (error) {
      dbErrorResponse(res, "fuel-cards.list", error, "Could not load the card list");
      return;
    }

    const access = await loadCardControlAccess(admin, env, orgId, req.auth!.userId, req.auth!.role);
    res.json({
      cards: (data as unknown as CardRow[]).map(toSummary),
      // The company's real count. `cards.length` is what came back; a difference between the two is
      // the only honest signal that a limit truncated the answer.
      total: count ?? data?.length ?? 0,
      capabilities: access,
      staleAfterMinutes: staleAfterMinutes(env),
    });
  }));

  // ── One card ────────────────────────────────────────────────────────────────────────────────────

  router.get("/:id", requireOrg, canView, asyncHandler(async (req, res) => {
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const orgId = req.auth!.orgId!;

    const { data, error } = await admin
      .from("efs_cards")
      .select(EFS_CARD_DETAIL_COLS)
      .eq("id", String(req.params.id))
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) {
      dbErrorResponse(res, "fuel-cards.detail", error, "Could not load that card");
      return;
    }
    // 404 rather than 403 for another org's id: a 403 would confirm the card exists.
    if (!data) {
      res.status(404).json(apiError("not_found", "That card is not in this company."));
      return;
    }

    const row = data as unknown as CardRow & {
      document: Record<string, unknown>;
      card_version: string;
      info_source: string | null; limit_source: string | null; time_source: string | null;
      hand_enter: string | null; company_xref: string | null;
      payroll_status: string | null; payroll_use: string | null; last_transaction: string | null;
    };

    // The policy half is best-effort. A card page that fails because the vendor is slow is worse than
    // one that renders card-level truth and says the policy could not be read.
    let policy = null;
    let policyError: string | null = null;
    if (row.policy_number != null) {
      try {
        const creds = await getEfsSoapCredentials(admin, env, orgId);
        if (creds?.enabled) policy = await getPolicy(env, creds, row.policy_number);
      } catch (error) {
        policyError = error instanceof EfsSoapError ? error.message : "Could not read the policy";
      }
    }

    const document = row.document as {
      infos?: { infoId: string }[]; limits?: { limitId: string }[];
      timeRestrictions?: { day: number }[];
    };
    const access = await loadCardControlAccess(admin, env, orgId, req.auth!.userId, req.auth!.role);

    res.json({
      card: { ...toSummary(row), companyXref: row.company_xref, handEnter: row.hand_enter,
              payrollStatus: row.payroll_status, payrollUse: row.payroll_use,
              lastTransaction: row.last_transaction, version: row.card_version, document: row.document },
      // Computed server-side so "card level always trumps policy" (p37) lives in ONE place and every
      // surface that ever renders it agrees.
      effective: {
        infos: mergeEffectiveConfig(document.infos ?? [], policy?.infos ?? [], row.info_source, (i) => i.infoId),
        limits: mergeEffectiveConfig(document.limits ?? [], policy?.limits ?? [], row.limit_source, (l) => l.limitId),
        timeRestrictions: mergeEffectiveConfig(
          document.timeRestrictions ?? [], policy?.timeRestrictions ?? [], row.time_source, (t) => String(t.day),
        ),
        sources: { infoSource: row.info_source, limitSource: row.limit_source, timeSource: row.time_source },
        policyDescription: policy?.description ?? null,
        policyError,
      },
      capabilities: access,
      staleAfterMinutes: staleAfterMinutes(env),
    });
  }));

  /**
   * Re-read one card from EFS, now. Synchronous: it is one paced vendor call, an operator is waiting,
   * and a job id for a two-second read would be theatre.
   */
  router.post("/:id/refresh", requireOrg, canView, asyncHandler(async (req, res) => {
    const { env } = getAppLocals(req);
    const admin = getSupabaseAdmin(env);
    const orgId = req.auth!.orgId!;

    const creds = await getEfsSoapCredentials(admin, env, orgId);
    if (!creds?.enabled) {
      res.status(409).json(apiError("efs_not_configured", "EFS is not connected for this company."));
      return;
    }
    // The unseal is the only place a PAN enters memory on this path, and it is org-scoped.
    const cardNumber = await loadCardNumber(admin, env, orgId, String(req.params.id));
    if (!cardNumber) {
      res.status(404).json(apiError("not_found", "That card is not in this company."));
      return;
    }
    try {
      const { cardVersion } = await refreshCardDetail(admin, env, creds, cardNumber, { priority: "interactive" });
      res.json({ ok: true, version: cardVersion });
    } catch (error) {
      efsErrorResponse(res, error);
    }
  }));

  return router;
}
