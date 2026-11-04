import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../../env.js";
import { open, seal, secretAad, SecretBoxError } from "../../../../lib/secretBox.js";
import type { HiggsfieldKey } from "./higgsfieldClient.js";

/**
 * The carrier's Higgsfield API key (C3; plan D-AD15, Q-AD20). It lives as a `higgsfield` row of
 * `ads_platform_connections`, sealed exactly as the Meta token is (`secretBox`, AAD = org + purpose), so it
 * is never plaintext at rest, never logged and never in an API answer. The key is Higgsfield's two halves,
 * `<key id>:<key secret>` (the `Authorization: Key …` header's own form).
 *
 * Only the reading half is built here. The Connect door for it (Settings › Ads control) waits on Q-AD20 —
 * nobody has seen a real key yet, and a door that cannot test what it stores would save a typo as
 * `connected`. `sealHiggsfieldKey` is the one way a key is ever sealed, so that door will call it.
 */

export const HIGGSFIELD_KEY_PURPOSE = "higgsfield_api";

export function sealHiggsfieldKey(env: Env, orgId: string, key: HiggsfieldKey): string {
  if (!key.id || !key.secret || key.id.includes(":")) throw new Error("A Higgsfield key is an id and a secret; the id has no colon.");
  return seal(env, `${key.id}:${key.secret}`, secretAad(orgId, HIGGSFIELD_KEY_PURPOSE));
}

export type KeyOutcome = { ok: true; key: HiggsfieldKey } | { ok: false; reason: "not_connected" | "unreadable" };

/** The org's live (non-sandbox) Higgsfield key, opened; never the key of another org (AAD binds it). */
export async function higgsfieldKeyFor(admin: SupabaseClient, env: Env, orgId: string): Promise<KeyOutcome> {
  const { data, error } = await admin
    .from("ads_platform_connections")
    .select("token_sealed, status")
    .eq("org_id", orgId)
    .eq("provider", "higgsfield")
    .eq("is_sandbox", false)
    .maybeSingle();
  if (error) throw new Error(`ads_platform_connections: ${error.message}`);
  const row = data as { token_sealed: string | null; status: string } | null;
  if (!row?.token_sealed || row.status === "disconnected") return { ok: false, reason: "not_connected" };
  try {
    const plain = open(env, row.token_sealed, secretAad(orgId, HIGGSFIELD_KEY_PURPOSE));
    const at = plain.indexOf(":");
    if (at <= 0 || at === plain.length - 1) return { ok: false, reason: "unreadable" };
    return { ok: true, key: { id: plain.slice(0, at), secret: plain.slice(at + 1) } };
  } catch (e) {
    if (e instanceof SecretBoxError) return { ok: false, reason: "unreadable" };
    throw e;
  }
}
