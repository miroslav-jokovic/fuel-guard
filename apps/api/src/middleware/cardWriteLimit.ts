import type { Request, Response } from "express";
import {
  CARD_DAILY_CAP_CODE,
  CARD_RATE_LIMITED_CODE,
  CARD_WRITE_LIMITS,
  cardWriteBucket,
  hitWindow,
  secondsUntilUtcMidnight,
  type CardWriteBucket,
  type WindowState,
} from "@fuelguard/shared";
import { apiError } from "../lib/http.js";
import { getAppLocals } from "../lib/appLocals.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";

/**
 * Per-user throttling for EFS card writes (plan §6.2).
 *
 * Shaped like `driverWriteLimit.ts` — same fixed-window arithmetic, same two-tier structure, same
 * order — because the mechanism is sound and a second implementation of a rate limiter is a second
 * place to get it subtly wrong. It differs in exactly one respect, and that difference is the point
 * of this file's existence rather than an oversight: see the fail-closed note below.
 *
 * ── Why this is a function the handler calls, and not middleware ────────────────────────────────
 * `driverWriteLimit` is middleware, which is right for it. Here it would run BEFORE the role gate,
 * the capability gate and body validation — so an auditor who may not touch cards at all, or a
 * request with a missing `reason`, would spend a slot against somebody's daily cap and could be
 * answered 503 by a counter outage instead of the 403 or 400 they had earned. "You have reached
 * today's maximum of 25 fuel overrides" after twenty-five malformed requests is a lie.
 *
 * So the limiter is called explicitly, last, once the request is known to be authorised and
 * well-formed and therefore genuinely about to change a card.
 *
 * ORDER INSIDE IT IS ALSO DELIBERATE. The in-memory per-minute window is checked FIRST, so a runaway
 * retry loop is stopped without touching the database; only requests that clear it reach the durable
 * daily counter. The reverse order lets the thing we are defending against generate the load.
 */

/** Per-minute buckets, per API instance. In memory: a sixty-second guard that costs nothing to lose
 *  on a deploy. The daily cap behind it is exact and durable. */
const windows = new Map<string, WindowState>();

function sweep(nowMs: number): void {
  if (windows.size < 5_000) return;
  for (const [key, state] of windows) {
    if (nowMs - state.windowStartMs > 5 * 60_000) windows.delete(key);
  }
}

/** Test seam — the window map is module state and would otherwise leak between test files. */
export function __resetCardWriteWindows(): void {
  windows.clear();
}

function deny(res: Response, code: string, message: string, retryAfterSec: number): void {
  res.setHeader("Retry-After", String(retryAfterSec));
  res.status(429).json(apiError(code, message));
}

/**
 * Returns true when the caller may proceed. Returns false having ALREADY answered the request —
 * with a 429 and a `Retry-After`, or a 503 when a fail-closed counter is unreachable.
 */
export async function enforceCardWriteLimit(req: Request, res: Response): Promise<boolean> {
  // `originalUrl` so the pattern sees the full path regardless of where the router is mounted.
  const bucket = cardWriteBucket(req.method, req.originalUrl);
  if (!bucket) return true;

  const userId = req.auth?.userId;
  const orgId = req.auth?.orgId;
  // Unauthenticated or org-less requests are somebody else's 401/403 to return; there is nothing to
  // key a per-user limit on, and inventing a fallback key would reintroduce shared buckets.
  if (!userId || !orgId) return true;

  const limit = CARD_WRITE_LIMITS[bucket];
  const nowMs = Date.now();
  const key = `${bucket}:${userId}`;

  const verdict = hitWindow(windows.get(key), limit.perMinute, nowMs);
  windows.set(key, verdict.state);
  sweep(nowMs);
  if (!verdict.allowed) {
    deny(res, CARD_RATE_LIMITED_CODE, "Too many card changes in a minute. Try again shortly.", verdict.retryAfterSec);
    return false;
  }

  return await checkDailyCap(req, res, bucket, orgId, userId, nowMs);
}

async function checkDailyCap(
  req: Request, res: Response,
  bucket: CardWriteBucket, orgId: string, userId: string, nowMs: number,
): Promise<boolean> {
  const { perDay, label, onCounterFailure } = CARD_WRITE_LIMITS[bucket];

  /**
   * FAIL CLOSED for overrides and prompts. DELIBERATE DEVIATION from `driverWriteLimit`, which always
   * fails open.
   *
   * There, refusing a completed stop because a bookkeeping table is down loses work a driver has
   * already done. Here, an unmetered `card_override` is unmetered free fuel and an unmetered
   * `card_prompts` can strip the driver-ID prompt off the fleet one call at a time — the two abuses
   * this product exists to detect. `card_status` still fails open, because locking a card is the safe
   * direction and a 2am theft response must not be blocked by a database hiccup.
   *
   * Loud either way: a silent degradation of a spend control is worse than the outage that caused it.
   */
  const onFailure = (why: string): boolean => {
    console.error(`[card-limit] daily cap check failed for ${bucket}: ${why}`);
    if (onCounterFailure === "open") return true;
    res.status(503).json(apiError(
      "limit_unavailable",
      "Card changes are paused because the usage counter is unavailable. This clears on its own — try again in a minute.",
    ));
    return false;
  };

  try {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const { data, error } = await admin.rpc("bump_card_write_counter", {
      p_org: orgId, p_user: userId, p_bucket: bucket, p_limit: perDay,
    });
    if (error) return onFailure(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean } | undefined;
    // A missing row is not a pass. The RPC always returns one, so `undefined` means the shape changed
    // or the call did not reach the function — the same unknown state as an error.
    if (!row) return onFailure("counter returned no row");
    if (row.allowed === false) {
      deny(
        res, CARD_DAILY_CAP_CODE,
        `You have reached today's maximum of ${perDay} ${label}. It resets at midnight UTC — ask an admin if you need more.`,
        secondsUntilUtcMidnight(nowMs),
      );
      return false;
    }
    return true;
  } catch (e) {
    return onFailure(e instanceof Error ? e.message : String(e));
  }
}
