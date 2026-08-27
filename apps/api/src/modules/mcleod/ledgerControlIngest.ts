import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsLedgerTotalsPayload } from "@silvicom/shared";

/**
 * GL control-totals ingest (0269) — one calendar month's per-(module, account) totals land, and
 * the month is REPLACED wholesale: upsert every swept row under a fresh batch stamp, then delete
 * the month's rows bearing an older stamp. The delete is what a plain upsert cannot do — a
 * reclassified entry moves money BETWEEN accounts, and without it the old account's stale total
 * would stand next to the new one's, which is precisely the kind of quiet double-count this table
 * exists to catch in others.
 *
 * The two steps are not atomic; between them a reader can see the month over-complete (old and new
 * rows together), never under-complete. For a reconciliation report re-swept nightly, a
 * seconds-wide over-complete window is acceptable; an RPC can make it atomic if a consumer ever
 * appears for whom it is not.
 */

const CHUNK = 500;

export interface LedgerTotalsIngestResult {
  received: number;
  upserted: number;
  staleRemoved: number;
}

export async function ingestLedgerTotals(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsLedgerTotalsPayload,
): Promise<LedgerTotalsIngestResult> {
  const sweptAt = new Date().toISOString();
  let upserted = 0;
  for (let i = 0; i < payload.totals.length; i += CHUNK) {
    const rows = payload.totals.slice(i, i + CHUNK).map((t) => ({
      org_id: orgId,
      period_start: payload.period_start,
      period_end: payload.period_end,
      post_module: t.post_module,
      glid: t.glid,
      line_count: t.lines,
      net_amount: t.net_amount,
      abs_amount: t.abs_amount,
      swept_at: sweptAt,
    }));
    const { data, error } = await admin
      .from("mcleod_gl_totals")
      .upsert(rows, { onConflict: "org_id,period_start,post_module,glid" })
      .select("id");
    if (error) throw new Error(`mcleod_gl_totals upsert failed: ${error.message}`);
    upserted += data?.length ?? rows.length;
  }

  const { data: stale, error: delErr } = await admin
    .from("mcleod_gl_totals")
    .delete()
    .eq("org_id", orgId)
    .eq("period_start", payload.period_start)
    .lt("swept_at", sweptAt)
    .select("id");
  if (delErr) throw new Error(`mcleod_gl_totals stale delete failed: ${delErr.message}`);

  return { received: payload.totals.length, upserted, staleRemoved: stale?.length ?? 0 };
}
