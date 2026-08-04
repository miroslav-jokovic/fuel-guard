import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { isSecretBoxConfigured, open, seal, secretAad, SecretBoxError } from "./secretBox.js";

/**
 * Samsara API token storage — sealed at rest. The per-org token in
 * `integration_credentials.samsara_api_token` is stored as a secretBox envelope (`v1.…`, AES-256-GCM,
 * AAD-bound to the org + this purpose — the same construction the EFS client keys use), so a database
 * backup / dump / read-only grant no longer yields a usable telematics credential. Legacy plaintext
 * values are still READ (and the boot sweep re-seals them in place once SECRETS_ENCRYPTION_KEY is
 * configured); new writes always seal and fail closed when the key is missing.
 */

export const SAMSARA_TOKEN_PURPOSE = "samsara_api_token";

/** A stored value is sealed iff it is a v1 secretBox envelope; anything else is legacy plaintext. */
const isSealed = (v: string): boolean => v.startsWith("v1.");

/**
 * Resolve the Samsara API token for an org: the per-org secret in `integration_credentials` (never
 * exposed to the browser) if enabled, else the single-tenant `SAMSARA_API_TOKEN` env fallback.
 * Returns null when neither is configured. A sealed value that fails to open (rotated/lost key,
 * tampered row) is logged loudly and treated as absent rather than crashing every sync.
 */
export async function loadSamsaraToken(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("integration_credentials")
    .select("samsara_api_token, enabled")
    .eq("org_id", orgId)
    .maybeSingle();
  const stored = data && data.enabled !== false ? (data.samsara_api_token as string | null) : null;
  if (stored) {
    if (!isSealed(stored)) return stored; // legacy plaintext — boot sweep seals it when the key exists
    try {
      return open(env, stored, secretAad(orgId, SAMSARA_TOKEN_PURPOSE));
    } catch (e) {
      const why = e instanceof SecretBoxError ? `${e.code}: ${e.message}` : String(e);
      console.error(`[samsaraToken] sealed token for org ${orgId} could not be opened (${why})`);
    }
  }
  return env.SAMSARA_API_TOKEN ?? null;
}

/**
 * Store (or rotate) the org's Samsara token — ALWAYS sealed. Throws SecretBoxError `not_configured`
 * when SECRETS_ENCRYPTION_KEY is unset: fail closed at the point of write, never fall back to
 * persisting a plaintext credential.
 */
export async function saveSamsaraToken(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  token: string,
): Promise<void> {
  const sealed = seal(env, token, secretAad(orgId, SAMSARA_TOKEN_PURPOSE));
  const { error } = await admin.from("integration_credentials").upsert(
    {
      org_id: orgId,
      provider: "samsara",
      samsara_api_token: sealed,
      enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id" },
  );
  if (error) throw new Error(error.message);
}

/** Remove the org's stored token (the env fallback, if any, still applies). */
export async function clearSamsaraToken(admin: SupabaseClient, orgId: string): Promise<void> {
  const { error } = await admin
    .from("integration_credentials")
    .update({ samsara_api_token: null, updated_at: new Date().toISOString() })
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
}

/**
 * Boot sweep: seal any legacy PLAINTEXT tokens in place. With no sealing key configured it only warns
 * (the tokens keep working — encryption at rest simply isn't on yet); with a key, every plaintext row
 * is rewritten as a sealed envelope, so turning on SECRETS_ENCRYPTION_KEY is the entire migration.
 */
export async function sealPlaintextSamsaraTokens(
  admin: SupabaseClient,
  env: Env,
): Promise<{ sealed: number }> {
  const { data } = await admin
    .from("integration_credentials")
    .select("org_id, samsara_api_token")
    .not("samsara_api_token", "is", null);
  const rows = ((data ?? []) as { org_id: string; samsara_api_token: string }[]).filter(
    (r) => !isSealed(r.samsara_api_token),
  );
  if (rows.length === 0) return { sealed: 0 };
  if (!isSecretBoxConfigured(env)) {
    console.warn(
      `[samsaraToken] ${rows.length} Samsara token(s) are stored in PLAINTEXT — set SECRETS_ENCRYPTION_KEY ` +
        "(openssl rand -base64 32) and restart to seal them at rest.",
    );
    return { sealed: 0 };
  }
  let sealed = 0;
  for (const r of rows) {
    const { error } = await admin
      .from("integration_credentials")
      .update({
        samsara_api_token: seal(env, r.samsara_api_token, secretAad(r.org_id, SAMSARA_TOKEN_PURPOSE)),
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", r.org_id);
    if (!error) sealed++;
  }
  console.log(`[samsaraToken] sealed ${sealed} plaintext Samsara token(s) at rest.`);
  return { sealed };
}
