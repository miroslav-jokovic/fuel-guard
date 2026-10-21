import type { SupabaseClient } from "@supabase/supabase-js";
import type { GlKeyLine, TmsLedgerKeyLinesPayload } from "@silvicom/shared";

/**
 * The general ledger per posting key (0509, TRUCK-DRIVER-PNL-PLAN P0c) — the landing and the read.
 *
 * Its own file beside `ledgerControlIngest.ts`: the module totals are the whole-ledger control, these
 * are the four modules a staged sub-ledger posts through, at the grain a tie needs.
 */

export interface LedgerKeyLinesIngestResult {
  received: number;
  upserted: number;
  staleRemoved: number;
  /** Set when nothing was written and nothing deleted, and why. */
  skipped?: "empty";
}

/**
 * One month, replaced whole by `replace_mcleod_gl_key_lines` in one transaction under one stamp.
 * ZERO ROWS NEVER DELETE (D-FIN6): an empty read is a measurement of the source — a wrong company
 * id, a month past the data's edge — and the month keeps what it had.
 *
 * Called one merge after 0509 applied in production, because `lint:migration-ordering` cannot see a
 * function and the deploy window would otherwise serve a caller of an RPC that does not exist yet.
 */
export async function ingestLedgerKeyLines(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsLedgerKeyLinesPayload,
): Promise<LedgerKeyLinesIngestResult> {
  if (payload.lines.length === 0) {
    console.warn(
      `[mcleod-financial] org ${orgId}: ledger-key-lines sweep for ${payload.period_start} returned zero rows — ` +
        `month left untouched (D-FIN6)`,
    );
    return { received: 0, upserted: 0, staleRemoved: 0, skipped: "empty" };
  }
  const { data, error } = await admin.rpc("replace_mcleod_gl_key_lines", {
    p_org: orgId,
    p_company_id: payload.company_id ?? null,
    p_period_start: payload.period_start,
    p_period_end: payload.period_end,
    p_rows: payload.lines.map((l) => ({
      txn_date: l.txn_date,
      post_module: l.post_module,
      post_key: l.post_key,
      glid: l.glid,
      lines: l.lines,
      net_amount: l.net_amount,
    })),
  });
  if (error) throw new Error(`replace_mcleod_gl_key_lines failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { upserted?: number; stale_removed?: number } | null;
  return { received: payload.lines.length, upserted: row?.upserted ?? 0, staleRemoved: row?.stale_removed ?? 0 };
}

const PAGE = 1000;

/**
 * A window's key lines, every module. Paged — a month is ~15,000 rows against PostgREST's 1,000-row
 * cap — on the table's identity, so the pages are a total order and none repeats or drops a row.
 */
export async function readLedgerKeyLines(
  admin: SupabaseClient,
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<GlKeyLine[]> {
  const out: GlKeyLine[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("mcleod_gl_key_lines")
      .select("txn_date, post_module, post_key, glid, line_count, net_amount")
      .eq("org_id", orgId)
      .gte("txn_date", fromIso)
      .lt("txn_date", toIso)
      .order("company_id", { ascending: true })
      .order("post_module", { ascending: true })
      .order("post_key", { ascending: true })
      .order("glid", { ascending: true })
      .order("txn_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`mcleod_gl_key_lines read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ txn_date: string; post_module: string; post_key: string; glid: string; line_count: number; net_amount: number | string }>;
    for (const r of rows) {
      out.push({ txn_date: r.txn_date, post_module: r.post_module, post_key: r.post_key, glid: r.glid, lines: r.line_count, net_amount: Number(r.net_amount) });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}
