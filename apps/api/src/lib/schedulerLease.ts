import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SchedulerLane } from "../schedulerLanes.js";

/**
 * Hold a scheduler lane's database lease (0506) — the guard that lets a service run more than one
 * replica without running its schedulers twice. PLATFORM-RELIABILITY-PLAN D-RLY2.
 *
 * ── THE PROTOCOL ──────────────────────────────────────────────────────────────────────────────
 * Every `renewEveryMs` the process calls `acquire_scheduler_lease`. The function takes a free or
 * expired lease, renews one this holder already has, and otherwise reports who has it. So:
 *
 *   · standby → held:   the lane's schedulers start, ONCE (`onAcquired`). Never restarted in-process:
 *                       a `setInterval` scheduler has no stop handle, so a process that has run a lane
 *                       and lost it cannot be trusted to have stopped it.
 *   · held → not held:  another process has the lane. `onLost` — production exits, the platform
 *                       restarts the process, and it comes back as a clean standby.
 *   · held, unconfirmed: a renewal failed or is hanging. The holder keeps running only until the
 *                       DEADLINE: the instant BEFORE the request that last succeeded was sent, plus
 *                       the TTL, minus a margin. Postgres stamped `expires_at = now() + ttl` at some
 *                       instant AFTER that send, so the database cannot let a standby in before this
 *                       process's own deadline has passed — provided the two clocks agree to within
 *                       the margin. Past the deadline it is `onLost` as well.
 *
 * Overlap is therefore bounded by clock skew minus the margin (zero, in practice), and inside any
 * overlap the jobs ledger's `(org_id, kind)` slot still refuses a second concurrent run of a per-org job.
 *
 * ── WHY A MISSING FUNCTION MEANS "DO NOT RUN" ─────────────────────────────────────────────────
 * On staging the code can be served minutes before its migration (docs/MIGRATION-DISCIPLINE.md).
 * Failing OPEN there would mean "two copies may run every poller", which is the one outcome worse
 * than a late poll — WEX's guide (p11) says excessive polling can suspend the EFS account. So a lease
 * that cannot be confirmed is a lease not held: the lane waits, and says so in the log.
 */

export interface LeaseRead {
  held: boolean;
  holder: string | null;
  expiresAt: string | null;
}

/** The two calls the protocol needs — injected so the protocol is testable without Postgres. */
export interface LeaseStore {
  acquire(lane: SchedulerLane, holder: string, ttlSeconds: number, meta: Record<string, unknown>): Promise<LeaseRead>;
  release(lane: SchedulerLane, holder: string): Promise<void>;
}

export interface LeaseTimers {
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

export interface LaneLeaseOptions {
  lane: SchedulerLane;
  holder: string;
  store: LeaseStore;
  meta?: Record<string, unknown>;
  ttlSeconds?: number;
  renewEveryMs?: number;
  /** Kept back from the TTL: the clock skew and event-loop stall this protocol tolerates. */
  marginMs?: number;
  onAcquired: () => void;
  onLost: (reason: string) => void;
  log?: (line: string) => void;
  timers?: LeaseTimers;
}

/** 60 s lease, renewed every 15 s: three renewals can fail before the deadline. A crashed holder's
 *  lane is taken over within TTL + one standby tick (≤ 75 s). */
export const LEASE_TTL_SECONDS = 60;
export const LEASE_RENEW_EVERY_MS = 15_000;
export const LEASE_MARGIN_MS = 10_000;
/** How often the held deadline is checked between renewals — a hanging request cannot outlive it. */
const DEADLINE_CHECK_MS = 1_000;

const realTimers: LeaseTimers = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const t = setInterval(fn, ms);
    t.unref?.();
    return () => clearInterval(t);
  },
};

export interface LaneLease {
  /** Stop competing, and release the lease if held (graceful shutdown). Idempotent. */
  stop(): Promise<void>;
  isHeld(): boolean;
  /** Test seam: run one acquire/renew attempt now. */
  tick(): Promise<void>;
}

export function startLaneLease(opts: LaneLeaseOptions): LaneLease {
  const ttl = opts.ttlSeconds ?? LEASE_TTL_SECONDS;
  const margin = opts.marginMs ?? LEASE_MARGIN_MS;
  const timers = opts.timers ?? realTimers;
  const log = opts.log ?? ((line: string) => console.log(line));
  const tag = `[scheduler-lease] ${opts.lane}`;

  let held = false;
  let started = false; // onAcquired has run — this process has run the lane's schedulers
  let lost = false;
  let stopped = false;
  let deadline = 0; // epoch ms after which a held lease is no longer trusted
  let inFlight = false;
  let lastStandbyHolder: string | null | undefined;
  let lastError = "";

  const loseOnce = (reason: string): void => {
    if (lost) return;
    lost = true;
    held = false;
    log(`${tag}: LOST — ${reason}`);
    opts.onLost(reason);
  };

  const tick = async (): Promise<void> => {
    if (stopped || lost || inFlight) return;
    inFlight = true;
    const sentAt = timers.now();
    try {
      const read = await opts.store.acquire(opts.lane, opts.holder, ttl, opts.meta ?? {});
      lastError = "";
      if (stopped || lost) return;
      if (read.held) {
        deadline = sentAt + ttl * 1000 - margin;
        if (!held) {
          held = true;
          log(`${tag}: acquired by ${opts.holder}`);
        }
        if (!started) {
          started = true;
          opts.onAcquired();
        }
        return;
      }
      if (started) {
        loseOnce(`taken by ${read.holder ?? "another process"}`);
        return;
      }
      if (read.holder !== lastStandbyHolder) {
        lastStandbyHolder = read.holder;
        log(`${tag}: standby — held by ${read.holder ?? "nobody"} until ${read.expiresAt ?? "?"}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // One line per distinct failure, not one every 15 s for an hour.
      if (message !== lastError) {
        lastError = message;
        log(`${tag}: lease call failed${held ? " (still held until the deadline)" : " — not running this lane"}: ${message}`);
      }
    } finally {
      inFlight = false;
    }
  };

  const checkDeadline = (): void => {
    if (held && !lost && !stopped && timers.now() > deadline) {
      loseOnce("renewal not confirmed before the lease's deadline");
    }
  };

  const cancelRenew = timers.every(opts.renewEveryMs ?? LEASE_RENEW_EVERY_MS, () => void tick());
  const cancelCheck = timers.every(DEADLINE_CHECK_MS, checkDeadline);
  void tick();

  return {
    isHeld: () => held && !lost,
    tick,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      cancelRenew();
      cancelCheck();
      if (held && !lost) {
        held = false;
        try {
          await opts.store.release(opts.lane, opts.holder);
          log(`${tag}: released by ${opts.holder}`);
        } catch (e) {
          // The lease expires on its own; this only loses the fast hand-over.
          log(`${tag}: release failed (expires on its own): ${e instanceof Error ? e.message : e}`);
        }
      }
    },
  };
}

/** The Postgres side of LeaseStore — 0506's two functions through PostgREST. */
export function supabaseLeaseStore(admin: SupabaseClient): LeaseStore {
  return {
    async acquire(lane, holder, ttlSeconds, meta) {
      const { data, error } = await admin.rpc("acquire_scheduler_lease", {
        p_lane: lane,
        p_holder: holder,
        p_ttl_seconds: ttlSeconds,
        p_meta: meta,
      });
      if (error) throw new Error(`acquire_scheduler_lease: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as
        | { held?: boolean; holder?: string; expires_at?: string }
        | null
        | undefined;
      if (!row) throw new Error("acquire_scheduler_lease returned no row");
      return { held: row.held === true, holder: row.holder ?? null, expiresAt: row.expires_at ?? null };
    },
    async release(lane, holder) {
      const { error } = await admin.rpc("release_scheduler_lease", { p_lane: lane, p_holder: holder });
      if (error) throw new Error(`release_scheduler_lease: ${error.message}`);
    },
  };
}

/**
 * This process's holder id: unique per process START, so a restarted process is a new holder and can
 * never mistake its predecessor's lease for its own. The platform's variables make it readable in the
 * row — Railway's own, or the neutral names `infra/server/compose.yml` sets on the AWS servers.
 *
 * Until the AWS cutover (AWS11, 2026-10-27) only Railway's names were read, so the first leases AWS
 * took read `local:<container id>` with every meta field null: the row could not say which server,
 * environment or commit held production's schedulers — the question it exists to answer. Railway's
 * names stay first until AWS12 removes Railway.
 */
export function processHolderId(env: NodeJS.ProcessEnv = process.env): string {
  const service = env.RAILWAY_SERVICE_NAME ?? env.SERVICE_NAME ?? "local";
  const where = env.RAILWAY_REPLICA_ID ?? hostname();
  return `${service}:${where}:${process.pid}:${randomUUID().slice(0, 8)}`.slice(0, 200);
}

/** What the lease row shows about its holder — for the person reading it after an alarm. */
export function processHolderMeta(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return {
    service: env.RAILWAY_SERVICE_NAME ?? env.SERVICE_NAME ?? null,
    environment: env.RAILWAY_ENVIRONMENT_NAME ?? env.DEPLOY_ENVIRONMENT ?? null,
    deploymentId: env.RAILWAY_DEPLOYMENT_ID ?? null,
    // On AWS the replica is the container: Docker makes its id the hostname, and `docker ps` and the
    // awslogs stream name it the same way.
    replicaId: env.RAILWAY_REPLICA_ID ?? (env.SERVICE_NAME ? hostname() : null),
    region: env.RAILWAY_REPLICA_REGION ?? env.DEPLOY_REGION ?? null,
    // Baked into the AWS image (infra/image/Dockerfile) — the same variable `buildInfo` reads.
    commit: env.RAILWAY_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA ?? null,
  };
}
