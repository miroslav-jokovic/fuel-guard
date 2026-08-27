import type { Request, Response, NextFunction } from "express";
import {
  DRIVER_WRITE_LIMITS, DAILY_CAP_CODE, RATE_LIMITED_CODE,
  driverWriteBucket, hitWindow, secondsUntilUtcMidnight,
  type DriverWriteBucket, type WindowState,
} from "@silvicom/shared";
import { apiError } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";

/**
 * D57 driver write limits (loads plan L4) — the gate that has to exist before Loads is switched on
 * for real drivers.
 *
 * Mounted INSIDE the driver routers, immediately after their own `requireAuth`, because the whole
 * design depends on `req.auth.userId` — the JWT `sub`. Mounting it at the app level would run it
 * before authentication and leave it with nothing to key on but an IP address, which is precisely
 * the failure mode D57 exists to prevent: a depot behind one NAT locking out its own yard.
 *
 * Order is deliberate. The per-minute window is checked first and in memory, so a runaway retry loop
 * is stopped without touching the database; only requests that pass it reach the durable daily
 * counter. The reverse order would let the thing we are defending against generate the load.
 */

/**
 * Per-minute buckets, per API instance.
 *
 * In memory on purpose. This is a sixty-second burst guard: losing it on a deploy costs nothing, and
 * a Postgres round trip per request would make the limiter more expensive than the work it protects.
 * The honest caveat is that with N instances the effective ceiling is N × the limit — irrelevant at
 * these numbers and at one Railway service, and the daily cap behind it IS exact. If this ever runs
 * multi-instance at scale, this map is the thing to move to Redis, not the counter table.
 */
const windows = new Map<string, WindowState>();

/** Keeps the map from growing without bound on a long-lived process. Cheap: it only runs on a miss. */
function sweep(nowMs: number): void {
  if (windows.size < 5_000) return;
  for (const [key, state] of windows) {
    if (nowMs - state.windowStartMs > 5 * 60_000) windows.delete(key);
  }
}

function deny(res: Response, code: string, message: string, retryAfterSec: number): void {
  res.setHeader("Retry-After", String(retryAfterSec));
  res.status(429).json(apiError(code, message));
}

export function driverWriteLimit() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // `originalUrl` so the pattern sees the full path regardless of where the router is mounted.
    const bucket = driverWriteBucket(req.method, req.originalUrl);
    if (!bucket) { next(); return; }

    const userId = req.auth?.userId;
    const orgId = req.auth?.orgId;
    // Unauthenticated or org-less requests are somebody else's 401/403 to return; there is nothing
    // to key a per-driver limit on, and inventing a fallback key would reintroduce shared buckets.
    if (!userId || !orgId) { next(); return; }

    const limit = DRIVER_WRITE_LIMITS[bucket];
    const nowMs = Date.now();
    const key = `${bucket}:${userId}`;

    const verdict = hitWindow(windows.get(key), limit.perMinute, nowMs);
    windows.set(key, verdict.state);
    sweep(nowMs);
    if (!verdict.allowed) {
      deny(res, RATE_LIMITED_CODE, "Too many requests. Try again in a moment.", verdict.retryAfterSec);
      return;
    }

    void checkDailyCap(req, res, next, bucket, orgId, userId, limit.perDay, limit.label, nowMs);
  };
}

async function checkDailyCap(
  req: Request, res: Response, next: NextFunction,
  bucket: DriverWriteBucket, orgId: string, userId: string,
  perDay: number, label: string, nowMs: number,
): Promise<void> {
  try {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const { data, error } = await admin.rpc("bump_driver_write_counter", {
      p_org: orgId, p_user: userId, p_bucket: bucket, p_limit: perDay,
    });
    // FAIL OPEN, LOUDLY. If the counter is unreachable the driver's shift does not stop: the
    // per-minute window above already bounds the damage, and refusing a completed stop because a
    // bookkeeping table is down would lose real work to protect a quota.
    if (error) {
      console.error(`[driver-limit] daily cap check failed for ${bucket}: ${error.message}`);
      next();
      return;
    }
    const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean } | undefined;
    if (row && row.allowed === false) {
      deny(
        res, DAILY_CAP_CODE,
        `You have reached today's maximum of ${perDay} ${label}. It resets at midnight UTC — contact dispatch if you need more.`,
        secondsUntilUtcMidnight(nowMs),
      );
      return;
    }
    next();
  } catch (e) {
    console.error(`[driver-limit] daily cap check threw for ${bucket}: ${e instanceof Error ? e.message : String(e)}`);
    next();
  }
}
