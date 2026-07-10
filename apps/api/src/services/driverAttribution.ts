import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveFuelEventsFromEfsStore, reconcileFuelLines, driversToProvision, type EfsStoreLine } from "@fuelguard/shared";

export interface DriverAttributionResult {
  provisioned: number; // driver records auto-created from EFS names
  attributed: number; // previously-unattributed fills now linked to a driver
}

const PAGE = 1000;

/** Load every faithful EFS line for the org (the raw driver-name source), paged. */
async function loadEfsLines(admin: SupabaseClient, orgId: string): Promise<EfsStoreLine[]> {
  const out: EfsStoreLine[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("efs_transactions")
      .select("card_num, invoice, tran_date, fueled_at, unit, driver_name, odometer, location_name, city, state, item, qty, amt")
      .eq("org_id", orgId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as EfsStoreLine[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/**
 * Maximize driver attribution: EFS reports carry the correct driver NAME, but a fill is only "attributed"
 * when that name matches a driver RECORD. This (a) auto-creates a driver for every EFS name that has no
 * record (normalized so variants collapse to one; junk skipped), then (b) links every previously
 * unattributed fill to its driver by the byte-identical merged external_ref. Idempotent + safe to re-run.
 */
export async function attributeDrivers(admin: SupabaseClient, orgId: string): Promise<DriverAttributionResult> {
  const lines = await loadEfsLines(admin, orgId);
  if (lines.length === 0) return { provisioned: 0, attributed: 0 };
  const { events } = deriveFuelEventsFromEfsStore(lines);

  const { data: existing } = await admin.from("drivers").select("id, full_name").eq("org_id", orgId);
  let drivers = ((existing ?? []) as { id: string; full_name: string }[]).slice();

  // (a) provision missing drivers
  const toCreate = driversToProvision(events.map((e) => e.driver_name), drivers);
  let provisioned = 0;
  if (toCreate.length) {
    const { data: created, error } = await admin
      .from("drivers")
      .insert(toCreate.map((full_name) => ({ org_id: orgId, full_name, status: "active" })))
      .select("id, full_name");
    if (error) throw new Error(error.message);
    drivers = [...drivers, ...((created ?? []) as { id: string; full_name: string }[])];
    provisioned = created?.length ?? 0;
  }

  // (b) match each merged event's name → driver, keyed by external_ref, then link unattributed fills.
  const reconciled = reconcileFuelLines(events, [], drivers);
  const refsByDriver = new Map<string, string[]>();
  for (const r of reconciled) {
    if (!r.driver_id) continue;
    const list = refsByDriver.get(r.driver_id) ?? [];
    list.push(r.external_ref);
    refsByDriver.set(r.driver_id, list);
  }

  let attributed = 0;
  for (const [driverId, refs] of refsByDriver) {
    for (let i = 0; i < refs.length; i += PAGE) {
      const chunk = refs.slice(i, i + PAGE);
      const { data, error } = await admin
        .from("fuel_transactions")
        .update({ driver_id: driverId })
        .eq("org_id", orgId)
        .is("driver_id", null)
        .in("external_ref", chunk)
        .select("id");
      if (error) throw new Error(error.message);
      attributed += data?.length ?? 0;
    }
  }
  return { provisioned, attributed };
}
