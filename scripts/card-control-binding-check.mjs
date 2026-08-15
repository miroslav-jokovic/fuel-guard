#!/usr/bin/env node
/**
 * Phase 2 exit gate, scripted — the credential-identity binding (Step 2.6).
 *
 * THE GATE. Migration 0187's own column comment states it:
 *
 *   "no org with write_entitlement = 'confirmed' may still have a null probed_identity_hash"
 *
 * WHY IT NEEDS A SCRIPT. The plan recorded this check as done-and-scripted; it was neither — it was
 * a query somebody ran by hand on 2026-08-15, and what it found is that the ONE org with card
 * control has `write_entitlement = 'confirmed'` and a null `probed_identity_hash`. A hand-run query
 * proves a fact about the minute it ran. This step's whole subject is a guard that was switched off
 * for months without anybody noticing, so the check that closes it must be re-runnable by someone
 * who was not here, and must be able to FAIL A BUILD rather than print a paragraph nobody reads.
 *
 * WHAT A VIOLATION MEANS. `efsCardControlAccess.ts` compares the credential identity it computes now
 * against `probed_identity_hash`, and refuses with `endpoint_changed` on a mismatch. A NULL hash does
 * not mismatch — it takes the grandfather branch, logs one warning per process, and ALLOWS the write.
 * So a violating row is not untidy data: it is an entitlement, confirmed against one EFS credential,
 * still being honoured against whatever credential the row points at today.
 *
 * ORDER OF THE FIX, and it is load-bearing (Step 2.6): re-probe FIRST so the hash is populated, THEN
 * delete the grandfather branch. Reversing it revokes card control on the only org that has it.
 *
 * READ-ONLY. Selects no PAN, no password, no cursor. The identity hash is a keyed HMAC and is
 * reported as present/absent with a short prefix, never in full — it is not a secret, but printing
 * credential-derived material in full into a terminal scrollback buys nothing.
 *
 * Uses Supabase creds from apps/api/.env, like scripts/override-ledger-diagnose.mjs.
 * Run:  node scripts/card-control-binding-check.mjs
 * Exits 1 on any violation, so it can be wired into a gate.
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

const show = (v) => (v === null || v === undefined ? String(v) : String(v));
const hashState = (h) => (h === null || h === undefined ? "NULL" : `set (${String(h).slice(0, 8)}…)`);

async function main() {
  const { data: settings, error } = await db
    .from("efs_card_control_settings")
    .select(
      "org_id, enabled, write_entitlement, require_approver, probed_identity_hash, " +
        "probed_endpoint_host, probed_document_shape, probed_at",
    )
    .order("probed_at", { ascending: false });
  if (error) throw new Error(`settings read failed: ${error.message}`);

  const rows = settings ?? [];
  console.log(`\n=== efs_card_control_settings: ${rows.length} row(s) ===\n`);

  const violations = [];

  for (const r of rows) {
    // The credentials row is what the gate hashes TODAY. Its absence is itself informative: the gate
    // refuses with `no_credentials` before it ever reaches the identity comparison, so such an org
    // cannot exercise the loophole even with a null hash.
    const { data: creds, error: credsError } = await db
      .from("efs_soap_credentials")
      .select("enabled, environment, endpoint_url, soap_username, account_id")
      .eq("org_id", r.org_id)
      .maybeSingle();
    if (credsError) throw new Error(`credentials read failed for ${r.org_id}: ${credsError.message}`);

    let currentHost = null;
    if (creds?.endpoint_url) {
      try {
        currentHost = new URL(creds.endpoint_url).hostname.toLowerCase();
      } catch {
        currentHost = "(unparseable)";
      }
    }

    const violating = r.write_entitlement === "confirmed" && (r.probed_identity_hash ?? null) === null;
    // Reachable = the write path is actually open on this org today. A violating row that is also
    // reachable is the live exposure; a violating row that is disabled is a trap primed for whoever
    // switches it on next.
    const reachable = violating && r.enabled === true && creds?.enabled === true;

    console.log(`── org ${r.org_id}${violating ? "   *** VIOLATION ***" : ""}`);
    console.log(`   enabled=${show(r.enabled)}  write_entitlement=${show(r.write_entitlement)}  require_approver=${show(r.require_approver)}`);
    console.log(`   probed_identity_hash=${hashState(r.probed_identity_hash)}  probed_at=${show(r.probed_at)}`);
    console.log(`   probed_endpoint_host=${show(r.probed_endpoint_host)}  probed_document_shape=${show(r.probed_document_shape)}`);
    console.log(
      `   credentials: ${creds ? `enabled=${show(creds.enabled)} environment=${show(creds.environment)} host=${show(currentHost)} account_id=${show(creds.account_id)}` : "NO ROW (gate refuses with no_credentials)"}`,
    );
    // Host drift is not the gate — the gate hashes host + username + account_id together, and this
    // script cannot compute that hash without SECRETS_ENCRYPTION_KEY. It is reported because a host
    // that already differs from the probed one tells the operator the re-probe is overdue for a
    // second, independent reason.
    if (r.probed_endpoint_host && currentHost && r.probed_endpoint_host !== currentHost) {
      console.log(`   ⚠ endpoint host CHANGED since the probe: ${r.probed_endpoint_host} → ${currentHost}`);
    }
    if (violating) {
      console.log(
        `   → confirmed entitlement with NO recorded credential identity. efsCardControlAccess.ts ` +
          `grandfathers this: one warning, write allowed.${reachable ? " THIS ORG'S WRITE PATH IS OPEN TODAY." : " (not currently reachable: org or credentials disabled)"}`,
      );
      violations.push({ orgId: r.org_id, reachable });
    }
    console.log();
  }

  console.log("=== verdict ===");
  if (rows.length === 0) {
    // Not a pass by default. Zero rows means no org has card control at all, which satisfies the
    // gate vacuously — say so, rather than printing a green tick that reads like a proof.
    console.log("No card-control settings rows exist. The gate is vacuously satisfied — there is");
    console.log("nothing to bind. This is NOT evidence that the binding works.");
    process.exit(0);
  }
  if (violations.length === 0) {
    console.log(`✓ PASS — ${rows.length} row(s), none with a confirmed entitlement and a null probed_identity_hash.`);
    process.exit(0);
  }
  const reachableCount = violations.filter((v) => v.reachable).length;
  console.log(
    `✗ FAIL — ${violations.length} of ${rows.length} row(s) violate the Phase 2 exit gate ` +
      `(${reachableCount} with the write path open today):`,
  );
  for (const v of violations) console.log(`    ${v.orgId}${v.reachable ? "  [reachable]" : ""}`);
  console.log("\nFix is Step 2.6, and the ORDER MATTERS:");
  console.log("  ① re-probe each org so writeProbe.ts populates probed_identity_hash");
  console.log("     (needs EFS_CARD_CONTROL_PROBE_ENABLED; unset it and redeploy afterwards)");
  console.log("  ② THEN delete the grandfather branch in efsCardControlAccess.ts");
  console.log("  Doing ② first revokes card control on every org listed above.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
