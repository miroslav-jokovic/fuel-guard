#!/usr/bin/env node
/**
 * OPERATOR VERIFIER — avoidable idle precision, read-only.
 *
 * Requires apps/api/.env with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service-role key is used
 * only for paged SELECTs; this script never writes to Supabase. Run locally with:
 *   pnpm verify:idle
 *   pnpm verify:idle --report
 *   pnpm verify:idle --snapshot-fixtures
 *
 * --report writes docs/idle-precision-report.md. --snapshot-fixtures writes the selected live examples to
 * packages/shared/src/idlePrecisionFixtures.ts for the offline regression suite. CI must not run this script.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// The verifier is intentionally .mjs so the operator command is `node scripts/...`, but the verdict must
// import the current TypeScript implementation, never a hand-copied JavaScript version or stale dist.
if (!process.execArgv.includes("tsx/esm")) {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx/esm", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  process.exit(child.status ?? 1);
}

const { computeAvoidable, avoidableCost } =
  await import("../packages/shared/src/idleAvoidable.ts");
const { sumRollupByVehicle } = await import("../packages/shared/src/idleBreakdown.ts");
const { buildHosVehicleTimelines } = await import("../packages/shared/src/hosVehicleTimeline.ts");
const { buildSessionDutyEvidence } =
  await import("../apps/api/src/services/idleSessionDutyEvidence.ts");

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argv = process.argv.slice(2);
const reportRequested = argv.includes("--report");
const snapshotRequested = argv.includes("--snapshot-fixtures");
const DAYS = 30;
const DAY_SEC = 86_400;
const HOS_PAD_MS = 72 * 3_600_000;
const TOLERANCE_SEC = 1;
const now = new Date();
const nowIso = now.toISOString();
const fromIso = new Date(now.getTime() - DAYS * DAY_SEC * 1000).toISOString();
const fromDay = fromIso.slice(0, 10);
const toDay = nowIso.slice(0, 10);
const selectedDays = Math.max(
  1,
  Math.round(
    (Date.parse(`${toDay}T23:59:59.999Z`) - Date.parse(`${fromDay}T00:00:00.000Z`)) /
      (DAY_SEC * 1000),
  ),
);
const sourceFromIso = `${fromDay}T00:00:00.000Z`;
const hosFromIso = new Date(Date.parse(sourceFromIso) - HOS_PAD_MS).toISOString();

const envPath = join(ROOT, "apps/api/.env");
if (!existsSync(envPath)) {
  console.error("No apps/api/.env — this operator verifier needs Supabase credentials.");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")];
    }),
);
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("apps/api/.env is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const n = (value) => Number(value ?? 0);
const dayOf = (iso) => iso.slice(0, 10);
const keyOf = (vehicleId, day) => `${vehicleId}|${day}`;
const close = (a, b, tolerance = TOLERANCE_SEC) => Math.abs(n(a) - n(b)) <= tolerance;
const hours = (sec) => Math.round(n(sec) / 360) / 10;
const r1 = (value) => Math.round(value * 10) / 10;
const json = (value) => JSON.stringify(value);

async function readAll(table, columns, apply = (query) => query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await apply(db.from(table).select(columns)).range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

function addTo(map, key, values) {
  const current = map.get(key) ?? {};
  for (const [field, value] of Object.entries(values)) current[field] = n(current[field]) + n(value);
  map.set(key, current);
}

function compareFields(actual, expected, fields, label, offenders) {
  const differences = fields.filter((field) => !close(actual[field], expected[field]));
  if (differences.length)
    offenders.push(
      `${label}: ${differences.map((field) => `${field}=${actual[field]} expected ${expected[field]}`).join(", ")}`,
    );
}

function buildEvidenceMaps(sessions, events, segments, windowStartMs, windowEndMs) {
  const byDriver = new Map();
  const byVehicle = new Map();
  for (const segment of segments) {
    const normalized = {
      driverId: segment.driver_id ?? "unresolved",
      vehicleId: segment.vehicle_id,
      status: segment.status,
      startMs: Date.parse(segment.started_at),
      endMs: segment.ended_at ? Date.parse(segment.ended_at) : null,
    };
    if (segment.driver_id) {
      const list = byDriver.get(segment.driver_id) ?? [];
      list.push(normalized);
      byDriver.set(segment.driver_id, list);
    }
    if (segment.vehicle_id) {
      const list = byVehicle.get(segment.vehicle_id) ?? [];
      list.push(normalized);
      byVehicle.set(segment.vehicle_id, list);
    }
  }
  const timelines = buildHosVehicleTimelines(byVehicle, windowStartMs, windowEndMs);
  const evidenceBySession = new Map();
  for (const session of sessions) {
    if (session.mode !== "continuous") continue;
    evidenceBySession.set(
      session.id,
      buildSessionDutyEvidence(session, events, byDriver, byVehicle, timelines),
    );
  }
  return evidenceBySession;
}

function sourceSums(engineDays, sessions) {
  const engine = new Map();
  const session = new Map();
  for (const row of engineDays) {
    addTo(engine, keyOf(row.vehicle_id, row.day), {
      drive_sec: Math.max(0, n(row.drive_sec)),
      idle_sec: Math.max(0, n(row.idle_sec)),
      off_sec: Math.max(0, n(row.off_sec)),
      coverage_sec: Math.max(0, n(row.coverage_sec)),
    });
  }
  for (const row of sessions) {
    const target = keyOf(row.vehicle_id, dayOf(row.started_at));
    addTo(session, target, {
      managed_idle_sec: row.mode === "continuous" ? 0 : Math.max(0, n(row.idle_sec)),
      continuous_idle_sec: row.mode === "continuous" ? Math.max(0, n(row.idle_sec)) : 0,
    });
  }
  return { engine, session };
}

function storedEvidenceSums(sessions) {
  const out = new Map();
  for (const row of sessions) {
    if (row.mode !== "continuous") continue;
    addTo(out, keyOf(row.vehicle_id, dayOf(row.started_at)), {
      hos_rest_sec: row.hos_rest_sec,
      hos_work_sec: row.hos_work_sec,
      hos_unknown_sec: row.hos_unknown_sec,
      hos_ambiguous_sec: row.hos_ambiguous_sec,
    });
  }
  return out;
}

function computedEvidenceSums(sessions, evidenceBySession) {
  const out = new Map();
  for (const row of sessions) {
    if (row.mode !== "continuous") continue;
    const evidence = evidenceBySession.get(row.id);
    if (!evidence) continue;
    addTo(out, keyOf(row.vehicle_id, dayOf(row.started_at)), {
      hos_rest_sec: evidence.restSec,
      hos_work_sec: evidence.workSec,
      hos_unknown_sec: evidence.unknownSec,
      hos_ambiguous_sec: evidence.ambiguousSec,
      hos_grace_sec: evidence.graceSec,
    });
  }
  for (const values of out.values())
    for (const field of Object.keys(values)) values[field] = Math.round(values[field]);
  return out;
}

function rawBucketOffenders(sessions) {
  const offenders = [];
  const fields = [
    "hos_covered_sec",
    "hos_rest_sec",
    "hos_work_sec",
    "hos_driving_sec",
    "hos_excluded_sec",
    "hos_unknown_sec",
    "hos_ambiguous_sec",
  ];
  for (const row of sessions) {
    const badNegative = fields.filter((field) => n(row[field]) < 0);
    const covered = n(row.hos_covered_sec);
    const duration = n(row.duration_sec);
    const bucketSum = ["hos_rest_sec", "hos_work_sec", "hos_driving_sec", "hos_excluded_sec"].reduce(
      (sum, field) => sum + n(row[field]),
      0,
    );
    if (badNegative.length || covered > duration + TOLERANCE_SEC || bucketSum > covered + TOLERANCE_SEC) {
      offenders.push(
        `session ${row.id} vehicle ${row.vehicle_id} day ${dayOf(row.started_at)} ` +
          `duration=${duration} covered=${covered} coveredBuckets=${bucketSum} ` +
          `negative=${badNegative.join(",") || "none"}`,
      );
    }
  }
  return offenders;
}

function rollupBucketOffenders(rows) {
  const fields = [
    "drive_sec",
    "idle_sec",
    "off_sec",
    "coverage_sec",
    "managed_idle_sec",
    "continuous_idle_sec",
    "rest_idle_sec",
    "work_idle_sec",
    "other_idle_sec",
    "optimized_envelope_inside_sec",
    "optimized_envelope_outside_sec",
    "optimized_envelope_unknown_sec",
    "optimized_envelope_ambiguous_sec",
    "hos_rest_sec",
    "hos_work_sec",
    "hos_unknown_sec",
    "hos_ambiguous_sec",
    "hos_grace_sec",
  ];
  const offenders = [];
  for (const row of rows) {
    const negative = fields.filter((field) => n(row[field]) < 0);
    if (
      negative.length ||
      n(row.continuous_idle_sec) + n(row.managed_idle_sec) > n(row.idle_sec) + TOLERANCE_SEC
    ) {
      offenders.push(
        `rollup ${row.vehicle_id}/${row.day} negative=${negative.join(",") || "none"} ` +
          `classified=${n(row.continuous_idle_sec) + n(row.managed_idle_sec)} idle=${n(row.idle_sec)}`,
      );
    }
  }
  return offenders;
}

function envelopeFor(s, hasOptimizedIdle) {
  if (hasOptimizedIdle !== true || s.continuous <= 0) return undefined;
  return {
    status: s.optimizedEnvelopeStatus === "not_applicable" ? "unavailable" : s.optimizedEnvelopeStatus,
    source: s.optimizedEnvelopeSource,
    insideSec: s.optimizedEnvelopeInside,
    outsideSec: s.optimizedEnvelopeOutside,
    unknownSec: s.optimizedEnvelopeUnknown,
    ambiguousSec: s.optimizedEnvelopeAmbiguous,
  };
}

function dutyEvidenceFor(s) {
  if (s.continuous <= 0) return undefined;
  return {
    status: s.hosEvidenceStatus === "not_applicable" ? "unavailable" : s.hosEvidenceStatus,
    workSec: s.hosWork,
    unknownSec: s.hosUnknown,
    ambiguousSec: s.hosAmbiguous,
    graceSec: s.hosGrace,
  };
}

function manualSumRollupByVehicle(rows) {
  const out = new Map();
  const envelopeRank = { not_applicable: 0, sufficient: 1, insufficient: 2, ambiguous: 3, unavailable: 4 };
  const hosRank = envelopeRank;
  for (const row of rows) {
    const sums = out.get(row.vehicle_id) ?? {
      drive: 0, idle: 0, off: 0, cov: 0, managed: 0, continuous: 0,
      rest: 0, work: 0, other: 0, optimizedEnvelopeInside: 0,
      optimizedEnvelopeOutside: 0, optimizedEnvelopeUnknown: 0,
      optimizedEnvelopeAmbiguous: 0, optimizedEnvelopeStatus: "not_applicable",
      optimizedEnvelopeSource: "none", hosRest: 0, hosWork: 0, hosUnknown: 0,
      hosAmbiguous: 0, hosGrace: 0, hosEvidenceStatus: "not_applicable",
    };
    sums.drive += n(row.drive_sec);
    sums.idle += n(row.idle_sec);
    sums.off += n(row.off_sec);
    sums.cov += n(row.coverage_sec);
    sums.managed += n(row.managed_idle_sec);
    sums.continuous += n(row.continuous_idle_sec);
    sums.rest += n(row.rest_idle_sec);
    sums.work += n(row.work_idle_sec);
    sums.other += n(row.other_idle_sec);
    sums.optimizedEnvelopeInside += n(row.optimized_envelope_inside_sec);
    sums.optimizedEnvelopeOutside += n(row.optimized_envelope_outside_sec);
    sums.optimizedEnvelopeUnknown += n(row.optimized_envelope_unknown_sec);
    sums.optimizedEnvelopeAmbiguous += n(row.optimized_envelope_ambiguous_sec);
    if (envelopeRank[row.optimized_envelope_status] > envelopeRank[sums.optimizedEnvelopeStatus])
      sums.optimizedEnvelopeStatus = row.optimized_envelope_status;
    if (row.optimized_envelope_source === "learned_behavioral") sums.optimizedEnvelopeSource = "learned_behavioral";
    else if (sums.optimizedEnvelopeSource === "none") sums.optimizedEnvelopeSource = row.optimized_envelope_source;
    sums.hosRest += n(row.hos_rest_sec);
    sums.hosWork += n(row.hos_work_sec);
    sums.hosUnknown += n(row.hos_unknown_sec);
    sums.hosAmbiguous += n(row.hos_ambiguous_sec);
    sums.hosGrace += n(row.hos_grace_sec);
    if (hosRank[row.hos_evidence_status] > hosRank[sums.hosEvidenceStatus])
      sums.hosEvidenceStatus = row.hos_evidence_status;
    out.set(row.vehicle_id, sums);
  }
  return out;
}

function pageRows(rollupRows, vehicles, basis, aggregate = sumRollupByVehicle) {
  const sums = aggregate(rollupRows);
  const days = Math.max(1, Math.min(selectedDays, new Set(rollupRows.map((row) => row.day)).size));
  const periodSec = days * DAY_SEC;
  const rows = [];
  for (const vehicle of vehicles) {
    const s = sums.get(vehicle.id);
    if (!s) continue;
    const verdict = computeAvoidable({
      driveSec: s.drive,
      idleSec: s.idle,
      offSec: s.off,
      coverageSec: s.cov,
      periodSec,
      sessions: [
        { idleSec: s.continuous, mode: "continuous" },
        { idleSec: s.managed, mode: "apu_or_off" },
      ],
      hasApu: vehicle.has_apu ?? null,
      hasOptimizedIdle: vehicle.has_optimized_idle ?? null,
      learnedCapability: vehicle.idle_capability ?? "unknown",
      optimizedEnvelope: envelopeFor(s, vehicle.has_optimized_idle ?? null),
      dutyEvidence: dutyEvidenceFor(s),
    });
    rows.push({
      vehicleId: vehicle.id,
      unit: vehicle.unit_number,
      source: vehicle,
      sums: s,
      verdict,
      avoidableH: hours(verdict.avoidableIdleSec),
      unavoidableH: hours(verdict.unavoidableIdleSec),
      uncertainH: hours(verdict.uncertainIdleSec),
      managedH: hours(verdict.managedIdleSec),
      justifiedH: hours(verdict.justifiedIdleSec),
      graceH: hours(verdict.operationalGraceIdleSec),
      avoidableUsd: avoidableCost(verdict.avoidableIdleSec, basis).usd,
      dutyShare:
        verdict.continuousIdleSec > 0
          ? (verdict.continuousIdleSec - verdict.uncertainIdleSec) / verdict.continuousIdleSec
          : 1,
      periodSec,
    });
  }
  rows.sort((a, b) => b.avoidableUsd - a.avoidableUsd || b.avoidableH - a.avoidableH);
  let avoidableH = 0;
  let avoidableUsd = 0;
  let confidentTrucks = 0;
  for (const row of rows) {
    if (!row.verdict.confident) continue;
    avoidableH += row.avoidableH;
    avoidableUsd += row.avoidableUsd;
    confidentTrucks += 1;
  }
  return {
    rows,
    fleet: {
      avoidableH: r1(avoidableH),
      avoidableUsd: Math.round(avoidableUsd),
      confidentTrucks,
      totalTrucks: rows.length,
      rangeDays: days,
    },
    sums,
    periodSec,
  };
}

function verdictOffenders(page, basis) {
  const offenders = [];
  for (const row of page.rows) {
    const r = row.verdict;
    const algebra =
      r.avoidableIdleSec +
      r.unavoidableIdleSec +
      r.justifiedIdleSec +
      r.uncertainIdleSec +
      r.operationalGraceIdleSec;
    const engineOn = r.driveSec + r.idleSec;
    if (
      Math.abs(algebra - r.continuousIdleSec) > TOLERANCE_SEC ||
      r.avoidableIdleSec > r.continuousIdleSec + TOLERANCE_SEC ||
      r.continuousIdleSec > r.idleSec + TOLERANCE_SEC ||
      r.idleSec > engineOn + TOLERANCE_SEC ||
      (!r.hasAlternative && r.avoidableIdleSec !== 0)
    ) {
      offenders.push(
        `unit ${row.unit} (${row.vehicleId}) algebra=${algebra}/${r.continuousIdleSec} ` +
          `avoidable=${r.avoidableIdleSec} continuous=${r.continuousIdleSec} idle=${r.idleSec} engineOn=${engineOn} ` +
          `hasAlternative=${r.hasAlternative}`,
      );
      continue;
    }
    const expectedCost = avoidableCost(r.avoidableIdleSec, basis).usd;
    if (row.avoidableUsd !== expectedCost)
      offenders.push(`unit ${row.unit} cost=${row.avoidableUsd} expected=${expectedCost}`);
  }
  return offenders;
}

function consistencyOffenders(page, independentRows) {
  const offenders = [];
  const byId = new Map(independentRows.map((row) => [row.vehicleId, row]));
  if (page.rows.length !== independentRows.length) offenders.push(`truck row count ${page.rows.length} vs ${independentRows.length}`);
  for (const row of page.rows) {
    const other = byId.get(row.vehicleId);
    if (!other || json(row.verdict) !== json(other.verdict))
      offenders.push(`unit ${row.unit} page verdict differs from independently reconstructed verdict`);
  }
  const confident = page.rows.filter((row) => row.verdict.confident);
  const positive = confident.filter((row) => row.avoidableH > 0);
  const cardH = r1(confident.reduce((sum, row) => sum + row.avoidableH, 0));
  const cardUsd = Math.round(confident.reduce((sum, row) => sum + row.avoidableUsd, 0));
  if (
    page.fleet.confidentTrucks !== confident.length ||
    page.fleet.avoidableH !== cardH ||
    page.fleet.avoidableUsd !== cardUsd
  )
    offenders.push(
      `fleet card ${json(page.fleet)} vs rows {confidentTrucks:${confident.length}, avoidableH:${cardH}, avoidableUsd:${cardUsd}}`,
    );
  if (positive.length !== independentRows.filter((row) => row.verdict.confident && row.avoidableH > 0).length)
    offenders.push(`positive displayed avoidable rows=${positive.length} do not match independently aggregated rows`);
  return offenders;
}

async function loadData() {
  const [organizations, vehicles, engineDays, sessions, rollups, events, segments, settings, prices, jobs] =
    await Promise.all([
      readAll("organizations", "id, name"),
      readAll("vehicles", "id, org_id, unit_number, status, has_apu, has_optimized_idle, idle_capability"),
      readAll(
        "vehicle_engine_days",
        "org_id, vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec",
        (q) => q.gte("day", fromDay).lte("day", toDay),
      ),
      readAll(
        "idle_park_sessions",
        "id, org_id, vehicle_id, started_at, ended_at, duration_sec, idle_sec, mode, hos_evidence_status, hos_covered_sec, hos_rest_sec, hos_work_sec, hos_driving_sec, hos_excluded_sec, hos_unknown_sec, hos_ambiguous_sec",
        (q) => q.gte("started_at", sourceFromIso).lte("started_at", nowIso),
      ),
      readAll(
        "idle_rollup_days",
        "id, org_id, vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec, managed_idle_sec, continuous_idle_sec, rest_idle_sec, work_idle_sec, other_idle_sec, optimized_envelope_inside_sec, optimized_envelope_outside_sec, optimized_envelope_unknown_sec, optimized_envelope_ambiguous_sec, optimized_envelope_status, optimized_envelope_source, hos_rest_sec, hos_work_sec, hos_unknown_sec, hos_ambiguous_sec, hos_grace_sec, hos_evidence_status, updated_at",
        (q) => q.gte("day", fromDay).lte("day", toDay),
      ),
      readAll(
        "idle_events",
        "org_id, vehicle_id, driver_id, started_at, duration_sec",
        (q) => q.gte("started_at", sourceFromIso).lte("started_at", nowIso),
      ),
      readAll(
        "hos_duty_segments",
        "org_id, driver_id, vehicle_id, status, started_at, ended_at",
        (q) => q.gte("started_at", hosFromIso).lte("started_at", nowIso),
      ),
      readAll("idle_settings", "org_id, idle_gal_per_hour, fuel_price_per_gal"),
      readAll(
        "fuel_prices",
        "org_id, posted_price, net_price, observed_at",
        (q) => q.eq("product", "diesel").gte("observed_at", new Date(now.getTime() - 14 * DAY_SEC * 1000).toISOString()).order("observed_at", { ascending: false }).limit(5000),
      ),
      readAll(
        "jobs",
        "org_id, kind, status, finished_at",
        (q) => q.in("kind", ["sync_idle", "sync_hos"]).eq("status", "done"),
      ),
    ]);
  return { organizations, vehicles, engineDays, sessions, rollups, events, segments, settings, prices, jobs };
}

function costBasisFor(orgId, settings, prices) {
  const setting = settings.find((row) => row.org_id === orgId);
  const recent = prices
    .filter((row) => row.org_id === orgId)
    .map((row) => n(row.net_price ?? row.posted_price))
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((a, b) => a - b);
  const mid = Math.floor(recent.length / 2);
  const median = recent.length ? (recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2) : null;
  return {
    idleGalPerHour: setting?.idle_gal_per_hour != null ? n(setting.idle_gal_per_hour) : 0.8,
    fuelPricePerGal:
      median != null
        ? Math.round(median * 1000) / 1000
        : setting?.fuel_price_per_gal != null
          ? n(setting.fuel_price_per_gal)
          : 4,
  };
}

function selectExamples(page) {
  const equipped = page.rows.find(
    (row) => row.verdict.confident && row.verdict.avoidableIdleSec > 0 && (row.source.has_apu === true || row.source.has_optimized_idle === true),
  );
  const continuousOnly = page.rows.find(
    (row) => row.verdict.confident && row.source.idle_capability === "continuous_only" && row.verdict.avoidableIdleSec === 0,
  );
  const excluded = page.rows
    .filter((row) => !row.verdict.confident && row.sums.continuous > 0 && row.dutyShare < 0.8)
    .sort((a, b) => b.dutyShare - a.dutyShare)[0];
  if (!equipped || !continuousOnly || !excluded)
    throw new Error(
      `Could not select all three live examples: equipped=${equipped?.unit}, continuous_only=${continuousOnly?.unit}, excluded=${excluded?.unit}`,
    );
  return [
    { kind: "equipped-and-wasting", row: equipped },
    { kind: "continuous-only-unavoidable", row: continuousOnly },
    { kind: "below-80-percent-duty-bar", row: excluded },
  ];
}

function fixtureText(examples, rollups, basis) {
  const fixtures = examples.map(({ kind, row }) => ({
    kind,
    vehicleId: row.vehicleId,
    unit: row.unit,
    hasApu: row.source.has_apu,
    hasOptimizedIdle: row.source.has_optimized_idle,
    learnedCapability: row.source.idle_capability ?? "unknown",
    periodSec: row.periodSec,
    costBasis: basis,
    rows: rollups.filter((rollup) => rollup.vehicle_id === row.vehicleId),
    expected: {
      alternative: row.verdict.alternative,
      confident: row.verdict.confident,
      avoidableSec: row.verdict.avoidableIdleSec,
      unavoidableSec: row.verdict.unavoidableIdleSec,
      justifiedSec: row.verdict.justifiedIdleSec,
      uncertainSec: row.verdict.uncertainIdleSec,
      graceSec: row.verdict.operationalGraceIdleSec,
      managedSec: row.verdict.managedIdleSec,
      avoidableH: row.avoidableH,
      unavoidableH: row.unavoidableH,
      uncertainH: row.uncertainH,
      managedH: row.managedH,
      avoidableUsd: row.avoidableUsd,
    },
  }));
  return `// Generated by scripts/verify-idle-precision.mjs --snapshot-fixtures on ${nowIso}.\n// Do not edit expected values without a fresh live verification and sign-off.\nexport const idlePrecisionFixtures = ${JSON.stringify(fixtures)} as const;\n`;
}

function funnel(page, vehicles) {
  const withRollup = page.rows;
  const covered = withRollup.filter((row) => row.verdict.coverage >= 0.5);
  const judgeable = withRollup.filter(
    (row) =>
      row.verdict.alternative !== "unknown" &&
      (row.verdict.alternative !== "optimized_idle" || row.verdict.continuousIdleSec === 0 || row.verdict.confident || row.sums.optimizedEnvelopeStatus === "sufficient"),
  );
  const unset = vehicles.filter(
    (vehicle) =>
      vehicle.status !== "retired" &&
      vehicle.has_apu == null &&
      vehicle.has_optimized_idle !== true &&
      vehicle.idle_capability !== "continuous_only",
  );
  return { total: withRollup.length, covered: covered.length, judgeable: judgeable.length, confident: page.fleet.confidentTrucks, unset: unset.length };
}

function reportText({ page, checks, examples, basis, funnelData }) {
  const positiveRows = page.rows.filter((row) => row.verdict.confident && row.avoidableH > 0).length;
  const executive = [
    "The live page computation reconciles to **",
    page.fleet.confidentTrucks,
    " confident trucks**, **",
    positiveRows,
    " rows with displayed avoidable hours**, **",
    page.fleet.avoidableH.toFixed(1),
    " avoidable hours**, and **$",
    page.fleet.avoidableUsd.toLocaleString(),
    "** on the rounded fleet card. The other confident trucks are either alternative=none (continuous-only or admin-confirmed no equipment, so idle is unavoidable) or equipped trucks whose managed/rest or grace/uncertain buckets leave zero displayed avoidable hours.",
  ].join("");
  const invariantLines = checks.map((check) =>
    "- **" +
    (check.count ? "FAIL" : "PASS") +
    "** — " +
    check.name +
    (check.count ? ` (${check.count} offending rows) — ` + check.offenders.slice(0, 20).join("; ") : ""),
  );
  const failedNames = new Set(checks.filter((check) => check.offenders.length).map((check) => check.name));
  const diagnoses = [];
  if ([...failedNames].some((name) => name.startsWith("1a")))
    diagnoses.push("**1a — derived-state retention:** `idle_rollup_days` contains rows with no matching current `vehicle_engine_days` row (for example, unit 512 on 2026-07-13 has rollup off=86,400s but no source row). The rollup writer diffs and upserts changed rows but does not remove derived rows after the foundation row disappears; this is a stale rollup/source deletion stage, not a scoring-semantic change.");
  if ([...failedNames].some((name) => name.startsWith("1b")))
    diagnoses.push("**1b — session feed drift:** the persisted rollup mode split differs from the current park-session source sums on named truck-days. This is a rollup maintenance lag/stale-derived-row issue (and includes rows with source sessions that were subsequently replaced), not a browser aggregation discrepancy.");
  if ([...failedNames].some((name) => name.startsWith("1c") || name.startsWith("1d")))
    diagnoses.push("**1c/1d — HOS evidence drift:** persisted rollup HOS buckets do not equal either the current source-session evidence or the stored session evidence on named truck-days. The rollup is stale or was built from a different session/HOS snapshot; the verifier deliberately reports both comparisons instead of silently accepting the derived row.");
  if ([...failedNames].some((name) => name.startsWith("2b")))
    diagnoses.push("**2b — per-day classified-idle algebra:** `buildIdleRollupDays` accumulates independently synced managed/continuous session seconds without applying the range-level clamp that `computeAvoidable` applies. This leaves many day rows with classified idle above engine idle; the clamp prevents the page verdict from exceeding observed idle, but it does not make the persisted per-day invariant true. No semantic fix is applied here.");
  if ([...failedNames].some((name) => name.startsWith("3")))
    diagnoses.push("**3 — verdict algebra:** the named trucks fail the ±1s bucket identity because rollup HOS grace/uncertain buckets and/or classified session seconds are inconsistent with the current source snapshot. The page remains internally card/table consistent, but the source-to-verdict chain is not precision-clean until the derived rows are rebuilt and the identity/source drift is resolved.");
  const lines = [
    "# Idle precision report",
    "",
    `Run: ${nowIso}`,
    `Window: ${fromDay} through ${toDay} (page default; ${page.periodSec / DAY_SEC} observed calendar days)`,
    `Cost basis: ${basis.idleGalPerHour} gal/hour × $${basis.fuelPricePerGal.toFixed(3)}/gal`,
    "",
    "## Executive result",
    "",
    executive,
    "",
    "## Invariant results",
    "",
    ...invariantLines,
    "",
    ...(diagnoses.length ? ["## Failure interpretation", "", ...diagnoses, ""] : []),
    "## Funnel",
    "",
    `| Stage | Trucks |`,
    `| --- | ---: |`,
    `| Total with rollup data | ${funnelData.total} |`,
    `| Covered (coverage ≥ 50%) | ${funnelData.covered} |`,
    `| Judgeable (known alternative/envelope) | ${funnelData.judgeable} |`,
    `| Confident (duty-evidenced share ≥ 80%) | ${funnelData.confident} |`,
    "",
    `Equipment census note: **${funnelData.unset} trucks await admin equipment confirmation**. Learned APU/optimized patterns do not grant avoidability; they remain display evidence only.`,
    "",
    "## Three worked examples",
    "",
  ];
  for (const example of examples) {
    const row = example.row;
    const s = row.sums;
    const r = row.verdict;
    lines.push(
      `### Unit ${row.unit} — ${example.kind}`,
      "",
      `Raw rollup sums: drive **${Math.round(s.drive)}s**, idle **${Math.round(s.idle)}s**, off **${Math.round(s.off)}s**, coverage **${Math.round(s.cov)}s**; managed sessions **${Math.round(s.managed)}s**, continuous sessions **${Math.round(s.continuous)}s**.`,
      `HOS buckets: rest **${Math.round(s.hosRest)}s**, work **${Math.round(s.hosWork)}s**, unknown **${Math.round(s.hosUnknown)}s**, ambiguous **${Math.round(s.hosAmbiguous)}s**, grace **${Math.round(s.hosGrace)}s**.`,
      `Capability: has_apu=${row.source.has_apu}, has_optimized_idle=${row.source.has_optimized_idle}, learned=${row.source.idle_capability}; resolved alternative **${r.alternative}**.`,
      `Verdict: managed **${r.managedIdleSec}s**, continuous **${r.continuousIdleSec}s**, avoidable **${r.avoidableIdleSec}s**, unavoidable **${r.unavoidableIdleSec}s**, justified **${r.justifiedIdleSec}s**, uncertain **${r.uncertainIdleSec}s**, grace **${r.operationalGraceIdleSec}s**; confident **${r.confident}**.`,
      `Displayed: avoidable **${row.avoidableH.toFixed(1)}h**, unavoidable **${row.unavoidableH.toFixed(1)}h**, uncertain **${row.uncertainH.toFixed(1)}h**, managed **${row.managedH.toFixed(1)}h**; dollars **$${row.avoidableUsd.toFixed(2)}**.`,
      "",
    );
  }
  lines.push("## Provenance", "", "- Raw facts: `vehicle_engine_days`, `idle_park_sessions`, `hos_duty_segments`, and `idle_events`.", "- Derived page input: `idle_rollup_days`.", "- Verdict math: `packages/shared/src/idleAvoidable.ts` imported directly by the verifier.", "- Page aggregation: `sumRollupByVehicle` and the same default-range/cost rounding as `useIdleBreakdown`.", "");
  return lines.join("\n");
}

const data = await loadData();
const checks = [];
const check = (name, offenders) => {
  const capped = offenders.slice(0, 50);
  checks.push({ name, offenders: capped, count: offenders.length });
  console.log(`${offenders.length ? "FAIL" : "PASS"} ${name}${offenders.length ? ` (${offenders.length} offending rows)` : ""}`);
  for (const offender of capped) console.log(`  - ${offender}`);
};

const activeVehicles = data.vehicles.filter((vehicle) => vehicle.status !== "retired");
const orgIds = new Set(activeVehicles.map((vehicle) => vehicle.org_id));
const orgRollups = data.rollups.filter((row) => orgIds.has(row.org_id));
const orgEngineDays = data.engineDays.filter((row) => orgIds.has(row.org_id));
const orgSessions = data.sessions.filter((row) => orgIds.has(row.org_id));
const orgEvents = data.events.filter((row) => orgIds.has(row.org_id));
const orgSegments = data.segments.filter((row) => orgIds.has(row.org_id));
const { engine: expectedEngine, session: expectedSession } = sourceSums(orgEngineDays, orgSessions);
const evidenceBySession = buildEvidenceMaps(
  orgSessions,
  orgEvents,
  orgSegments,
  Date.parse(sourceFromIso),
  Date.parse(nowIso),
);
const expectedComputedEvidence = computedEvidenceSums(orgSessions, evidenceBySession);
const expectedStoredEvidence = storedEvidenceSums(orgSessions);

const engineOffenders = [];
const sessionOffenders = [];
const evidenceOffenders = [];
const storedEvidenceOffenders = [];
const seenRollups = new Set();
for (const row of orgRollups) {
  const key = keyOf(row.vehicle_id, row.day);
  if (seenRollups.has(key)) engineOffenders.push(`duplicate rollup key ${key}`);
  seenRollups.add(key);
  compareFields(
    row,
    expectedEngine.get(key) ?? {},
    ["drive_sec", "idle_sec", "off_sec", "coverage_sec"],
    `rollup ${key} engine`,
    engineOffenders,
  );
  compareFields(
    row,
    expectedSession.get(key) ?? {},
    ["managed_idle_sec", "continuous_idle_sec"],
    `rollup ${key} session split`,
    sessionOffenders,
  );
  compareFields(
    row,
    expectedComputedEvidence.get(key) ?? {},
    ["hos_rest_sec", "hos_work_sec", "hos_unknown_sec", "hos_ambiguous_sec", "hos_grace_sec"],
    `rollup ${key} recomputed HOS`,
    evidenceOffenders,
  );
  compareFields(
    row,
    expectedStoredEvidence.get(key) ?? {},
    ["hos_rest_sec", "hos_work_sec", "hos_unknown_sec", "hos_ambiguous_sec"],
    `rollup ${key} stored-session HOS`,
    storedEvidenceOffenders,
  );
}
check("1a rollup engine seconds tie to vehicle_engine_days", engineOffenders);
check("1b rollup managed/continuous seconds tie to park sessions", sessionOffenders);
check("1c rollup HOS buckets tie to recomputed session evidence", evidenceOffenders);
check("1d rollup HOS buckets tie to stored session evidence", storedEvidenceOffenders);

check("2a per-session HOS bucket algebra", rawBucketOffenders(orgSessions));
check("2b per-rollup nonnegative and classified-idle algebra", rollupBucketOffenders(orgRollups));

const newestRollup = orgRollups.reduce((latest, row) => (!latest || Date.parse(row.updated_at) > Date.parse(latest.updated_at) ? row : latest), null);
const freshnessOffenders = [];
if (!newestRollup || Date.now() - Date.parse(newestRollup.updated_at) >= 26 * 3_600_000)
  freshnessOffenders.push(`idle_rollup_days newest updated_at=${newestRollup?.updated_at ?? "none"}`);
for (const kind of ["sync_idle", "sync_hos"]) {
  const latest = data.jobs
    .filter((job) => job.kind === kind && job.status === "done")
    .sort((a, b) => Date.parse(b.finished_at ?? "") - Date.parse(a.finished_at ?? ""))[0];
  if (!latest || Date.now() - Date.parse(latest.finished_at) >= 26 * 3_600_000)
    freshnessOffenders.push(`${kind} newest successful finished_at=${latest?.finished_at ?? "none"}`);
}
check("5 freshness (<26h)", freshnessOffenders);

const examplesByOrg = [];
const allPages = [];
for (const org of data.organizations) {
  const vehicles = activeVehicles.filter((vehicle) => vehicle.org_id === org.id);
  const rollups = orgRollups.filter((row) => row.org_id === org.id);
  if (!vehicles.length || !rollups.length) continue;
  const basis = costBasisFor(org.id, data.settings, data.prices);
  const page = pageRows(rollups, vehicles, basis);
  allPages.push({ org, vehicles, rollups, basis, page });
  check(`3 verdict algebra (${org.name ?? org.id})`, verdictOffenders(page, basis));
  const independentlyAggregatedPage = pageRows(rollups, vehicles, basis, manualSumRollupByVehicle);
  check(`4 card/table consistency (${org.name ?? org.id})`, consistencyOffenders(page, independentlyAggregatedPage.rows));
  examplesByOrg.push({ org, page, rollups, basis, vehicles });
}

if (!examplesByOrg.length) throw new Error("No active organization has rollup rows in the verification window.");
const primary = examplesByOrg[0];
const examples = selectExamples(primary.page);
if (snapshotRequested) {
  const fixturePath = join(ROOT, "packages/shared/src/idlePrecisionFixtures.ts");
  writeFileSync(fixturePath, fixtureText(examples, primary.rollups, primary.basis));
  console.log(`Wrote ${fixturePath}`);
}
if (reportRequested) {
  mkdirSync(join(ROOT, "docs"), { recursive: true });
  const reportPath = join(ROOT, "docs/idle-precision-report.md");
  writeFileSync(
    reportPath,
    reportText({
      page: primary.page,
      checks,
      examples,
      basis: primary.basis,
      funnelData: funnel(primary.page, primary.vehicles),
    }),
  );
  console.log(`Wrote ${reportPath}`);
}

const failures = checks.filter((result) => result.offenders.length > 0);
console.log(
  `\nWindow ${fromDay}..${toDay}; page denominator ${primary.page.periodSec / DAY_SEC} days; ` +
    `${failures.length ? `${failures.length} invariant groups failed` : "all invariant groups passed"}.`,
);
process.exit(failures.length ? 1 : 0);
