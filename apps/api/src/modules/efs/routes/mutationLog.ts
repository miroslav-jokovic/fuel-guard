import { z } from "zod";
import type { Request, Response } from "express";
import { maskPan } from "@silvicom/shared";
import { getAppLocals } from "../../../lib/appLocals.js";
import { apiError, dbErrorResponse } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { toMutationView } from "./mutationView.js";

/**
 * Every card change on the account, filtered — the Audit Log page's "Card changes" tab (Step 6.6).
 *
 * ── Why this is an API route and not a Supabase query from the browser ──────────────────────────
 * `AuditPage.vue` reads `audit_logs` directly under RLS, so copying that shape is the obvious move.
 * It does not work here and fails SILENTLY: `efs_card_mutations` has RLS enabled and **no policy**
 * (migration 0177), deliberately, because the ledger carries `before_document`, `after_document` and
 * redacted vendor XML that no page should be able to pull. A client query against it returns an
 * empty list, not an error — a tab that looks like a card nobody has ever changed.
 *
 * ── ⚠️ Mounted BEFORE `/:id` ────────────────────────────────────────────────────────────────────
 * `/:id` is a dynamic segment in the same router. Registered after it, `/mutations` is swallowed as
 * `id = "mutations"` and answers 404 — which reads as a missing card rather than a routing mistake.
 * `apps/api/src/routes/fuelCards.test.ts` covers it: `/:id` validates nothing, so a swallowed
 * `/mutations?from=nonsense` would be a card lookup instead of the 400 this must give.
 */

/**
 * The tab's filters. Dates are plain `YYYY-MM-DD` — what `DateRangeFilter` emits.
 *
 * `limit` is capped: this is a paged table, and an uncapped one would let a caller pull the whole
 * ledger — including every org's worth of rows the range would otherwise span — in one request.
 */
export const mutationLogQuerySchema = z.object({
  cardId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

interface LoggedCard {
  id: string;
  card_last4: string | null;
  unit_prompt: string | null;
  driver_name: string | null;
}

/** The per-card view plus who the card IS — the tab lists many cards, so each row must say which. */
const toLogView = (row: unknown) => {
  const card = (row as { efs_cards: LoggedCard | null }).efs_cards;
  return {
    ...toMutationView(row),
    cardId: card?.id ?? null,
    // Masked, never a PAN. `maskPan` is the one mask in this codebase, and the last four is all the
    // mirror stores anyway — but routing it through the mask keeps that true by construction.
    maskedRef: card?.card_last4 ? maskPan(card.card_last4) : "—",
    unitPrompt: card?.unit_prompt ?? null,
    driverName: card?.driver_name ?? null,
  };
};

export async function handleMutationLog(req: Request, res: Response): Promise<void> {
  // Filters are validated BEFORE the admin client is built. A malformed date is a bad request, not a
  // reason to reach for infrastructure — and building the client first turned every 400 into a 500
  // wherever Supabase is unconfigured, which is precisely where the route tests run.
  const parsed = mutationLogQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid filter"));
    return;
  }
  const { cardId, search, from, to, limit, offset } = parsed.data;

  const { env } = getAppLocals(req);
  const admin = getSupabaseAdmin(env);
  const orgId = req.auth!.orgId!;

  let query = admin
    .from("efs_card_mutations")
    // Explicit columns, same rule as `/:id/history`, plus the card identity so the table can NAME
    // the card. `select("*")` would ship the before/after documents this route exists to withhold.
    .select(
      "id, intent, status, requested_by, step_up, created_at, completed_at, "
      + "efs_fault_code, efs_fault_message, drift, "
      + "efs_cards!inner(id, card_last4, unit_prompt, driver_name)",
      { count: "exact" },
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (cardId) query = query.eq("efs_card_id", cardId);
  // Inclusive of the whole `to` day: an operator picking 16 August means the 16th, and a bare `lte`
  // against a timestamp silently excludes everything after midnight — the change they are looking for.
  if (from) query = query.gte("created_at", `${from}T00:00:00Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);
  if (search) {
    // Search is over the CARD — last four, unit, driver: the three things an operator has to hand.
    // Wildcard characters are stripped rather than escaped, matching the list route.
    const term = search.replace(/[%,()]/g, "");
    query = query.or(
      `card_last4.ilike.%${term}%,unit_prompt.ilike.%${term}%,driver_name.ilike.%${term}%`,
      { referencedTable: "efs_cards" },
    );
  }

  const { data, error, count } = await query;
  if (error) {
    dbErrorResponse(res, "fuel-cards.mutations", error, "Could not load card changes");
    return;
  }
  res.json({ mutations: (data ?? []).map(toLogView), total: count ?? (data?.length ?? 0) });
}
