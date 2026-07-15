// Phase 0 — Smart Fueling data-readiness probe (READ-ONLY).
// Verifies the two hard dependencies before we build the solver:
//   (1) fuel level coverage + quantization per truck, (2) HOS clocks presence/freshness + real field shapes + teams.
// Run on a machine WITH network to api.samsara.com (NOT the cloud sandbox — it's proxy-blocked):
//   SAMSARA_API_TOKEN=samsara_api_xxx node _probes/phase0-fueling-readiness.mjs
// Nothing is written anywhere. Paste the printed summary back.

const TOKEN = process.env.SAMSARA_API_TOKEN;
const BASE = process.env.SAMSARA_API_URL || "https://api.samsara.com";
if (!TOKEN) { console.error("Set SAMSARA_API_TOKEN (read-only token)."); process.exit(1); }

const H = { Authorization: `Bearer ${TOKEN}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getAll(path) {
  const out = [];
  let after = "";
  for (let i = 0; i < 200; i++) {
    const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}limit=512${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const res = await fetch(url, { headers: H });
    if (res.status === 429) { const ra = Number(res.headers.get("retry-after") || 1); await sleep((ra || 1) * 1000); i--; continue; }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path} :: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    for (const d of j.data ?? []) out.push(d);
    const pg = j.pagination ?? {};
    if (!pg.hasNextPage || !pg.endCursor) break;
    after = pg.endCursor;
  }
  return out;
}

const ageMin = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 60000) : null);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
const readVal = (x) => (x == null ? null : Array.isArray(x) ? x[x.length - 1] : x);

(async () => {
  console.log(`\n=== Phase 0 readiness — ${new Date().toISOString()} — ${BASE} ===\n`);

  // 1) fuel level + gps snapshot  (Samsara returns 'fuelPercent' singular even though the type is 'fuelPercents')
  console.log("## 1. Fuel level + GPS coverage");
  const stats = await getAll("/fleet/vehicles/stats?types=gps,fuelPercents");
  let withFuel = 0, withGps = 0;
  const fuelVals = [], gpsAges = [];
  for (const v of stats) {
    const f = readVal(v.fuelPercent ?? v.fuelPercents);
    const g = readVal(v.gps);
    if (f && f.value != null) { withFuel++; fuelVals.push(Number(f.value)); }
    if (g && (g.time || g.latitude != null)) { withGps++; if (g.time) gpsAges.push(ageMin(g.time)); }
  }
  console.log(`   vehicles returned:         ${stats.length}`);
  console.log(`   with a fuel level:         ${withFuel}  (${pct(withFuel, stats.length)})   <-- KEY GO/NO-GO`);
  console.log(`   with a gps fix:            ${withGps}  (${pct(withGps, stats.length)})`);
  const distinct = [...new Set(fuelVals)].sort((a, b) => a - b);
  console.log(`   distinct fuel% values:     ${distinct.length} (sample: ${distinct.slice(0, 14).join(", ")}${distinct.length > 14 ? " ..." : ""})`);
  const stepGuess = distinct.length > 1 ? Math.min(...distinct.slice(1).map((v, i) => v - distinct[i])) : null;
  console.log(`   smallest step (quantization ~): ${stepGuess ?? "n/a"}%`);
  const freshGps = gpsAges.filter((m) => m != null && m <= 30).length;
  console.log(`   gps fixes <=30 min old:    ${freshGps}/${gpsAges.length}`);

  // 2) HOS clocks
  console.log("\n## 2. HOS clocks presence / freshness / field shapes / teams");
  let hos = [];
  try { hos = await getAll("/fleet/hos/clocks"); }
  catch (e) { console.log(`   !! HOS call FAILED: ${e.message}`); }
  if (hos.length) {
    let d0 = 0, s0 = 0, c0 = 0, b0 = 0;
    const duty = new Set();
    for (const d of hos) {
      const c = d.clocks ?? {};
      if ((c.drive?.driveRemainingDurationMs ?? c.driveRemainingDurationMs) != null) d0++;
      if ((c.shift?.shiftRemainingDurationMs ?? c.shiftRemainingDurationMs) != null) s0++;
      if ((c.cycle?.cycleRemainingDurationMs ?? c.cycleRemainingDurationMs) != null) c0++;
      if ((c.break?.timeUntilBreakDurationMs ?? c.timeUntilBreakDurationMs) != null) b0++;
      const ds = d.currentDutyStatus?.hosStatusType ?? d.currentDutyStatus?.status;
      if (ds) duty.add(ds);
    }
    console.log(`   drivers returned:          ${hos.length}`);
    console.log(`   with driveRemaining:       ${d0}  (${pct(d0, hos.length)})`);
    console.log(`   with shiftRemaining:       ${s0}  (${pct(s0, hos.length)})`);
    console.log(`   with cycleRemaining:       ${c0}  (${pct(c0, hos.length)})`);
    console.log(`   with timeUntilBreak:       ${b0}  (${pct(b0, hos.length)})`);
    console.log(`   distinct hosStatusType:    [${[...duty].join(", ")}]`);
    const active = hos.filter((d) => ["driving", "onDuty", "sleeperBed"].includes(d.currentDutyStatus?.hosStatusType));
    const byVeh = new Map();
    for (const d of active) { const id = d.currentVehicle?.id; if (id) byVeh.set(id, (byVeh.get(id) ?? 0) + 1); }
    const teams = [...byVeh.values()].filter((n) => n >= 2).length;
    console.log(`   active drivers on a truck: ${active.length};  trucks with 2+ active drivers (teams): ${teams}`);
  }

  console.log("\n=== GO/NO-GO ===");
  console.log("   Buildable from LIVE state if fuel-level coverage is high (>80%) AND HOS drive/shift/cycle present.");
  console.log("   Low fuel coverage -> plan from last EFS fill (bounded) or exclude those trucks; decide before Phase 3.\n");
})().catch((e) => { console.error("PROBE ERROR:", e.message); process.exit(1); });
