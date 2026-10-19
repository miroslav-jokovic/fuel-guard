import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerClose, TmsGlControlPayload } from "@silvicom/shared";

/**
 * McLeod's open accounting period per company (0493, TRUCK-DRIVER-PNL-PLAN D-TP5) — the landing and
 * the one read.
 *
 * Its own file rather than another function in `financialReads.ts` or `ledgerControlIngest.ts`: it is
 * not a ledger amount, it is the verdict on whether the amounts can still move, and the one reader is
 * the month assessment in the financial module (`ledgerPeriod.ts`).
 */

/**
 * One row per (org, company), replaced whole by every sweep — the open period only ever describes
 * "now", so there is no history to keep and an UPDATE-shaped upsert of the full row is the honest
 * write. Every NOT NULL column is in the payload (`lint:upserts`).
 */
export async function ingestGlControl(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsGlControlPayload,
): Promise<{ received: number; upserted: number }> {
  const c = payload.control;
  const { data, error } = await admin
    .from("mcleod_gl_control")
    .upsert(
      {
        org_id: orgId,
        company_id: c.company_id,
        fiscal_year: c.fiscal_year,
        fiscal_period: c.fiscal_period,
        prior_post_allowed: c.prior_post_allowed,
        period_start: c.period_start,
        period_end: c.period_end,
        swept_at: new Date().toISOString(),
      },
      { onConflict: "org_id,company_id" },
    )
    .select("id");
  if (error) throw new Error(`mcleod_gl_control upsert failed: ${error.message}`);
  return { received: 1, upserted: data?.length ?? 1 };
}

/**
 * The close verdict the month assessment takes, or null when McLeod has told us nothing that makes
 * any month final.
 *
 * Across companies the EARLIEST open period wins — a fleet month is final only when every company's
 * books behind it are — and one company that allows posting into earlier periods makes no month
 * final at all. Today this carrier sweeps one company (TMS), so the two rules agree; they are written
 * for the day it does not.
 */
export async function readLedgerClose(admin: SupabaseClient, orgId: string): Promise<LedgerClose | null> {
  const { data, error } = await admin
    .from("mcleod_gl_control")
    .select("company_id, period_start, prior_post_allowed, swept_at")
    .eq("org_id", orgId);
  if (error) throw new Error(`mcleod_gl_control read failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ company_id: string; period_start: string; prior_post_allowed: boolean; swept_at: string }>;
  if (!rows.length || rows.some((r) => r.prior_post_allowed)) return null;
  const earliest = rows.reduce((a, b) => (String(b.period_start) < String(a.period_start) ? b : a));
  return { openMonth: String(earliest.period_start).slice(0, 7), sweptAt: String(earliest.swept_at) };
}
