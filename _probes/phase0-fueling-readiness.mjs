// Phase 0 — Smart Fueling data-readiness probe (READ-ONLY).
// Verifies the two hard dependencies before we build the solver:
//   (1) fuelPercents coverage + quantization per truck, (2) HOS clocks presence/freshness + real field shapes.
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

const hrs = (ms) => (ms == null ? null : Math.round((ms / 3_600_000) * 10) / 10);
const ageMin = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 60000) : null);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");

(async () => {
  console.log(`\n=== Phase 0 readiness — ${new Date().toISOString()} — ${BASE} ===\n`);

  // 1) fuelPercents + gps snapshot
  console.log("## 1. Fuel level (fuelPercents) + GPS coverage");
  const stats = await getAll("/fleet/vehicles/stats?types=gps,fuelPercents");
  const readVal = (x) => (x == null ? null : Array.isArray(x) ? x[x.length - 1] : x);
  let withFuel = 0, withGps = 0;
  const fuelVals = [];
  const gpsAges = [];
  for (const v of stats) {
    const f = readVal(v.fuelPercents);
    const g = readVal(v.gps);
    if (f && f.value != null) { withFuel++; fuelVals.push(Number(f.value)); }
    if (g && (g.time || g.latitude != null)) { withGps++; if (g.time) gpsAges.push(ageMin(g.time)); }
  }
  console.log(`   vehicles returned:        ${stats.length}`);
  console.log(`   with a fuelPercents value: ${withFuel}  (${pct(withFuel, stats.length)})   <-- KEY GO/NO-GO`);
  console.log(`   with a gps fix:            ${withGps}  (${pct(withGps, stats.length)})`);
  // quantization: distinct fractional steps in the sample tells us how coarse the sensor is
  const distinct = [...new Set(fuelVals.map((n) => n))].sort((a, b) => a - b);
  console.log(`   distinct fuel% values seen: ${distinct.length} (sample: ${distinct.slice(0, 12).join(", ")}${distinct.length > 12 ? " ..." : ""})`);
  const freshGps = gpsAges.filter((m) => m != null && m <= 30).length;
  console.log(`   gps fixes <=30 min old:    ${freshGps}/${gpsAges.length}`);
  if (stats[0]) console.log(`   RAW sample vehicle stat:\n     ${JSON.stringify(stats[0]).slice(0, 500)}`);

  // 2) HOS clocks
  console.log("\n## 2. HOS clocks presence / freshness / real field shapes");
  let hos = [];
  try { hos = await getAll("/fleet/hos/clocks"); }
  catch (e) { console.log(`   !! HOS call FAILED: ${e.message}\n   (missing 'Read ELD Compliance Settings (US)' scope? or no ELD?) `); }
  if (hos.length) {
    let withDrive = 0, withShift = 0, withCycle = 0, withBreak = 0;
    const duty = new Set();
    for (const d of hos) {
      const c = d.clocks ?? {};
      const drive = c.drive?.driveRemainingDurationMs ?? c.driveRemainingDurationMs;
      const shift = c.shift?.shiftRemainingDurationMs ?? c.shiftRemainingDurationMs;
      const cycle = c.cycle?.cycleRemainingDurationMs ?? c.cycleRemainingDurationMs;
      const brk = c.break?.timeUntilBreakDurationMs ?? c.timeUntilBreakDurationMs;
      if (drive != null) withDrive++;
      if (shift != null) withShift++;
      if (cycle != null) withCycle++;
      if (brk != null) withBreak++;
      const ds = d.currentDutyStatus?.hosStatusType ?? d.currentDutyStatus?.status;
      if (ds) duty.add(ds);
    }
    console.log(`   drivers returned:          ${hos.length}`);
    console.log(`   with driveRemaining:       ${withDrive}  (${pct(withDrive, hos.length)})`);
    console.log(`   with shiftRemaining:       ${withShift}  (${pct(withShift, hos.length)})`);
    console.log(`   with cycleRemaining:       ${withCycle}  (${pct(withCycle, hos.length)})`);
    console.log(`   with timeUntilBreak:       ${withBreak}  (${pct(withBreak, hos.length)})`);
    console.log(`   distinct hosStatusType:    [${[...duty].join(", ")}]   <-- confirms enum spelling (sleeperBerth vs sleeperBed)`);
    console.log(`   RAW sample HOS clock:\n     ${JSON.stringify(hos[0]).slice(0, 700)}`);
  }

  console.log("\n=== GO/NO-GO ===");
  console.log("   Solver is buildable from LIVE state if fuelPercents coverage is high (say >80%) AND HOS drive/shift/cycle are present.");
  console.log("   Low fuel% coverage -> plan from last EFS fill (bounded) or exclude those trucks; decide before Phase 3.\n");
})().catch((e) => { console.error("PROBE ERROR:", e.message); process.exit(1); });
