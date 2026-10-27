import { spawnSync } from "node:child_process";
import { loadEnv } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { writeAudit } from "../lib/audit.js";
import { enableTmsIntegration, getTmsIntegrationStatus } from "../modules/mcleod/tmsIngest.js";

/**
 * Issues a new McLeod connector ingest token for ONE org and puts it on this Mac's clipboard —
 * never on the screen, in a file or in the shell history. Owner-run (the token is a secret value).
 *
 *   node --env-file=<apps/api/.env> --import tsx apps/api/src/scripts/issueMcleodToken.ts \
 *     --org <org uuid> --name "<org name, exactly>"
 *
 * Why a script: the API's issue route (POST /api/integrations/mcleod/enable, also the rotate path)
 * has no screen in the web app — no page calls it — and the token running on the Board VM since
 * 2026-08-28 was issued outside it (no `integration.mcleod.token_issued` audit row). This calls
 * the same service function and writes the same audit action, so the trail is identical. The
 * missing piece is a rotate button on the McLeod settings page; when that ships, this script goes.
 *
 * ⚠ Issuing REVOKES the previous token at once (only the newest hash is stored, tmsIngest.ts), so
 * the connector posts 401 until the new token is in its connector.env. Run this only when the VM
 * side is stopped and waiting at its "Paste token" prompt.
 */
function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
}

const orgId = arg("org");
const expectedName = arg("name");
if (!orgId || !expectedName) {
  console.error('Usage: … issueMcleodToken.ts --org <org uuid> --name "<org name>"');
  process.exit(2);
}

const env = loadEnv();
const admin = getSupabaseAdmin(env);

// Both the id and the name must match, so a pasted wrong id cannot rotate another carrier's token.
const { data: org, error: orgError } = await admin.from("organizations").select("id, name").eq("id", orgId).maybeSingle();
if (orgError) throw new Error(orgError.message);
if (!org || org.name !== expectedName) {
  console.error(`Refused: org ${orgId} is ${org ? `"${org.name}"` : "not found"}, not "${expectedName}". Nothing changed.`);
  process.exit(1);
}

const before = await getTmsIntegrationStatus(admin, orgId, "mcleod");
const { token, prefix } = await enableTmsIntegration(admin, orgId, "mcleod");
const audited = await writeAudit(admin, {
  orgId,
  actorId: null,
  action: "integration.mcleod.token_issued",
  entity: "org_integrations",
  meta: { prefix, previousPrefix: before.tokenPrefix, via: "scripts/issueMcleodToken.ts" },
});

const copy = spawnSync("pbcopy", { input: token });
const after = await getTmsIntegrationStatus(admin, orgId, "mcleod");
console.log(`Org: ${org.name}`);
console.log(`Old token prefix: ${before.tokenPrefix ?? "none"} — revoked now`);
console.log(`New token prefix: ${prefix} (stored: ${after.tokenPrefix}), length ${token.length}`);
console.log(`Audit row: ${audited ? "written" : "NOT written — tell Claude"}`);
if (copy.status === 0) {
  console.log("The new token is on the clipboard. Paste it at the VM's prompt, then copy anything else to clear it.");
} else {
  console.error("Could not copy to the clipboard. The old token is already revoked — run this script again to issue another.");
  process.exit(1);
}
