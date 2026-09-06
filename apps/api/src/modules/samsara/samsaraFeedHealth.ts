/**
 * Read every Samsara tier's staleness out of the ledgers it already writes (SAM-S5, D-SAM6).
 *
 * The verdict is `describeSamsaraFeeds` in `@silvicom/shared`; this file is the I/O half, and its whole
 * job is choosing the right stamp for each feed. Three of those choices are load-bearing:
 *
 * ── 1. A `done` RUN IS NOT ALWAYS A DELIVERY ─────────────────────────────────────────────────────
 * `runOrgTier` catches `NoSamsaraTokenError` and records the run as **done** with
 * `stats = { skipped: "no token" }` — deliberately, because an unconfigured org is not a failure. But
 * an org with no token would then show every feed as freshly delivered forever, which is the exact
 * shape of the `*_last_polled_at` trap `fuelSpend/feedFreshness.ts` was written against: a stamp that
 * moves whether or not anything arrived. So a skipped run is excluded from the success stamp. It is
 * still an ATTEMPT, which is what separates "never configured" from "configured and delivering
 * nothing".
 *
 * ── 2. THE ERROR COMES FROM THE MOST RECENT RUN, NOT FROM THE MOST RECENT FAILURE ────────────────
 * A tier that failed on Tuesday and has succeeded every hour since is not failing. Reading "the last
 * row with an error" would leave it red until that row aged out of the table.
 *
 * ── 3. THE PER-FILL TIER IS NOT MEASURED BY ITS JOB ROWS ─────────────────────────────────────────
 * The recon tier dispatches the `backfill` kind, which `startRebuildOnBoot` and manual rebuilds also
 * use, so a `backfill` row proves nothing about telematics. `fuel_transactions.samsara_recon_checked_at`
 * is the stamp the recon path itself writes, and it is what S4's coverage card already judges attempts
 * by — the same predicate, so the two surfaces cannot disagree about whether we asked.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  describeSamsaraFeeds,
  samsaraFeedSpecs,
  type SamsaraFeedHealth,
  type SamsaraFeedId,
  type SamsaraFeedObservation,
} from "@silvicom/shared";
import type { Env } from "../../env.js";
import type { JobKind } from "../org/index.js";

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Which `jobs.kind` carries each feed. Read off `samsaraScheduler.ts`'s own `runOrgTier` calls — the
 * tier LABELS ("identity", "driver-scores") are not job kinds, and identity deliberately runs under
 * `sync_vehicles` so a manual vehicle sync and the tier share one slot.
 *
 * `telematics` is absent on purpose: see the header.
 */
const FEED_JOB_KIND: Partial<Record<SamsaraFeedId, JobKind>> = {
  stats: "sync_stats",
  identity: "sync_vehicles",
  driver_scores: "sync_driver_scores",
  ifta: "sync_ifta",
  odometer: "sync_odometer",
  hos: "sync_hos",
  idle: "sync_idle",
};

/**
 * The interval each tier is configured to run on, from the environment this process is actually
 * running with — never a copy in shared, so `targetUnreachable` can see a setting somebody changed.
 * A zero means the tier is switched off, and `startSamsaraScheduler` reads these exact guards.
 */
export function samsaraFeedCadences(env: Env): Record<SamsaraFeedId, number> {
  const perf = env.SAMSARA_DRIVER_SCORE_SYNC_HOURS * HOUR_MS;
  return {
    stats: env.SAMSARA_STATS_SYNC_MINUTES * MIN_MS,
    // The recon tier is gated on BOTH, exactly as the scheduler gates it: a zero batch means it never
    // starts, and reporting it as "polled hourly" would be a promise nothing is keeping.
    telematics:
      env.SAMSARA_RECON_SYNC_MINUTES > 0 && env.SAMSARA_RECON_BATCH > 0
        ? env.SAMSARA_RECON_SYNC_MINUTES * MIN_MS
        : 0,
    identity: env.SAMSARA_IDENTITY_SYNC_HOURS * HOUR_MS,
    // driver-scores, HOS and idle all run inside the performance tier, on its one interval.
    driver_scores: perf,
    hos: perf,
    idle: perf,
    ifta: env.SAMSARA_IFTA_SYNC_HOURS * HOUR_MS,
    odometer: env.SAMSARA_ODOMETER_SYNC_HOURS * HOUR_MS,
  };
}

type JobRow = { status: string; error: string | null; created_at: string; finished_at: string | null };

/**
 * One feed's stamps. Two queries rather than one grouped read: PostgREST cannot aggregate, and a
 * single "last N rows" page cannot answer both questions — a feed refused for a week has its last
 * success outside any page a chatty neighbour leaves room for. Both hit `idx_jobs_org_kind_created`.
 */
async function readJobStamps(
  admin: SupabaseClient,
  orgId: string,
  kind: JobKind,
): Promise<Omit<SamsaraFeedObservation, "id">> {
  const base = () =>
    admin
      .from("jobs")
      .select("status, error, created_at, finished_at")
      .eq("org_id", orgId)
      .eq("kind", kind)
      .order("created_at", { ascending: false })
      .limit(1);

  const [latest, delivered] = await Promise.all([
    base(),
    // A `done` run that skipped for want of a token delivered nothing — see the header.
    base().eq("status", "done").filter("stats->>skipped", "is", "null"),
  ]);

  // Raised, never absorbed: a refused read that returns `data: null` looks exactly like a feed with no
  // job rows, and would be rendered as "never arrived" for every feed at once — a fault reported as a
  // finding. `readSamsaraFeedHealth` catches it and says so instead.
  if (latest.error) throw new Error(latest.error.message);
  if (delivered.error) throw new Error(delivered.error.message);

  const last = (latest.data as JobRow[] | null)?.[0] ?? null;
  const ok = (delivered.data as JobRow[] | null)?.[0] ?? null;
  return {
    lastSuccessAt: ok ? (ok.finished_at ?? ok.created_at) : null,
    lastAttemptAt: last?.created_at ?? null,
    // Only when the MOST RECENT run failed. A tier that recovered is not failing.
    lastError: last?.status === "failed" ? (last.error ?? "The last run failed.") : null,
  };
}

/** The per-fill tier's own stamp: the newest fill the recon path has actually looked at. */
async function readTelematicsStamp(
  admin: SupabaseClient,
  orgId: string,
): Promise<Omit<SamsaraFeedObservation, "id">> {
  const { data, error } = await admin
    .from("fuel_transactions")
    .select("samsara_recon_checked_at")
    .eq("org_id", orgId)
    .not("samsara_recon_checked_at", "is", null)
    .order("samsara_recon_checked_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const at = (data as { samsara_recon_checked_at: string }[] | null)?.[0]?.samsara_recon_checked_at ?? null;
  // There is no separate attempt stamp here — the recon path writes one stamp, and it writes it
  // whether or not Samsara had anything, which is precisely what makes it the right one.
  return { lastSuccessAt: at, lastAttemptAt: at, lastError: null };
}

export interface SamsaraFeedHealthResult {
  feeds: SamsaraFeedHealth[];
  /** Feeds whose bound was ruled, is meetable, and is breached — the ones allowed to page somebody. */
  alerting: SamsaraFeedHealth[];
  error: string | null;
}

/**
 * Org-scoped explicitly on every read: `admin` is the SERVICE ROLE and bypasses RLS, so the
 * `.eq("org_id", …)` here is the only tenant boundary this code has (D-FC1, migration 0247).
 */
export async function readSamsaraFeedHealth(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  now: Date = new Date(),
): Promise<SamsaraFeedHealthResult> {
  const specs = samsaraFeedSpecs(samsaraFeedCadences(env));
  try {
    const observations = await Promise.all(
      specs.map(async (s): Promise<SamsaraFeedObservation> => {
        const kind = FEED_JOB_KIND[s.id];
        const stamps = kind ? await readJobStamps(admin, orgId, kind) : await readTelematicsStamp(admin, orgId);
        return { id: s.id, ...stamps };
      }),
    );
    const feeds = describeSamsaraFeeds(specs, observations, now);
    return { feeds, alerting: feeds.filter((f) => f.alertable), error: null };
  } catch (e) {
    // Surfaced, never swallowed into an empty list: a freshness page that renders nothing wrong
    // because it could not read is the failure this whole step exists to remove.
    return { feeds: [], alerting: [], error: e instanceof Error ? e.message : String(e) };
  }
}
