import { loadEnv } from "../apps/api/src/env.js";
import { getSupabaseAdmin } from "../apps/api/src/lib/supabaseAdmin.js";
import { seal, secretAad } from "../apps/api/src/lib/secretBox.js";

const env = loadEnv(process.env);
const admin = getSupabaseAdmin(env);
const { data, error } = await admin
  .from("efs_soap_credentials")
  .select("org_id, soap_password, soap_password_sealed")
  .is("soap_password_sealed", null);
if (error) throw new Error(`could not read EFS SOAP credentials: ${error.message}`);

let migrated = 0;
for (const row of (data ?? []) as { org_id: string; soap_password: string; soap_password_sealed: string | null }[]) {
  if (!row.soap_password) continue;
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
