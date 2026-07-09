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
  | "sync_vehicles"
  | "sync_trailers"
  | "sync_stats"
  | "nightly_reconcile"
  | "efs_ingest";

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
}

/**
 * A job still marked "running" after this long is presumed dead (process crashed / hung await mid-run) —
 * the partial unique index would otherwise wedge that (org, kind) slot forever. The boot sweep clears the
 * common case (restart); this TTL is the backstop for a wedge without a restart. Generous so it never
 * reclaims a legitimately long backfill.
 */
const STALE_JOB_MS = 2 * 3_600_000;

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
      started_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
}

/**
 * Insert a running job row. Throws JobConflictError if a genuine run is already active for this (org,
 * kind). If the active row is STALE (older than STALE_JOB_MS — a crashed/wedged run), it is reclaimed
 * (marked failed) and the new job takes the slot, so a dead lock can never block work indefinitely.
 */
export async function startJob(
  admin: SupabaseClient,
  orgId: string,
  kind: JobKind,
  opts: StartJobOpts = {},
): Promise<string> {
  let { data, error } = await insertJob(admin, orgId, kind, opts);
  if (error?.code === "23505") {
    // Slot taken. Reclaim it only if it's stale; otherwise a real run owns it → conflict.
    const { data: active } = await admin
      .from("jobs")
      .select("id, started_at, created_at")
      .eq("org_id", orgId)
      .eq("kind", kind)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const stamp = (active?.started_at ?? active?.created_at) as string | undefined;
    const ageMs = stamp ? Date.now() - new Date(stamp).getTime() : Infinity;
    if (active && ageMs > STALE_JOB_MS) {
      await finishJob(admin, active.id as string, { status: "failed", error: "reclaimed (stale/interrupted run)" });
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
      updated_at: now,
    })
    .eq("id", id);
}

/** The most-recent job of a kind for an org (any status) — drives the UI status/progress. */
export async function latestJob(admin: SupabaseClient, orgId: string, kind: JobKind): Promise<JobRow | null> {
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

/** The most-recent SUCCESSFUL job of a kind — drives the "data as of HH:MM" freshness label. */
export async function lastDoneJob(admin: SupabaseClient, orgId: string, kind: JobKind): Promise<JobRow | null> {
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
export async function requestJobCancel(admin: SupabaseClient, orgId: string, kind: JobKind): Promise<boolean> {
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
  const stats = { ...(((data as { stats?: Record<string, unknown> }).stats) ?? {}), cancel_requested: true };
  await admin.from("jobs").update({ stats, updated_at: new Date().toISOString() }).eq("id", (data as { id: string }).id);
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
    try {
      const report: ProgressReporter = (done, total) => updateJobProgress(admin, jobId, done, total);
      const stats = await work(report, jobId);
      await finishJob(admin, jobId, { status: "done", stats: stats ?? {} });
    } catch (e) {
      await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return { jobId };
}

/**
 * On boot, fail any jobs still marked queued/running — they were interrupted by the restart (this app is
 * a single in-process instance, so nothing is genuinely running at startup). Clears wedged (org, kind)
 * slots so schedulers and buttons work immediately after a deploy. NOTE: if the app is ever scaled to
 * multiple instances, replace this with a per-instance heartbeat/lease — see AUTOMATION-BUILD-PLAN.md.
 */
export async function reclaimInterruptedJobs(admin: SupabaseClient): Promise<number> {
  const now = new Date().toISOString();
  const { data } = await admin
    .from("jobs")
    .update({ status: "failed", error: "interrupted (server restart)", finished_at: now, updated_at: now })
    .in("status", ["queued", "running"])
    .select("id");
  return (data ?? []).length;
}
