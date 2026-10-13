import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { isSecretBoxConfigured, seal, open, secretAad } from "../../lib/secretBox.js";

/**
 * The Med-Stop credential (MEDSTOP-PLAN.md §9 2026-09-29, D-MS2).
 *
 * FleetPal's posture (`modules/fleetpal/credentials.ts`), for the same reasons: the key is shown
 * once by the vendor, so it is sealed with an AAD binding it to this org and this purpose, refused
 * outright when the sealing key is absent, and never returned to a browser — `hasKey` answers the
 * only question a page may ask. It is NOT the `MEDSTOP_API_KEY` Railway variable set on 2026-10-01
 * for the first probe: a variable is one key for every org and is readable by anyone who can read
 * the service's settings.
 *
 * Med-Stop adds one fact FleetPal lacks: **keys die after at most 180 days**, and a dead key answers
 * the same 401 as a wrong one. `key_expires_on` is what the admin types from Med-Stop's API Admin
 * page, so the Settings page can warn before the day instead of a red sweep after it.
 */

export interface MedstopCredential {
  baseUrl: string;
  enabled: boolean;
  hasKey: boolean;
  keyExpiresOn: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

const AAD_PURPOSE = "medstop.api_key";

interface CredentialRow {
  base_url: string;
  enabled: boolean;
  api_key_sealed: string | null;
  key_expires_on: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

export async function getCredential(admin: SupabaseClient, orgId: string): Promise<MedstopCredential | null> {
  const { data, error } = await admin
    .from("medstop_credentials")
    .select("base_url, enabled, api_key_sealed, key_expires_on, last_synced_at, last_error")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as CredentialRow;
  return {
    baseUrl: row.base_url,
    enabled: row.enabled,
    hasKey: row.api_key_sealed !== null,
    keyExpiresOn: row.key_expires_on,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  };
}

/**
 * The key itself, for the sweep to send — null when unconfigured, switched off, or when the envelope
 * will not open under the current `SECRETS_ENCRYPTION_KEY`. All three mean stop: sending an empty key
 * would come back as a 401 that reads like a revoked key.
 */
export async function getApiKey(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<{ apiKey: string; baseUrl: string } | null> {
  const { data, error } = await admin
    .from("medstop_credentials")
    .select("base_url, enabled, api_key_sealed")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Pick<CredentialRow, "base_url" | "enabled" | "api_key_sealed">;
  if (!row.enabled || !row.api_key_sealed) return null;
  return { apiKey: open(env, row.api_key_sealed, secretAad(orgId, AAD_PURPOSE)), baseUrl: row.base_url };
}

/** UPDATE-then-INSERT, never a partial `.upsert()` (`lint:upserts`). */
async function writeRow(admin: SupabaseClient, orgId: string, patch: Record<string, unknown>): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await admin.from("medstop_credentials").update(patch).eq("org_id", orgId).select("org_id");
  if (error) return { error: error.message };
  if (data && data.length > 0) return { ok: true };
  const { error: insertError } = await admin.from("medstop_credentials").insert({ org_id: orgId, ...patch });
  return insertError ? { error: insertError.message } : { ok: true };
}

export async function setApiKey(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  apiKey: string,
  expiresOn: string | null,
): Promise<{ ok: true } | { error: string }> {
  if (!isSecretBoxConfigured(env)) {
    return { error: "SECRETS_ENCRYPTION_KEY is not set — refusing to store a Med-Stop key in the clear" };
  }
  return writeRow(admin, orgId, {
    api_key_sealed: seal(env, apiKey, secretAad(orgId, AAD_PURPOSE)),
    key_expires_on: expiresOn,
    last_error: null,
  });
}

/** The kill switch — separate from the key, so turning the sweep off never asks for the key again. */
export const setEnabled = (admin: SupabaseClient, orgId: string, enabled: boolean) => writeRow(admin, orgId, { enabled });

export async function recordSweep(admin: SupabaseClient, orgId: string, outcome: { at: string; error: string | null }): Promise<void> {
  await admin.from("medstop_credentials").update({ last_synced_at: outcome.at, last_error: outcome.error }).eq("org_id", orgId);
}

/** Orgs switched ON and holding a key — neither half alone (an enabled row with no key is a 401 per tick). */
export async function orgsWithMedstop(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin
    .from("medstop_credentials")
    .select("org_id")
    .eq("enabled", true)
    .not("api_key_sealed", "is", null);
  if (error || !data) return [];
  return (data as { org_id: string }[]).map((r) => r.org_id);
}
