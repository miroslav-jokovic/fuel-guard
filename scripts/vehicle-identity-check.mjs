#!/usr/bin/env node
/**
 * Vehicle identity check — is every truck mapped to the RIGHT Samsara vehicle?
 *
 * WHY (recon 2026-08-12). The Samsara-vs-store reconciliation proved the pull complete for 157/162
 * trucks, but unit 589's store rows claim 163h of driving in a week Samsara says that vehicle drove
 * 4h — the signature of a STALE OR SWAPPED samsara_vehicle_id (the store faithfully syncing the wrong
 * truck's telemetry). The same trucks bottom out the duty-evidence audit (1% evidenced share), which
 * is exactly what mis-mapped identity produces: drivers assigned to the real truck never overlap the
 * impostor's engine data.
 *
 * This script pulls Samsara's own vehicle list and compares, for every active truck:
 *   - does our samsara_vehicle_id still EXIST at Samsara?
 *   - does Samsara's name/externalId for that id still look like OUR unit_number?
 *   - is any Samsara vehicle NAMED like our unit mapped to a DIFFERENT id than ours? (swap detection)
 *
 * Read-only. Uses SAMSARA_API_TOKEN + Supabase creds from apps/api/.env.
 * Run:  node scripts/vehicle-identity-check.mjs
 * Writes docs/vehicle-identity-check.txt.
 */
import { readFileSync, writeFileSync } from "node:fs";
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
const SAMSARA = env.SAMSARA_API_URL || "https://api.samsara.com";
if (!env.SAMSARA_API_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("apps/api/.env needs SAMSARA_API_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const out = [];
const say = (s = "") => {
  out.push(s);
  console.log(s);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Samsara vehicle list, fully paginated.
const samsaraVehicles = [];
{
  let after;
  do {
    const url = new URL("/fleet/vehicles", SAMSARA);
    url.searchParams.set("limit", "512");
    if (after) url.searchParams.set("after", after);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.SAMSARA_API_TOKEN}` } });
    if (res.status === 429) { await sleep(1500); continue; }
    if (!res.ok) throw new Error(`Samsara ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    samsaraVehicles.push(...(page.data ?? []));
    after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
    await sleep(300);
  } while (after);
}
const samById = new Map(samsaraVehicles.map((v) => [String(v.id), v]));
// Tokens Samsara admins actually use for the unit: name, externalIds, licensePlate, serial.
const labelOf = (v) =>
  [v.name, v.externalIds && Object.values(v.externalIds).join(" "), v.licensePlate, v.serial]
    .filter(Boolean)
    .join(" ");

const vehicles = [];
for (let off = 0; ; off += 1000) {
  const { data, error } = await db
    .from("vehicles")
    .select("unit_number, samsara_vehicle_id, status")
    .neq("status", "retired")
    .not("samsara_vehicle_id", "is", null)
    .order("unit_number")
    .range(off, off + 999);
  if (error) throw new Error(error.message);
  vehicles.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}

say("=".repeat(96));
say(`VEHICLE IDENTITY CHECK — ${new Date().toISOString()}`);
say(`Samsara reports ${samsaraVehicles.length} vehicles; store maps ${vehicles.length} active trucks.`);
say("=".repeat(96));

const unitPattern = (unit) => new RegExp(`(^|[^0-9])${String(unit).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`);
const missing = [];
const mismatched = [];
const swapped = [];
let clean = 0;
for (const v of vehicles) {
  const sam = samById.get(String(v.samsara_vehicle_id));
  if (!sam) {
    missing.push(v);
    continue;
  }
  const label = labelOf(sam);
  const labelMatchesUnit = unitPattern(v.unit_number).test(label);
  // Does some OTHER Samsara vehicle carry our unit number in its label?
  const other = samsaraVehicles.find(
    (s) => String(s.id) !== String(v.samsara_vehicle_id) && unitPattern(v.unit_number).test(labelOf(s)),
  );
  if (labelMatchesUnit && !other) {
    clean += 1;
  } else if (!labelMatchesUnit && other) {
    swapped.push({ unit: v.unit_number, mappedId: v.samsara_vehicle_id, mappedLabel: label, betterId: other.id, betterLabel: labelOf(other) });
  } else if (!labelMatchesUnit) {
    mismatched.push({ unit: v.unit_number, mappedId: v.samsara_vehicle_id, mappedLabel: label });
  } else {
    // label matches ours but another vehicle ALSO matches — ambiguous naming; report softly
    mismatched.push({ unit: v.unit_number, mappedId: v.samsara_vehicle_id, mappedLabel: label, note: `also matches Samsara id ${other.id} (${labelOf(other)})` });
  }
}

say(`\n  clean 1:1 mappings                 : ${clean}`);
say(`  mapped id NOT FOUND at Samsara     : ${missing.length}`);
for (const v of missing) say(`      unit ${v.unit_number} → samsara_vehicle_id ${v.samsara_vehicle_id} (vehicle gone/replaced at Samsara)`);
say(`  LIKELY SWAPPED / STALE mapping     : ${swapped.length}`);
for (const t of swapped)
  say(`      unit ${t.unit} → mapped to "${t.mappedLabel}" (id ${t.mappedId}) but Samsara vehicle "${t.betterLabel}" (id ${t.betterId}) carries this unit number`);
say(`  label mismatch / ambiguous         : ${mismatched.length}`);
for (const t of mismatched.slice(0, 25))
  say(`      unit ${t.unit} → "${t.mappedLabel}" (id ${t.mappedId})${t.note ? ` — ${t.note}` : ""}`);
if (mismatched.length > 25) say(`      … +${mismatched.length - 25} more`);

say("\n  A SWAPPED truck syncs the wrong vehicle's telemetry: engine data that contradicts Samsara's");
say("  dashboard, HOS/assignments that never line up (the 0-5% duty-share trucks), and rollups that");
say("  can never be right until the mapping is fixed. Fix the mapping (Vehicles page or fleet identity");
say("  re-sync after correcting names at Samsara), then re-run sync_idle + sync_hos and re-audit.");

writeFileSync(join(ROOT, "docs/vehicle-identity-check.txt"), out.join("\n") + "\n");
console.log("\nWrote docs/vehicle-identity-check.txt");
