#!/usr/bin/env node
/**
 * END-TO-END AUDIT: why does "avoidable idle" only cover a handful of trucks?
 *
 * Answers, with live data and zero assumptions, WHERE trucks fall out of the pipeline:
 *
 *   A. DATA PULL (Samsara → our tables): engine-days, park sessions, duty segments, assignments —
 *      row counts and DISTINCT-vehicle coverage, fully paged (no sampling lies).
 *   B. EVIDENCE (session level): hos_evidence_status distribution, BY EVIDENCE VERSION — proves
 *      whether the v2 assignment-attribution code has actually run, and what it changed.
 *   C. ROLLUP (day level): hos_evidence_status across truck-days; per truck, how many days are
 *      sufficient vs not.
 *   D. PAGE MATH (range level): replicates useIdleBreakdown's aggregation EXACTLY — including the
 *      worst-status-wins collapse — and prints the funnel: total → coverage gate → capability gate →
 *      duty gate → confident. The final number should reproduce what the Idling page shows.
 *
 * Read-only. Reads Supabase credentials from apps/api/.env (service role — local use only).
 * Run:  node scripts/idle-avoidable-audit.mjs [--days 30]
 * Also writes docs/idle-avoidable-audit.txt.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argv = process.argv.slice(2);
const DAYS = Number(argv[argv.indexOf("--days") + 1] || 30) || 30;

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

const out = [];
const say = (s = "") => {
  out.push(s);
  console.log(s);
};
const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "-");
const hrs = (sec) => Math.round((sec / 3600) * 10) / 10;

const sinceIso = new Date(Date.now() - DAYS * 86_400_000).toISOString();
const sinceDay = sinceIso.slice(0, 10);

/** Fully paged read — every row, no 1000-row default cap, no misleading sampled DISTINCTs. */
async function readAll(table, columns, apply = (q) => q) {
  const PAGE = 1000;
  const rows = [];
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await apply(db.from(table).select(columns)).range(off, off + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

say("=".repeat(100));
say(`AVOIDABLE-IDLE PIPELINE AUDIT — last ${DAYS} days — ${new Date().toISOString()}`);
say("=".repeat(100));

const orgs = await readAll("organizations", "id, name");
for (const org of orgs) {
  const vehicles = await readAll(
    "vehicles",
    "id, unit_number, status, samsara_vehicle_id, has_apu, has_optimized_idle, idle_capability",
    (q) => q.eq("org_id", org.id),
  );
  const active = vehicles.filter((v) => v.status !== "retired");
  if (active.length === 0) continue;
  say(`\n${"#".repeat(100)}\n# ORG ${org.name ?? org.id} — ${active.length} active trucks\n${"#".repeat(100)}`);

  // ── A. DATA PULL ──────────────────────────────────────────────────────────────────────────────
  say("\n## A. Samsara data actually in our tables (full scan, distinct trucks)\n");
  const engineDays = await readAll("vehicle_engine_days", "vehicle_id, day, coverage_sec", (q) =>
    q.eq("org_id", org.id).gte("day", sinceDay),
  );
  const sessions = await readAll(
    "idle_park_sessions",
    "vehicle_id, started_at, idle_sec, mode, hos_evidence_status, hos_evidence_version, hos_covered_sec, hos_unknown_sec, hos_ambiguous_sec",
    (q) => q.eq("org_id", org.id).gte("started_at", sinceIso),
  );
  const segments = await readAll(
    "hos_duty_segments",
    "vehicle_id, samsara_driver_id, driver_id, started_at",
    (q) => q.eq("org_id", org.id).gte("started_at", sinceIso),
  );
  const assignments = await readAll(
    "driver_vehicle_assignments",
    "vehicle_samsara_id, driver_samsara_id, start_at, end_at",
    (q) => q.eq("org_id", org.id).lte("start_at", new Date().toISOString()),
  ).then((rows) => rows.filter((r) => r.end_at == null || r.end_at >= sinceIso));
  const distinct = (rows, key) => new Set(rows.map((r) => r[key]).filter(Boolean)).size;

  say(`  vehicle_engine_days   : ${String(engineDays.length).padStart(7)} rows, ${distinct(engineDays, "vehicle_id")} distinct trucks`);
  say(`  idle_park_sessions    : ${String(sessions.length).padStart(7)} rows, ${distinct(sessions, "vehicle_id")} distinct trucks`);
  say(`  hos_duty_segments     : ${String(segments.length).padStart(7)} rows, ${distinct(segments, "vehicle_id")} trucks via LOGBOOK vehicle link`);
  say(`                          ${String(segments.filter((s) => s.samsara_driver_id).length).padStart(7)} rows carry samsara_driver_id (assignment-join key)`);
  say(`  driver_vehicle_assign : ${String(assignments.length).padStart(7)} intervals overlapping window, ${distinct(assignments, "vehicle_samsara_id")} distinct trucks, ${distinct(assignments, "driver_samsara_id")} distinct drivers`);

  const samsaraVehicles = new Set(active.map((v) => v.samsara_vehicle_id).filter(Boolean));
  const assignedTrucksResolvable = [...new Set(assignments.map((a) => a.vehicle_samsara_id))].filter((id) => samsaraVehicles.has(id)).length;
  say(`  assignments resolving to an active truck: ${assignedTrucksResolvable}`);

  // ── B. EVIDENCE — session level, split by version ────────────────────────────────────────────
  say("\n## B. Park-session duty evidence (did v2 attribution run, and what did it change?)\n");
  const byVersion = new Map();
  for (const s of sessions) {
    const v = s.hos_evidence_version ?? "(none)";
    const rec = byVersion.get(v) ?? { total: 0, sufficient: 0, insufficient: 0, ambiguous: 0, idleSec: 0, coveredSec: 0, unknownSec: 0 };
    rec.total += 1;
    rec[s.hos_evidence_status] = (rec[s.hos_evidence_status] ?? 0) + 1;
    rec.idleSec += Number(s.idle_sec) || 0;
    rec.coveredSec += Number(s.hos_covered_sec) || 0;
    rec.unknownSec += Number(s.hos_unknown_sec) || 0;
    byVersion.set(v, rec);
  }
  for (const [version, r] of byVersion) {
    say(`  ${version}: ${r.total} sessions — sufficient ${r.sufficient ?? 0} (${pct(r.sufficient ?? 0, r.total)}), insufficient ${r.insufficient ?? 0}, ambiguous ${r.ambiguous ?? 0}`);
    say(`      seconds-weighted: idle ${hrs(r.idleSec)}h, HOS-covered ${hrs(r.coveredSec)}h (${pct(r.coveredSec, r.idleSec)}), unknown ${hrs(r.unknownSec)}h`);
  }
  if (![...byVersion.keys()].some((v) => v === "vehicle-hos-v2"))
    say("  >>> NO v2 sessions: the assignment-attribution code has NOT rewritten evidence yet (not deployed, or no sync_hos since deploy).");

  // ── C. ROLLUP — day level ────────────────────────────────────────────────────────────────────
  say("\n## C. Rollup days (what the Idling page actually reads)\n");
  const rollup = await readAll(
    "idle_rollup_days",
    "vehicle_id, day, drive_sec, idle_sec, coverage_sec, continuous_idle_sec, hos_evidence_status, hos_rest_sec, hos_work_sec, hos_unknown_sec, hos_ambiguous_sec",
    (q) => q.eq("org_id", org.id).gte("day", sinceDay),
  );
  const dayStatus = new Map();
  for (const r of rollup) dayStatus.set(r.hos_evidence_status, (dayStatus.get(r.hos_evidence_status) ?? 0) + 1);
  say(`  ${rollup.length} truck-days across ${distinct(rollup, "vehicle_id")} trucks. Day-level duty status:`);
  for (const [k, n] of [...dayStatus].sort((a, b) => b[1] - a[1])) say(`      ${String(k).padEnd(16)} ${n} (${pct(n, rollup.length)})`);

  // ── D. PAGE MATH — the NEW seconds-weighted rule (deployed 2026-08-12) ──────────────────────
  say("\n## D. Funnel under the seconds-weighted rule (evidenced share >= 80% => confident)\n");
  const per = new Map();
  for (const r of rollup) {
    const s = per.get(r.vehicle_id) ?? { cov: 0, days: 0, continuous: 0, idle: 0, drive: 0, unknown: 0, ambiguous: 0, rest: 0, work: 0 };
    s.cov += Number(r.coverage_sec) || 0;
    s.days += 1;
    s.continuous += Number(r.continuous_idle_sec) || 0;
    s.idle += Number(r.idle_sec) || 0;
    s.drive += Number(r.drive_sec) || 0;
    s.unknown += Number(r.hos_unknown_sec) || 0;
    s.ambiguous += Number(r.hos_ambiguous_sec) || 0;
    s.rest += Number(r.hos_rest_sec) || 0;
    s.work += Number(r.hos_work_sec) || 0;
    per.set(r.vehicle_id, s);
  }
  const daysWithData = new Set(rollup.map((r) => r.day)).size || 1;
  const periodSec = Math.min(DAYS, daysWithData) * 86_400;
  const vehById = new Map(active.map((v) => [v.id, v]));

  let total = 0, passCoverage = 0, passCapability = 0, confident = 0;
  const shares = []; // per-truck evidenced share, for trucks passing coverage+capability with continuous idle
  const weak = [];
  for (const [vehicleId, s] of per) {
    const v = vehById.get(vehicleId);
    if (!v) continue;
    total += 1;
    const coverageOk = s.cov / periodSec >= 0.5;
    const alternativeKnown =
      v.has_apu === true || v.has_optimized_idle === true || v.has_apu === false ||
      (v.idle_capability != null && v.idle_capability !== "unknown");
    if (coverageOk) passCoverage += 1;
    if (!(coverageOk && alternativeKnown)) continue;
    passCapability += 1;
    const dutyUncertain = Math.min(s.continuous, s.unknown + s.ambiguous);
    const share = s.continuous > 0 ? (s.continuous - dutyUncertain) / s.continuous : 1;
    shares.push(share);
    if (share >= 0.8) confident += 1;
    else weak.push({ unit: v.unit_number, share, continuousH: hrs(s.continuous), unknownH: hrs(s.unknown), ambiguousH: hrs(s.ambiguous), restH: hrs(s.rest), workH: hrs(s.work), days: s.days });
  }
  say(`  trucks with any rollup data          ${total}`);
  say(`  … coverage >= 50% of range           ${passCoverage}`);
  say(`  … + capability/alternative known     ${passCapability}`);
  say(`  … + duty-evidenced share >= 80%      ${confident}   <- what the page now calls "confident"`);

  say("\n  Evidenced-share distribution (trucks passing coverage+capability):");
  const bins = [[0,0.2],[0.2,0.4],[0.4,0.6],[0.6,0.8],[0.8,0.95],[0.95,1.001]];
  for (const [lo, hi] of bins) {
    const n = shares.filter((x) => x >= lo && x < hi).length;
    say(`      ${String(Math.round(lo*100)).padStart(3)}–${String(Math.round(hi*100)).padStart(3)}%   ${"#".repeat(Math.min(60, n))} ${n}`);
  }
  say("\n  Threshold sensitivity (confident count if the floor were):");
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9]) say(`      >= ${Math.round(t*100)}%  ->  ${shares.filter((x) => x >= t).length} trucks`);

  weak.sort((a, b) => b.share - a.share);
  say(`\n  Trucks below the 80% bar: ${weak.length} (sorted best-first)`);
  for (const t of weak.slice(0, 25))
    say(`      unit ${String(t.unit).padEnd(8)} share ${Math.round(t.share*100)}%  continuous ${t.continuousH}h  unknown ${t.unknownH}h  ambiguous ${t.ambiguousH}h  rest ${t.restH}h  work ${t.workH}h  (${t.days} days)`);
  if (weak.length > 25) say(`      … +${weak.length - 25} more`);

  say("\n## Verdict inputs");
  say(`  Trucks clustered at 60-79% share -> threshold calibration question (evidence exists, bar slightly high).`);
  say(`  Trucks clustered at 0-40% share  -> evidence generation gap for those trucks' drivers/assignments.`);
  say(`  High ambiguous hours             -> conflicting assignment overlaps to investigate.`);
}

writeFileSync(join(ROOT, "docs/idle-avoidable-audit.txt"), out.join("\n") + "\n");
console.log("\nWrote docs/idle-avoidable-audit.txt");
