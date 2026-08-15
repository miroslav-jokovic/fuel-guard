#!/usr/bin/env node
/**
 * Override-grant ledger diagnosis — Step 3.11.
 *
 * WHY. A live QA override grant on 2026-08-14 LANDED (the badge, fed by the verifying re-read, read
 * "Override: 1 use left") and was recorded `failed` with fault `no_change`. `intentLanded` returned
 * false on a write that worked, which tells the operator to retry — and a retry grants a SECOND
 * override. docs/30 §6.A.
 *
 * The plan's decisive read was `drift->'unexplained'`. That column is NULL on this row:
 * `finalizeFailed` never writes `drift` (efsCardReconcile.ts) — only `finalizeLanded` does. So this
 * script reconstructs the same fact from what the failed row DOES store: `edits` (what we asked for)
 * against `after_document` (the vendor's own answer, from the verifying re-read).
 *
 * Read-only. Selects nothing that could carry a PAN: no request/response XML, no card number.
 * Uses Supabase creds from apps/api/.env, like scripts/vehicle-identity-check.mjs.
 * Run:  node scripts/override-ledger-diagnose.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(ROOT, "apps/api/.env"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** The typed-view key each edit name reads back from in `after_document`. */
const AFTER_KEY = {
  override: "overrideUses",
  overrideAllLocations: "overrideAllLocations",
  locationOverride: "locationOverrideId",
  status: "status",
};

const show = (v) => (v === null || v === undefined ? String(v) : JSON.stringify(v));

/** Loose compare: the after-document is typed (number/bool/null), the edit value is always a string. */
function matches(sent, got) {
  if (got === null || got === undefined) return sent === "0" ? "AMBIGUOUS(null vs 0)" : false;
  if (typeof got === "boolean") return String(got) === sent.toLowerCase();
  return String(got) === sent || String(got) === String(Number(sent));
}

async function main() {
  const { data: rows, error } = await db
    .from("efs_card_mutations")
    .select(
      "id, org_id, efs_card_id, intent, capability_key, status, efs_fault_code, efs_fault_message, " +
        "edits, drift, before_document, after_document, request_body, step_up, attempts, created_at",
    )
    .eq("intent", "override_grant")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`ledger read failed: ${error.message}`);

  console.log(`\n=== override_grant rows: ${rows.length} ===\n`);

  for (const r of rows) {
    console.log(`── ${r.created_at}  ${r.status.toUpperCase()}  fault=${r.efs_fault_code ?? "-"}`);
    console.log(`   id=${r.id}  card=${r.efs_card_id}  capability=${r.capability_key ?? "(pre-registry)"}`);
    console.log(`   org=${r.org_id}  step_up=${r.step_up}  attempts=${r.attempts}`);
    if (r.request_body) console.log(`   request_body: ${JSON.stringify(r.request_body)}`);
    if (r.efs_fault_message) console.log(`   message: ${r.efs_fault_message}`);

    const before = r.before_document ?? {};
    const after = r.after_document ?? {};
    console.log(
      `   before: uses=${show(before.overrideUses)} all=${show(before.overrideAllLocations)} loc=${show(before.locationOverrideId)}`,
    );
    console.log(
      `   after : uses=${show(after.overrideUses)} all=${show(after.overrideAllLocations)} loc=${show(after.locationOverrideId)}`,
    );

    if (Array.isArray(r.edits)) {
      console.log("   per-edit verdict (sent vs vendor's own re-read):");
      for (const e of r.edits) {
        const key = AFTER_KEY[e.name] ?? e.name;
        const got = after[key];
        const verdict = r.after_document ? matches(String(e.value), got) : "no after_document";
        console.log(
          `     ${e.name} = ${show(e.value)}  ->  ${key}=${show(got)}   ${verdict === true ? "MATCH" : verdict === false ? "*** MISMATCH ***" : verdict}`,
        );
      }
    }
    if (r.drift) console.log(`   drift: ${JSON.stringify(r.drift).slice(0, 600)}`);
    console.log();
  }

  // ── §6.E: did an operator, told "EFS refused", grant twice on the same card? ──────────────────
  const byCard = new Map();
  for (const r of rows) byCard.set(r.efs_card_id, (byCard.get(r.efs_card_id) ?? 0) + 1);
  console.log("=== grants per card (docs/30 §6.E: two rows would explain the stale override) ===");
  for (const [cardId, n] of byCard) {
    const { data: card } = await db
      .from("efs_cards")
      .select("card_last4, override_uses, detail_synced_at, synced_at, sync_error, fuel_card_id")
      .eq("id", cardId)
      .maybeSingle();
    console.log(
      `  ••••${card?.card_last4 ?? "????"}  grants=${n}  mirror.override_uses=${show(card?.override_uses)}  ` +
        `fuel_card_id=${card?.fuel_card_id ? "linked" : "NULL"}  sync_error=${show(card?.sync_error)}`,
    );
    console.log(`      detail_synced_at=${card?.detail_synced_at ?? "-"}  synced_at=${card?.synced_at ?? "-"}`);
  }
  console.log();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
