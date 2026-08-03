import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";

/**
 * EFS SOAP integration credentials — CRUD + non-secret status.
 *
 * Backing table: `efs_soap_credentials` (migration 0091). Service-role only — no client RLS policies
 * — because rows carry the SOAP password. All reads/writes here MUST go through the service-role
 * client (`getSupabaseAdmin`), same posture as Samsara's `integration_credentials.samsara_api_token`.
 *
 * Design decisions locked in this module:
 *   • Per-org row (org_id primary key). One EFS account per org for now.
 *   • Single-tenant env-var fallback (EFS_SOAP_USERNAME/PASSWORD/ENDPOINT_URL/ACCOUNT_ID) so a
 *     dev/staging env can run without a database row — matches the Samsara pattern.
 *   • `enabled` flag is checked EVERYWHERE credentials are consumed. A disabled row + a stale
 *     scheduler run must never call EFS.
 *   • `getStatus()` NEVER returns the password (or its length, or a hash of it). It returns only
 *     what the UI/admin needs to see: whether credentials exist, environment, freshness, error.
 */

export interface EfsSoapCredentials {
  orgId: string;
  environment: "sandbox" | "production";
  endpointUrl: string;
  soapUsername: string;
  soapPassword: string;
  accountId: string | null;
  postedLastCursor: string | null;
  rejectedLastCursor: string | null;
  postedLastPolledAt: string | null;
  rejectedLastPolledAt: string | null;
  postedLastSuccessAt: string | null;
  rejectedLastSuccessAt: string | null;
  postedLastError: string | null;
  rejectedLastError: string | null;
  enabled: boolean;
}

export interface EfsSoapStatus {
  configured: boolean;
  enabled: boolean;
  environment: "sandbox" | "production" | null;
  endpointUrl: string | null;
  accountId: string | null;
  posted: {
    lastPolledAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
  rejected: {
    lastPolledAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
}

/** Zero-configured status — reported to the UI when no row exists AND no env fallback is set. */
const EMPTY_STATUS: Omit<EfsSoapStatus, "configured" | "enabled"> = {
  environment: null,
  endpointUrl: null,
  accountId: null,
  posted: { lastPolledAt: null, lastSuccessAt: null, lastError: null },
  rejected: { lastPolledAt: null, lastSuccessAt: null, lastError: null },
};

interface DbRow {
  org_id: string;
  environment: string;
  endpoint_url: string;
  soap_username: string;
  soap_password: string;
  account_id: string | null;
  posted_last_cursor: string | null;
  rejected_last_cursor: string | null;
  posted_last_polled_at: string | null;
  rejected_last_polled_at: string | null;
  posted_last_success_at: string | null;
  rejected_last_success_at: string | null;
  posted_last_error: string | null;
  rejected_last_error: string | null;
  enabled: boolean;
}

function fromRow(row: DbRow): EfsSoapCredentials {
  return {
    orgId: row.org_id,
    environment: row.environment === "production" ? "production" : "sandbox",
    endpointUrl: row.endpoint_url,
    soapUsername: row.soap_username,
    soapPassword: row.soap_password,
    accountId: row.account_id,
    postedLastCursor: row.posted_last_cursor,
    rejectedLastCursor: row.rejected_last_cursor,
    postedLastPolledAt: row.posted_last_polled_at,
    rejectedLastPolledAt: row.rejected_last_polled_at,
    postedLastSuccessAt: row.posted_last_success_at,
    rejectedLastSuccessAt: row.rejected_last_success_at,
    postedLastError: row.posted_last_error,
    rejectedLastError: row.rejected_last_error,
    enabled: row.enabled,
  };
}

/**
 * Load an org's EFS SOAP credentials, or a single-tenant env-var fallback if the row is missing AND
 * the fallback vars are set. Returns null if neither is available — the poller/routes MUST treat null
 * as "not configured" and skip cleanly (no throw).
 *
 * Ordering: DB row wins over env-var fallback. This lets a dev override the environment during
 * testing by writing a row without touching deploy vars.
 */
export async function getEfsSoapCredentials(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<EfsSoapCredentials | null> {
  const { data } = await admin
    .from("efs_soap_credentials")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (data) return fromRow(data as DbRow);

  // Env-var fallback (single-tenant deploy). All four fields must be present for it to count.
  if (env.EFS_SOAP_ENDPOINT_URL && env.EFS_SOAP_USERNAME && env.EFS_SOAP_PASSWORD) {
    return {
      orgId,
      environment: env.EFS_SOAP_ENVIRONMENT,
      endpointUrl: env.EFS_SOAP_ENDPOINT_URL,
      soapUsername: env.EFS_SOAP_USERNAME,
      soapPassword: env.EFS_SOAP_PASSWORD,
      accountId: env.EFS_SOAP_ACCOUNT_ID ?? null,
      postedLastCursor: null,
      rejectedLastCursor: null,
      postedLastPolledAt: null,
      rejectedLastPolledAt: null,
      postedLastSuccessAt: null,
      rejectedLastSuccessAt: null,
      postedLastError: null,
      rejectedLastError: null,
      enabled: env.EFS_SOAP_ENABLED,
    };
  }
  return null;
}

/** Every org with EFS SOAP configured (row present + enabled). Env-var fallback applies to ALL
 *  orgs when set — matches the Samsara pattern. */
export async function orgsWithEfsSoap(admin: SupabaseClient, env: Env): Promise<string[]> {
  const set = new Set<string>();
  const { data } = await admin
    .from("efs_soap_credentials")
    .select("org_id, enabled")
    .eq("enabled", true);
  for (const row of (data ?? []) as { org_id: string; enabled: boolean }[]) {
    set.add(row.org_id);
  }
  if (
    env.EFS_SOAP_ENDPOINT_URL &&
    env.EFS_SOAP_USERNAME &&
    env.EFS_SOAP_PASSWORD &&
    env.EFS_SOAP_ENABLED
  ) {
    const { data: orgs } = await admin.from("organizations").select("id");
    for (const o of (orgs ?? []) as { id: string }[]) set.add(o.id);
  }
  return [...set];
}

export interface UpsertEfsSoapInput {
  environment: "sandbox" | "production";
  endpointUrl: string;
  soapUsername: string;
  soapPassword: string;
  accountId: string | null;
  enabled: boolean;
}

/** Upsert credentials for an org. Also the ROTATE path — re-calling overwrites the password. */
export async function upsertEfsSoapCredentials(
  admin: SupabaseClient,
  orgId: string,
  input: UpsertEfsSoapInput,
): Promise<void> {
  const { error } = await admin.from("efs_soap_credentials").upsert(
    {
      org_id: orgId,
      environment: input.environment,
      endpoint_url: input.endpointUrl,
      soap_username: input.soapUsername,
      soap_password: input.soapPassword,
      account_id: input.accountId,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (error) throw new Error(error.message);
}

/** Disable + wipe the SOAP password so a scheduler that missed the enabled flag can't dial home. */
export async function disableEfsSoapCredentials(admin: SupabaseClient, orgId: string): Promise<void> {
  const { error } = await admin
    .from("efs_soap_credentials")
    .update({
      enabled: false,
      soap_password: "",
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
}

/**
 * Non-secret status for the settings UI. NEVER returns password, cursors (opaque provider tokens),
 * or anything that could leak credential material. Safe to expose to admin-role clients.
 */
export async function getEfsSoapStatus(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<EfsSoapStatus> {
  const creds = await getEfsSoapCredentials(admin, env, orgId);
  if (!creds) return { configured: false, enabled: false, ...EMPTY_STATUS };
  return {
    configured: true,
    enabled: creds.enabled && env.EFS_SOAP_ENABLED, // both must be true for the poller to run
    environment: creds.environment,
    endpointUrl: creds.endpointUrl,
    accountId: creds.accountId,
    posted: {
      lastPolledAt: creds.postedLastPolledAt,
      lastSuccessAt: creds.postedLastSuccessAt,
      lastError: creds.postedLastError,
    },
    rejected: {
      lastPolledAt: creds.rejectedLastPolledAt,
      lastSuccessAt: creds.rejectedLastSuccessAt,
      lastError: creds.rejectedLastError,
    },
  };
}

export type FeedName = "posted" | "rejected";

/** Advance the cursor + stamp success on the row. Never throws — errors log and no-op so a
 *  successful ingest is never rolled back by a stats-write failure. */
export async function recordFeedSuccess(
  admin: SupabaseClient,
  orgId: string,
  feed: FeedName,
  nextCursor: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const patch =
    feed === "posted"
      ? {
          posted_last_cursor: nextCursor,
          posted_last_polled_at: now,
          posted_last_success_at: now,
          posted_last_error: null,
          updated_at: now,
        }
      : {
          rejected_last_cursor: nextCursor,
          rejected_last_polled_at: now,
          rejected_last_success_at: now,
          rejected_last_error: null,
          updated_at: now,
        };
  const { error } = await admin.from("efs_soap_credentials").update(patch).eq("org_id", orgId);
  if (error) console.error(`[efs-soap] recordFeedSuccess(${feed}) failed for org ${orgId}: ${error.message}`);
}

/** Stamp the polled-at + error text for the feed. Cursor is NOT advanced on failure. Best-effort. */
export async function recordFeedFailure(
  admin: SupabaseClient,
  orgId: string,
  feed: FeedName,
  errorMessage: string,
): Promise<void> {
  const now = new Date().toISOString();
  const patch =
    feed === "posted"
      ? { posted_last_polled_at: now, posted_last_error: errorMessage, updated_at: now }
      : { rejected_last_polled_at: now, rejected_last_error: errorMessage, updated_at: now };
  const { error } = await admin.from("efs_soap_credentials").update(patch).eq("org_id", orgId);
  if (error) console.error(`[efs-soap] recordFeedFailure(${feed}) failed for org ${orgId}: ${error.message}`);
}
