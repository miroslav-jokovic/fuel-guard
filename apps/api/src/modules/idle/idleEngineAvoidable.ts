/**
 * The idle engine's avoidable idling for a range of days (IE3, D-IE4) — the first reader of 0407.
 *
 * Parks are read as measured (`idle_engine_stops`); each is judged by `idleStopVerdict` against its
 * truck's DECLARED equipment (IE1, `declaredEquipment`) and the org's `idle_settings`; the totals are
 * folded by `idleAvoidableTotals`. Nothing is stored: the verdict is a function of today's settings
 * and declarations over yesterday's measurements (`sql-returns-measurement-ts-owns-verdict`).
 *
 * ── WHICH PARKS A RANGE HOLDS ───────────────────────────────────────────────────────────────────
 * A park belongs to the local day it STARTED on, whole. Cutting a ten-hour overnight park at
 * midnight would halve its Q-IE3 allowance on each side (the allowance is a share of the park's own
 * duration) and turn one park into two verdicts nobody parked. An open park (still parked now) is
 * counted as far as it has been measured.
 *
 * ── MONEY ───────────────────────────────────────────────────────────────────────────────────────
 * Hours become gallons and dollars on `resolveIdleCostBasis` — the Idling page's own burn rate and
 * price, so the two never price an idle hour differently. The learned burn rate is IE4 (D-IE5).
 *
 * ORG-FILTERED explicitly: the service role bypasses RLS, so every `.eq("org_id")` here IS the tenant
 * boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_IDLE_AVOIDABLE_SETTINGS,
  declaredEquipment,
  idleAvoidableTotals,
  idleStopVerdict,
  organizationTimezone,
  zonedWallTimeToUtcIso,
  type DeclaredEquipment,
  type IdleAvoidableSettings,
  type IdleAvoidableTotals,
  type IdleStopMeasure,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";
import { resolveIdleCostBasis } from "./idleCostBasis.js";

interface StopRow {
  vehicle_id: string;
  duration_sec: number;
  running_sec: number;
  running_rest_sec: number | null;
  running_on_duty_sec: number | null;
  running_excluded_sec: number | null;
  running_unknown_sec: number | null;
  ambient_milli_c: number | null;
}

interface VehicleRow {
  id: string;
  unit_number: string;
  has_apu: boolean | null;
  apu_type: string | null;
}

export interface IdleEngineMoney {
  galPerHour: number;
  pricePerGal: number;
  avoidableGallons: number;
  avoidableUsd: number;
  equipmentOpportunityGallons: number;
  equipmentOpportunityUsd: number;
}

export interface IdleEngineTruckAvoidable {
  vehicleId: string;
  unit: string;
  equipment: DeclaredEquipment;
  totals: IdleAvoidableTotals;
}

export interface IdleEngineAvoidable {
  from: string;
  to: string;
  timezone: string;
  settings: IdleAvoidableSettings;
  totals: IdleAvoidableTotals;
  money: IdleEngineMoney;
  /** Every truck with a park in the range, most avoidable first. */
  trucks: IdleEngineTruckAvoidable[];
}

const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function readIdleEngineAvoidable(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<IdleEngineAvoidable> {
  const [{ data: org }, { data: s }, basis] = await Promise.all([
    admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle(),
    admin.from("idle_settings").select("comfort_low_f, comfort_high_f").eq("org_id", orgId).maybeSingle(),
    resolveIdleCostBasis(admin, orgId),
  ]);
  const timezone = organizationTimezone(org?.operating_hours);
  const settings: IdleAvoidableSettings = {
    ...DEFAULT_IDLE_AVOIDABLE_SETTINGS,
    // Numerics arrive from PostgREST as strings.
    ...(s?.comfort_low_f != null ? { comfortLowF: Number(s.comfort_low_f) } : {}),
    ...(s?.comfort_high_f != null ? { comfortHighF: Number(s.comfort_high_f) } : {}),
  };
  const fromIso = zonedWallTimeToUtcIso(from, "00:00:00", timezone);
  const toIso = zonedWallTimeToUtcIso(nextDay(to), "00:00:00", timezone);

  const [stops, vehicles] = await Promise.all([
    fetchAllPaged<StopRow>((a, b) =>
      admin
        .from("idle_engine_stops")
        .select("vehicle_id, duration_sec, running_sec, running_rest_sec, running_on_duty_sec, running_excluded_sec, running_unknown_sec, ambient_milli_c")
        .eq("org_id", orgId)
        .gte("started_at", fromIso)
        .lt("started_at", toIso)
        .order("started_at")
        .order("vehicle_id")
        .range(a, b),
    ),
    fetchAllPaged<VehicleRow>((a, b) =>
      admin.from("vehicles").select("id, unit_number, has_apu, apu_type").eq("org_id", orgId).order("id").range(a, b),
    ),
  ]);
  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));

  type Judged = { stop: IdleStopMeasure; verdict: ReturnType<typeof idleStopVerdict> };
  const all: Judged[] = [];
  const byTruck = new Map<string, Judged[]>();
  for (const r of stops) {
    const v = vehicleById.get(r.vehicle_id);
    const equipment = declaredEquipment({ hasApu: v?.has_apu ?? null, apuType: v?.apu_type ?? null });
    const stop: IdleStopMeasure = {
      durationSec: r.duration_sec,
      runningSec: r.running_sec,
      runningRestSec: r.running_rest_sec,
      runningOnDutySec: r.running_on_duty_sec,
      runningExcludedSec: r.running_excluded_sec,
      runningUnknownSec: r.running_unknown_sec,
      ambientMilliC: r.ambient_milli_c,
    };
    const judged = { stop, verdict: idleStopVerdict(stop, equipment, settings) };
    all.push(judged);
    const list = byTruck.get(r.vehicle_id) ?? [];
    list.push(judged);
    byTruck.set(r.vehicle_id, list);
  }

  const totals = idleAvoidableTotals(all);
  const gallons = (sec: number) => r2((sec / 3600) * basis.idleGalPerHour);
  const avoidableGallons = gallons(totals.avoidableSec);
  const equipmentOpportunityGallons = gallons(totals.equipmentOpportunitySec);
  const trucks = [...byTruck].map(([vehicleId, rows]) => {
    const v = vehicleById.get(vehicleId);
    return {
      vehicleId,
      unit: v?.unit_number ?? "—",
      equipment: declaredEquipment({ hasApu: v?.has_apu ?? null, apuType: v?.apu_type ?? null }),
      totals: idleAvoidableTotals(rows),
    };
  });
  trucks.sort((a, b) => b.totals.avoidableSec - a.totals.avoidableSec || a.unit.localeCompare(b.unit));

  return {
    from,
    to,
    timezone,
    settings,
    totals,
    money: {
      galPerHour: basis.idleGalPerHour,
      pricePerGal: basis.fuelPricePerGal,
      avoidableGallons,
      avoidableUsd: r2(avoidableGallons * basis.fuelPricePerGal),
      equipmentOpportunityGallons,
      equipmentOpportunityUsd: r2(equipmentOpportunityGallons * basis.fuelPricePerGal),
    },
    trucks,
  };
}
