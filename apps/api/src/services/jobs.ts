import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Background job ledger (migration 0027). Every long-running background operation runs THROUGH this so
 * the UI can show progress + freshness, failures are visible (not just server logs), and a second
 * concurrent run of the same kind for the same org is refused by the DB (partial unique index → 23505).
 */

export type JobKind =
  | "rebuild"
  | "backfill"
  | "score_import"
  | "score_declined_import"
  | "rescore_declined"
  | "score_txn" // one-fill score+cascade (POST /transactions/:id/score) — P0-3 serialization
  | "efs_store_sync" // repair from the faithful EFS store (POST /transactions/sync-from-efs)
  | "sync_vehicles"
  | "sync_trailers"
  | "sync_idle"
  | "sync_hos"
  | "sync_stats"
  | "sync_drivers"
  | "nightly_reconcile"
  | "efs_ingest"
  | "efs_soap_posted" // EFS SOAP posted-feed acquisition (docs/plans/EFS-SOAP-INTEGRATION-PLAN.md)
  | "efs_soap_rejected" // EFS SOAP rejected-feed acquisition
  | "efs_process_import" // durable post-acquisition scoring + alert emission
  | "sync_driver_scores"
  | "snapshot_driver_week"
  | "hazmat_extract"
  | "hazmat_analyze"
  | "pattern_sweep" // entity-intelligence Phase 2: read-only retrospective analysis of a flagged case
  | "data_retention" // daily retention-policy enforcement (services/dataRetention.ts)
  | "dq_binder"; // assemble an auditor's sample of §391.51 files into one PDF (DQ-BINDER-PLAN)

/**
 * P0-3 (2026-08 audit) — ONE per-org mutex across every path that writes fuel_transactions scoring
 * outcomes. Concurrent scorers of the same rows are last-writer-wins on case_level/case_signals and
 * duplicate the re-attribution/self-heal side effects, so all scoring-capable jobs carry this
 * dedup_key. It rides the GLOBAL `idx_jobs_active_dedup` partial unique index (migration 0095):
 * two active jobs with the same key are refused by the DB regardless of their `kind`, which is
 * exactly the cross-kind exclusion the per-(org,kind) slot cannot express.
 */
export const scoringDedupKey = (orgId: string): string => `scoring:${orgId}`;

/** Job kinds whose work scores fuel transactions — dispatchJob applies the scoring mutex to these. */
export const SCORING_JOB_KINDS: ReadonlySet<JobKind> = new Set<JobKind>([
  "rebuild",
  "backfill",
  "score_import",
  "score_txn",
  "efs_store_sync",
  "efs_ingest", // legacy file ingestion scores its new rows inline
  "efs_process_import", // durable post-EFS scoring and alert processing
  "nightly_reconcile", // runs syncFuelEventsFromEfs + backfillOrg internally
]);

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobRow {
  id: string;
  org_id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  total: number | null;
  error: string | null;
  stats: Record<string, unknown>;
  requested_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Thrown when a run of the same (org, kind) is already active — surfaced to the client as 409. */
export class JobConflictError extends Error {
  constructor(public kind: JobKind) {
    super(`A ${kind} job is already running`);
    this.name = "JobConflictError";
  }
}

/** Progress reporter handed to job work functions. */
export type ProgressReporter = (done: number, total?: number) => Promise<void>;

export interface StartJobOpts {
  total?: number | null;
  requestedBy?: string | null;
  /** Cross-kind mutex key (rides idx_jobs_active_dedup). Scoring jobs pass scoringDedupKey(orgId). */
  dedupKey?: string | null;
}

/**
 * A job still marked "running" after this long is presumed dead (process crashed / hung await mid-run) —
 * the partial unique index would otherwise wedge that (org, kind) slot forever. The boot sweep clears the
 * common case (restart); this TTL is the backstop for LEGACY rows with no lease. Leased jobs (everything
 * started after the P0-4 fix) are reclaimed on lease EXPIRY instead — a live job heartbeats its lease, so
 * a legitimately long run is never evicted while a crashed one frees its slot within minutes.
 */
const STALE_JOB_MS = 2 * 3_600_000;

/** In-process job lease. Heartbeats renew it at 1/3 of this; a lease older than now = dead process.
 *  5 min balances the two costs: after a crash/deploy the slot is unavailable for at most this long
 *  (startJob reclaims on expiry), while a live job only needs a ~100s heartbeat cadence to stay safe. */
export const JOB_LEASE_MS = 5 * 60_000;

const leaseIso = () => new Date(Date.now() + JOB_LEASE_MS).toISOString();

/**
 * Keep a running job's lease alive (P0-4). Returns a stop function; ALWAYS call it in finally.
 * Without a live lease, startJob's reclaim and the boot sweep treat the job as dead.
 */
export function startJobHeartbeat(admin: SupabaseClient, jobId: string): () => void {
  const beat = setInterval(
    () => {
      void admin
        .from("jobs")
        .update({ lease_expires_at: leaseIso(), updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .then(undefined, () => undefined); // a missed beat is retried on the next tick
    },
    Math.floor(JOB_LEASE_MS / 3),
  );
  // Never keep the process alive just to heartbeat.
  if (typeof beat.unref === "function") beat.unref();
  return () => clearInterval(beat);
}

async function insertJob(admin: SupabaseClient, orgId: string, kind: JobKind, opts: StartJobOpts) {
  const now = new Date().toISOString();
  return admin
    .from("jobs")
    .insert({
      org_id: orgId,
      kind,
      status: "running",
      total: opts.total ?? null,
      requested_by: opts.requestedBy ?? null,
      dedup_key: opts.dedupKey ?? null,
      lease_expires_at: leaseIso(), // P0-4: every job carries a lease from birth
      started_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
}

/**
 * Insert a running job row. Throws JobConflictError if a genuine run is already active for this slot
 * — the (org, kind) index for plain jobs, or the global dedup_key index when opts.dedupKey is set.
 * A blocker whose LEASE has expired (or a legacy no-lease row older than STALE_JOB_MS) is a
 * crashed/wedged run: it is reclaimed (marked failed) and the new job takes the slot. A blocker with
 * a live lease is real work → conflict. (P0-4: age alone no longer evicts — a 3-hour backfill with a
 * beating heart keeps its slot; the old 2h age test started a duplicate run alongside it.)
 */
export async function startJob(
  admin: SupabaseClient,
  orgId: string,
  kind: JobKind,
  opts: StartJobOpts = {},
): Promise<string> {
  let { data, error } = await insertJob(admin, orgId, kind, opts);
  if (error?.code === "23505") {
    // Slot taken. The blocker may hold the (org,kind) slot OR the dedup key (a DIFFERENT kind) —
    // look it up on the axis we collided on.
    let blockerQuery = admin
      .from("jobs")
      .select("id, kind, started_at, created_at, lease_expires_at")
      .in("status", ["queued", "running"]);
    blockerQuery = opts.dedupKey
      ? blockerQuery.eq("dedup_key", opts.dedupKey)
      : blockerQuery.eq("org_id", orgId).eq("kind", kind).is("dedup_key", null);
    const { data: active } = await blockerQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lease = active?.lease_expires_at
      ? new Date(active.lease_expires_at as string).getTime()
      : null;
    const stamp = (active?.started_at ?? active?.created_at) as string | undefined;
    const ageMs = stamp ? Date.now() - new Date(stamp).getTime() : Infinity;
    const dead = active != null && (lease != null ? lease < Date.now() : ageMs > STALE_JOB_MS);
    if (dead) {
      await finishJob(admin, active!.id as string, {
        status: "failed",
        error: "reclaimed (lease expired / interrupted run)",
      });
      ({ data, error } = await insertJob(admin, orgId, kind, opts));
    }
  }
  if (error) {
    if (error.code === "23505") throw new JobConflictError(kind);
    throw new Error(error.message);
  }
  return (data as { id: string }).id;
}

/** Update a running job's progress (and total, if now known). */
export async function updateJobProgress(
  admin: SupabaseClient,
  id: string,
  progress: number,
  total?: number | null,
): Promise<void> {
  await admin
    .from("jobs")
    .update({ progress, ...(total != null ? { total } : {}), updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Mark a job done or failed. Always sets finished_at so freshness reflects the last completion. */
export async function finishJob(
  admin: SupabaseClient,
  id: string,
  patch: { status: "done" | "failed"; error?: string | null; stats?: Record<string, unknown> },
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from("jobs")
    .update({
      status: patch.status,
      error: patch.error ?? null,
      stats: patch.stats ?? {},
      finished_at: now,
      lease_expires_at: null,
      updated_at: now,
    })
    .eq("id", id);
}

/** The most-recent job of a kind for an org (any status) — drives the UI status/progress. */
export async function latestJob(
  admin: SupabaseClient,
  orgId: string,
  kind: JobKind,
): Promise<JobRow | null> {
  const { data } = await admin
    .from("jobs")
    .select("*")
    .eq("org_id", orgId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as JobRow | null) ?? null;
}

/** Failed terminal jobs require operator visibility/retry; never leave them only in logs. */
export async function failedJobs(
  admin: SupabaseClient,
  orgId: string,
  limit = 50,
): Promise<JobRow[]> {
  const { data, error } = await admin
    .from("jobs")
    .select("*")
    .eq("org_id", orgId)
    .eq("status", "failed")
    .order("finished_at", { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 200));
  if (error) throw new Error(error.message);
  return (data ?? []) as JobRow[];
}

/** The most-recent SUCCESSFUL job of a kind — drives the "data as of HH:MM" freshness label. */
export async function lastDoneJob(
  admin: SupabaseClient,
  orgId: string,
  kind: JobKind,
): Promise<JobRow | null> {
  const { data } = await admin
    .from("jobs")
    .select("*")
    .eq("org_id", orgId)
    .eq("kind", kind)
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as JobRow | null) ?? null;
}

/**
 * Request cooperative cancellation of the active job of a kind: set `stats.cancel_requested` on the running
 * row (no schema change — stats is jsonb). Long jobs (backfill) poll this between chunks and stop
 * gracefully; rows already processed are committed + checkpointed (samsara_recon_at), so a re-run resumes.
 * Returns true if a running/queued job was flagged.
 */
export async function requestJobCancel(
  admin: SupabaseClient,
  orgId: string,
  kind: JobKind,
): Promise<boolean> {
  const { data } = await admin
    .from("jobs")
    .select("id, stats")
    .eq("org_id", orgId)
    .eq("kind", kind)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  const stats = {
    ...((data as { stats?: Record<string, unknown> }).stats ?? {}),
    cancel_requested: true,
  };
  await admin
    .from("jobs")
    .update({ stats, updated_at: new Date().toISOString() })
    .eq("id", (data as { id: string }).id);
  return true;
}

/** True if cancellation was requested for this job id (stats.cancel_requested) — a cheap poll for long jobs. */
export async function jobCancelRequested(admin: SupabaseClient, jobId: string): Promise<boolean> {
  const { data } = await admin.from("jobs").select("stats").eq("id", jobId).maybeSingle();
  return Boolean((data as { stats?: Record<string, unknown> } | null)?.stats?.cancel_requested);
}

export type RunJobResult = { jobId: string } | { conflict: true };

/**
 * Run a background operation through the ledger: claim the (org, kind) slot, run `work` in the
 * background (returning immediately after the claim so the HTTP request doesn't block), and ALWAYS
 * finish the job — done with the returned stats, or failed with the error if `work` throws. Returns the
 * new job id, or `{ conflict: true }` when a run is already active.
 */
export async function runJob(
  admin: SupabaseClient,
  orgId: string,
  kind: JobKind,
  work: (report: ProgressReporter, jobId: string) => Promise<Record<string, unknown> | void>,
  opts: StartJobOpts = {},
): Promise<RunJobResult> {
  let jobId: string;
  try {
    jobId = await startJob(admin, orgId, kind, opts);
  } catch (e) {
    if (e instanceof JobConflictError) return { conflict: true };
    throw e;
  }
  void (async () => {
    const stopHeartbeat = startJobHeartbeat(admin, jobId); // P0-4: live jobs keep their lease fresh
    try {
      const report: ProgressReporter = (done, total) =>
        updateJobProgress(admin, jobId, done, total);
      const stats = await work(report, jobId);
      await finishJob(admin, jobId, { status: "done", stats: stats ?? {} });
    } catch (e) {
      await finishJob(admin, jobId, {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      stopHeartbeat();
    }
  })();
  return { jobId };
}

/**
 * On boot, fail interrupted jobs — P0-4: judged by LEASE, never by "a process is booting so nothing
 * can be running". With heartbeat leases (every job carries one from insert), a running row whose
 * lease is EXPIRED belongs to a dead process; a row with a LIVE lease belongs to another replica (or
 * this process pre-restart within the lease window) and must be left alone. The old behavior —
 * failing every running null-lease job on any boot — meant one replica's deploy killed the other
 * replica's in-flight work and freed its slots mid-run (the double-run bug). Null-lease rows can now
 * only be legacy pre-fix rows; they are reclaimed too.
 */
export async function reclaimInterruptedJobs(admin: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("jobs")
    .update({
      status: "failed",
      error: "interrupted (lease expired / process died)",
      finished_at: now,
      lease_expires_at: null,
      updated_at: now,
    })
    .eq("status", "running")
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now}`)
    .select("id");
  return (data ?? []).length;
}
