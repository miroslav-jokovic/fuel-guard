/**
 * Produce the Step 4.4 config-scan JSON for every org, from the mirror's stored vendor documents.
 *
 * The same `scanConfig` the endpoint calls, over the same corpus — the endpoint reads it through
 * Supabase per request, this reads it once per org and writes the committed artefact the exit gate
 * asks for. No vendor call, no write.
 *
 * Run: pnpm --filter @silvicom/api exec tsx src/scripts/runConfigScan.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { CARD_CAPABILITY_CONTRACTS } from "@silvicom/shared";
import { scanConfig } from "../efs/harness/configScan.js";

const ROOT = new URL("../../../../", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(`${ROOT}apps/api/.env`, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const ORGS: Record<string, string> = {
  "07fe4058-cc72-4a69-b3e9-29b4cf1c6a44": "sandbox",
  "86d6b3ea-4361-4f71-877f-e8373615769b": "production",
};

for (const [orgId, label] of Object.entries(ORGS)) {
  const { data, error } = await db
    .from("efs_cards")
    .select("last_response_xml_redacted, detail_synced_at")
    .eq("org_id", orgId);
  if (error) throw new Error(`${label}: ${error.message}`);

  const rows = data ?? [];
  const documents = rows
    .map((r) => (r as { last_response_xml_redacted: string | null }).last_response_xml_redacted)
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  const synced = rows
    .map((r) => (r as { detail_synced_at: string | null }).detail_synced_at)
    .filter((t): t is string => typeof t === "string")
    .sort();

  const report = scanConfig(documents, CARD_CAPABILITY_CONTRACTS);
  const out = {
    environment: label,
    provenance: {
      source: "mirror.last_response_xml_redacted",
      cardsInOrg: rows.length,
      cardsWithStoredDocument: documents.length,
      cardsWithoutStoredDocument: rows.length - documents.length,
      oldestSyncedAt: synced.at(0) ?? null,
      newestSyncedAt: synced.at(-1) ?? null,
    },
    ...report,
  };
  const path = `${ROOT}docs/efs/config-scan-${label}.json`;
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(
    `${label.padEnd(11)} cards=${rows.length} docs=${documents.length} `
      + `match=${report.summary.match} mismatch=${report.summary.mismatch} unobserved=${report.summary.unobserved}`,
  );
  for (const v of report.verdicts) {
    console.log(`   ${v.state.padEnd(11)} ${v.capability}.${v.field}  observed=[${v.observation.rawSpellings.join(", ")}]`);
  }

  /**
   * The read-only fields a capability BRANCHES on, counted across the whole fleet.
   *
   * Printed with the per-value counts because the COUNT is the finding: `limitSource: POLICY` on one
   * card is an awkward fixture, and on a hundred it means a card-level product override does not
   * apply to this account. Nothing above could report it — the emit scan only sees fields some
   * capability declares it can write, and these are fields we only ever read.
   */
  console.log("   ── read-only fields capabilities depend on ─────────────────");
  for (const f of report.dependedFields) {
    const values = f.observedValues.map((v) => `${v.text}×${v.count}`).join(", ") || "(none observed)";
    const absent = f.absentCount > 0 ? `  absent=${f.absentCount}` : "";
    console.log(`   ${f.field.padEnd(16)} ${values}${absent}`);
  }
}
