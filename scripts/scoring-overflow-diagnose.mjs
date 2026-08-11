#!/usr/bin/env node
/**
 * WHICH fills poison the nightly self-heal, and WHICH column overflows?
 *
 * Postgres raises `numeric field overflow` without naming a column, and the nightly reconcile used to
 * die on the first such fill (incident 2026-08-11). This script answers, from the live database:
 *   1. The recent failed nightly_reconcile / efs_process_import jobs and their error text.
 *   2. Every scoring attempt that failed with a numeric overflow, newest first.
 *   3. For each failing transaction: the raw inputs (odometer, gallons, prev odometer), the derived
 *      miles/MPG, and the NAME of each outcome column whose value its DB type cannot store.
 *
 * Read-only. Prints nothing secret. Reads Supabase credentials from apps/api/.env (service role —
 * local use only, never in a browser).
 *
 * Run:  node scripts/scoring-overflow-diagnose.mjs
 * Also writes docs/scoring-overflow-diagnosis.txt.
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
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("apps/api/.env is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
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
const mins = (a, b) => (a && b ? `${((Date.parse(b) - Date.parse(a)) / 60000).toFixed(1)}m` : "-");

/** Same bounds the API's sanitizer enforces (persist.ts OUTCOME_NUMERIC_BOUNDS). */
const BOUNDS = {
  miles_since_last: { limit: 1e9, scale: 1, type: "numeric(10,1)" },
  computed_mpg: { limit: 1e4, scale: 2, type: "numeric(6,2)" },
  samsara_odometer: { limit: 1e9, scale: 1, type: "numeric(10,1)" },
  samsara_nearest_station_miles: { limit: 1e6, scale: 1, type: "numeric(7,1)" },
  station_lat: { limit: 1e3, scale: 6, type: "numeric(9,6)" },
  station_lng: { limit: 1e3, scale: 6, type: "numeric(9,6)" },
  samsara_tank_short_gal: { limit: 1e9, scale: 1, type: "numeric(10,1)" },
  samsara_tank_observed_gal: { limit: 1e9, scale: 1, type: "numeric(10,1)" },
  samsara_fuel_pct_before: { limit: 1e4, scale: 1, type: "numeric(5,1)" },
  samsara_fuel_pct_after: { limit: 1e4, scale: 1, type: "numeric(5,1)" },
  samsara_observed_lat: { limit: 1e3, scale: 6, type: "numeric(9,6)" },
  samsara_observed_lng: { limit: 1e3, scale: 6, type: "numeric(9,6)" },
};
const overflows = (v, b) => {
  if (v == null || !Number.isFinite(Number(v))) return false;
  const f = 10 ** b.scale;
  return Math.round(Math.abs(Number(v)) * f) / f >= b.limit;
};

say("=".repeat(96));
say(`SCORING OVERFLOW DIAGNOSIS — ${new Date().toISOString()}`);
say("=".repeat(96));

// ── 1. Recent failed jobs that run scoring ─────────────────────────────────────────────────────────
say("\n## 1. Last 12 failed nightly_reconcile / efs_process_import / rebuild jobs\n");
const { data: jobs, error: jobsErr } = await db
  .from("jobs")
  .select("kind, status, error, created_at, finished_at")
  .in("kind", ["nightly_reconcile", "efs_process_import", "backfill", "rebuild"])
  .eq("status", "failed")
  .order("created_at", { ascending: false })
  .limit(12);
if (jobsErr) say(`  ERROR reading jobs: ${jobsErr.message}`);
for (const j of jobs ?? []) {
  say(`  [${j.kind}] ran ${mins(j.created_at, j.finished_at)} started ${j.created_at}`);
  say(`      ${String(j.error ?? "").slice(0, 300)}`);
}
if (!jobs?.length) say("  none — nothing failed recently.");

// ── 2. Scoring attempts that died on a numeric overflow ────────────────────────────────────────────
say("\n## 2. Scoring attempts failed with numeric overflow (newest first, cap 100)\n");
const { data: attempts, error: attErr } = await db
  .from("scoring_attempts")
  .select("transaction_id, org_id, error, created_at")
  .ilike("error", "%numeric field overflow%")
  .order("created_at", { ascending: false })
  .limit(100);
if (attErr) say(`  ERROR reading scoring_attempts: ${attErr.message}`);
const txnIds = [...new Set((attempts ?? []).map((a) => a.transaction_id))];
say(`  ${attempts?.length ?? 0} failed attempts across ${txnIds.length} distinct transactions.`);

// ── 3. Name the offending column for each poisoned transaction ─────────────────────────────────────
say("\n## 3. Per-transaction verdict — which value cannot be stored, and why\n");
for (const id of txnIds.slice(0, 25)) {
  const { data: t } = await db
    .from("fuel_transactions")
    .select("id, vehicle_id, fueled_at, odometer, gallons, samsara_odometer, station_lat, station_lng")
    .eq("id", id)
    .maybeSingle();
  if (!t) {
    say(`  ${id}: transaction no longer exists`);
    continue;
  }
  const { data: prev } = t.vehicle_id
    ? await db
        .from("fuel_transactions")
        .select("id, fueled_at, odometer, samsara_odometer, gallons")
        .eq("vehicle_id", t.vehicle_id)
        .lt("fueled_at", t.fueled_at)
        .order("fueled_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const miles =
    t.samsara_odometer != null && prev?.samsara_odometer != null && t.samsara_odometer > prev.samsara_odometer
      ? { v: t.samsara_odometer - prev.samsara_odometer, basis: "obd" }
      : t.odometer != null && prev?.odometer != null && t.odometer > prev.odometer
        ? { v: t.odometer - prev.odometer, basis: "entered" }
        : null;
  const mpg = miles && Number(t.gallons) > 0 ? miles.v / Number(t.gallons) : null;

  say(`  txn ${t.id}  vehicle=${t.vehicle_id ?? "-"}  fueled_at=${t.fueled_at}`);
  say(
    `      odometer=${t.odometer ?? "-"}  prev_odometer=${prev?.odometer ?? "-"}  obd=${t.samsara_odometer ?? "-"}  prev_obd=${prev?.samsara_odometer ?? "-"}  gallons=${t.gallons ?? "-"}`,
  );
  say(`      derived: miles_since_last=${miles ? `${miles.v.toFixed(1)} (${miles.basis})` : "-"}  computed_mpg=${mpg ? mpg.toFixed(2) : "-"}`);
  const bad = [];
  if (miles && overflows(miles.v, BOUNDS.miles_since_last)) bad.push(`miles_since_last ${BOUNDS.miles_since_last.type}`);
  if (mpg != null && overflows(mpg, BOUNDS.computed_mpg)) bad.push(`computed_mpg ${BOUNDS.computed_mpg.type}`);
  for (const col of ["samsara_odometer", "station_lat", "station_lng"]) {
    if (overflows(t[col], BOUNDS[col])) bad.push(`${col} ${BOUNDS[col].type}`);
  }
  say(bad.length ? `      >>> OVERFLOWS: ${bad.join(", ")}` : "      (no static overflow found — recon-time value; re-run scoring with the sanitizer deployed)");
  say();
}
if (!txnIds.length) say("  none — no overflow-failed attempts recorded.");

say("=".repeat(96));
say("With the sanitizer deployed (persist.ts), these values persist as NULL and the field names are");
say("recorded in fuel_transactions.case_gates->'out_of_range'. Fix the source data (usually an");
say("odometer typo) and re-score, or leave them — the nightly self-heal no longer dies on them.");
say("=".repeat(96));

writeFileSync(join(ROOT, "docs/scoring-overflow-diagnosis.txt"), out.join("\n") + "\n");
console.log("\nWrote docs/scoring-overflow-diagnosis.txt");
