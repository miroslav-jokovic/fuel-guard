import type { SupabaseClient } from "@supabase/supabase-js";
import type { TmsLedgerTotalsPayload, TmsGlAccountsPayload } from "@silvicom/shared";

/**
 * GL control-totals ingest (0269) — one calendar month's per-(module, account) totals land, and
 * the month is REPLACED wholesale: upsert every swept row under a fresh batch stamp, then delete
 * the month's rows bearing an older stamp. The delete is what a plain upsert cannot do — a
 * reclassified entry moves money BETWEEN accounts, and without it the old account's stale total
 * would stand next to the new one's, which is precisely the kind of quiet double-count this table
 * exists to catch in others.
 *
 * Since 2026-09-03 the replace is ONE statement, so the upsert and the stale delete share a
 * transaction and a stamp; since W1b it is `replace_mcleod_gl_days` (0310) and what lands is the
 * DAY rows McLeod asserts, with the month derived from them. Each of those readers moved onto its
 * function one merge after the migration had applied in production (`pnpm verify:live`), because
 * `lint:migration-ordering` cannot see a function and the deploy window would otherwise serve a
 * caller of an RPC that did not exist yet for ~9 minutes.
 *
 * `replace_mcleod_gl_month` (0302 → 0304) is now unused by application code and is deliberately
 * left standing: its matrix still proves the behaviour the new function inherited, and dropping a
 * function while a previous build may still be serving it is the hazard the deploy window runs in
 * reverse (MIGRATION-DISCIPLINE §the-deploy-window). It goes with W1c, once the day path has run
 * against the live database.
 *
 * ZERO ROWS NEVER DELETE (D-FIN6, FINANCE-GO-LIVE-PLAN §1.6). Before 2026-09-03 an empty payload
 * upserted nothing and then deleted every row of the month bearing an older stamp — which is every
 * row. A transient empty read (wrong company id on the agent, a month past the sandbox's data
 * edge, a query that returned before the ledger was posted) erased the month's control totals and
 * took the CPM page's "fleet truth" with them. Zero rows is a MEASUREMENT of the source and is
 * returned as `skipped: "empty"` for the caller to log and surface; the month keeps what it had.
 */


const CHUNK = 500;

export interface LedgerTotalsIngestResult {
  received: number;
  /** Day rows written. Since W1b this is the grain the source asserts, not the month's summary. */
  upserted: number;
  staleRemoved: number;
  /** Rows in the derived monthly rollup — the same money, summed, for readers that want a month. */
  monthRows?: number;
  /** Set when nothing was written and nothing deleted, and why. */
  skipped?: "empty";
}

export async function ingestLedgerTotals(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsLedgerTotalsPayload,
): Promise<LedgerTotalsIngestResult> {
  if (payload.totals.length === 0) {
    console.warn(
      `[mcleod-financial] org ${orgId}: ledger-totals sweep for ${payload.period_start} returned zero rows — ` +
        `month left untouched (D-FIN6); check the agent's company id and whether McLeod has posted the month`,
    );
    return { received: 0, upserted: 0, staleRemoved: 0, skipped: "empty" };
  }
  // One statement, one stamp (0310, W1b): `replace_mcleod_gl_days` stages the month's DAY rows and
  // derives the `mcleod_gl_totals` rollup by summing exactly those rows, inside one transaction
  // scoped to the org, the company and the month. It replaces `replace_mcleod_gl_month` (0302 →
  // 0304), which took rows already summed to the month — the grain our collector invented rather
  // than the one McLeod asserts (D-FLEET9). This reader moved onto it one merge after 0310 had
  // applied in production (`pnpm verify:live`), because `lint:migration-ordering` cannot see a
  // function and the deploy window would otherwise serve a caller of an RPC that did not exist yet.
  const { data, error } = await admin.rpc("replace_mcleod_gl_days", {
    p_org: orgId,
    p_company_id: payload.company_id ?? null,
    p_period_start: payload.period_start,
    p_period_end: payload.period_end,
    p_rows: payload.totals.map((t) => ({
      txn_date: t.txn_date,
      post_module: t.post_module,
      glid: t.glid,
      lines: t.lines,
      net_amount: t.net_amount,
      abs_amount: t.abs_amount,
    })),
  });
  if (error) throw new Error(`replace_mcleod_gl_days failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { day_upserted?: number; day_stale_removed?: number; month_upserted?: number }
    | null;
  return {
    received: payload.totals.length,
    upserted: row?.day_upserted ?? 0,
    staleRemoved: row?.day_stale_removed ?? 0,
    monthRows: row?.month_upserted ?? 0,
  };
}

/**
 * Chart-of-accounts ingest (0272) — the whole master lands with every sweep, full-row idempotent
 * upsert on (org_id, glid). No stale-delete: an account that stops appearing in the master was
 * deleted in McLeod, and keeping its name lets historical GL totals stay classifiable — the same
 * reason evidence rows never disappear when their source does.
 */
export async function ingestGlAccounts(
  admin: SupabaseClient,
  orgId: string,
  payload: TmsGlAccountsPayload,
): Promise<{ received: number; upserted: number }> {
  let upserted = 0;
  for (let i = 0; i < payload.accounts.length; i += CHUNK) {
    const rows = payload.accounts.slice(i, i + CHUNK).map((a) => ({
      org_id: orgId,
      glid: a.glid,
      descr: a.descr ?? null,
      type_id: a.type_id ?? null,
      updated_at: new Date().toISOString(),
    }));
    const { data, error } = await admin
      .from("mcleod_gl_accounts")
      .upsert(rows, { onConflict: "org_id,glid" })
      .select("id");
    if (error) throw new Error(`mcleod_gl_accounts upsert failed: ${error.message}`);
    upserted += data?.length ?? rows.length;
  }
  return { received: payload.accounts.length, upserted };
}
