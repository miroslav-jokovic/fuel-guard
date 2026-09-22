import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Data retention as code — the single place that says how long each table's rows live, and the runner
 * that enforces it in bounded batches. Runs daily per org through the jobs ledger (kind
 * `data_retention`), so growth is capped by POLICY instead of by the next incident.
 *
 * Principles:
 *  - Only DERIVED or REPRODUCIBLE data is pruned: raw telematics whose aggregates live on in
 *    idle_rollup_days, finished job rows, and rebuildable caches. Business records (fuel/EFS
 *    transactions, anomalies, driver scores) and the audit ledger are NEVER listed here — audit_logs is
 *    an append-only compliance record and pruning it would be evidence destruction (a guard test pins
 *    this).
 *  - Deletes are BOUNDED — id batches through the existing (org_id, time) indexes, or oldest-first time
 *    slices for tables without an id column — never one giant DELETE that could blow the statement
 *    timeout (the same failure mode the HOS sync hit for writes).
 *  - Each run is capped per table; a backlog converges over successive daily runs instead of producing
 *    one monster run.
 */

/** Ids per delete statement (id strategy). */
const BATCH = 1000;
/** Max delete statements per table per run — a backlog drains across daily runs. */
const MAX_BATCHES = 30;
/** Time-slice width for tables pruned oldest-first without an id column. */
const SLICE_MS = 30 * 86_400_000;
/** Max time slices per table per run. */
const MAX_SLICES = 12;

import {
  RETENTION_RULES,
  RETENTION_FORBIDDEN,
  type RetentionRule,
} from "./dataRetentionPolicy.js";

// Re-exported so the split stays invisible to every existing importer and to the guard test: the
// policy moved house, it did not change hands.
export { RETENTION_RULES, RETENTION_FORBIDDEN, type RetentionRule };

export interface RetentionTableResult {
  table: string;
  deleted: number;
  /** True when the per-run cap was hit — more rows remain and tomorrow's run continues. */
  capped: boolean;
}

export interface RetentionResult {
  tables: RetentionTableResult[];
  totalDeleted: number;
}

const cutoffFor = (rule: RetentionRule): string => {
  const iso = new Date(Date.now() - rule.keepDays * 86_400_000).toISOString();
  return rule.timeColumn === "day" ? iso.slice(0, 10) : iso; // DATE columns compare on the date part
};

/** id strategy: select a batch of ids past the cutoff (via the (org_id, time) index), delete by id. */
async function pruneById(
  admin: SupabaseClient,
  orgId: string,
  rule: RetentionRule,
): Promise<RetentionTableResult> {
  const cutoff = cutoffFor(rule);
  let deleted = 0;
  let batches = 0;
  for (; batches < MAX_BATCHES; batches++) {
    let q = admin
      .from(rule.table)
      .select("id")
      .lt(rule.timeColumn, cutoff)
      .order(rule.timeColumn, { ascending: true })
      .limit(BATCH);
    if (rule.orgScoped) q = q.eq("org_id", orgId);
    if (rule.onlyWhenIn) q = q.in(rule.onlyWhenIn.column, rule.onlyWhenIn.values);
    const { data, error } = await q;
    if (error) throw new Error(`${rule.table} select: ${error.message}`);
    const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) break;
    let d = admin.from(rule.table).delete().in("id", ids);
    if (rule.orgScoped) d = d.eq("org_id", orgId);
    const { error: derr } = await d;
    if (derr) throw new Error(`${rule.table} delete: ${derr.message}`);
    deleted += ids.length;
    if (ids.length < BATCH) {
      batches++;
      break;
    }
  }
  return { table: rule.table, deleted, capped: batches >= MAX_BATCHES };
}

/** timeSlice strategy (composite-PK tables): delete oldest-first 30-day slices up to the cutoff. */
async function pruneByTimeSlice(
  admin: SupabaseClient,
  orgId: string,
  rule: RetentionRule,
): Promise<RetentionTableResult> {
  const cutoff = cutoffFor(rule);
  let deleted = 0;
  let slices = 0;
  for (; slices < MAX_SLICES; slices++) {
    let oq = admin
      .from(rule.table)
      .select(rule.timeColumn)
      .not(rule.timeColumn, "is", null)
      .order(rule.timeColumn, { ascending: true })
      .limit(1);
    if (rule.orgScoped) oq = oq.eq("org_id", orgId);
    const { data: oldestRows, error: oerr } = await oq;
    if (oerr) throw new Error(`${rule.table} oldest: ${oerr.message}`);
    const oldest = (oldestRows?.[0] as Record<string, string> | undefined)?.[rule.timeColumn];
    // Numeric compare — PostgREST may format timestamptz with "+00:00" while our cutoff uses "Z".
    if (!oldest || Date.parse(oldest) >= Date.parse(cutoff)) break;
    const sliceEnd = new Date(
      Math.min(Date.parse(oldest) + SLICE_MS, Date.parse(cutoff)),
    ).toISOString();
    let d = admin
      .from(rule.table)
      .delete({ count: "exact" })
      .lt(rule.timeColumn, sliceEnd)
      .not(rule.timeColumn, "is", null);
    if (rule.orgScoped) d = d.eq("org_id", orgId);
    const { count, error: derr } = await d;
    if (derr) throw new Error(`${rule.table} delete: ${derr.message}`);
    deleted += count ?? 0;
  }
  return { table: rule.table, deleted, capped: slices >= MAX_SLICES };
}

/** Enforce every retention rule for one org. Rules are independent — one failing table doesn't stop the
 *  rest; the first error is rethrown at the end so the job records the failure after doing all it could. */
export async function runDataRetention(
  admin: SupabaseClient,
  orgId: string,
  rules: RetentionRule[] = RETENTION_RULES,
): Promise<RetentionResult> {
  const tables: RetentionTableResult[] = [];
  let firstError: Error | null = null;
  for (const rule of rules) {
    try {
      const r =
        rule.strategy === "id"
          ? await pruneById(admin, orgId, rule)
          : await pruneByTimeSlice(admin, orgId, rule);
      if (r.deleted > 0 || r.capped) {
        console.log(
          `[retention] ${rule.table}: deleted ${r.deleted} rows older than ${rule.keepDays}d` +
            (r.capped ? " (capped — continues next run)" : ""),
        );
      }
      tables.push(r);
    } catch (e) {
      firstError ??= e instanceof Error ? e : new Error(String(e));
      console.error(`[retention] ${rule.table} failed: ${firstError.message}`);
      tables.push({ table: rule.table, deleted: 0, capped: false });
    }
  }
  if (firstError) throw firstError;
  return { tables, totalDeleted: tables.reduce((s, t) => s + t.deleted, 0) };
}
