import type { SupabaseClient } from "@supabase/supabase-js";
import type { EfsCardSummary } from "@silvicom/shared";
import { EFS_CARD_LIST_COLS } from "./efsCardMirror.js";
import { cardRowToSummary, type EfsCardListRow } from "./efsCardSummary.js";

/**
 * The Fuel Cards page's list read (`GET /api/fuel-cards`), out of the route so a second reader asks
 * the same question (F21 R6b, 2026-11-10: Ask AI's `card_holds`). It was inline in `routes/read.ts`;
 * a copy in the assistant would have been a second status filter and a second masking path, which is
 * exactly how a report ends up disagreeing with the page or carrying a field the page masks.
 *
 * Reads the MIRROR (`efs_cards`), never EFS: no vendor call, no PAN (`card_number_sealed` is not in
 * `EFS_CARD_LIST_COLS`), and every row goes through `cardRowToSummary`, where the masking lives.
 *
 * ORG-SCOPED: the service role bypasses RLS, so `org_id` is chained here, from the caller's verified org.
 */

export interface EfsCardListFilter {
  /** A status as the filter offers it (`Hold`); matched case-blind, because the account stores `HOLD`. */
  status?: string;
  /** Last four, unit, driver id or driver name. */
  search?: string;
  /** The route's ceiling, 2,000: see its schema for why it is not a page size. */
  limit?: number;
}

export type EfsCardListResult =
  | { ok: true; cards: EfsCardSummary[]; total: number }
  | { ok: false; error: { message?: string; code?: string } };

export async function listEfsCards(admin: SupabaseClient, orgId: string, filter: EfsCardListFilter = {}): Promise<EfsCardListResult> {
  // `count: exact` so `total` is what the company OWNS, not what this response happened to carry.
  let query = admin
    .from("efs_cards")
    .select(EFS_CARD_LIST_COLS, { count: "exact" })
    .eq("org_id", orgId);
  // ilike, not eq: the filter's values come from the documented enum (Active/Hold/…) while a
  // production account stores ACTIVE/HOLD. `eq` matched nothing and the page looked empty.
  if (filter.status) query = query.ilike("status", filter.status);
  if (filter.search) {
    // Last four, unit number or driver id — the three things an operator actually has to hand.
    const term = filter.search.replace(/[%,()]/g, "");
    // driver_name included because the list now SHOWS it — a column you can read but not search for
    // is a column people scroll past looking for the name they already know.
    query = query.or(
      `card_last4.ilike.%${term}%,unit_prompt.ilike.%${term}%,driver_id_prompt.ilike.%${term}%,driver_name.ilike.%${term}%`,
    );
  }
  const { data, error, count } = await query.order("card_last4").limit(filter.limit ?? 2000);
  if (error) return { ok: false, error };
  const rows = (data ?? []) as unknown as EfsCardListRow[];
  // The company's real count. `cards.length` is what came back; a difference between the two is the
  // only honest signal that a limit truncated the answer.
  return { ok: true, cards: rows.map(cardRowToSummary), total: count ?? rows.length };
}
