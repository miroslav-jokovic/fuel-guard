import type { SupabaseClient } from "@supabase/supabase-js";
import { CASE_RULE_ID } from "@fuelguard/shared";

/** Default window (hours) matching the rule's cumulativeWindowHours default. */
const DEFAULT_WINDOW_H = 48;

interface Assignment {
  vehicleSamsaraId: string;
  driverSamsaraId: string;
  startMs: number;
  endMs: number | null;
}

/** The Samsara driver assigned to a truck at instant tMs (open-ended when end_at is null), or null. */
function driverAt(assignments: Assignment[], vehicleSamsaraId: string, tMs: number): string | null {
  for (const a of assignments) {
    if (a.vehicleSamsaraId !== vehicleSamsaraId) continue;
    if (tMs >= a.startMs && (a.endMs == null || tMs <= a.endMs)) return a.driverSamsaraId;
  }
  return null;
}

/**
 * Auto-clear "one card fueled multiple trucks" cases that Samsara explains as ONE driver moving between
 * trucks. The alert is still RAISED (so there's a record), but if every fill on that card in the window
 * resolves — via driver_vehicle_assignments — to the SAME Samsara driver, the case is dismissed and marked
 * (disposition benign_explained). Deliberately conservative: if Samsara can't fully explain it (an
 * unmatched truck, or a second driver), the case is left open for a human. Returns the count auto-cleared.
 */
export async function reconcileCardMultiForOrg(
  admin: SupabaseClient,
  orgId: string,
  opts: { windowHours?: number } = {},
): Promise<number> {
  const windowMs = (opts.windowHours ?? DEFAULT_WINDOW_H) * 3_600_000;

  const { data: cases } = await admin
    .from("anomalies")
    .select("id, transaction_id, evidence")
    .eq("org_id", orgId)
    .eq("rule_id", CASE_RULE_ID)
    .eq("status", "open");
  const targets = ((cases ?? []) as {
    id: string;
    transaction_id: string;
    evidence: { signals?: { ruleId: string }[] } | null;
  }[]).filter(
    (c) => Array.isArray(c.evidence?.signals) && c.evidence!.signals!.some((s) => s.ruleId === "card_multi_vehicle"),
  );
  if (!targets.length) return 0;

  // Preload the vehicle→samsara-id map and the org's assignments (both small tables).
  const { data: vs } = await admin.from("vehicles").select("id, samsara_vehicle_id").eq("org_id", orgId);
  const vehSamsara = new Map<string, string>();
  for (const v of (vs ?? []) as { id: string; samsara_vehicle_id: string | null }[]) {
    if (v.samsara_vehicle_id) vehSamsara.set(v.id, v.samsara_vehicle_id);
  }
  const { data: asg } = await admin
    .from("driver_vehicle_assignments")
    .select("vehicle_samsara_id, driver_samsara_id, start_at, end_at")
    .eq("org_id", orgId);
  const assignments: Assignment[] = (
    (asg ?? []) as { vehicle_samsara_id: string; driver_samsara_id: string; start_at: string; end_at: string | null }[]
  ).map((a) => ({
    vehicleSamsaraId: a.vehicle_samsara_id,
    driverSamsaraId: a.driver_samsara_id,
    startMs: Date.parse(a.start_at),
    endMs: a.end_at ? Date.parse(a.end_at) : null,
  }));

  let cleared = 0;
  for (const c of targets) {
    const { data: txn } = await admin
      .from("fuel_transactions")
      .select("card_ref, fueled_at")
      .eq("id", c.transaction_id)
      .maybeSingle();
    const t = txn as { card_ref: string | null; fueled_at: string } | null;
    if (!t?.card_ref) continue;
    const endMs = Date.parse(t.fueled_at);

    // Every fill on that card in the SAME backward window scoreTransaction used to count the trucks.
    const { data: fills } = await admin
      .from("fuel_transactions")
      .select("vehicle_id, fueled_at")
      .eq("org_id", orgId)
      .eq("card_ref", t.card_ref)
      .gte("fueled_at", new Date(endMs - windowMs).toISOString())
      .lte("fueled_at", t.fueled_at);
    const rows = ((fills ?? []) as { vehicle_id: string | null; fueled_at: string }[]).filter((f) => f.vehicle_id);
    if (!rows.length) continue;

    // Resolve the Samsara driver for each fill. If every fill maps to the SAME driver, one person moved
    // trucks → benign. Any unmatched fill or a second driver → not explained → leave the case open.
    const drivers = new Set<string>();
    let allResolved = true;
    for (const f of rows) {
      const sv = vehSamsara.get(f.vehicle_id!);
      const drv = sv ? driverAt(assignments, sv, Date.parse(f.fueled_at)) : null;
      if (!drv) {
        allResolved = false;
        break;
      }
      drivers.add(drv);
    }
    if (allResolved && drivers.size === 1) {
      await admin
        .from("anomalies")
        .update({
          status: "dismissed",
          disposition: "benign_explained",
          resolution_note:
            "Auto-cleared: Samsara shows the same driver moved between these trucks (one card, legitimate truck change).",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      cleared++;
    }
  }
  return cleared;
}
