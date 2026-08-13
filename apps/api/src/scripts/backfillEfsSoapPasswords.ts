import type { SupabaseClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { loadEnv, type Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { seal, sealingKeyId, secretAad } from "../lib/secretBox.js";

/**
 * One-time backfill: seal the legacy plaintext `efs_soap_credentials.soap_password` values that
 * migration 0185 left in place, then blank the plaintext column.
 *
 * IT LIVES UNDER `src/` ON PURPOSE. `pnpm typecheck` is `pnpm -r typecheck`, which only visits
 * workspace packages — a `.ts` file at the repo root in `scripts/` is compiled by no tsconfig, linted
 * by no config that knows its types, and run by no script. The one operational step that makes the
 * sealed-password work real must not be the one file nothing checks.
 *
 * ORDER IS NOT OPTIONAL, AND IT IS A ONE-WAY DOOR:
 *
 *   1. Apply migration 0185 (adds `soap_password_sealed`).
 *   2. Deploy the API that reads sealed-or-legacy (`fromRow` in efsSoapCredentials.ts).
 *   3. THEN run this.
 *
 * Run it before step 2 and the still-deployed old code reads `soap_password` — now `""` — and dials
 * EFS with an empty password on every poll. After step 3 there is no rollback to a build that
 * predates step 2: the plaintext is gone, and only a deploy holding the same SECRETS_ENCRYPTION_KEY
 * can read the credential. Confirm the key matches the deploy's before running.
 *
 * Sealing under a key the deployed API does not hold is the one failure this script cannot walk back:
 * the plaintext is blanked in the same statement that writes the ciphertext. The key id is a truncated
 * double-hash of a hash, is not secret, and is already stored in every envelope — printing and
 * comparing it costs nothing.
 *
 * An empty anchor set is indistinguishable from being pointed at the wrong database, and that is not
 * a distinction to guess at while blanking plaintext credentials. Dry-run may report that state, but
 * `--apply` refuses to proceed without an anchor.
 *
 *   pnpm backfill:efs-soap-passwords              # report only, writes nothing
 *   pnpm backfill:efs-soap-passwords --apply      # seal and blank
 */

interface CredentialRow {
  org_id: string;
  soap_password: string;
  soap_password_sealed: string | null;
}

interface SealedAnchorRow {
  card_number_sealed?: string | null;
  key_sealed?: string | null;
}

export interface SealedKeyIdVerdict {
  currentKeyId: string;
  keyIds: Array<{ keyId: string; count: number }>;
  sealedCount: number;
  hasAnchor: boolean;
  ok: boolean;
}

function keyIdFromEnvelope(sealed: string): string {
  const parts = sealed.split(".");
  return parts.length === 5 && parts[0] === "v1" && parts[1] ? parts[1] : "<malformed>";
}

/** Compare the active deployment key id with the ids embedded in existing sealed material. */
export function compareSealedKeyIds(
  currentKeyId: string,
  sealedValues: readonly (string | null | undefined)[],
): SealedKeyIdVerdict {
  const counts = new Map<string, number>();
  let sealedCount = 0;
  for (const value of sealedValues) {
    if (!value) continue;
    sealedCount += 1;
    const keyId = keyIdFromEnvelope(value);
    counts.set(keyId, (counts.get(keyId) ?? 0) + 1);
  }
  const keyIds = [...counts.entries()]
    .map(([keyId, count]) => ({ keyId, count }))
    .sort((a, b) => a.keyId.localeCompare(b.keyId));
  return {
    currentKeyId,
    keyIds,
    sealedCount,
    hasAnchor: sealedCount > 0,
    ok: keyIds.every(({ keyId }) => keyId === currentKeyId),
  };
}

export async function runBackfill(admin: SupabaseClient, env: Env, apply: boolean): Promise<boolean> {
  // These are unordered samples capped at 200: enough to answer "am I pointed at the right database
  // and key", not proof that every sealed row in either table carries the current key id. This is not
  // an exhaustive audit.
  const [{ data, error }, { data: cardAnchors, error: cardAnchorError }, { data: certAnchors, error: certAnchorError }] =
    await Promise.all([
      admin
        .from("efs_soap_credentials")
        .select("org_id, soap_password, soap_password_sealed")
        .is("soap_password_sealed", null),
      admin.from("efs_cards").select("card_number_sealed").limit(200),
      admin.from("efs_soap_client_certs").select("key_sealed").limit(200),
    ]);
  if (error) throw new Error(`could not read EFS SOAP credentials: ${error.message}`);
  if (cardAnchorError) throw new Error(`could not read sealed card anchors: ${cardAnchorError.message}`);
  if (certAnchorError) throw new Error(`could not read sealed certificate anchors: ${certAnchorError.message}`);

  const sealedValues = [
    ...((cardAnchors ?? []) as SealedAnchorRow[]).map((row) => row.card_number_sealed),
    ...((certAnchors ?? []) as SealedAnchorRow[]).map((row) => row.key_sealed),
  ];
  const verdict = compareSealedKeyIds(sealingKeyId(env), sealedValues);
  console.log(`[efs-soap] current sealing key id: ${verdict.currentKeyId}`);
  if (!verdict.hasAnchor) {
    console.log("[efs-soap] no existing sealed material to compare against; the key cannot be cross-checked");
    if (apply) {
      console.error("[efs-soap] refusing to apply: no sealed material exists to cross-check the key against");
      return false;
    }
  } else {
    console.log("[efs-soap] existing sealed key ids:");
    for (const { keyId, count } of verdict.keyIds) console.log(`  - ${keyId}: ${count}`);
    if (!verdict.ok) {
      console.error(`[efs-soap] refusing: stored sealing key id differs from current ${verdict.currentKeyId}`);
      return false;
    }
    console.log("[efs-soap] sealing key id matches all existing sealed material.");
  }

  const rows = (data ?? []) as CredentialRow[];
  const pending = rows.filter((row) => Boolean(row.soap_password));

  if (!apply) {
    console.log(`[efs-soap] ${pending.length} row(s) hold a legacy plaintext password:`);
    for (const row of pending) console.log(`  - org ${row.org_id}`);
    console.log(`[efs-soap] dry run — nothing written. Re-run with --apply to seal them.`);
    return true;
  }

  let migrated = 0;
  for (const row of pending) {
    const { error: updateError } = await admin
      .from("efs_soap_credentials")
      .update({
        soap_password: "",
        soap_password_sealed: seal(env, row.soap_password, secretAad(row.org_id, "efs_soap_password.v1")),
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", row.org_id);
    if (updateError) throw new Error(`could not seal EFS SOAP credentials for ${row.org_id}: ${updateError.message}`);
    migrated += 1;
  }
  console.log(`[efs-soap] sealed ${migrated} legacy password row(s)`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadEnv(process.env);
  const ok = await runBackfill(getSupabaseAdmin(env), env, process.argv.includes("--apply"));
  if (!ok) process.exitCode = 1;
}
