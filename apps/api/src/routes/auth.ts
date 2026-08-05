import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import {
  driverLoginRequestSchema,
  normalizeDriverUsername,
  toSyntheticDriverEmail,
  type DriverLoginRequest,
} from "@fuelguard/shared";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getAppLocals } from "../lib/appLocals.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { writeAudit } from "../lib/audit.js";

/**
 * PUBLIC auth surface — `POST /api/auth/driver-login`, the ONE way driver-app credentials are
 * exchanged for a session (DRIVER-CREDENTIALS-PLAN.md DC5). The app sends the company-issued
 * username + password; the server resolves the username to its synthetic auth email and signs in
 * with the ANON key, so the synthetic-email scheme never leaves the server.
 *
 * Hostile-input posture (this endpoint is unauthenticated by definition):
 *  - ONE uniform `invalid_credentials` error for unknown username, wrong password, AND disabled
 *    login — no enumeration signal.
 *  - A minimum response floor (~350ms) so the DB-lookup-miss path isn't measurably faster than the
 *    full sign-in path.
 *  - Per-IP and per-username throttles (in-process token buckets; Supabase Auth's own limits back
 *    them up), answering 429 without touching auth.
 *  - Failed attempts on a KNOWN username are audited (`auth.driver_login_failed`, actor null, IP in
 *    meta) so a guessing campaign is visible on the org's audit trail.
 *  - Input containing "@" is treated as a legacy email login (the app-binary cutover path, audit A6).
 */

const WINDOW_MS = 15 * 60_000;
const MAX_PER_IP = 30;
const MAX_PER_USERNAME = 10;
const MIN_RESPONSE_MS = 350;

interface Bucket {
  count: number;
  resetAt: number;
}
const buckets = new Map<string, Bucket>();

/** True when this key is over its budget for the window. Prunes as it goes; O(1) per call. */
export function overLimit(key: string, max: number, nowMs = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.resetAt <= nowMs) {
    buckets.set(key, { count: 1, resetAt: nowMs + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > max;
}

/** Test hook. */
export function __resetLoginThrottle(): void {
  buckets.clear();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function authRouter(): Router {
  const router = Router();

  router.post(
    "/driver-login",
    validateBody(driverLoginRequestSchema),
    asyncHandler(async (req, res) => {
      const started = Date.now();
      const env = getAppLocals(req).env;
      const { username: rawUsername, password } = res.locals.body as DriverLoginRequest;
      const ip = req.ip ?? "unknown";
      const username = normalizeDriverUsername(rawUsername);

      const finish = async (status: number, body: unknown) => {
        // Response-time floor: the miss path must not be measurably faster than the sign-in path.
        const elapsed = Date.now() - started;
        if (elapsed < MIN_RESPONSE_MS) await sleep(MIN_RESPONSE_MS - elapsed);
        res.status(status).json(body);
      };

      if (overLimit(`ip:${ip}`, MAX_PER_IP) || overLimit(`u:${username}`, MAX_PER_USERNAME)) {
        await finish(429, apiError("too_many_attempts", "Too many sign-in attempts. Try again in a few minutes."));
        return;
      }
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        await finish(503, apiError("auth_unavailable", "Sign-in is not available right now."));
        return;
      }

      // Resolve the username → synthetic email ("@" in the input = legacy email login, cutover A6).
      let email: string | null = null;
      let orgId: string | null = null;
      if (username.includes("@")) {
        email = username;
      } else {
        const admin = getSupabaseAdmin(env);
        const { data } = await admin
          .from("drivers")
          .select("org_id, app_access_enabled")
          .eq("app_username", username)
          .limit(1)
          .maybeSingle();
        const row = data as { org_id: string; app_access_enabled: boolean | null } | null;
        if (row) {
          orgId = row.org_id;
          // A disabled login gets the SAME error as a wrong password (no state leak); the auth-side
          // ban would refuse it anyway — this just skips a pointless attempt.
          if (row.app_access_enabled !== false) email = toSyntheticDriverEmail(username);
        }
      }

      if (email) {
        const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await anon.auth.signInWithPassword({ email, password });
        if (!error && data.session) {
          await finish(200, {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_in: data.session.expires_in,
            token_type: data.session.token_type,
          });
          return;
        }
      }

      // Known username + failed attempt → visible on the org's audit trail (never the password).
      if (orgId) {
        await writeAudit(getSupabaseAdmin(env), {
          orgId,
          actorId: null,
          action: "auth.driver_login_failed",
          entity: "drivers",
          meta: { username, ip },
        }).catch(() => undefined);
      }
      await finish(401, apiError("invalid_credentials", "That username or password is incorrect."));
    }),
  );

  return router;
}
