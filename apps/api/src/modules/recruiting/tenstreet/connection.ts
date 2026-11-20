import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TenstreetConnectionMode,
  TenstreetConnectionSave,
  TenstreetConnectionStatus,
  TenstreetKeyIssued,
  TenstreetLastProblem,
} from "@silvicom/shared";
import type { Env } from "../../../env.js";
import { isSecretBoxConfigured } from "../../../lib/secretBox.js";
import { hashTenstreetKey, REJECT_TEXT, TENSTREET_WEBHOOK_PATH } from "./receive.js";

/**
 * The office's side of a carrier's Tenstreet connection (TENSTREET-INTAKE-PLAN TS4): read it for the Settings card,
 * save the Company ID / mode / on-off, and issue a new URL secret. The receiver (`receive.ts`) is the only reader of
 * what is written here; the routes (`routes/tenstreet.ts`) gate and audit.
 *
 * ── THE SECRET (D-TS7) ──────────────────────────────────────────────────────────────────────────
 * 32 random bytes, base64url — 43 characters, inside the receiver's `[A-Za-z0-9_-]{32,128}` shape check. Stored only
 * as `hashTenstreetKey` (SHA-256, the receiver's own function, so the two can never disagree) and its last four
 * characters. The plain key leaves the server once, in the rotate answer, and is in no log and no audit row. A new key
 * replaces the old one at once: the old address answers 401 from that moment, which is what a person rotating a key
 * that leaked needs, and why the card says so before it asks.
 *
 * ── THE ADDRESS ─────────────────────────────────────────────────────────────────────────────────
 * `PUBLIC_API_URL` + the receiver's own path, as FleetPal's `receiverUrl` builds its address. Unset, there is no
 * address to show — the card says so, rather than printing a bare path that a person then completes by guesswork
 * (how FleetPal's once became `/api/webhooks`, env.ts).
 *
 * ── "LAST ERROR" IS READ FROM THE LOG ───────────────────────────────────────────────────────────
 * 0640 gave the connection a `last_error` column, and nothing writes it (the receiver only clears it). The card's
 * last problem is therefore read from `tenstreet_posts` — the newest refused post or the newest post that could not
 * become a lead — which is what actually happened, rather than a sentence no code sets. A refusal carries the very
 * sentence Tenstreet was answered with (`REJECT_TEXT`), so the office and Tenstreet read the same words.
 */

export const TENSTREET_KEY_BYTES = 32;
/**
 * A kept post that could not become a lead. `process_error` is the job's code-level reason ("unreadable: …"); the
 * office is told what it means and what to do, and the reason stays beside it for whoever looks further.
 */
const FAILED_TEXT = "It was kept, but could not be read into a lead. Find the applicant in Tenstreet and add them by hand.";
const DAY_MS = 86_400_000;

interface ConnectionRow {
  id: string;
  company_id: string;
  mode: TenstreetConnectionMode;
  enabled: boolean;
  key_hash: string | null;
  key_hint: string | null;
  rotated_at: string | null;
  last_post_at: string | null;
}

export interface ConnectionRefusal {
  status: number;
  code: string;
  message: string;
}
export const isConnectionRefusal = (v: unknown): v is ConnectionRefusal =>
  typeof v === "object" && v !== null && "status" in v && "code" in v && "message" in v;

/** The address Tenstreet posts to, for a key or a mask; null when this deploy does not know its own address. */
export function tenstreetEndpoint(env: Pick<Env, "PUBLIC_API_URL">, keyPart: string): string | null {
  if (!env.PUBLIC_API_URL) return null;
  return `${env.PUBLIC_API_URL.replace(/\/+$/, "")}${TENSTREET_WEBHOOK_PATH}/${keyPart}`;
}

async function readRow(admin: SupabaseClient, orgId: string): Promise<ConnectionRow | null> {
  const { data, error } = await admin
    .from("tenstreet_connections")
    .select("id, company_id, mode, enabled, key_hash, key_hint, rotated_at, last_post_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`tenstreet_connections: ${error.message}`);
  return (data as ConnectionRow | null) ?? null;
}

export async function readTenstreetConnection(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  now: Date,
): Promise<TenstreetConnectionStatus> {
  const row = await readRow(admin, orgId);
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const posts = () => admin.from("tenstreet_posts");
  const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await q;
    if (error) throw new Error(`tenstreet_posts: ${error.message}`);
    return n ?? 0;
  };
  const head = { count: "exact" as const, head: true };
  const [accepted, rejected, failed, lastRejected, lastFailed] = row
    ? await Promise.all([
        count(posts().select("id", head).eq("org_id", orgId).eq("reply_status", "ACCEPTED").gte("received_at", since)),
        count(posts().select("id", head).eq("org_id", orgId).eq("reply_status", "REJECTED").gte("received_at", since)),
        count(posts().select("id", head).eq("org_id", orgId).not("process_error", "is", null).gte("received_at", since)),
        posts().select("received_at, reply_reason").eq("org_id", orgId).eq("reply_status", "REJECTED")
          .order("received_at", { ascending: false }).limit(1).maybeSingle(),
        posts().select("processed_at, process_error").eq("org_id", orgId).not("process_error", "is", null)
          .order("processed_at", { ascending: false }).limit(1).maybeSingle(),
      ])
    : [0, 0, 0, { data: null, error: null }, { data: null, error: null }];
  for (const r of [lastRejected, lastFailed]) if (r.error) throw new Error(`tenstreet_posts: ${r.error.message}`);

  const problems: TenstreetLastProblem[] = [];
  const rej = lastRejected.data as { received_at: string; reply_reason: string } | null;
  if (rej) problems.push({ at: rej.received_at, kind: "rejected", reason: rej.reply_reason, text: REJECT_TEXT[rej.reply_reason] ?? rej.reply_reason });
  const fail = lastFailed.data as { processed_at: string; process_error: string } | null;
  if (fail) problems.push({ at: fail.processed_at, kind: "failed", reason: fail.process_error, text: FAILED_TEXT });
  problems.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    configured: row !== null,
    companyId: row?.company_id ?? null,
    mode: row?.mode ?? "test",
    enabled: row?.enabled ?? false,
    keyHint: row?.key_hint ?? null,
    rotatedAt: row?.rotated_at ?? null,
    lastPostAt: row?.last_post_at ?? null,
    endpointMasked: row?.key_hint ? tenstreetEndpoint(env, `••••${row.key_hint}`) : null,
    receiverReady: isSecretBoxConfigured(env),
    last7Days: { accepted, rejected, failed },
    lastProblem: problems[0] ?? null,
  };
}

export interface SavedConnection {
  before: Pick<ConnectionRow, "company_id" | "mode" | "enabled"> | null;
  after: TenstreetConnectionSave;
}

/**
 * Save the Company ID, the mode and the switch. The table refuses a connection switched on with no key (0640's
 * `check (not enabled or key_hash is not null)`); that is asked here first, so the office reads a sentence and not a
 * constraint name. Two carriers can never hold one Company ID (0640's unique): the receiver's second check rests on it.
 */
export async function saveTenstreetConnection(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  input: TenstreetConnectionSave,
  now: Date,
): Promise<SavedConnection | ConnectionRefusal> {
  const row = await readRow(admin, orgId);
  if (input.enabled && !row?.key_hash) {
    return { status: 409, code: "tenstreet_key_required", message: "Make the address first: a connection with no key cannot be switched on." };
  }
  const fields = { company_id: input.companyId, mode: input.mode, enabled: input.enabled };
  const { error } = row
    ? await admin.from("tenstreet_connections").update({ ...fields, updated_at: now.toISOString() }).eq("org_id", orgId).eq("id", row.id)
    : await admin.from("tenstreet_connections").insert({ org_id: orgId, ...fields, created_by: actorId });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return {
        status: 409,
        code: "tenstreet_company_taken",
        message: "This Company ID is already connected to another Silvicom 360 account. Check the number with Tenstreet.",
      };
    }
    throw new Error(`tenstreet_connections: ${error.message}`);
  }
  return { before: row ? { company_id: row.company_id, mode: row.mode, enabled: row.enabled } : null, after: input };
}

/** Issue a new secret, replacing the old one at once. Refused until a Company ID is saved: there is nothing to key. */
export async function rotateTenstreetKey(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  now: Date,
): Promise<{ issued: TenstreetKeyIssued; replaced: boolean } | ConnectionRefusal> {
  const row = await readRow(admin, orgId);
  if (!row) return { status: 409, code: "tenstreet_not_configured", message: "Save Tenstreet's Company ID first." };
  const key = randomBytes(TENSTREET_KEY_BYTES).toString("base64url");
  const keyHint = key.slice(-4);
  const rotatedAt = now.toISOString();
  const { error } = await admin
    .from("tenstreet_connections")
    .update({ key_hash: hashTenstreetKey(key), key_hint: keyHint, rotated_at: rotatedAt, updated_at: rotatedAt })
    .eq("org_id", orgId)
    .eq("id", row.id);
  if (error) throw new Error(`tenstreet_connections: ${error.message}`);
  return { issued: { key, keyHint, endpoint: tenstreetEndpoint(env, key), rotatedAt }, replaced: row.key_hash !== null };
}
