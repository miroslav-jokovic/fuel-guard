#!/usr/bin/env node
/**
 * INDEPENDENT reconciliation: Samsara API vs our stored tables.
 *
 * Answers "is our sync pulling everything?" with numbers, not theory. This script talks to Samsara
 * DIRECTLY (no FuelGuard sync code, no shared parsers — an independent integrator), then diffs
 * per-truck window totals against what our tables contain:
 *
 *   1. engineStates history  → integrate Off/On/Idle seconds ourselves → compare vehicle_engine_days
 *   2. /idling/events        → per-truck event count + idle hours      → compare idle_events
 *
 * A truck whose store totals track Samsara within tolerance is being synced correctly; a truck with
 * data at Samsara and a hole in the store names exactly where the pull is losing data.
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SAMSARA_API_TOKEN from apps/api/.env.
 * Read-only everywhere. Paced ≤4 req/s, honors Retry-After on 429.
 *
 * Run:  node scripts/samsara-vs-store-recon.mjs [--days 7] [--units 550,589,699]
 * Writes docs/samsara-vs-store-recon.txt.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DAYS = Number(arg("days", 7)) || 7;
const ONLY_UNITS = arg("units", null)?.split(",").map((s) => s.trim());
const TOLERANCE = 0.03; // 3% window-total drift before we flag a truck

const env = Object.fromEntries(
  readFileSync(join(ROOT, "apps/api/.env"), "utf8")
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
if (!env.SAMSARA_API_TOKEN) {
  console.error(
    "apps/api/.env has no SAMSARA_API_TOKEN. Add one (Samsara dashboard → Settings → API Tokens,\n" +
      "read scopes are enough) or run with SAMSARA_API_TOKEN=... in the environment.",
  );
  process.exit(1);
}
const SAMSARA = env.SAMSARA_API_URL || "https://api.samsara.com";
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const out = [];
const say = (s = "") => {
  out.push(s);
  console.log(s);
};
const hrs = (sec) => Math.round((sec / 3600) * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastCall = 0;
async function samsaraGet(path, params) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + 250 - Date.now(); // ≤4 req/s
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const url = new URL(path, SAMSARA);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.SAMSARA_API_TOKEN}` } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`Samsara ${res.status} on ${path} after ${attempt} retries`);
      const ra = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Samsara ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
}

async function readAll(table, columns, apply = (q) => q) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await apply(db.from(table).select(columns)).range(off, off + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

// ── Org, timezone, window (last N COMPLETE org-local days) ──────────────────────────────────────
const orgs = await readAll("organizations", "id, name, operating_hours");
const org = orgs[0];
const tz = org.operating_hours?.tz ?? "America/Chicago";
const localDate = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
// Find the UTC instant of local midnight for a local date by scanning hour offsets (DST-safe enough here).
function localMidnightUtc(dateStr) {
  for (let h = -12; h <= 14; h++) {
    const t = new Date(`${dateStr}T00:00:00Z`).getTime() + h * 3_600_000;
    const d = new Date(t);
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit" });
    const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === dateStr && Number(parts.hour) % 24 === 0) return t;
  }
  throw new Error(`could not resolve local midnight for ${dateStr}`);
}
const today = localDate(new Date());
const days = [];
for (let i = DAYS; i >= 1; i--) {
  const d = new Date(localMidnightUtc(today) - i * 86_400_000 + 3_600_000); // +1h guard, re-derive date
  days.push(localDate(d));
}
const windowStartMs = localMidnightUtc(days[0]);
const windowEndMs = localMidnightUtc(today);
say("=".repeat(100));
say(`SAMSARA vs STORE — org ${org.name}, tz ${tz}, ${days[0]} → ${days[days.length - 1]} (${DAYS} complete local days)`);
say("=".repeat(100));

// ── Vehicles ────────────────────────────────────────────────────────────────────────────────────
let vehicles = await readAll(
  "vehicles",
  "id, unit_number, samsara_vehicle_id, status",
  (q) => q.eq("org_id", org.id).neq("status", "retired").not("samsara_vehicle_id", "is", null),
);
if (ONLY_UNITS) vehicles = vehicles.filter((v) => ONLY_UNITS.includes(String(v.unit_number)));
say(`\nComparing ${vehicles.length} trucks.`);

// ── 1. engineStates: independent integration vs vehicle_engine_days ─────────────────────────────
const PAD_MS = 96 * 3_600_000; // pre-window context: a STUCK gateway can go days without a state
// change (units 589/585/669/642, 2026-08-12), so the opening state may have been set long before the
// window. 96h of context keeps the integrator honest for those trucks instead of undercounting Samsara.
const samsaraTotals = new Map(); // samsara_vehicle_id -> {off,on,idle}
const BATCH = 15;
let pages = 0;
for (let i = 0; i < vehicles.length; i += BATCH) {
  const batch = vehicles.slice(i, i + BATCH);
  const byVehicle = new Map(batch.map((v) => [String(v.samsara_vehicle_id), []]));
  let after;
  do {
    const params = {
      vehicleIds: batch.map((v) => v.samsara_vehicle_id).join(","),
      types: "engineStates",
      startTime: new Date(windowStartMs - PAD_MS).toISOString(),
      endTime: new Date(windowEndMs).toISOString(),
      ...(after ? { after } : {}),
    };
    const page = await samsaraGet("/fleet/vehicles/stats/history", params);
    for (const v of page.data ?? []) {
      const list = byVehicle.get(String(v.id));
      if (list) for (const r of v.engineStates ?? []) list.push(r);
    }
    after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
    pages += 1;
    if (pages > 400) throw new Error("page guard tripped — narrow --days or --units");
  } while (after);
  for (const [svid, records] of byVehicle) {
    records.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const totals = { Off: 0, On: 0, Idle: 0 };
    for (let j = 0; j < records.length; j++) {
      const t0 = Date.parse(records[j].time);
      const t1 = j + 1 < records.length ? Date.parse(records[j + 1].time) : windowEndMs;
      const s = Math.max(t0, windowStartMs);
      const e = Math.min(t1, windowEndMs);
      if (e > s && totals[records[j].value] != null) totals[records[j].value] += (e - s) / 1000;
    }
    samsaraTotals.set(svid, totals);
  }
  process.stdout.write(`  fetched engineStates ${Math.min(i + BATCH, vehicles.length)}/${vehicles.length} trucks (${pages} pages)\r`);
}
console.log();

const engineDays = await readAll(
  "vehicle_engine_days",
  "vehicle_id, day, idle_sec, drive_sec, off_sec, coverage_sec",
  (q) => q.eq("org_id", org.id).in("day", days),
);
const storeTotals = new Map();
for (const r of engineDays) {
  const s = storeTotals.get(r.vehicle_id) ?? { idle: 0, drive: 0, off: 0, days: 0 };
  s.idle += Number(r.idle_sec) || 0;
  s.drive += Number(r.drive_sec) || 0;
  s.off += Number(r.off_sec) || 0;
  s.days += 1;
  storeTotals.set(r.vehicle_id, s);
}

say("\n## 1. Engine time — Samsara (independent integration) vs vehicle_engine_days\n");
let ok = 0;
const drifted = [];
const missing = [];
const noSamsara = [];
for (const v of vehicles) {
  const sam = samsaraTotals.get(String(v.samsara_vehicle_id)) ?? { Off: 0, On: 0, Idle: 0 };
  const st = storeTotals.get(v.id);
  const samActive = sam.On + sam.Idle;
  if (samActive < 60 && !st) { noSamsara.push(v.unit_number); continue; }
  if (!st) { missing.push({ unit: v.unit_number, samIdleH: hrs(sam.Idle), samDriveH: hrs(sam.On) }); continue; }
  const idleDelta = Math.abs(sam.Idle - st.idle) / Math.max(3600, sam.Idle);
  const driveDelta = Math.abs(sam.On - st.drive) / Math.max(3600, sam.On);
  if (idleDelta <= TOLERANCE && driveDelta <= TOLERANCE) ok += 1;
  else drifted.push({ unit: v.unit_number, samIdleH: hrs(sam.Idle), stIdleH: hrs(st.idle), samDriveH: hrs(sam.On), stDriveH: hrs(st.drive), days: st.days });
}
say(`  within ${Math.round(TOLERANCE * 100)}% tolerance : ${ok}`);
say(`  drifted              : ${drifted.length}`);
say(`  in Samsara, MISSING from store: ${missing.length}`);
say(`  no meaningful Samsara data (parked/offline all window): ${noSamsara.length}`);
for (const t of drifted.slice(0, 20))
  say(`      unit ${String(t.unit).padEnd(8)} idle sam ${t.samIdleH}h vs store ${t.stIdleH}h · drive sam ${t.samDriveH}h vs store ${t.stDriveH}h · ${t.days} store days`);
if (drifted.length > 20) say(`      … +${drifted.length - 20} more`);
for (const t of missing.slice(0, 20))
  say(`      MISSING unit ${String(t.unit).padEnd(8)} samsara shows idle ${t.samIdleH}h, drive ${t.samDriveH}h — store has NO engine-day rows in window`);

// ── 2. Idling events — Samsara /idling/events vs idle_events ────────────────────────────────────

// Per-day breakdown for explicitly requested units — the drill-down for drifted trucks.
if (ONLY_UNITS) {
  say("\n## 1b. Per-day breakdown (requested units)\n");
  const dayBounds = days.map((d) => ({ day: d, start: localMidnightUtc(d), end: localMidnightUtc(d) + 86_400_000 }));
  // Re-fetch per unit so we can integrate per day (records were already fetched; reuse samsaraTotals is
  // window-level only). Cheap for a handful of units.
  for (const v of vehicles) {
    const records = [];
    let after;
    do {
      const page = await samsaraGet("/fleet/vehicles/stats/history", {
        vehicleIds: String(v.samsara_vehicle_id),
        types: "engineStates",
        startTime: new Date(windowStartMs - PAD_MS).toISOString(),
        endTime: new Date(windowEndMs).toISOString(),
        ...(after ? { after } : {}),
      });
      for (const pv of page.data ?? []) for (const r of pv.engineStates ?? []) records.push(r);
      after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
    } while (after);
    records.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const stRows = new Map(engineDays.filter((r) => r.vehicle_id === v.id).map((r) => [r.day, r]));
    say(`  unit ${v.unit_number} (samsara id ${v.samsara_vehicle_id})`);
    say(`      day          sam idle  sam drive  sam off   | store idle  store drive  store off`);
    for (const b of dayBounds) {
      const t = { Off: 0, On: 0, Idle: 0 };
      for (let j = 0; j < records.length; j++) {
        const t0 = Date.parse(records[j].time);
        const t1 = j + 1 < records.length ? Date.parse(records[j + 1].time) : windowEndMs;
        const cs = Math.max(t0, b.start);
        const ce = Math.min(t1, b.end);
        if (ce > cs && t[records[j].value] != null) t[records[j].value] += (ce - cs) / 1000;
      }
      const st = stRows.get(b.day);
      const f = (x) => String(hrs(x)).padStart(7);
      say(`      ${b.day}  ${f(t.Idle)}h ${f(t.On)}h ${f(t.Off)}h  | ${st ? `${f(st.idle_sec)}h  ${f(st.drive_sec)}h   ${f(st.off_sec)}h` : "   —— NO STORE ROW ——"}`);
    }
    say("");
  }
}

say("\n## 2. Idling events — Samsara /idling/events vs idle_events (same window)\n");
const samEvents = new Map(); // samsara vehicle id -> {count, sec}
{
  let after;
  let n = 0;
  do {
    const page = await samsaraGet("/idling/events", {
      startTime: new Date(windowStartMs).toISOString(),
      endTime: new Date(windowEndMs).toISOString(),
      limit: "200",
      ...(after ? { after } : {}),
    });
    for (const e of page.data ?? []) {
      const vid = String(e.vehicle?.id ?? e.vehicleId ?? "");
      if (!vid) continue;
      const rec = samEvents.get(vid) ?? { count: 0, sec: 0 };
      rec.count += 1;
      rec.sec += Number(e.durationMs ?? 0) / 1000 || Number(e.durationSeconds ?? 0) || 0;
      samEvents.set(vid, rec);
      n += 1;
    }
    after = page.pagination?.hasNextPage ? page.pagination.endCursor : undefined;
  } while (after);
  say(`  Samsara returned ${n} idling events in window.`);
  if (n === 0) {
    say("  >>> ZERO events almost certainly means this token lacks the 'Read Idling' scope (Samsara");
    say("  >>> answers 200-empty, not 403). The store comparison below would be all false alarms, so");
    say("  >>> it is SKIPPED. Use a token with Read Idling to run this section.");
  }
}
const samEventsUsable = [...samEvents.values()].length > 0;
const storeEvents = samEventsUsable ? await readAll(
  "idle_events",
  "vehicle_id, duration_sec, started_at",
  (q) => q.eq("org_id", org.id).gte("started_at", new Date(windowStartMs).toISOString()).lt("started_at", new Date(windowEndMs).toISOString()),
) : [];
const storeEvByVeh = new Map();
for (const e of storeEvents) {
  const rec = storeEvByVeh.get(e.vehicle_id) ?? { count: 0, sec: 0 };
  rec.count += 1;
  rec.sec += Number(e.duration_sec) || 0;
  storeEvByVeh.set(e.vehicle_id, rec);
}
let evOk = 0;
const evDrift = [];
for (const v of samEventsUsable ? vehicles : []) {
  const sam = samEvents.get(String(v.samsara_vehicle_id)) ?? { count: 0, sec: 0 };
  const st = storeEvByVeh.get(v.id) ?? { count: 0, sec: 0 };
  if (sam.count === 0 && st.count === 0) { evOk += 1; continue; }
  const secDelta = Math.abs(sam.sec - st.sec) / Math.max(1800, sam.sec);
  if (sam.count === st.count && secDelta <= TOLERANCE) evOk += 1;
  else evDrift.push({ unit: v.unit_number, samCount: sam.count, stCount: st.count, samH: hrs(sam.sec), stH: hrs(st.sec) });
}
say(`  matching             : ${evOk}`);
say(`  differing            : ${evDrift.length}`);
for (const t of evDrift.slice(0, 20))
  say(`      unit ${String(t.unit).padEnd(8)} events sam ${t.samCount} vs store ${t.stCount} · idle-event hours sam ${t.samH}h vs store ${t.stH}h`);
if (evDrift.length > 20) say(`      … +${evDrift.length - 20} more`);

say("\n## Verdict");
say(`  Engine time:  ${ok}/${vehicles.length - noSamsara.length} trucks tie out within ${Math.round(TOLERANCE * 100)}%. ` +
  (missing.length ? `${missing.length} trucks have Samsara data the store LACKS — that is a pull gap; investigate those units' sync path.` : "No truck has Samsara data the store lacks — the pull is complete."));
say(samEventsUsable
  ? `  Idling events: ${evOk}/${vehicles.length} match. ` +
    (evDrift.length ? "Differences listed above — compare windows/attribution for those units." : "Fully consistent.")
  : "  Idling events: SKIPPED (token lacks Read Idling scope — engine-time parity above is the authoritative check).");
say(`  Note: the AVOIDABLE number is gated downstream of this data (equipment flags + duty evidence);`);
say(`  a complete pull with few avoidable trucks means the gate, not the pull. See docs/idle-avoidable-audit.txt.`);

writeFileSync(join(ROOT, "docs/samsara-vs-store-recon.txt"), out.join("\n") + "\n");
console.log("\nWrote docs/samsara-vs-store-recon.txt");
