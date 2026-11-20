import type { SupabaseClient } from "@supabase/supabase-js";
import { lookupIsStale, projectTelnyxLookup, telnyxLookupSchema, type PhoneLine, type PhoneLookupProjection } from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { redactNumber } from "../../../lib/sms.js";

/**
 * What the phone provider says about a lead's number (ADS-LEAD-INTAKE-PLAN LQ8b; ADS-PLATFORM-V2-PLAN V7a;
 * Q-AD62 (a): every lead with a phone, once per number, a flag and never a filter). The table is 0583's
 * `phone_lookups`, one row per (carrier, number); this file is its one writer.
 *
 * ── WHEN IT RUNS ─────────────────────────────────────────────────────────────────────────────────
 * AFTER the lead is stored, never before: the sink stores, rings, and then asks (`leadSink.ts`), and a typed-in
 * lead is asked about after its store (`routes/leads.ts`). A lookup that fails never fails either caller — the
 * lead is in the table by then — and the number is asked again by the uncontacted sweep's tick
 * (`lookUpMissingPhones`), which is the plan's "a miss is retried by the sweep".
 *
 * ── WHAT TELNYX'S ANSWERS MEAN (OpenAPI `LookupNumber`, read 2026-11-19) ───────────────────────────
 *   200   the answer → stored, folded to four words (`projectTelnyxLookup`).
 *   422   "Unprocessable entity": Telnyx will not answer for THIS number (its one example is a Canadian number
 *         on an account not enabled for Canada). Asking again gives the same 422, so it is stored as `unknown`
 *         with Telnyx's error kept in `raw`, and the number is asked again only when the row goes stale.
 *   other the documented "Unexpected error" default, and anything undocumented (401, 429, a 5xx, a timeout, a
 *         body we cannot read): nothing stored; the sweep asks again. A 401/403 is logged as a configuration
 *         fault, because no retry will mend it.
 * What a well-formed but unassigned number returns is NOT documented; whichever of the above it is, it is
 * handled by that row, never guessed at.
 *
 * ── THE CEILING ──────────────────────────────────────────────────────────────────────────────────
 * `TELNYX_LOOKUP_DAILY_MAX` lookups per carrier per UTC day, counted from the table itself (rows whose
 * `looked_up_at` is today — a number is never looked up twice in a day, since a row is fresh for 180). Over it,
 * the number waits for tomorrow's sweep. The plan asked for a `lead_intake_failing` bell here; that bell says
 * "ad leads are not arriving", which is not what happened, so the count rides on the job's detail instead
 * (`LookupRun.over_quota`) and no bell is rung under a wrong name.
 *
 * Only `type=carrier` is asked — never `caller-name`/`caller-identity`, which return a person's name and address.
 * The number goes in the path as E.164 with its `+`, as Telnyx's own example sends it; it has passed the
 * table's CHECK (`^\+[1-9][0-9]{7,14}$`) first, so nothing else can reach the URL.
 */

export type LookupAnswer =
  | { kind: "answered"; projection: PhoneLookupProjection; raw: Record<string, unknown> }
  | { kind: "refused"; raw: Record<string, unknown> }
  | { kind: "failed"; reason: string };

export interface PhoneLookupClient {
  lookup(e164: string): Promise<LookupAnswer>;
}

export const TELNYX_LOOKUP_TIMEOUT_MS = 5_000;
const E164 = /^\+[1-9][0-9]{7,14}$/;

export function telnyxLookupClient(
  apiKey: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): PhoneLookupClient {
  const base = (opts.baseUrl ?? "https://api.telnyx.com").replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async lookup(e164) {
      if (!E164.test(e164)) return { kind: "failed", reason: "not an E.164 number" };
      let res: Response;
      try {
        res = await doFetch(`${base}/v2/number_lookup/${e164}?type=carrier`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(opts.timeoutMs ?? TELNYX_LOOKUP_TIMEOUT_MS),
        });
      } catch (err) {
        return { kind: "failed", reason: err instanceof Error ? err.name : "network" };
      }
      const body = await res.json().catch(() => null);
      if (res.status === 200) {
        const parsed = telnyxLookupSchema.safeParse(body);
        if (!parsed.success) return { kind: "failed", reason: "answer unreadable" };
        return { kind: "answered", projection: projectTelnyxLookup(parsed.data), raw: { ...(body as { data: Record<string, unknown> }).data } };
      }
      if (res.status === 422) {
        const errors = body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors) ? (body as { errors: unknown[] }).errors : [];
        return { kind: "refused", raw: { http_status: 422, errors } };
      }
      return { kind: "failed", reason: `HTTP ${res.status}` };
    },
  };
}

/** The client the deployment has, or null when the lookup is off (no key, or a ceiling of 0). */
export function phoneLookupFor(env: Pick<Env, "TELNYX_API_KEY" | "TELNYX_LOOKUP_DAILY_MAX">): PhoneLookupDeps | null {
  if (!env.TELNYX_API_KEY || env.TELNYX_LOOKUP_DAILY_MAX <= 0) return null;
  return { client: telnyxLookupClient(env.TELNYX_API_KEY), dailyMax: env.TELNYX_LOOKUP_DAILY_MAX };
}

export interface PhoneLookupDeps {
  client: PhoneLookupClient;
  dailyMax: number;
}

export interface LookupRun { asked: number; stored: number; refused: number; failed: number; fresh: number; over_quota: number }

const startOfUtcDay = (now: Date): string => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;

/**
 * Look up each number that has no fresh row. Throws only when the table cannot be read or written — a caller
 * that must not fail (the sink, the manual door) wraps it; the sweep lets the job record the failure.
 */
export async function lookUpPhones(
  admin: SupabaseClient,
  orgId: string,
  phones: ReadonlyArray<string | null>,
  deps: PhoneLookupDeps,
  now: Date,
): Promise<LookupRun> {
  const run: LookupRun = { asked: 0, stored: 0, refused: 0, failed: 0, fresh: 0, over_quota: 0 };
  const wanted = [...new Set(phones.filter((p): p is string => typeof p === "string" && E164.test(p)))];
  if (wanted.length === 0) return run;

  const { data, error } = await admin
    .from("phone_lookups").select("id, phone_e164, looked_up_at").eq("org_id", orgId).in("phone_e164", wanted);
  if (error) throw new Error(`Could not read the phone lookups: ${error.message}`);
  const existing = new Map(((data ?? []) as Array<{ id: string; phone_e164: string; looked_up_at: string }>).map((r) => [r.phone_e164, r]));

  const { count, error: ce } = await admin
    .from("phone_lookups").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).gte("looked_up_at", startOfUtcDay(now));
  if (ce) throw new Error(`Could not count today's phone lookups: ${ce.message}`);
  let used = count ?? 0;

  for (const phone of wanted) {
    const row = existing.get(phone);
    if (row && !lookupIsStale(row.looked_up_at, now)) { run.fresh += 1; continue; }
    if (used >= deps.dailyMax) { run.over_quota += 1; continue; }
    run.asked += 1;
    const answer = await deps.client.lookup(phone);
    if (answer.kind === "failed") {
      run.failed += 1;
      const config = /^HTTP 40[13]$/.test(answer.reason);
      console[config ? "error" : "warn"](`[phone-lookup] org ${orgId}: ${redactNumber(phone)} not looked up (${answer.reason})${config ? " — the Telnyx key is refused; no retry will mend this" : ""}`);
      continue;
    }
    const projection: PhoneLookupProjection = answer.kind === "answered" ? answer.projection : { line_type: "unknown", carrier: null, valid: null };
    await writeLookup(admin, orgId, phone, row?.id ?? null, projection, answer.raw, now);
    used += 1;
    if (answer.kind === "refused") run.refused += 1;
    else run.stored += 1;
  }
  return run;
}

/** A new number is inserted; a stale one is replaced whole (an UPDATE, never a partial upsert — lint:upserts). */
async function writeLookup(
  admin: SupabaseClient,
  orgId: string,
  phone: string,
  existingId: string | null,
  p: PhoneLookupProjection,
  raw: Record<string, unknown>,
  now: Date,
): Promise<void> {
  const fields = { provider: "telnyx", line_type: p.line_type, carrier: p.carrier, valid: p.valid, raw, looked_up_at: now.toISOString() };
  if (existingId === null) {
    const { error } = await admin.from("phone_lookups").insert({ org_id: orgId, phone_e164: phone, ...fields });
    if (!error) return;
    // Another lead with the same number was looked up between our read and this insert: replace theirs, the
    // answer is the same number's and no older.
    if ((error as { code?: string }).code !== "23505") throw new Error(`Could not store the phone lookup: ${error.message}`);
  }
  const { error } = await admin.from("phone_lookups").update(fields).eq("org_id", orgId).eq("phone_e164", phone);
  if (error) throw new Error(`Could not store the phone lookup: ${error.message}`);
}

/** The stored reading of each number, for the queue and the drawer. */
export async function readPhoneLines(admin: SupabaseClient, orgId: string, phones: ReadonlyArray<string | null>): Promise<Map<string, PhoneLine>> {
  const wanted = [...new Set(phones.filter((p): p is string => typeof p === "string" && E164.test(p)))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await admin
    .from("phone_lookups").select("phone_e164, line_type, valid, carrier, looked_up_at").eq("org_id", orgId).in("phone_e164", wanted);
  if (error) throw new Error(`Could not read the phone lookups: ${error.message}`);
  return new Map(((data ?? []) as Array<PhoneLine & { phone_e164: string }>).map(({ phone_e164, ...line }) => [phone_e164, line]));
}

// ── the retry ────────────────────────────────────────────────────────────────────────────────────
/** How far back the retry looks: a lead older than a week has been called or closed, and its badge is history. */
export const LOOKUP_RETRY_DAYS = 7;
/** At most this many numbers per carrier per sweep (one sweep every five minutes). */
export const LOOKUP_RETRY_MAX = 100;

/**
 * Every lead of the last `LOOKUP_RETRY_DAYS` whose number has no fresh row, newest first — the numbers a failed or
 * over-ceiling lookup left behind, and a typed-in lead whose door's lookup failed. Any channel, any status: the
 * badge is the number's, and a recruiter may open a contacted lead too.
 */
export async function lookUpMissingPhones(admin: SupabaseClient, orgId: string, deps: PhoneLookupDeps, now: Date): Promise<LookupRun> {
  const since = new Date(now.getTime() - LOOKUP_RETRY_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("recruiting_leads").select("phone_e164")
    .eq("org_id", orgId).gte("received_at", since).not("phone_e164", "is", null)
    .order("received_at", { ascending: false }).order("id").limit(500);
  if (error) throw new Error(`Could not read the recent leads' numbers: ${error.message}`);
  const phones = [...new Set(((data ?? []) as Array<{ phone_e164: string }>).map((r) => r.phone_e164))];
  const known = await readPhoneLines(admin, orgId, phones);
  const missing = phones.filter((p) => { const k = known.get(p); return !k || lookupIsStale(k.looked_up_at, now); });
  return lookUpPhones(admin, orgId, missing.slice(0, LOOKUP_RETRY_MAX), deps, now);
}
