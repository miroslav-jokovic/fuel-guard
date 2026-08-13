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

export interface RetentionRule {
  table: string;
  /** Column the cutoff compares against (rows strictly older are pruned). */
  timeColumn: string;
  keepDays: number;
  /** "id": select ids past cutoff → delete by id (needs an `id` column). "timeSlice": delete oldest-first
   *  30-day slices (for composite-PK tables). */
  strategy: "id" | "timeSlice";
  /** False for global caches without an org_id column. */
  orgScoped: boolean;
  /** Extra filter, e.g. jobs: only finished runs. Column → value-list (IN). */
  onlyWhenIn?: { column: string; values: string[] };
  /** Why this retention is safe — the policy rationale, kept next to the number. */
  why: string;
}

/**
 * The policy. Raw telematics: 400 days (rolling ~13 months) — idle_rollup_days carries the history the
 * product needs beyond that, and the Samsara API can re-backfill if ever required. Finished jobs: 90
 * days is ample for the Data & Sync freshness UI. Caches: rebuilt/re-fetched on demand.
 */
export const RETENTION_RULES: RetentionRule[] = [
  {
    table: "idle_events",
    timeColumn: "started_at",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "raw Samsara idling events; aggregated into idle_rollup_days",
  },
  {
    table: "hos_duty_segments",
    timeColumn: "started_at",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "raw ELD duty intervals; duty split preserved in idle_rollup_days",
  },
  {
    table: "idle_park_sessions",
    timeColumn: "started_at",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "derived park sessions; mode split preserved in idle_rollup_days",
  },
  {
    table: "idle_telemetry_windows",
    timeColumn: "synced_at",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "derived current-window telemetry evidence; rebuilt from Samsara vehicle stats",
  },
  {
    table: "vehicle_engine_days",
    timeColumn: "day",
    keepDays: 400,
    strategy: "id",
    orgScoped: true,
    why: "per-day engine totals; mirrored in idle_rollup_days",
  },
  {
    table: "driver_vehicle_assignments",
    timeColumn: "end_at",
    keepDays: 400,
    strategy: "timeSlice",
    orgScoped: true,
    why: "closed assignment intervals (lt on end_at never matches open ones); attribution stored on rollup days",
  },
  {
    table: "jobs",
    timeColumn: "created_at",
    keepDays: 90,
    strategy: "id",
    orgScoped: true,
    onlyWhenIn: { column: "status", values: ["done", "failed"] },
    why: "finished background-job ledger rows; freshness UI only needs recent history",
  },
  {
    table: "route_geometries",
    timeColumn: "created_at",
    keepDays: 180,
    strategy: "id",
    orgScoped: false,
    why: "global route polyline cache; re-fetched on demand",
  },
  {
    table: "weather_cache",
    timeColumn: "hour_utc",
    keepDays: 400,
    strategy: "timeSlice",
    orgScoped: false,
    why: "global hourly weather grid; only consulted for events inside the raw-telematics window",
  },
  /**
   * D-LD8. 49 CFR Part 379 App. A puts freight bills and bills of lading at ONE year — but Carmack
   * (49 U.S.C. §14706(e)) lets a shipper file for nine months after delivery and sue for two years
   * after a denial, so a proof-of-delivery photo can decide a claim close to three years out.
   * Retaining for the regulatory floor and destroying the photograph that would have won the claim is
   * the worst of both: compliant, and out of pocket.
   *
   * Deleting the row is the whole mechanism. The object then has no row pointing at it, and the
   * `load-photos` orphan sweep already running in hazmatStorageReconcileScheduler removes the bytes
   * on its next pass after the 24-hour grace. Two mechanisms built for other reasons compose into
   * the policy, and neither had to change.
   */
  {
    table: "load_stop_photos",
    timeColumn: "uploaded_at",
    keepDays: 1095,
    strategy: "id",
    orgScoped: true,
    why: "proof-of-work photos; 3y covers the Carmack claim window (9mo to file + 2y to sue) past the 1y §379 floor",
  },
];

/** Tables that must NEVER appear in RETENTION_RULES — pinned by a guard test. */
export const RETENTION_FORBIDDEN = [
  "audit_logs", // append-only compliance ledger
  "platform_audit_log",
  "fuel_transactions", // business records
  "efs_transactions",
  "efs_card_mutations", // card-control ledger
  "fuel_events",
  "declined_transactions",
  "anomalies",
  "driver_scores",
  "driver_performance_weeks", // frozen rewards ledger
  "organizations",
  "drivers",
  "vehicles",
  /**
   * D-BD12 — the driver qualification file. §391.51 measures retention in YEARS (the MVR review for
   * three, the file itself for as long as the driver is employed plus three), and §390.32(d) requires
   * an electronic record to still be reproducible when asked for. Until now nothing stopped someone
   * adding these to a retention rule in six months and quietly pruning a driver's history — the
   * history the binder is built to reproduce. `documents` is the scan behind every one of these rows
   * and is append-only by RLS for exactly the same reason.
   */
  "certifications",
  "qualification_records",
  "documents",
  /** The export ledger (0152). The bytes expire after seven days; the row that says who pulled a
   *  driver's medical card out of the system does not (D-BD9). */
  "dq_exports",
] as const;

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
