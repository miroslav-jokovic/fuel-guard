import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { storageBackupConfigured } from "./storageBackupS3.js";

/**
 * Is there a recent second copy of every org's files? Published on `GET /api/version` and folded into
 * `ok`, the `maintenanceHealth.ts` shape: `platform-health.yml` already reads that boolean every 15
 * minutes and pages the alert recipients on a non-ok state seen twice.
 *
 * A backup nobody watches is a backup that stopped in March. The code this replaced is the proof: it
 * was written, reviewed, shipped, and never called for six weeks, and nothing could have said so.
 *
 *  · `off`      — the STORAGE_BACKUP_* variables are not set. Healthy, because it is a deployment
 *                 decision (staging is `off` on purpose) and visible as itself, never as `ok`.
 *  · `pending`  — configured, and no org has a finished run yet: the hour after the deploy that ships it.
 *  · `ok`       — every org's last success is within FRESH_MS.
 *  · `failing`  — some org is past FRESH_MS and its latest run failed (the job row has the error).
 *  · `stale`    — some org is past FRESH_MS and its latest run did not fail: the runs stopped.
 *  · `unknown`  — the ledger could not be read. Not healthy: "I could not check" is never "all good".
 *
 * Public: a state and the OLDEST org's last success. No org ids, no counts, no bucket names.
 */
export type StorageBackupState = "off" | "pending" | "ok" | "failing" | "stale" | "unknown";

export interface StorageBackupHealth {
  state: StorageBackupState;
  /** The least recent org's last successful copy; null when any org has none yet. */
  lastSucceededAt: string | null;
}

/** One night missed is tolerated (a deploy through 04:00 is caught up at 30 h); two is an alarm. */
export const FRESH_MS = 36 * 3_600_000;

export function storageBackupHealthy(state: StorageBackupState): boolean {
  return state === "off" || state === "pending" || state === "ok";
}

export interface OrgBackupStatus {
  lastDoneAt: string | null;
  latestStatus: string | null;
}

/** Pure: the fleet-wide state from each org's ledger. Worst org wins. */
export function toStorageBackupHealth(orgs: readonly OrgBackupStatus[], nowMs: number): StorageBackupHealth {
  if (orgs.every((o) => o.latestStatus === null)) return { state: "pending", lastSucceededAt: null };
  let state: StorageBackupState = "ok";
  for (const o of orgs) {
    // An org with no run at all while others have one is the hour after it was created: not an alarm.
    if (o.latestStatus === null) continue;
    const done = o.lastDoneAt ? Date.parse(o.lastDoneAt) : Number.NaN;
    if (Number.isFinite(done) && nowMs - done < FRESH_MS) continue;
    if (o.latestStatus === "failed") state = "failing";
    else if (state !== "failing") state = "stale";
  }
  const dones = orgs.map((o) => (o.lastDoneAt ? Date.parse(o.lastDoneAt) : Number.NaN));
  const oldest = dones.every(Number.isFinite) ? new Date(Math.min(...dones)).toISOString() : null;
  return { state, lastSucceededAt: oldest };
}

/**
 * Its own two reads rather than `lastDoneJob`/`latestJob`: those return null on a read ERROR, and here
 * null means "never ran" — which reads as healthy `pending`. A health check that turns a database
 * failure into a green light is the one thing it must not do.
 */
async function readOrgStatus(admin: SupabaseClient, orgId: string): Promise<OrgBackupStatus> {
  const base = () => admin.from("jobs").select("status, finished_at").eq("org_id", orgId).eq("kind", "storage_backup");
  const [latest, done] = await Promise.all([
    base().order("created_at", { ascending: false }).limit(1),
    base().eq("status", "done").order("finished_at", { ascending: false }).limit(1),
  ]);
  if (latest.error) throw new Error(latest.error.message);
  if (done.error) throw new Error(done.error.message);
  const l = (latest.data ?? [])[0] as { status: string } | undefined;
  const d = (done.data ?? [])[0] as { finished_at: string | null } | undefined;
  return { latestStatus: l?.status ?? null, lastDoneAt: d?.finished_at ?? null };
}

async function readOrgStatuses(admin: SupabaseClient): Promise<OrgBackupStatus[]> {
  const { data, error } = await admin.from("organizations").select("id");
  if (error) throw new Error(error.message);
  return Promise.all(((data ?? []) as { id: string }[]).map(({ id }) => readOrgStatus(admin, id)));
}

/** `/api/version` is public and unauthenticated; the same 30-second cache as its other reads. */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: StorageBackupHealth } | null = null;

export function resetStorageBackupHealthCache(): void {
  cache = null;
}

export async function getStorageBackupHealth(env: Env, now = Date.now()): Promise<StorageBackupHealth> {
  if (!storageBackupConfigured(env)) return { state: "off", lastSucceededAt: null };
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  let value: StorageBackupHealth;
  try {
    value = toStorageBackupHealth(await readOrgStatuses(getSupabaseAdmin(env)), now);
  } catch {
    value = { state: "unknown", lastSucceededAt: null };
  }
  cache = { at: now, value };
  return value;
}
