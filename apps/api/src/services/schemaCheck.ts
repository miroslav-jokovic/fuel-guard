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
  { table: "vehicles", column: "has_apu", migration: "0046" },
  { table: "vehicles", column: "has_optimized_idle", migration: "0048" },
  { table: "idle_events", column: "air_temp_source", migration: "0049" },
  { table: "idle_events", column: "idle_gal", migration: "0050" },
  { table: "idle_events", column: "driver_source", migration: "0051" },
  { table: "driver_vehicle_assignments", column: "driver_samsara_id", migration: "0051" },
  { table: "vehicles", column: "idle_states_sec", migration: "0052" },
  { table: "efs_transactions", column: "tran_time", migration: "0047" },
  { table: "driver_performance_settings", column: "org_id", migration: "0053" },
  { table: "driver_scores", column: "id", migration: "0054" },
  { table: "driver_performance_weeks", column: "id", migration: "0055" },
  { table: "driver_performance_settings", column: "idle_score_basis", migration: "0056" },
  { table: "anomaly_thresholds", column: "reefer_diversion_window_days", migration: "0057" },
  { table: "fuel_stations", column: "brand", migration: "0058" },
  { table: "fuel_prices", column: "net_price", migration: "0058" },
  { table: "route_fuel_settings", column: "org_id", migration: "0058" },
  { table: "vehicles", column: "axle_count", migration: "0058" },
  { table: "route_geometries", column: "cache_key", migration: "0059" },
  // Master Data & Identity (M1). One probe per migration — enough to prove the file ran, and
  // `invites.driver_id` in particular is the column the driver app's whole login→roster link needs.
  { table: "terminals", column: "code", migration: "0097" },
  { table: "drivers", column: "identity_source", migration: "0098" },
  { table: "driver_endorsements", column: "code", migration: "0098" },
  { table: "vehicles", column: "identity_source", migration: "0099" },
  { table: "trailers", column: "identity_source", migration: "0100" },
  { table: "compliance_items", column: "item_type", migration: "0101" },
  { table: "master_documents", column: "doc_type", migration: "0101" },
  { table: "invites", column: "driver_id", migration: "0102" },
  // EFS mutual TLS. Probed because an unapplied 0106 makes certificate upload fail at the DB layer
  // with a schema-cache error that reads like an application bug.
  { table: "efs_soap_client_certs", column: "fingerprint_sha256", migration: "0106" },
  { table: "fuel_transactions", column: "transaction_id", migration: "0107" },
  { table: "drivers", column: "samsara_username", migration: "0108" },
  // HOS duty-status segments (idle avoidability, duty-aware). Unapplied 0109 makes the HOS sync fail at the
  // DB layer with a schema-cache error that reads like an app bug.
  { table: "hos_duty_segments", column: "status", migration: "0109" },
  { table: "drivers", column: "current_hos_status", migration: "0111" },
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
