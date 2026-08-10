#!/usr/bin/env node
/**
 * Where exactly does the Idling sync stall, and what kills it?
 *
 * Answers, from the live database, the three things code reading cannot:
 *   1. The ACTUAL error text on the failed sync_idle / sync_hos jobs, and how long each run lasted.
 *   2. How far it got — how many DISTINCT vehicles have engine-days / park sessions / telemetry
 *      windows in the current window. "It stops after N vehicles" becomes a number.
 *   3. Whether a job is wedged right now (running, with a live or an expired lease).
 *
 * Read-only. Prints nothing secret. Reads Supabase credentials from apps/api/.env (service role —
 * local use only, never in a browser).
 *
 * Run:  node scripts/idle-sync-diagnose.mjs
 * Also writes docs/idle-sync-diagnosis.txt.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
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

async function countOf(table, apply = (q) => q) {
  const { count, error } = await apply(db.from(table).select("*", { count: "exact", head: true }));
  return error ? `ERROR ${error.message}` : (count ?? 0);
}

/** Distinct values of `col`, paged. Bounded — this is a diagnostic, not a hot path. */
async function distinct(table, col, apply = (q) => q, cap = 40000) {
  const seen = new Set();
  for (let off = 0; off < cap; off += 1000) {
    const { data, error } = await apply(db.from(table).select(col)).range(off, off + 999);
    if (error) return { size: `ERROR ${error.message}`, capped: false };
    for (const row of data ?? []) if (row[col]) seen.add(row[col]);
    if ((data ?? []).length < 1000) return { size: seen.size, capped: false };
  }
  return { size: seen.size, capped: true };
}

const nowIso = new Date().toISOString();
const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
const day30 = since30.slice(0, 10);

say("=".repeat(96));
say(`IDLE / HOS SYNC DIAGNOSIS — ${nowIso}`);
say("=".repeat(96));

say("\n## 1. Last 16 sync_idle / sync_hos jobs\n");
{
  const { data, error } = await db
    .from("jobs")
    .select(
      "kind,status,error,created_at,started_at,finished_at,lease_expires_at,dedup_key,stats,requested_by",
    )
    .in("kind", ["sync_idle", "sync_hos"])
    .order("created_at", { ascending: false })
    .limit(16);
  if (error) say(`  QUERY FAILED: ${error.message}`);
  for (const j of data ?? []) {
    say(
      `[${j.kind}] ${String(j.status).toUpperCase().padEnd(8)} ran ${mins(j.started_at, j.finished_at).padStart(8)}  started ${j.started_at ?? j.created_at}  ${j.requested_by ? "manual" : "scheduled"}`,
    );
    if (j.status === "running") say(`    lease_expires_at=${j.lease_expires_at}  (now ${nowIso})`);
    if (j.dedup_key) say(`    dedup_key=${j.dedup_key}`);
    if (j.error) say(`    ERROR: ${j.error}`);
    if (j.stats && Object.keys(j.stats).length) say(`    stats: ${JSON.stringify(j.stats)}`);
    say("");
  }
}

say("\n## 2. Coverage — how many vehicles actually have idle data\n");
say(`  vehicles (total)                : ${await countOf("vehicles")}`);
say(
  `  ...with samsara_vehicle_id      : ${await countOf("vehicles", (q) => q.not("samsara_vehicle_id", "is", null))}`,
);
say(
  `  ...with idle_capability learned : ${await countOf("vehicles", (q) => q.not("idle_capability", "is", null))}`,
);
say(
  `  ...with idle_states_at stamped  : ${await countOf("vehicles", (q) => q.not("idle_states_at", "is", null))}`,
);
say("");

const COVERAGE = [
  ["vehicle_engine_days (30d)", "vehicle_engine_days", (q) => q.gte("day", day30)],
  ["idle_park_sessions (30d)", "idle_park_sessions", (q) => q.gte("started_at", since30)],
  ["idle_telemetry_windows", "idle_telemetry_windows", (q) => q],
  ["idle_events (30d)", "idle_events", (q) => q.gte("started_at", since30)],
  ["idle_rollup_days (30d)", "idle_rollup_days", (q) => q.gte("day", day30)],
  ["hos_duty_segments (30d)", "hos_duty_segments", (q) => q.gte("started_at", since30)],
];
for (const [label, table, apply] of COVERAGE) {
  const total = await countOf(table, apply);
  const d = await distinct(table, "vehicle_id", apply);
  say(
    `  ${label.padEnd(28)}: ${String(total).padStart(9)} rows across ${d.size}${d.capped ? "+" : ""} distinct vehicles`,
  );
}

say("\n  Most recently synced trucks (idle_states_at desc, top 12):");
{
  const { data, error } = await db
    .from("vehicles")
    .select("unit_number,samsara_vehicle_id,idle_capability,idle_states_at,idle_evidence_status")
    .not("idle_states_at", "is", null)
    .order("idle_states_at", { ascending: false })
    .limit(12);
  if (error) say(`    (query failed: ${error.message})`);
  for (const v of data ?? [])
    say(
      `    ${String(v.unit_number ?? v.samsara_vehicle_id).padEnd(14)} cap=${String(v.idle_capability).padEnd(16)} evidence=${String(v.idle_evidence_status).padEnd(13)} at=${v.idle_states_at}`,
    );
}

say("\n## 3. Jobs active right now (any kind)\n");
{
  const { data } = await db
    .from("jobs")
    .select("kind,status,started_at,created_at,lease_expires_at,dedup_key")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(25);
  if (!(data ?? []).length) say("  none");
  for (const j of data ?? []) {
    const expired = j.lease_expires_at && Date.parse(j.lease_expires_at) < Date.now();
    say(
      `  ${j.kind.padEnd(22)} ${j.status.padEnd(8)} since ${j.started_at ?? j.created_at}  lease=${j.lease_expires_at ?? "none"}${expired ? "  << EXPIRED" : ""}`,
    );
  }
}

say("\n## 4. Migration 0174/0175 objects present?\n");
for (const fn of [
  "apply_idle_hos_evidence",
  "apply_idle_equipment_evidence",
  "apply_idle_learned_envelope",
]) {
  const { data, error } = await db.rpc(fn, {
    p_org: "00000000-0000-0000-0000-000000000000",
    p_rows: [],
  });
  say(
    `  ${fn}: ${error ? `MISSING / ERROR — ${error.message}` : `present (returned ${data}, expected 0)`}`,
  );
}

say("\n## 5. Last 10 failed jobs of ANY kind (context)\n");
{
  const { data } = await db
    .from("jobs")
    .select("kind,error,started_at,finished_at")
    .eq("status", "failed")
    .order("finished_at", { ascending: false })
    .limit(10);
  for (const j of data ?? [])
    say(`  [${j.kind}] ran ${mins(j.started_at, j.finished_at)} — ${String(j.error).slice(0, 240)}`);
}

mkdirSync(join(ROOT, "docs"), { recursive: true });
const dest = join(ROOT, "docs/idle-sync-diagnosis.txt");
writeFileSync(dest, out.join("\n") + "\n");
say(`\nWritten to ${dest}`);
