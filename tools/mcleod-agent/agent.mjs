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
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";
import { fetchRoster, fetchRetirements, diffAgainstState, loadState, saveState, runInspection } from "./roster.mjs";
import { INSPECTION } from "./inspect.mjs";
import { fetchSettlements } from "./settlements.mjs";
import { fetchExpenses } from "./expenses.mjs";
import { fetchMovementFacts } from "./movements.mjs";
import { fetchLedgerControl, fetchGlAccounts } from "./ledger.mjs";
import { fetchBilling, mapBilling } from "./billing.mjs";

// ── config ──────────────────────────────────────────────────────────────────────────────────────────
/** A path beside agent.mjs itself, so state does not follow the working directory around. */
const beside = (name) => resolvePath(dirname(fileURLToPath(import.meta.url)), name);

const CFG = {
  ingestUrl: (process.env.FUELGUARD_INGEST_URL ?? "").replace(/\/+$/, ""), // e.g. https://app.fuelguard.example
  ingestToken: process.env.FUELGUARD_INGEST_TOKEN ?? "", // the fgtms_… token from FuelGuard → Settings
  source: (process.env.SOURCE ?? "mock").toLowerCase(), // 'mock' | 'mcleod'
  // --roster syncs the master-data lists (drivers/tractors/trailers) straight from McLeod's SQL Server.
  // Independent of SOURCE, which selects the movement/time-off path.
  roster: process.argv.includes("--roster"),
  // Retirement is opt-in per RUN, never a mode that rides along with a sweep: it is the one operation
  // that takes capability away from a person and the only one that touches the retention clock.
  retire: process.argv.includes("--retire"),
  // Read-only reconnaissance. Answers the questions the field mapping cannot decide without
  // measuring, and prints them as JSON so the output can be pasted back verbatim. Every query is
  // gated by `pnpm lint:mcleod-recon` before it can reach this file.
  inspect: process.argv.includes("--inspect"),
  // Read McLeod, map every row, and print what WOULD be posted — without posting, and without
  // needing a FuelGuard ingest token. Exercises the entire half of this integration that lives on the
  // carrier's side (the SQL, the trims, the unit and code handling, the change detection) against
  // real data, before anybody has connected the two systems together.
  dryRun: process.argv.includes("--dry-run"),
  // Send every row regardless of whether it changed. What the link-only match report needs: it is
  // measuring a whole roster against FuelGuard's, not a delta.
  rosterFull: process.argv.includes("--full"),
  // --financial sweeps settlements + AP vouchers into FuelGuard's 0257 staging tables (program
  // step P3.2). Reads the SAME SQL the standalone reconciliation CLIs (settlements.mjs,
  // expenses.mjs) have already proven to the cent — this flag turns those proofs into a
  // pipeline. Rolling accrual window; the ingest is idempotent on the McLeod row id, so overlap
  // is the normal case, not a hazard.
  financial: process.argv.includes("--financial"),
  financialWindowDays: Number(process.env.FINANCIAL_WINDOW_DAYS ?? 45),
  // 'report'   — matches and counts, and writes NOTHING. How §7's numbers get reproduced by the
  //              pipeline against the carrier's live fleet without touching a row. Start here.
  // 'link'     — match keys only; no date of birth or home address is READ, let alone sent.
  // 'identity' — adds the fields FuelGuard writes onto rows it has already matched.
  // 'create'   — identity, plus: a McLeod record matching nothing becomes a new FuelGuard row.
  rosterMode: (process.env.ROSTER_MODE ?? "link").toLowerCase(),
  lookbackDays: Number(process.env.LOOKBACK_DAYS ?? 35),
  intervalMinutes: Number(process.env.INTERVAL_MINUTES ?? 0), // 0 = run once and exit; >0 = loop forever
  // ── WHY THESE RESOLVE AGAINST THE AGENT AND NOT AGAINST THE WORKING DIRECTORY ────────────────
  // They defaulted to "./state.json" and "./roster-state.json", which is the CWD — so where the state
  // landed depended on where somebody happened to be standing when they ran the agent. Run from a
  // FuelGuard checkout, as it is during development, and it lands in the ROOT OF A PUBLIC REPOSITORY.
  //
  // That matters because of what the roster state contains. The values are row hashes and harmless;
  // the keys are a carrier's actual identifiers — 164 driver codes, 190 unit numbers, 235 trailer
  // numbers. One `git add -A` away from publishing a customer's roster. It sat untracked in a working
  // tree for four days before anybody noticed it was there.
  //
  // Resolved against this file's own directory, the state is always beside the agent that wrote it,
  // wherever it is invoked from — and `.gitignore` can name one path rather than guess at every CWD
  // an operator might use. An explicit STATE_PATH / ROSTER_STATE_PATH still wins, and is still
  // interpreted relative to the CWD, which is what somebody passing an absolute path expects.
  statePath: process.env.STATE_PATH ?? beside("state.json"),
  rosterStatePath: process.env.ROSTER_STATE_PATH ?? beside("roster-state.json"),
  // McLeod ws (only needed when SOURCE=mcleod)
  // McLeod SQL Server — the roster source (see roster.mjs / queries.mjs).
  sql: {
    server: process.env.MCLEOD_SQL_SERVER ?? "",
    port: Number(process.env.MCLEOD_SQL_PORT ?? 1433),
    database: process.env.MCLEOD_SQL_DATABASE ?? "",
    user: process.env.MCLEOD_SQL_USER ?? "",
    password: process.env.MCLEOD_SQL_PASSWORD ?? "",
    // dbo.company.id (TMS, TMS2, …) — NOT dbo.company.company_id, which is the LoadMaster instance
    // code and reads 'TMS' on all four rows. Getting this wrong mixes two legal entities.
    companyId: process.env.MCLEOD_COMPANY_ID ?? "",
    encrypt: (process.env.MCLEOD_SQL_ENCRYPT ?? "true").toLowerCase() !== "false",
    serverName: process.env.MCLEOD_SQL_SERVERNAME ?? "",
    trustCert: (process.env.MCLEOD_SQL_TRUST_CERT ?? "true").toLowerCase() !== "false",
  },
  mcleod: {
    baseUrl: (process.env.MCLEOD_WS_URL ?? "").replace(/\/+$/, ""), // e.g. https://<loadmaster-host>/ws
    company: process.env.MCLEOD_COMPANY ?? "", // loadmaster.company (e.g. TMS)
    token: process.env.MCLEOD_WS_TOKEN ?? "", // token registered in LoadMaster / PowerBroker
    username: process.env.MCLEOD_WS_USERNAME ?? "", // optional: Basic auth instead of a token
    password: process.env.MCLEOD_WS_PASSWORD ?? "",
    pageSize: Math.min(Number(process.env.MCLEOD_PAGE_SIZE ?? 1000), 1000),
    // McLeod's public DriverService docs do not publish a time-off endpoint. A carrier-specific API or
    // read-only SQL view can be plugged in here after McLeod confirms it for this installation.
    driverTimeOffPath: process.env.MCLEOD_DRIVER_TIMEOFF_PATH ?? "",
    reeferEquipmentTypes: new Set(
      (process.env.MCLEOD_REEFER_EQUIPMENT_TYPES ?? "REEFER,R")
        .split(",")
        .map((v) => v.trim().toUpperCase())
        .filter(Boolean),
    ),
  },
};

function fail(msg) {
  console.error(`[agent] FATAL: ${msg}`);
  process.exit(1);
}
// Reconnaissance POSTS NOTHING, so it must not require FuelGuard credentials. That is not a nicety:
// the people best placed to run `--inspect` are the carrier's IT against `lme`, and they will be doing
// it BEFORE anyone has issued an ingest token — demanding one would make the first useful command
// impossible to run at the only time it matters.
if (!CFG.inspect && !CFG.dryRun && (!CFG.ingestUrl || !CFG.ingestToken)) {
  fail("Set FUELGUARD_INGEST_URL and FUELGUARD_INGEST_TOKEN.");
}
if (!["mock", "mcleod"].includes(CFG.source)) fail("SOURCE must be 'mock' or 'mcleod'.");
if (CFG.roster || CFG.retire || CFG.inspect || CFG.dryRun || CFG.financial) {
  for (const k of ["server", "database", "user", "password", "companyId"]) {
    if (!CFG.sql[k]) fail(`--roster needs MCLEOD_SQL_${k === "companyId" ? "…MCLEOD_COMPANY_ID" : k.toUpperCase()}.`);
  }
  if (!["report", "link", "identity", "create"].includes(CFG.rosterMode)) {
    fail("ROSTER_MODE must be 'report', 'link', 'identity' or 'create'.");
  }
}
if (!Number.isInteger(CFG.mcleod.pageSize) || CFG.mcleod.pageSize < 1) {
  fail("MCLEOD_PAGE_SIZE must be an integer from 1 to 1000.");
}

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

/**
 * Send rows in bounded batches (FuelGuard's per-request cap) and total the reported results.
 *
 * `extra` rides along on EVERY batch. The financial payload schemas require `window_start`/
 * `window_end` beside the rows — the ingest uses them to tell a short batch from an empty window —
 * and the first version of this helper silently dropped them, which would have 400'd every
 * financial POST on the sweep's first real run. Caught 2026-08-27 wiring movement facts; the sweep
 * had never run against production, so the schemas' own validation was the only thing that noticed.
 */
async function sendBatched(path, key, rows, extra = {}, batchSize = 1000) {
  let received = 0,
    upserted = 0,
    updated = 0,
    created = 0,
    skippedOwned = 0;
  const unmatched = new Set();
  for (const batch of chunk(rows, batchSize)) {
    const r = await postToFuelGuard(path, { ...extra, [key]: batch });
    received += r.received ?? 0;
    upserted += r.upserted ?? 0;
    updated += r.updated ?? 0;
    created += r.created ?? 0;
    skippedOwned += r.skippedOwned ?? 0;
    for (const u of r.unmatched ?? []) unmatched.add(u);
  }
  return { received, upserted, updated, created, skippedOwned, unmatched: [...unmatched] };
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
  if (!CFG.mcleod.baseUrl) fail("SOURCE=mcleod needs MCLEOD_WS_URL.");
  if (!CFG.mcleod.token && !(CFG.mcleod.username && CFG.mcleod.password)) {
    fail("SOURCE=mcleod needs MCLEOD_WS_TOKEN or MCLEOD_WS_USERNAME + MCLEOD_WS_PASSWORD.");
  }
  if (!CFG.mcleod.company) fail("SOURCE=mcleod needs MCLEOD_COMPANY (for the AnywhereCompanyID header).");

  // Documented Direct-Hosted authentication: Bearer/Token or HTTP Basic, plus AnywhereCompanyID.
  const authorization = CFG.mcleod.token
    ? `Bearer ${CFG.mcleod.token}`
    : `Basic ${Buffer.from(`${CFG.mcleod.username}:${CFG.mcleod.password}`).toString("base64")}`;
  const mcleodHeaders = {
    Accept: "application/json",
    Authorization: authorization,
    AnywhereCompanyID: CFG.mcleod.company,
  };

  async function mcleodGet(pathAndQuery) {
    const res = await fetch(`${CFG.mcleod.baseUrl}${pathAndQuery}`, { headers: mcleodHeaders });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      throw new Error(`McLeod ${pathAndQuery} → HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return res.json();
  }

  const rows = (payload) => {
    if (Array.isArray(payload)) return payload;
    for (const key of ["items", "results", "data", "movements", "windows"]) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
  };

  async function pagedSearch(path, changedAfterDate) {
    const all = [];
    for (let offset = 0; ; offset += CFG.mcleod.pageSize) {
      const query = new URLSearchParams({
        changedAfterDate,
        recordLength: String(CFG.mcleod.pageSize),
        recordOffset: String(offset),
      });
      const page = rows(await mcleodGet(`${path}?${query}`));
      all.push(...page);
      if (page.length < CFG.mcleod.pageSize) return all;
    }
  }

  // Published MovementService incremental-search endpoint. McLeod caps a page at 1,000 rows.
  const movementIndex = await pagedSearch("/movements/search", sinceIso);

  // The search endpoint returns RowMovement index rows. The documented detail endpoint adds the assigned
  // tractor, drivers, trailers, stops and orders needed for FuelGuard's mapping. Hydrate with bounded
  // concurrency so an initial backfill does not overwhelm the carrier's LoadMaster server.
  const rawMovements = new Array(movementIndex.length);
  const detailWorkers = Array.from({ length: Math.min(6, movementIndex.length) }, async (_, worker) => {
    for (let i = worker; i < movementIndex.length; i += 6) {
      const summary = movementIndex[i];
      const id = summary?.id ?? summary?.movement_id;
      if (!id) throw new Error(`McLeod movement search returned a row without an id at offset ${i}`);
      rawMovements[i] = await mcleodGet(`/movements/${encodeURIComponent(String(id))}`);
    }
  });
  await Promise.all(detailWorkers);

  // No driver time-off route appears in the public DriverService contract. Keep it disabled unless McLeod
  // supplies a supported route (or the carrier exposes a read-only internal adapter for an approved view).
  const rawWindows = CFG.mcleod.driverTimeOffPath
    ? rows(
        await mcleodGet(
          CFG.mcleod.driverTimeOffPath.replaceAll("{since}", encodeURIComponent(sinceIso)),
        ),
      )
    : [];

  const descendants = (value) => {
    const out = [];
    const visit = (v) => {
      if (!v || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(visit);
      out.push(v);
      Object.values(v).forEach(visit);
    };
    visit(value);
    return out;
  };
  const namedChild = (record, name) =>
    descendants(record).find((v) => v !== record && (v.__name === name || v.__type === name));
  const namedChildren = (record, name) =>
    descendants(record).filter((v) => v !== record && (v.__name === name || v.__type === name));
  const yes = (value) => value === true || ["Y", "YES", "TRUE", "1"].includes(String(value ?? "").toUpperCase());

  const movements = rawMovements.map((m) => {
    const tractor = namedChild(m, "tractor");
    const trailer = namedChild(m, "trailer1") ?? namedChild(m, "trailer");
    const orders = namedChildren(m, "orders");
    const stops = namedChildren(m, "stops");
    const firstStop = stops[0];
    const lastStop = stops.at(-1);
    const equipmentType =
      orders.find((o) => o.equipment_type_id)?.equipment_type_id ??
      m.carrier_trailer_type ??
      trailer?.trailer_type ??
      trailer?.equipment_type_id;
    const setpoint =
      orders.find((o) => o.temperature_min != null || o.setpoint_f != null)?.temperature_min ??
      orders.find((o) => o.setpoint_f != null)?.setpoint_f ??
      null;
    const commodity = orders.find((o) => o.commodity)?.commodity ?? m.ts_commodity ?? null;
    return {
      external_id: String(m.id ?? m.movement_id),
      vehicle_unit: m.__tractor_id ?? tractor?.id ?? m.carrier_tractor ?? undefined,
      trailer_unit: m.__trailer1_id ?? trailer?.id ?? m.carrier_trailer ?? undefined,
      started_at: firstStop?.actual_departure ?? firstStop?.actual_arrival ?? m.rdy_pickup_date ?? undefined,
      ended_at: lastStop?.actual_departure ?? lastStop?.actual_arrival ?? m.return_date ?? undefined,
      // Equipment codes are carrier-configurable; MCLEOD_REEFER_EQUIPMENT_TYPES is the explicit allow-list.
      temperature_controlled:
        yes(m.temperature_controlled ?? m.reefer) ||
        setpoint != null ||
        CFG.mcleod.reeferEquipmentTypes.has(String(equipmentType ?? "").toUpperCase()),
      setpoint_f: setpoint == null ? null : Number(setpoint),
      commodity,
      raw: m,
    };
  });

  const windows = rawWindows.map((w) => ({
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

// ── roster sync ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Read the three master-data lists from McLeod and push what changed.
 *
 * The rows that VANISHED from the active predicate are reported to the operator and deliberately NOT
 * sent as an instruction. A disappearance can mean a driver was terminated — or that a query returned
 * short because the database was mid-restore. This side cannot tell those apart, and FuelGuard's
 * deactivation pass carries the guard that can (never retire more rows than the incoming roster size).
 */
/**
 * Fields that must never be printed by a dry run. It reports COVERAGE — how many rows carry a value —
 * and one sample row, and a sample row of a driver is a person's date of birth and home address on
 * somebody's terminal. Counting proves the mapping works; printing the value proves nothing extra.
 */
const DRY_MASK = new Set([
  "first_name", "middle_name", "last_name", "full_name", "cdl_number", "cdl_state",
  "date_of_birth", "address_line1", "city", "state", "postal_code", "email",
]);

/** What a sweep WOULD send, as per-field coverage plus one masked sample. */
function reportDryRun(entity, rows) {
  console.log(`\n### ${entity} — ${rows.length} row(s) would be sent`);
  if (!rows.length) return;
  const coverage = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      coverage[k] = (coverage[k] ?? 0) + (v === null || v === undefined || v === "" ? 0 : 1);
    }
  }
  for (const [field, n] of Object.entries(coverage).sort()) {
    const flag = n === 0 ? "  ← EMPTY on every row" : n < rows.length ? `  (${rows.length - n} without)` : "";
    console.log(`  ${String(n).padStart(4)}/${rows.length}  ${field}${flag}`);
  }
  const sample = Object.fromEntries(
    Object.entries(rows[0]).map(([k, v]) => [k, DRY_MASK.has(k) && v != null ? "\u2039masked\u203a" : v]),
  );
  console.log(`  sample: ${JSON.stringify(sample)}`);
}

async function runRoster() {
  const state = loadState(CFG.rosterStatePath);
  log(`roster: reading ${CFG.sql.database} on ${CFG.sql.server} as company ${CFG.sql.companyId} (mode=${CFG.rosterMode}${CFG.rosterFull ? ", full" : ""})`);
  const roster = await fetchRoster({ ...CFG.sql, mode: CFG.rosterMode });
  log(`roster: McLeod reports ${JSON.stringify(roster.counts)}`);

  const nextState = { ...state };
  for (const [entity, path, key] of [
    ["drivers", `/api/tms/roster/drivers?mode=${CFG.rosterMode}`, "drivers"],
    ["vehicles", `/api/tms/roster/vehicles?mode=${CFG.rosterMode}`, "vehicles"],
    ["trailers", `/api/tms/roster/trailers?mode=${CFG.rosterMode}`, "trailers"],
  ]) {
    const { changed, vanished, nextState: ns } = diffAgainstState(entity, roster[entity], state, CFG.rosterFull);
    nextState[entity] = ns;
    if (vanished.length > 0) {
      log(`roster: ${vanished.length} ${entity} left the active list since the last run (reported, not acted on): ${vanished.slice(0, 20).join(", ")}${vanished.length > 20 ? "…" : ""}`);
    }
    if (changed.length === 0) {
      log(`roster: ${entity} unchanged (${roster[entity].length} active)`);
      continue;
    }
    if (CFG.dryRun) {
      reportDryRun(entity, changed);
      continue;
    }
    const res = await sendBatched(path, key, changed);
    log(`roster: ${entity} sent=${changed.length} received=${res.received} linked=${res.upserted} updated=${res.updated ?? 0} created=${res.created ?? 0}${res.skippedOwned ? ` office-owned=${res.skippedOwned}` : ""}${res.unmatched.length ? ` UNMATCHED=${res.unmatched.length}` : ""}`);
    if (res.unmatched.length) log(`roster: ${entity} unmatched → ${res.unmatched.slice(0, 25).join(", ")}${res.unmatched.length > 25 ? "…" : ""}`);
  }
  saveState(CFG.rosterStatePath, nextState);
}

/** Push the rows that have LEFT the active roster, each with an explicit status. */
async function runRetire() {
  log(`roster: reading retirements from ${CFG.sql.database} as company ${CFG.sql.companyId}`);
  const r = await fetchRetirements(CFG.sql);
  for (const [entity, path] of [
    ["drivers", "/api/tms/roster/drivers/retire"],
    ["vehicles", "/api/tms/roster/vehicles/retire"],
    ["trailers", "/api/tms/roster/trailers/retire"],
  ]) {
    const rows = r[entity];
    if (!rows.length) continue;
    // Retirements are sent whole every time and never diffed against local state: this is the sweep
    // where being slightly stale is the expensive direction, and the ingest is idempotent — a row
    // already in the right state costs one comparison and no write.
    let sent = 0;
    const totals = { retired: 0, unchanged: 0, unknown: 0, skippedOwned: 0, rehires: 0 };
    let refused = null;
    for (const batch of chunk(rows, 2000)) {
      const res = await postToFuelGuard(path, { retire: batch });
      sent += batch.length;
      if (res.refused) refused = res.refused;
      for (const k of Object.keys(totals)) {
        const v = res[k];
        totals[k] += Array.isArray(v) ? v.length : (v ?? 0);
      }
    }
    if (refused) log(`roster: ${entity} retirement REFUSED — ${refused}`);
    else log(`roster: ${entity} retire sent=${sent} retired=${totals.retired} already=${totals.unchanged} not-linked=${totals.unknown} office-owned=${totals.skippedOwned} rehires-to-review=${totals.rehires}`);
  }
}

/** Every calendar month [first, first-of-next) that [windowStart, windowEnd) touches. */
function monthsTouching(windowStart, windowEnd) {
  const months = [];
  let [y, m] = windowStart.split("-").map(Number);
  for (;;) {
    const periodStart = `${y}-${String(m).padStart(2, "0")}-01`;
    if (periodStart >= windowEnd) break;
    m === 12 ? ((y += 1), (m = 1)) : (m += 1);
    months.push({ periodStart, periodEnd: `${y}-${String(m).padStart(2, "0")}-01` });
  }
  return months;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
/** Sweep one rolling accrual window of settlements + AP vouchers into FuelGuard (P3.2). */
async function runFinancial() {
  const end = new Date(Date.now() + 86_400_000); // tomorrow, so today's accruals are inside the window
  const start = new Date(end.getTime() - CFG.financialWindowDays * 86_400_000);
  const windowStart = start.toISOString().slice(0, 10);
  const windowEnd = end.toISOString().slice(0, 10);
  log(`financial: sweeping ${windowStart} → ${windowEnd} from ${CFG.sql.database} as company ${CFG.sql.companyId}`);

  const windowExtra = { window_start: windowStart, window_end: windowEnd };

  const st = await fetchSettlements({ ...CFG.sql, windowStart, windowEnd });
  const rs = await sendBatched("/api/tms/settlements", "settlements", st.settlements, windowExtra, 2000);
  log(`financial: settlements sent=${st.settlements.length} received=${rs.received} upserted=${rs.upserted}`);

  // Deductions ride the same fetch — fetchSettlements already reads them (they reconcile the same
  // accrual window) — and land in their own staging (0268): money moving the other way, with its
  // own void state, never a column on the settlement.
  const rd = await sendBatched("/api/tms/deductions", "deductions", st.deductions, windowExtra, 2000);
  log(`financial: deductions sent=${st.deductions.length} received=${rd.received} upserted=${rd.upserted}`);

  const ex = await fetchExpenses({ ...CFG.sql, windowStart, windowEnd });
  const rv = await sendBatched("/api/tms/vouchers", "vouchers", ex.vouchers, windowExtra, 1000);
  log(`financial: vouchers sent=${ex.vouchers.length} received=${rv.received} upserted=${rv.upserted}`);

  // Movement facts — the cents-per-mile denominator (C2 posting; C1's dry run proved the window's
  // mileage against the carrier's own operations report first). The window predicate is
  // xfer2settle_date, same clock the settlement sweep uses, so a trip and its pay arrive under the
  // same sweep horizon. Batches of 500: the payload schema caps `movements` there because each row
  // carries its ordered stops array.
  const mv = await fetchMovementFacts({ ...CFG.sql, windowStart, windowEnd });
  const rm = await sendBatched("/api/tms/movement-facts", "movements", mv.movements, windowExtra, 500);
  log(`financial: movement-facts sent=${mv.movements.length} received=${rm.received} upserted=${rm.upserted}`);

  // Billing — the earnings side, posting unlocked 2026-08-27 the day F1/F2 answered. EVERYTHING in
  // the window is staged, canceled/rebilled flags verbatim (their vocabulary is F3's still-open
  // question); what reaches reports is decided downstream by the documented GL-posted predicate,
  // never here. Windowed on bill_date, the economic date, like the dry-run CLI.
  const bl = await fetchBilling({ ...CFG.sql, windowStart, windowEnd });
  const rb = await sendBatched("/api/tms/billing", "billing", bl.rows.map(mapBilling), windowExtra, 2000);
  log(`financial: billing sent=${bl.rows.length} received=${rb.received} upserted=${rb.upserted}`);

  // The chart of accounts, whole — 123 rows; the classification the GL month totals below are
  // read through (the CPM page's fleet-truth income statement).
  const ga = await fetchGlAccounts(CFG.sql);
  const rg = await postToFuelGuard("/api/tms/gl-accounts", { accounts: ga.accounts });
  log(`financial: gl-accounts sent=${ga.accounts.length} upserted=${rg.upserted ?? 0}`);

  // Office payroll at PERSON grain (0276). `fetchLedgerControl` has read these lines since C4 for
  // the coverage report and then thrown them away; OFF is the one expense module with no subledger,
  // so the ledger line is the only record of who was paid. Swept on the rolling window like the
  // other detail, and month-whole totals below stay the control they are checked against.
  const officeWindow = await fetchLedgerControl({ ...CFG.sql, windowStart, windowEnd });
  const ro = await sendBatched("/api/tms/office-lines", "lines", officeWindow.officeLines, windowExtra, 2000);
  log(`financial: office-lines sent=${officeWindow.officeLines.length} received=${ro.received} upserted=${ro.upserted}`);

  // GL control totals — month-grained, unlike everything above: totals are aggregates over a
  // period, so the period must be the stable unit the carrier's own close uses. Every calendar
  // month the rolling window touches is swept WHOLE (bounded month, not clipped to the window) and
  // the ingest replaces it — that is how the carrier's ~1-month entry lag flows through instead of
  // freezing the first partial sweep of a month as its truth.
  for (const { periodStart, periodEnd } of monthsTouching(windowStart, windowEnd)) {
    const lc = await fetchLedgerControl({ ...CFG.sql, windowStart: periodStart, windowEnd: periodEnd });
    const rl = await postToFuelGuard("/api/tms/ledger-totals", {
      period_start: periodStart,
      period_end: periodEnd,
      totals: lc.totals,
    });
    log(`financial: ledger-totals ${periodStart} rows=${lc.totals.length} upserted=${rl.upserted ?? 0} staleRemoved=${rl.staleRemoved ?? 0}`);
  }

  // Reconciliation stays where it always ran: the standalone CLIs print the to-the-cent GL
  // tie-outs; this sweep only persists. Fuel purchases are deliberately NOT posted — EFS is
  // authoritative for fuel (D-FS2) and the McLeod copy lands via P3.4's projection decision.
}

async function main() {
  if (CFG.dryRun) {
    log(`DRY RUN — reading ${CFG.sql.database} as company ${CFG.sql.companyId} (mode=${CFG.rosterMode}); nothing will be posted`);
    await runRoster();
    return;
  }
  if (CFG.inspect) {
    log(`inspect: ${INSPECTION.length} question(s) against ${CFG.sql.database} as company ${CFG.sql.companyId}`);
    for (const r of await runInspection(CFG.sql, INSPECTION)) {
      console.log(`\n### ${r.id} — ${r.question}`);
      console.log(`# blocks: ${r.blocks}`);
      if (r.error) console.log(`# ERROR: ${r.error}`);
      else if (!r.rows.length) console.log("# (no rows)");
      else for (const row of r.rows) console.log(JSON.stringify(row));
    }
    return;
  }
  if (CFG.retire) {
    await runRetire();
    return;
  }
  if (CFG.financial) {
    await runFinancial();
    if (CFG.intervalMinutes > 0) {
      log(`financial: looping every ${CFG.intervalMinutes} min (Ctrl-C to stop)`);
      while (true) {
        await sleep(CFG.intervalMinutes * 60_000);
        try {
          await runFinancial();
        } catch (e) {
          log(`financial cycle error (will retry next interval): ${e.message}`);
        }
      }
    }
    return;
  }
  if (CFG.roster) {
    await runRoster();
    if (CFG.intervalMinutes > 0) {
      log(`roster: looping every ${CFG.intervalMinutes} min (Ctrl-C to stop)`);
      while (true) {
        await sleep(CFG.intervalMinutes * 60_000);
        try {
          await runRoster();
        } catch (e) {
          log(`roster cycle error (will retry next interval): ${e.message}`);
        }
      }
    }
    return;
  }
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
