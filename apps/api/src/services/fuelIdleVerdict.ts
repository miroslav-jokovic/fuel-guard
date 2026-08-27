/**
 * The fleet's avoidable-idle verdict, read server-side so the fuel-spend REPORT can carry it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * The verdict — which trucks had an alternative to running the main engine, and therefore whose idle
 * anybody could have done something about — lived only in a Vue composable. The report could not reach
 * it, so its first version multiplied idle seconds by a burn rate and printed the total as waste. That
 * is the every-truck-is-avoidable over-count `docs/plans/IDLE-AVOIDABLE-HOS.md` was written to kill:
 * 17 of 195 trucks carry a confirmed APU, so for most of the fleet the driver had no choice.
 *
 * The judgement itself is pure and in `@silvicom/shared` (`computeIdleBreakdown`). This is the I/O
 * around it, and it is deliberately the SAME three reads the page makes, so a figure in a document and
 * the same figure on screen come from one implementation.
 *
 * ── ORG SCOPING ──────────────────────────────────────────────────────────────────────────────────
 * Every query filters `org_id`. The service role bypasses RLS, so the filter IS the tenant boundary.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeIdleBreakdown,
  idleRangeDays,
  type FleetIdleVerdict,
  type IdleBreakdownRollupRow,
  type IdleCapability,
  type IdleVehicle,
} from "@silvicom/shared";
import { eachPage } from "../lib/paging.js";

/** Matches the Idling page's fallback when the org has configured neither. */
const DEFAULT_BASIS = { idleGalPerHour: 0.8, fuelPricePerGal: 4.0 };

const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

export async function readFleetIdleVerdict(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<FleetIdleVerdict | null> {
  const [rows, vehicles, dayPrices, basis] = await Promise.all([
    readRollupRows(admin, orgId, from, to),
    readVehicles(admin, orgId),
    readDayPrices(admin, orgId, from, to),
    readCostBasis(admin, orgId),
  ]);
  if (rows.length === 0 || vehicles.length === 0) return null;

  return computeIdleBreakdown(rows, vehicles, dayPrices, {
    rangeDays: idleRangeDays(rows, from, to),
    costBasis: basis,
  }).fleet;
}

async function readRollupRows(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<IdleBreakdownRollupRow[]> {
  const out: IdleBreakdownRollupRow[] = [];
  await eachPage<Record<string, unknown>>(
    (a, b) =>
      admin
        .from("idle_rollup_days")
        .select(
          "vehicle_id, day, drive_sec, idle_sec, off_sec, coverage_sec, managed_idle_sec, continuous_idle_sec, rest_idle_sec, work_idle_sec, other_idle_sec, optimized_envelope_inside_sec, optimized_envelope_outside_sec, optimized_envelope_unknown_sec, optimized_envelope_ambiguous_sec, optimized_envelope_status, optimized_envelope_source, hos_rest_sec, hos_work_sec, hos_unknown_sec, hos_ambiguous_sec, hos_grace_sec, hos_evidence_status, attributed_driver_id",
        )
        .eq("org_id", orgId)
        .gte("day", from)
        .lte("day", to)
        .order("day", { ascending: true })
        .range(a, b),
    (batch) => {
      for (const r of batch) {
        out.push({
          vehicle_id: String(r.vehicle_id),
          day: String(r.day),
          drive_sec: num(r.drive_sec),
          idle_sec: num(r.idle_sec),
          off_sec: num(r.off_sec),
          coverage_sec: num(r.coverage_sec),
          managed_idle_sec: num(r.managed_idle_sec),
          continuous_idle_sec: num(r.continuous_idle_sec),
          rest_idle_sec: num(r.rest_idle_sec),
          work_idle_sec: num(r.work_idle_sec),
          other_idle_sec: num(r.other_idle_sec),
          optimized_envelope_inside_sec: num(r.optimized_envelope_inside_sec),
          optimized_envelope_outside_sec: num(r.optimized_envelope_outside_sec),
          optimized_envelope_unknown_sec: num(r.optimized_envelope_unknown_sec),
          optimized_envelope_ambiguous_sec: num(r.optimized_envelope_ambiguous_sec),
          optimized_envelope_status:
            (r.optimized_envelope_status as IdleBreakdownRollupRow["optimized_envelope_status"]) ?? "not_applicable",
          optimized_envelope_source:
            (r.optimized_envelope_source as IdleBreakdownRollupRow["optimized_envelope_source"]) ?? "none",
          hos_rest_sec: num(r.hos_rest_sec),
          hos_work_sec: num(r.hos_work_sec),
          hos_unknown_sec: num(r.hos_unknown_sec),
          hos_ambiguous_sec: num(r.hos_ambiguous_sec),
          hos_grace_sec: num(r.hos_grace_sec),
          hos_evidence_status:
            (r.hos_evidence_status as IdleBreakdownRollupRow["hos_evidence_status"]) ?? "not_applicable",
          attributed_driver_id: r.attributed_driver_id == null ? null : String(r.attributed_driver_id),
        });
      }
    },
  );
  return out;
}

/**
 * Equipment is the SOURCE OF TRUTH for avoidability, so this reads the admin flags and never infers
 * them. Retired trucks are excluded, matching the page.
 */
async function readVehicles(admin: SupabaseClient, orgId: string): Promise<IdleVehicle[]> {
  const out: IdleVehicle[] = [];
  await eachPage<Record<string, unknown>>(
    (a, b) =>
      admin
        .from("vehicles")
        .select("id, unit_number, has_apu, has_optimized_idle, idle_capability")
        .eq("org_id", orgId)
        .neq("status", "retired")
        .range(a, b),
    (batch) => {
      for (const v of batch) {
        out.push({
          id: String(v.id),
          unitNumber: String(v.unit_number ?? ""),
          hasApu: (v.has_apu as boolean | null) ?? null,
          hasOptimizedIdle: (v.has_optimized_idle as boolean | null) ?? null,
          learnedCapability: ((v.idle_capability as string | null) ?? "unknown") as IdleCapability,
        });
      }
    },
  );
  return out;
}

/** Each day charged at the diesel price that day actually cost; days without one fall back to the basis. */
async function readDayPrices(
  admin: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data } = await admin
    .from("fuel_price_days")
    .select("day, effective_price_per_gal")
    .eq("org_id", orgId)
    .gte("day", from)
    .lte("day", to);
  for (const r of (data ?? []) as { day: string; effective_price_per_gal: number | string | null }[]) {
    const price = Number(r.effective_price_per_gal);
    if (Number.isFinite(price) && price > 0) out.set(r.day, price);
  }
  return out;
}

async function readCostBasis(admin: SupabaseClient, orgId: string): Promise<{ idleGalPerHour: number; fuelPricePerGal: number }> {
  const { data } = await admin
    .from("idle_settings")
    .select("idle_gal_per_hour, fuel_price_per_gal")
    .eq("org_id", orgId)
    .maybeSingle();
  const s = data as { idle_gal_per_hour?: number | string; fuel_price_per_gal?: number | string } | null;
  return {
    idleGalPerHour: Number(s?.idle_gal_per_hour) || DEFAULT_BASIS.idleGalPerHour,
    fuelPricePerGal: Number(s?.fuel_price_per_gal) || DEFAULT_BASIS.fuelPricePerGal,
  };
}
