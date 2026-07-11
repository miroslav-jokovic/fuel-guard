import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";

// Columns/tables that recent features depend on. If a deploy ships ahead of its migration, these
// selects fail — which is exactly how the AI verifier silently broke. Checking on boot turns that into
// a loud, actionable log line instead of a mystery.
const CHECKS: { table: string; column: string; migration: string }[] = [
  { table: "geocode_cache", column: "precision", migration: "0018/0019" },
  { table: "fuel_transactions", column: "samsara_location_confidence", migration: "0018" },
  { table: "fuel_transactions", column: "samsara_fuel_pct_before", migration: "0020" },
  { table: "fuel_events", column: "id", migration: "0021" },
  { table: "declined_transactions", column: "suspicion_level", migration: "0022" },
  { table: "anomalies", column: "fueled_at", migration: "0023" },
  { table: "organizations", column: "last_digest_at", migration: "0024" },
  { table: "vehicles", column: "monitored_tank_capacity_gal", migration: "0037" },
  { table: "vehicles", column: "tank_sensor_reliable", migration: "0038" },
  { table: "vehicles", column: "observed_max_fill_gal", migration: "0039" },
  { table: "fuel_transactions", column: "samsara_nearest_station_miles", migration: "0040" },
  { table: "station_geocode_learned", column: "query", migration: "0045" },
];

/** Warn on boot when a required column/table is missing (a migration hasn't been applied). Non-fatal. */
export async function runSchemaCheck(env: Env): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const admin = getSupabaseAdmin(env);
  const missing: string[] = [];
  for (const c of CHECKS) {
    const { error } = await admin.from(c.table).select(c.column).limit(1);
    if (error && /does not exist|could not find|schema cache/i.test(error.message)) {
      missing.push(`${c.table}.${c.column}  → migration ${c.migration}`);
    }
  }
  if (missing.length) {
    console.warn(
      `[schema] ⚠ ${missing.length} pending migration(s) — related features will misbehave until applied:\n  - ` +
        missing.join("\n  - ") +
        `\n  Apply supabase/_deploy/reconcile_schema.sql in Supabase.`,
    );
  } else {
    console.log("[schema] all expected columns present ✓");
  }
}
