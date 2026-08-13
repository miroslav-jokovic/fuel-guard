import { loadEnv } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { seal, secretAad } from "../lib/secretBox.js";

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
 *   pnpm backfill:efs-soap-passwords              # report only, writes nothing
 *   pnpm backfill:efs-soap-passwords --apply      # seal and blank
 */

const apply = process.argv.includes("--apply");
const env = loadEnv(process.env);
const admin = getSupabaseAdmin(env);

const { data, error } = await admin
  .from("efs_soap_credentials")
  .select("org_id, soap_password, soap_password_sealed")
  .is("soap_password_sealed", null);
if (error) throw new Error(`could not read EFS SOAP credentials: ${error.message}`);

const rows = (data ?? []) as { org_id: string; soap_password: string; soap_password_sealed: string | null }[];
const pending = rows.filter((row) => Boolean(row.soap_password));

if (!apply) {
  console.log(`[efs-soap] ${pending.length} row(s) hold a legacy plaintext password:`);
  for (const row of pending) console.log(`  - org ${row.org_id}`);
  console.log(`[efs-soap] dry run — nothing written. Re-run with --apply to seal them.`);
  process.exit(0);
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
