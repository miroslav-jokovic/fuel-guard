#!/usr/bin/env node
/**
 * FuelGuard ⇄ McLeod on-prem sync agent.
 *
 * Runs INSIDE the carrier's network (on the McLeod host or any box that can reach it), reads dispatch data
 * from McLeod LoadMaster, and POSTs it OUTBOUND to FuelGuard's ingest endpoints. No inbound firewall change —
 * the only connections it makes are: McLeod (local) and https://<fuelguard>/api/tms (outbound HTTPS).
 *
 * Zero dependencies: Node 18+ built-in fetch only. Configure with environment variables (see config.example.env).
 *
 * SOURCE=mock   → posts a couple of sample rows so IT can verify the FuelGuard side (auth + ingest) works
 *                 end-to-end BEFORE the McLeod field mapping is confirmed. Start here.
 * SOURCE=mcleod → reads LoadMaster (see fetchFromMcleod) and posts the real data. The McLeod field paths are
 *                 confirmed against live data during the one-truck connectivity test, then filled in below.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── config ──────────────────────────────────────────────────────────────────────────────────────────
const CFG = {
  ingestUrl: (process.env.FUELGUARD_INGEST_URL ?? "").replace(/\/+$/, ""), // e.g. https://app.fuelguard.example
  ingestToken: process.env.FUELGUARD_INGEST_TOKEN ?? "", // the fgtms_… token from FuelGuard → Settings
  source: (process.env.SOURCE ?? "mock").toLowerCase(), // 'mock' | 'mcleod'
  lookbackDays: Number(process.env.LOOKBACK_DAYS ?? 35),
  intervalMinutes: Number(process.env.INTERVAL_MINUTES ?? 0), // 0 = run once and exit; >0 = loop forever
  statePath: process.env.STATE_PATH ?? "./state.json",
  // McLeod ws (only needed when SOURCE=mcleod)
  mcleod: {
    baseUrl: (process.env.MCLEOD_WS_URL ?? "").replace(/\/+$/, ""), // e.g. https://<loadmaster-host>/ws
    company: process.env.MCLEOD_COMPANY ?? "", // loadmaster.company (e.g. TMS)
    token: process.env.MCLEOD_WS_TOKEN ?? "", // the web-service API token McLeod issues
  },
};

function fail(msg) {
  console.error(`[agent] FATAL: ${msg}`);
  process.exit(1);
}
if (!CFG.ingestUrl || !CFG.ingestToken) fail("Set FUELGUARD_INGEST_URL and FUELGUARD_INGEST_TOKEN.");
if (!["mock", "mcleod"].includes(CFG.source)) fail("SOURCE must be 'mock' or 'mcleod'.");

const log = (...a) => console.log(`[agent ${new Date().toISOString()}]`, ...a);

// ── small helpers ───────────────────────────────────────────────────────────────────────────────────
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST JSON to FuelGuard with the ingest token, retrying transient failures with backoff. */
async function postToFuelGuard(path, body) {
  const url = `${CFG.ingestUrl}${path}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${CFG.ingestToken}` },
        body: JSON.stringify(body),
      });
      if (res.status === 401) fail("FuelGuard rejected the ingest token (401). Re-check FUELGUARD_INGEST_TOKEN.");
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`); // transient → retry
      const json = await res.json().catch(() => ({}));
      if (!res.ok) fail(`FuelGuard ${path} rejected the payload (HTTP ${res.status}): ${JSON.stringify(json)}`);
      return json;
    } catch (e) {
      if (attempt === 4) fail(`FuelGuard ${path} unreachable after retries: ${e.message}`);
      const backoff = 1000 * 2 ** (attempt - 1);
      log(`POST ${path} failed (${e.message}); retrying in ${backoff}ms…`);
      await sleep(backoff);
    }
  }
}

/** Send rows in ≤1000-row batches (FuelGuard's per-request cap) and total the reported results. */
async function sendBatched(path, key, rows) {
  let received = 0,
    upserted = 0;
  const unmatched = new Set();
  for (const batch of chunk(rows, 1000)) {
    const r = await postToFuelGuard(path, { [key]: batch });
    received += r.received ?? 0;
    upserted += r.upserted ?? 0;
    for (const u of r.unmatched ?? []) unmatched.add(u);
  }
  return { received, upserted, unmatched: [...unmatched] };
}

// ── source: mock ────────────────────────────────────────────────────────────────────────────────────
function mockData() {
  const now = new Date();
  const iso = (dAgo) => new Date(now.getTime() - dAgo * 86400_000).toISOString();
  return {
    movements: [
      // A reefer load (temperature_controlled:true) and a dry load on the SAME truck — replace unit numbers
      // with real ones from your fleet so they resolve.
      { external_id: "MOCK-M1", vehicle_unit: "REPLACE_UNIT", trailer_unit: "REPLACE_TRAILER", started_at: iso(6), ended_at: iso(4), temperature_controlled: true, setpoint_f: -10, commodity: "Frozen" },
      { external_id: "MOCK-M2", vehicle_unit: "REPLACE_UNIT", started_at: iso(3), ended_at: iso(1), temperature_controlled: false, commodity: "Dry van" },
    ],
    windows: [
      { external_id: "MOCK-W1", driver_employee_id: "REPLACE_EMPLOYEE_ID", start_at: iso(2), end_at: iso(0), kind: "home_time" },
    ],
  };
}

// ── source: mcleod ──────────────────────────────────────────────────────────────────────────────────
/**
 * Read movements + driver time-off from LoadMaster and map them to FuelGuard's neutral contract.
 *
 * ┌─ TO COMPLETE DURING THE CONNECTIVITY TEST ────────────────────────────────────────────────────────┐
 * │ The LoadMaster web services (MovementService / OrderService / DriverService) expose this data, but  │
 * │ the exact endpoint paths and which field marks a load "temperature-controlled" are carrier-config   │
 * │ specific. Confirm them against ONE real movement, then fill in the two mappers below:               │
 * │   • movement.temperature_controlled ← the reefer/temperature-controlled flag OR a temperature       │
 * │     setpoint being present OR the commodity/order-type. (This is the field that fixes the alerts.)   │
 * │   • the vehicle/trailer UNIT NUMBERS and driver EMPLOYEE ID, so FuelGuard can match your records.    │
 * │ Until then, run with SOURCE=mock to prove the FuelGuard side.                                        │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
async function fetchFromMcleod(sinceIso) {
  if (!CFG.mcleod.baseUrl || !CFG.mcleod.token) fail("SOURCE=mcleod needs MCLEOD_WS_URL and MCLEOD_WS_TOKEN.");

  // McLeod ws auth header — confirm the exact header McLeod issues for your account (token vs company+token).
  const mcleodHeaders = { Authorization: `Bearer ${CFG.mcleod.token}`, "X-com.mcleodsoftware.CompanyID": CFG.mcleod.company };

  async function mcleodGet(pathAndQuery) {
    const res = await fetch(`${CFG.mcleod.baseUrl}${pathAndQuery}`, { headers: mcleodHeaders });
    if (!res.ok) throw new Error(`McLeod ${pathAndQuery} → HTTP ${res.status}`);
    return res.json();
  }

  // TODO(confirm): the MovementService / OrderService endpoint that lists movements changed since `sinceIso`.
  const rawMovements = await mcleodGet(`/movements?changedSince=${encodeURIComponent(sinceIso)}`);
  // TODO(confirm): the DriverService endpoint for driver time-off / availability windows.
  const rawWindows = await mcleodGet(`/drivers/timeoff?changedSince=${encodeURIComponent(sinceIso)}`);

  const movements = (rawMovements.items ?? rawMovements ?? []).map((m) => ({
    external_id: String(m.id ?? m.movement_id),
    vehicle_unit: m.tractor_id ?? m.unit ?? undefined, // TODO(confirm): your unit-number field
    trailer_unit: m.trailer_id ?? undefined, // TODO(confirm)
    started_at: m.actual_departure ?? m.start_date ?? undefined,
    ended_at: m.actual_arrival ?? m.end_date ?? undefined,
    // TODO(confirm): the reefer signal for your fleet — temp-controlled flag, a setpoint, or commodity/order type.
    temperature_controlled: Boolean(m.temperature_controlled ?? m.reefer ?? m.temperature_min != null),
    setpoint_f: m.temperature_min ?? null,
    commodity: m.commodity ?? null,
    raw: m,
  }));

  const windows = (rawWindows.items ?? rawWindows ?? []).map((w) => ({
    external_id: String(w.id ?? ""),
    driver_employee_id: w.driver_id ?? w.employee_id ?? undefined, // TODO(confirm): matches drivers.employee_id
    start_at: w.start_date ?? w.from,
    end_at: w.end_date ?? w.to ?? undefined,
    kind: w.type === "PTO" ? "pto" : "home_time",
    raw: w,
  }));

  return { movements, windows };
}

// ── watermark (incremental sync) ──────────────────────────────────────────────────────────────────
function loadSince() {
  if (existsSync(CFG.statePath)) {
    try {
      return JSON.parse(readFileSync(CFG.statePath, "utf8")).lastSync ?? null;
    } catch {
      /* ignore a corrupt state file */
    }
  }
  return null;
}
function saveSince(iso) {
  writeFileSync(CFG.statePath, JSON.stringify({ lastSync: iso }, null, 2));
}

// ── one sync cycle ────────────────────────────────────────────────────────────────────────────────
async function runOnce() {
  const fallback = new Date(Date.now() - CFG.lookbackDays * 86400_000).toISOString();
  const since = loadSince() ?? fallback;
  const startedAt = new Date().toISOString();
  log(`sync start · source=${CFG.source} · since=${since}`);

  const { movements, windows } = CFG.source === "mock" ? mockData() : await fetchFromMcleod(since);

  if (movements.length) {
    const r = await sendBatched("/api/tms/movements", "movements", movements);
    log(`movements: received=${r.received} upserted=${r.upserted}` + (r.unmatched.length ? ` · UNMATCHED units: ${r.unmatched.join(", ")}` : ""));
  } else log("movements: none");

  if (windows.length) {
    const r = await sendBatched("/api/tms/driver-time", "windows", windows);
    log(`driver-time: received=${r.received} upserted=${r.upserted}` + (r.unmatched.length ? ` · UNMATCHED drivers: ${r.unmatched.join(", ")}` : ""));
  } else log("driver-time: none");

  // Only advance the watermark after a fully successful cycle (errors above exit the process).
  saveSince(startedAt);
  log("sync ok");
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  await runOnce();
  if (CFG.intervalMinutes > 0) {
    log(`looping every ${CFG.intervalMinutes} min (Ctrl-C to stop)`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await sleep(CFG.intervalMinutes * 60_000);
      try {
        await runOnce();
      } catch (e) {
        log(`cycle error (will retry next interval): ${e.message}`);
      }
    }
  }
}
main().catch((e) => fail(e.message));
