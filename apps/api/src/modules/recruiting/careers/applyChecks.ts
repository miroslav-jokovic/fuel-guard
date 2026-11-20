import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLY_MIN_FILL_MS,
  APPLY_PAGE_CHANNEL,
  APPLY_TURNSTILE_ACTION,
  applyFlags,
  type ApplyChecks,
  type FillOutcome,
  type TurnstileOutcome,
} from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { isSecretBoxConfigured, open, seal, secretAad } from "../../../lib/secretBox.js";

/**
 * The apply page's checks (APPLY-PAGE-PLAN D-AP5): each one FLAGS a submission and none refuses it, so a real driver
 * whose browser blocks a script is still a lead. The rule that turns results into flags is the shared `applyFlags`.
 */

// ── Turnstile's keys (D-AP6) ────────────────────────────────────────────────────────────────────

/** Both keys or neither: one without the other would flag every applicant (envAds.ts says why). */
export function turnstileKeys(env: Env): { siteKey: string; secret: string } | null {
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? { siteKey: env.TURNSTILE_SITE_KEY, secret: env.TURNSTILE_SECRET_KEY } : null;
}

export function turnstileBootWarning(env: Env): string | null {
  if (turnstileKeys(env)) return null;
  const half = env.TURNSTILE_SITE_KEY || env.TURNSTILE_SECRET_KEY;
  return half
    ? "[apply-page] only one of TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY is set: the robot check is OFF until both are."
    : "[apply-page] TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY unset: the careers page takes applications with no robot check (recorded as not checked).";
}

// ── the form token: which form was served, and when ──────────────────────────────────────────────

const FORM_PURPOSE = "apply_page_form";
interface FormTokenBody {
  v: 1;
  o: string;
  iat: number;
  n: string;
}

/** Sealed with the org and purpose bound in (`secretAad`), so it opens only for the carrier and form that served it. */
export function issueFormToken(env: Env, orgId: string, openingId: string, now: Date): string | null {
  if (!isSecretBoxConfigured(env)) return null;
  const body: FormTokenBody = { v: 1, o: openingId, iat: now.getTime(), n: randomUUID() };
  return seal(env, JSON.stringify(body), secretAad(orgId, FORM_PURPOSE));
}

export interface FormTokenReading {
  fill: FillOutcome;
  fill_ms: number | null;
  /**
   * The lead's `external_ref`: the served form's own id, so the same form sent twice is ONE lead (the LeadSink's
   * per-(org, channel, ref) store). A form we cannot read gets a fresh id: it is still a lead, never a merge.
   */
  ref: string;
}

/** Clock skew allowed between the API's instances before an "issued in the future" token reads as forged. */
const FUTURE_SKEW_MS = 60_000;

export function readFormToken(env: Env, orgId: string, openingId: string, token: string | null, now: Date): FormTokenReading {
  if (!isSecretBoxConfigured(env)) return { fill: "not_measured", fill_ms: null, ref: randomUUID() };
  if (!token) return { fill: "token_invalid", fill_ms: null, ref: randomUUID() };
  let body: FormTokenBody;
  try {
    body = JSON.parse(open(env, token, secretAad(orgId, FORM_PURPOSE))) as FormTokenBody;
  } catch {
    return { fill: "token_invalid", fill_ms: null, ref: randomUUID() };
  }
  const ms = now.getTime() - body.iat;
  if (body.v !== 1 || body.o !== openingId || !Number.isFinite(ms) || ms < -FUTURE_SKEW_MS || typeof body.n !== "string") {
    return { fill: "token_invalid", fill_ms: null, ref: randomUUID() };
  }
  const fill_ms = Math.max(0, ms);
  return { fill: fill_ms < APPLY_MIN_FILL_MS ? "too_fast" : "ok", fill_ms, ref: body.n };
}

// ── Turnstile, checked on the server ─────────────────────────────────────────────────────────────

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export type FetchLike = (url: string, init: { method: string; body: URLSearchParams; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Cloudflare's error codes that are OURS (a key or request we sent wrong), not the person's: not a flag, but loud. */
const OUR_FAULT = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);

/**
 * Cloudflare's siteverify (read 2026-11-20, developers.cloudflare.com/turnstile/get-started/server-side-validation):
 * POST the secret, the token, the visitor's address and an idempotency key; a token is single-use and lives 300
 * seconds. `success` is not enough on its own: the docs say to check `hostname` and `action`, because a token minted
 * on another site, or for another of our forms, is still a "success".
 */
export async function verifyTurnstile(
  env: Env,
  token: string | null,
  remoteIp: string | null,
  idempotencyKey: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<{ outcome: TurnstileOutcome; errors: string[] }> {
  const keys = turnstileKeys(env);
  if (!keys) return { outcome: "not_configured", errors: [] };
  if (!token) return { outcome: "missing", errors: [] };
  const body = new URLSearchParams({ secret: keys.secret, response: token, idempotency_key: idempotencyKey });
  if (remoteIp) body.set("remoteip", remoteIp);
  let answer: { success?: unknown; hostname?: unknown; action?: unknown; "error-codes"?: unknown };
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: "POST", body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`[apply-page] Turnstile siteverify answered ${res.status}; the application is kept, not checked`);
      return { outcome: "unavailable", errors: [] };
    }
    answer = (await res.json()) as typeof answer;
  } catch (err) {
    console.error(`[apply-page] Turnstile siteverify unreachable; the application is kept, not checked: ${err instanceof Error ? err.message : String(err)}`);
    return { outcome: "unavailable", errors: [] };
  }
  const errors = Array.isArray(answer["error-codes"]) ? answer["error-codes"].filter((e): e is string => typeof e === "string").slice(0, 10) : [];
  if (answer.success === true) {
    const host = new URL(env.WEB_APP_URL).hostname;
    if (answer.hostname !== host || answer.action !== APPLY_TURNSTILE_ACTION) {
      return { outcome: "failed", errors: [`hostname:${String(answer.hostname)}`, `action:${String(answer.action)}`] };
    }
    return { outcome: "passed", errors: [] };
  }
  if (errors.some((e) => OUR_FAULT.has(e))) {
    console.error(`[apply-page] Turnstile siteverify refused OUR request (${errors.join(", ")}); check TURNSTILE_SECRET_KEY`);
    return { outcome: "unavailable", errors };
  }
  return { outcome: "failed", errors };
}

// ── how busy the address and the number are ──────────────────────────────────────────────────────

const HOUR_MS = 3_600_000;

/**
 * Earlier apply-page leads from this address in the last hour and for this number in the last day, counted BEFORE
 * this one is stored. Both org-scoped. A count that fails reads as 0 and is logged: a check that cannot run flags
 * nobody, as Turnstile's outage does not.
 */
export async function busyCounts(
  admin: SupabaseClient,
  orgId: string,
  ip: string | null,
  phone: string | null,
  now: Date,
): Promise<{ address_last_hour: number; number_last_day: number }> {
  const count = async (label: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await q;
    if (error) {
      console.error(`[apply-page] org ${orgId}: ${label} count failed, read as 0: ${error.message}`);
      return 0;
    }
    return n ?? 0;
  };
  const leads = () => admin.from("recruiting_leads").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("channel", APPLY_PAGE_CHANNEL);
  const [address_last_hour, number_last_day] = await Promise.all([
    ip ? count("address", leads().eq("raw->client->>ip", ip).gte("received_at", new Date(now.getTime() - HOUR_MS).toISOString())) : 0,
    phone ? count("number", leads().eq("phone_e164", phone).gte("received_at", new Date(now.getTime() - 24 * HOUR_MS).toISOString())) : 0,
  ]);
  return { address_last_hour, number_last_day };
}

export function checksOf(c: Omit<ApplyChecks, "flags">): ApplyChecks {
  return { ...c, flags: applyFlags(c) };
}
