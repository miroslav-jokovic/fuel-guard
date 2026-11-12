import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assistantUnitKey,
  coverageIsPrintable,
  exclusiveEndYmd,
  organizationTimezone,
  resolveAssistantRange,
  shiftDay,
  todayInZone,
  type AssistantRangeInput,
} from "@silvicom/shared";
import { readCoverage } from "./coverage.js";
import { readUnitCost, type UnitCostAnswer } from "./unitCost.js";

/**
 * The assistant's `maintenance_cost` tool (F21 R6b, 2026-11-10): a truck's or trailer's repair bills,
 * asked in words ("what did 748 cost us in repairs this year").
 *
 * ── WHY IT CALLS `readCoverage` THEN `readUnitCost`, AND NOTHING ELSE ────────────────────────────
 * The truck page's repair-bills line (`UnitRepairBillsLine.vue`) asks
 * `GET /api/maintenance/units/:kind/:id/maintenance`, and that route reads the coverage bound FIRST
 * and refuses with 409 when `coverageIsPrintable` says no (D-FP4): a FleetPal figure with nothing
 * from the ledger to measure it against is the plausible-but-wrong number D-FIN10 forbids. This file
 * does the same two reads in the same order with the same refusal, for each unit named, and renames
 * fields. Every figure is `readUnitCost`'s; nothing is re-summed.
 *
 * ── FLEETPAL AND MCLEOD ARE TWO NAMED VALUES, NEVER ONE (D-FP18, memory `fleetpal-is-larger…`) ───
 * FleetPal's per-unit `total` includes the shop's own labour, which McLeod files as payroll, not in
 * the GL maintenance family; measured July 2026, $314,030 against $219,301, the gap almost exactly
 * the labour. So the answer carries (a) FleetPal's operational cost per unit, labour included, the
 * page's headline; (b) FleetPal's labour on its own, so a reader can see what the ledger does not
 * hold; and (c) McLeod's maintenance family per month, FLEET-WIDE, because the ledger has no
 * equipment dimension at all (`mcleod_gl_totals`). There is no McLeod figure per truck, and the
 * answer says so rather than splitting the fleet's total by anything.
 *
 * Gated as its page is: `maintenance: view` (`assistantContract.ts`). No module gate.
 *
 * ORG-SCOPED: `readCoverage` and `readUnitCost` filter `org_id` on every read; so do the unit
 * lookups and the timezone read here.
 */

export const MAINTENANCE_SOURCE = "Truck and trailer pages (/shop/units), the repair bills from FleetPal, measured against the McLeod ledger";
export const MAX_MAINTENANCE_UNITS = 10;

export interface AssistantMaintenanceInput extends AssistantRangeInput {
  units?: unknown;
}

type Kind = "tractor" | "trailer";
interface Unit {
  kind: Kind;
  id: string;
  unit: string;
}

/**
 * The window, half-open, as the route takes it. With no period, the page's own: the last twelve
 * FULL months (`UnitRepairBillsLine.vue` `lastTwelveMonths`), on the carrier's clock.
 */
function windowOf(input: AssistantMaintenanceInput, today: string): { from: string; to: string; label: string } | { error: string } {
  if (input.period == null && input.from == null && input.to == null) {
    const thisMonth = `${today.slice(0, 7)}-01`;
    const [y, m] = thisMonth.split("-").map(Number) as [number, number];
    const back = y * 12 + (m - 1) - 12;
    const from = `${Math.floor(back / 12)}-${String((back % 12) + 1).padStart(2, "0")}-01`;
    return { from, to: thisMonth, label: "the last 12 full months" };
  }
  const range = resolveAssistantRange(input, today);
  if (!range.ok) return { error: range.error };
  return { from: range.from, to: exclusiveEndYmd(range.to), label: range.label };
}

async function findUnits(admin: SupabaseClient, orgId: string, asked: string[]): Promise<{ found: Unit[]; notFound: string[] }> {
  const [trucks, trailers] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
    admin.from("trailers").select("id, unit_number").eq("org_id", orgId),
  ]);
  if (trucks.error) throw new Error(trucks.error.message);
  if (trailers.error) throw new Error(trailers.error.message);
  const index = new Map<string, Unit[]>();
  const add = (kind: Kind, rows: unknown) => {
    for (const r of (rows ?? []) as { id: string; unit_number: string | null }[]) {
      if (!r.unit_number) continue;
      const key = assistantUnitKey(r.unit_number);
      index.set(key, [...(index.get(key) ?? []), { kind, id: r.id, unit: r.unit_number }]);
    }
  };
  add("tractor", trucks.data);
  add("trailer", trailers.data);
  const found: Unit[] = [];
  const notFound: string[] = [];
  // A number a truck and a trailer share is both units; each row says which it is.
  for (const u of asked) {
    const hit = index.get(assistantUnitKey(u));
    if (hit) found.push(...hit);
    else notFound.push(u);
  }
  return { found, notFound };
}

const unitFigures = (u: Unit, c: UnitCostAnswer) => ({
  unit: u.unit,
  kind: u.kind === "tractor" ? "truck" : "trailer",
  fleetpal_cost: c.totals.total,
  fleetpal_parts: c.totals.parts,
  fleetpal_labor: c.totals.labor,
  fleetpal_labor_hours: c.totals.laborHours,
  fleetpal_services: c.totals.services,
  fleetpal_fees: c.totals.fees,
  fleetpal_tax: c.totals.tax,
  repairs: c.repairCount,
  days_in_shop: c.downtimeDays,
  miles: c.miles,
  fleetpal_cost_per_mile: c.costPerMile,
  ...(c.fleetpalUnitIds.length === 0 ? { not_in_fleetpal: true } : {}),
});

export async function assistantMaintenanceCost(
  admin: SupabaseClient,
  orgId: string,
  input: AssistantMaintenanceInput,
  now: Date = new Date(),
): Promise<unknown> {
  const asked = [...new Set((Array.isArray(input.units) ? input.units : []).map((u) => String(u)).filter((u) => assistantUnitKey(u) !== ""))];
  if (asked.length === 0) return { error: "Name the truck or trailer units to report on." };
  if (asked.length > MAX_MAINTENANCE_UNITS) return { error: `At most ${MAX_MAINTENANCE_UNITS} units per answer; ${asked.length} were named. Split the list.` };

  const { data: org } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  const timezone = organizationTimezone((org as { operating_hours?: object | null } | null)?.operating_hours);
  const w = windowOf(input, todayInZone(now, timezone));
  if ("error" in w) return { error: w.error };

  const { found, notFound } = await findUnits(admin, orgId, asked);
  if (found.length === 0) return { error: "None of the named units are in this fleet.", not_found: notFound };

  // D-FP4, exactly as the route: the bound first, and no cost at all when it cannot be computed.
  const coverage = await readCoverage(admin, orgId, w.from, w.to);
  const base = { source: MAINTENANCE_SOURCE, period: w.label, from: w.from, to: shiftDay(w.to, -1) };
  if (!coverageIsPrintable(coverage.months)) {
    return {
      ...base,
      cost_unavailable:
        "Maintenance cost cannot be shown for this window: the general ledger has no swept maintenance total for at " +
        "least one of its months, so there is nothing to measure FleetPal's share against.",
      months_without_a_ledger_total: coverage.months.filter((m) => m.ratioLowerBound === null).map((m) => m.month),
    };
  }

  const costs = await Promise.all(found.map((u) => readUnitCost(admin, orgId, u.kind, u.id, w.from, w.to)));
  return {
    ...base,
    fleetpal_cost_is:
      "FleetPal's repair bills for the unit, the shop's own labour included (the truck page's figure). McLeod files that " +
      "labour as wages, so FleetPal runs higher than the ledger's maintenance accounts; compare only fleetpal_cost minus " +
      "fleetpal_labor with McLeod.",
    units: found.map((u, i) => unitFigures(u, costs[i]!)),
    ...(notFound.length > 0 ? { not_found: notFound } : {}),
    mcleod_by_month: coverage.months.map((m) => ({
      month: m.month,
      mcleod_maintenance_fleet_wide: m.glMaintenance,
      fleetpal_invoiced_fleet_wide: m.fleetpalInvoiced,
      // "At least": a LOWER bound (D-FP15).
      share_of_ledger_seen_through_fleetpal_at_least: m.ratioLowerBound,
    })),
    mcleod_note: "McLeod's ledger has no truck or trailer on its maintenance accounts, so it gives a fleet-wide month only. There is no McLeod figure per unit.",
    fleetpal_units_not_matched_to_our_equipment: coverage.unmatchedUnits,
  };
}
