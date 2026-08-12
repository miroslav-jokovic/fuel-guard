#!/usr/bin/env node
/**
 * Export the equipment-confirmation worksheet — the last gate on avoidable-idle coverage.
 *
 * WHY (audit 2026-08-12). The avoidable-idle verdict refuses to judge a truck until a human answers
 * "did this truck have an alternative to main-engine idle?" — the has_apu / has_optimized_idle flags.
 * 92 active trucks have no answer recorded, so they sit excluded from scoring; 83 of them already
 * DEMONSTRATE an engine-off/cycling pattern and are just waiting for confirmation. With the flags set
 * fleet-wide, confident coverage measured 152 of 177 trucks.
 *
 * This script writes docs/equipment-worksheet.csv with one row per UNANSWERED truck:
 *   unit_number, apu_type, has_optimized_idle, learned_pattern, engine_off_share, notes
 * `apu_type` and `has_optimized_idle` are left BLANK on purpose — the Vehicle Setup Import treats a
 * blank as "leave unchanged", so nothing is applied until you type a value you actually confirm
 * (diesel_apu / battery_hvac / fuel_heater / shore_power / none; true/false). The learned columns are
 * decision support only. Review, fill, then upload via Import → Vehicle setup — the importer matches
 * on unit_number and shows a change preview before writing anything.
 *
 * Read-only against the database. Run:  node scripts/export-equipment-worksheet.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const envPath = join(ROOT, "apps/api/.env");
if (!existsSync(envPath)) {
  console.error("No apps/api/.env — this script needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
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

const rows = [];
for (let off = 0; ; off += 1000) {
  const { data, error } = await db
    .from("vehicles")
    .select("unit_number, has_apu, has_optimized_idle, idle_capability, idle_optimized_pct, status")
    .neq("status", "retired")
    .order("unit_number", { ascending: true })
    .range(off, off + 999);
  if (error) throw new Error(error.message);
  rows.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}

const unanswered = rows.filter((v) => v.has_apu == null && v.has_optimized_idle !== true);
const csvEscape = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const lines = [
  "unit_number,apu_type,has_optimized_idle,learned_pattern,engine_off_share,notes",
];
for (const v of unanswered) {
  const pattern = v.idle_capability ?? "unknown";
  const share =
    v.idle_optimized_pct != null ? `${Math.round(Number(v.idle_optimized_pct))}%` : "";
  const note =
    pattern === "apu"
      ? "rests engine-off — likely diesel_apu or battery_hvac; confirm which"
      : pattern === "ecu_optimized"
        ? "auto start/stop pattern — likely OEM optimized idle; set has_optimized_idle=true"
        : pattern === "continuous_only"
          ? "only ever idles continuously — if truly no equipment, set apu_type=none"
          : "no clear pattern — check the spec sheet";
  lines.push(
    [v.unit_number, "", "", pattern, share, note].map(csvEscape).join(","),
  );
}
const outPath = join(ROOT, "docs/equipment-worksheet.csv");
writeFileSync(outPath, lines.join("\r\n") + "\r\n");
console.log(`${unanswered.length} trucks without an equipment answer (of ${rows.length} active).`);
console.log(`Wrote ${outPath}`);
console.log(
  "\nFill apu_type (diesel_apu / battery_hvac / fuel_heater / shore_power / none) and/or",
);
console.log(
  "has_optimized_idle (true/false) ONLY for trucks you can confirm — blanks are left unchanged.",
);
console.log("Then upload the file via Import → Vehicle setup; it previews every change first.");
