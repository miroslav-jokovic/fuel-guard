import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { invalidateOrgSoapCaches } from "../lib/soapCaches.js";
import { open, seal, secretAad } from "../lib/secretBox.js";
import { describeTlsMaterial, envTlsMaterial, type EfsTlsMaterial } from "../lib/soapClient.js";
import { CERT_EXPIRY_WARN_DAYS, listCerts, loadActiveMaterial, type StoredCertSummary } from "./efsSoapClientCerts.js";

/**
 * EFS SOAP integration credentials — CRUD + non-secret status.
 *
 * Backing table: `efs_soap_credentials` (migration 0091). Service-role only — no client RLS policies
 * — because rows carry the SOAP password. All reads/writes here MUST go through the service-role
 * client (`getSupabaseAdmin`), same posture as Samsara's `integration_credentials.samsara_api_token`.
 *
 * Design decisions locked in this module:
 *   • Per-org row (org_id primary key). One EFS account per org for now.
 *   • Single-tenant env-var fallback (EFS_SOAP_USERNAME/PASSWORD/ENDPOINT_URL), scoped by
 *     EFS_SOAP_ORG_ID when supplied; durable cursor state is seeded into the DB on first enabled pass.
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
  /** True when credentials came from Railway env vars and still need durable DB state. */
  fromEnvFallback: boolean;
  /**
   * Mutual-TLS material to present on every call for this org, or null for ordinary TLS.
   * Resolved once here — per-org `efs_soap_client_certs` row first, then the deploy-wide env vars —
   * so every downstream caller (poller, manual sync, test-connection) presents the same identity
   * without each having to know the precedence rules.
   */
  tls: EfsTlsMaterial | null;
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
    processingPending: number;
    processingLastError: string | null;
  };
  rejected: {
    lastPolledAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    processingPending: number;
    processingLastError: string | null;
  };
  /** Transport security, described without exposing any key material. */
  tls: {
    /** Human summary, e.g. "client certificate (PEM, CN=...) + per-org". */
    description: string;
    /** "org" when a stored certificate is presenting, "env" for the deploy-wide fallback, else null. */
    source: "org" | "env" | null;
    /** The active stored certificate, when there is one. Never includes the private key. */
    activeCert: StoredCertSummary | null;
    /** True when a certificate is presenting and it expires within the warning band. */
    expiringSoon: boolean;
  };
}

/** Zero-configured status — reported to the UI when no row exists AND no env fallback is set. */
const EMPTY_STATUS: Omit<EfsSoapStatus, "configured" | "enabled" | "tls"> = {
  environment: null,
  endpointUrl: null,
  accountId: null,
  posted: { lastPolledAt: null, lastSuccessAt: null, lastError: null, processingPending: 0, processingLastError: null },
  rejected: { lastPolledAt: null, lastSuccessAt: null, lastError: null, processingPending: 0, processingLastError: null },
};

interface DbRow {
  org_id: string;
  environment: string;
  endpoint_url: string;
  soap_username: string;
  soap_password: string;
  soap_password_sealed: string | null;
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

function fromRow(row: DbRow, tls: EfsTlsMaterial | null, env: Env): EfsSoapCredentials {
  const soapPassword = row.soap_password_sealed
    ? open(env, row.soap_password_sealed, secretAad(row.org_id, "efs_soap_password.v1"))
    : row.soap_password;
  return {
    orgId: row.org_id,
    environment: row.environment === "production" ? "production" : "sandbox",
    endpointUrl: row.endpoint_url,
    soapUsername: row.soap_username,
    soapPassword,
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
    fromEnvFallback: false,
    tls,
  };
}

/**
 * Which client certificate this org presents. Per-org stored certificate wins; the deploy-wide env
 * vars are the single-tenant fallback; null means ordinary TLS.
 *
 * Never throws. A certificate we cannot unseal (SECRETS_ENCRYPTION_KEY rotated or missing) must NOT
 * take the whole integration down silently-but-mysteriously — it logs loudly, and the caller proceeds
 * with whatever the fallback is. EFS then either accepts the connection (mTLS was optional) or
 * rejects it with a classified TLS error that names the problem. Both are better than a crash inside
 * a scheduler tick.
 */
async function resolveTls(admin: SupabaseClient, env: Env, orgId: string): Promise<EfsTlsMaterial | null> {
  try {
    const orgMaterial = await loadActiveMaterial(admin, env, orgId);
    if (orgMaterial) return orgMaterial;
  } catch (e) {
    console.error(`[efs-soap-tls] org ${orgId}: stored client certificate unusable — ${e instanceof Error ? e.message : e}`);
  }
  try {
    return envTlsMaterial(env);
  } catch (e) {
    console.error(`[efs-soap-tls] deploy TLS env vars are invalid — ${e instanceof Error ? e.message : e}`);
    return null;
  }
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
  const tls = await resolveTls(admin, env, orgId);
  if (data) return fromRow(data as DbRow, tls, env);

  // Env-var fallback (single-tenant deploy). Endpoint, username, and password must be present —
  // and the fallback must be BOUND to one org. Serving one EFS account's credentials to whichever
  // orgId happened to ask is how one fleet's PANs end up mirrored into every tenant (audit P0-6):
  // the sweep would seal the same card inventory into each org, and any tenant that later passed
  // the card-control gates could act on another company's cards. No RLS posture catches it, because
  // the service role does the writes. So: no EFS_SOAP_ORG_ID, no fallback — loudly.
  if (!env.EFS_SOAP_ORG_ID) {
    if (env.EFS_SOAP_ENDPOINT_URL && env.EFS_SOAP_USERNAME && env.EFS_SOAP_PASSWORD) {
      console.error(
        "[efs-soap] EFS_SOAP_* env credentials are set but EFS_SOAP_ORG_ID is not. The fallback is " +
          "disabled until it names exactly one org — serving it to every org mirrors one EFS " +
          "account's cards into all tenants.",
      );
    }
    return null;
  }
  if (env.EFS_SOAP_ORG_ID !== orgId) return null;
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
      fromEnvFallback: true,
      tls,
    };
  }
  return null;
}

/**
 * Every org with EFS SOAP configured (row present + enabled), plus the ONE org an env fallback is
 * bound to via EFS_SOAP_ORG_ID.
 *
 * The previous "legacy compatibility" branch enumerated `organizations` and applied the env
 * credentials to every org when EFS_SOAP_ORG_ID was unset. That fan-out is the cross-tenant PAN
 * exposure described in audit P0-6 — one EFS account's whole card inventory swept into every
 * tenant's mirror. It is gone: an unbound fallback now contributes no orgs at all, and
 * `getEfsSoapCredentials` logs the misconfiguration loudly so the missing variable is found in
 * minutes, not by a tenant finding someone else's cards.
 */
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
    env.EFS_SOAP_ORG_ID &&
    env.EFS_SOAP_ENDPOINT_URL &&
    env.EFS_SOAP_USERNAME &&
    env.EFS_SOAP_PASSWORD &&
    env.EFS_SOAP_ENABLED
  ) {
    set.add(env.EFS_SOAP_ORG_ID);
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
  env: Env,
  orgId: string,
  input: UpsertEfsSoapInput,
): Promise<void> {
  const { error } = await admin.from("efs_soap_credentials").upsert(
    {
      org_id: orgId,
      environment: input.environment,
      endpoint_url: input.endpointUrl,
      soap_username: input.soapUsername,
      soap_password: "",
      soap_password_sealed: seal(env, input.soapPassword, secretAad(orgId, "efs_soap_password.v1")),
      account_id: input.accountId,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (error) throw new Error(error.message);
  invalidateOrgSoapCaches(orgId);
}

/** Disable + wipe the SOAP password so a scheduler that missed the enabled flag can't dial home. */
export async function disableEfsSoapCredentials(admin: SupabaseClient, orgId: string): Promise<void> {
  const { error } = await admin
    .from("efs_soap_credentials")
    .update({
      enabled: false,
      soap_password: "",
      soap_password_sealed: null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
  invalidateOrgSoapCaches(orgId);
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
  const tls = await tlsStatus(admin, orgId, creds?.tls ?? null);
  if (!creds) return { configured: false, enabled: false, ...EMPTY_STATUS, tls };
  const { data: processing } = await admin
    .from("efs_processing_runs")
    .select("feed, status, last_error")
    .eq("org_id", orgId)
    .in("status", ["pending", "running", "failed"])
    .order("updated_at", { ascending: false })
    .limit(100);
  const processingRows = (processing ?? []) as { feed: "posted" | "rejected"; status: string; last_error: string | null }[];
  const processingFor = (feed: "posted" | "rejected") => {
    const rows = processingRows.filter((r) => r.feed === feed);
    return {
      processingPending: rows.length,
      processingLastError: rows.find((r) => r.status === "failed")?.last_error ?? null,
    };
  };
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
      ...processingFor("posted"),
    },
    rejected: {
      lastPolledAt: creds.rejectedLastPolledAt,
      lastSuccessAt: creds.rejectedLastSuccessAt,
      lastError: creds.rejectedLastError,
      ...processingFor("rejected"),
    },
    tls,
  };
}

/**
 * Transport-security block for the settings UI. Reads the ACTIVE certificate's metadata (never its
 * key) so an admin can see, in one place: what identity we present, who issued it, when it expires,
 * and whether the last handshake actually worked. That last field is what makes an EFS-side
 * enrolment problem visible before it becomes a silent gap in the fuel feed.
 */
async function tlsStatus(
  admin: SupabaseClient,
  orgId: string,
  material: EfsTlsMaterial | null,
): Promise<EfsSoapStatus["tls"]> {
  let activeCert: StoredCertSummary | null = null;
  if (material?.source === "org") {
    const certs = await listCerts(admin, orgId, new Date(), 5);
    activeCert = certs.find((c) => c.status === "active") ?? null;
  }
  const expiringSoon = activeCert
    ? activeCert.expiryState === "expiring" || activeCert.expiryState === "expired"
    : !!material?.notAfter && Date.parse(material.notAfter) - Date.now() <= CERT_EXPIRY_WARN_DAYS * 86_400_000;
  return {
    description: describeTlsMaterial(material),
    source: material?.source ?? null,
    activeCert,
    expiringSoon,
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
