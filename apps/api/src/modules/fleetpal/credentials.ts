import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { isSecretBoxConfigured, seal, open, secretAad } from "../../lib/secretBox.js";

/**
 * The FleetPal credential (FLEETPAL-INTEGRATION-PLAN.md F2, D-FP1).
 *
 * ── THE KEY IS SEALED BEFORE IT REACHES A COLUMN ───────────────────────────────────────────────
 * `integration_credentials.samsara_api_token` and `efs_soap_credentials.soap_password` are
 * plaintext behind "service role only, no RLS policies" — a defensible posture for a revocable
 * token, and one this collector does not inherit because it has no legacy rows to migrate. A
 * FleetPal key carries its issuing user's ROLE and COMPANY, is shown exactly once by the vendor and
 * cannot be recovered, so a database backup, a logical replica or a `pg_dump` in a support ticket
 * should not yield a working one. `secretBox` seals it with an AAD binding the ciphertext to this
 * org and this purpose, so lifting an envelope into another org's row fails authentication rather
 * than decrypting.
 *
 * ⚠ **We refuse to store a key at all when the sealing key is absent.** Not a fallback to
 * plaintext, not a warning — a refusal, at the point of write, which is the posture `secretBox`'s
 * own header sets and the only one that cannot degrade silently.
 */

export interface FleetpalCredential {
  orgId: string;
  baseUrl: string;
  enabled: boolean;
  hasKey: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

const AAD_PURPOSE = "fleetpal.api_key";

interface CredentialRow {
  org_id: string;
  base_url: string;
  enabled: boolean;
  api_key_sealed: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

function toCredential(row: CredentialRow): FleetpalCredential {
  return {
    orgId: row.org_id,
    baseUrl: row.base_url,
    enabled: row.enabled,
    // Never the envelope, and never a masked prefix of the key. A caller that wants to know whether
    // the integration is configured is asking a yes/no question, and answering it with ciphertext
    // puts the envelope on a route where the only thing it can do is leak.
    hasKey: row.api_key_sealed !== null,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  };
}

/** The configuration as an operator sees it. Never carries key material. */
export async function getCredential(
  admin: SupabaseClient,
  orgId: string,
): Promise<FleetpalCredential | null> {
  const { data, error } = await admin
    .from("fleetpal_credentials")
    .select("org_id, base_url, enabled, api_key_sealed, last_synced_at, last_error")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  return toCredential(data as CredentialRow);
}

/**
 * The key itself, for the client to send. Returns null when unconfigured, disabled, or when the
 * envelope cannot be opened — a rotated `SECRETS_ENCRYPTION_KEY` reports the key-id mismatch through
 * `SecretBoxError`, which is diagnosable, and this returns null so the caller stops rather than
 * sending an empty bearer token and reading the 401 as a revoked key.
 */
export async function getApiKey(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<{ apiKey: string; baseUrl: string } | null> {
  const { data, error } = await admin
    .from("fleetpal_credentials")
    .select("base_url, enabled, api_key_sealed")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Pick<CredentialRow, "base_url" | "enabled" | "api_key_sealed">;
  if (!row.enabled || !row.api_key_sealed) return null;
  const apiKey = open(env, row.api_key_sealed, secretAad(orgId, AAD_PURPOSE));
  return { apiKey, baseUrl: row.base_url };
}

/**
 * Store a key, sealed.
 *
 * UPDATE-then-INSERT, never `.upsert()` with a partial payload (`lint:upserts`): Postgres checks
 * NOT NULL before it arbitrates the conflict, so the convenient one-liner is the version that fails
 * in production and not in a test. Migrations 0174/0175 are the house pattern.
 */
export async function setApiKey(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  apiKey: string,
): Promise<{ ok: true } | { error: string }> {
  if (!isSecretBoxConfigured(env)) {
    return { error: "SECRETS_ENCRYPTION_KEY is not set — refusing to store a FleetPal key in the clear" };
  }
  const sealed = seal(env, apiKey, secretAad(orgId, AAD_PURPOSE));

  const { data: updated, error: updateError } = await admin
    .from("fleetpal_credentials")
    .update({ api_key_sealed: sealed })
    .eq("org_id", orgId)
    .select("org_id");
  if (updateError) return { error: updateError.message };
  if (updated && updated.length > 0) return { ok: true };

  const { error: insertError } = await admin
    .from("fleetpal_credentials")
    .insert({ org_id: orgId, api_key_sealed: sealed });
  if (insertError) return { error: insertError.message };
  return { ok: true };
}

/**
 * The kill switch. Separate from `setApiKey` because they are different acts: one supplies a
 * secret, the other decides whether a scheduler touches a vendor at all, and an operator turning
 * the integration off should not have to re-enter a key that is shown once and unrecoverable.
 */
export async function setEnabled(
  admin: SupabaseClient,
  orgId: string,
  enabled: boolean,
): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await admin
    .from("fleetpal_credentials")
    .update({ enabled })
    .eq("org_id", orgId)
    .select("org_id");
  if (error) return { error: error.message };
  if (data && data.length > 0) return { ok: true };

  const { error: insertError } = await admin
    .from("fleetpal_credentials")
    .insert({ org_id: orgId, enabled });
  if (insertError) return { error: insertError.message };
  return { ok: true };
}

/** Record the outcome of a sweep against the credential, which is where an operator looks first. */
export async function recordSweep(
  admin: SupabaseClient,
  orgId: string,
  outcome: { at: string; error: string | null },
): Promise<void> {
  await admin
    .from("fleetpal_credentials")
    .update({ last_synced_at: outcome.at, last_error: outcome.error })
    .eq("org_id", orgId);
}
