import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSamsaraDrivers, driverMatchKey } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraDriverLister, type SamsaraDriverLister } from "../lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

export interface DriverSyncResult {
  total: number;
  created: number;
  updated: number;
  deactivated: number; // Samsara-sourced drivers marked inactive because they left Samsara's active roster
}

interface ExistingDriver {
  id: string;
  samsara_driver_id: string | null;
  full_name: string;
  phone: string | null;
  samsara_username: string | null;
  identity_source: string | null;
  status: string | null;
}

/**
 * Pull the org's drivers from Samsara and upsert them into `drivers`. Matching precedence:
 * samsara_driver_id → phone → NAME (via driverMatchKey). On a match we refresh name + phone + the
 * Samsara login, but never clobber user-owned fields (employee_id, status). Mirrors the vehicle sync.
 *
 * Name matching uses driverMatchKey — the SAME order-independent, middle-initial-tolerant key the EFS
 * import path uses to auto-provision drivers — so a driver EFS created as "SMITH, JOHN" matches
 * Samsara's "John Smith" and gets ENRICHED (phone + username) instead of duplicated. The old
 * lowercase-trim comparison missed exactly those, which is why some drivers showed no phone: their
 * phone landed on a second, name-mismatched Samsara copy. A name shared by 2+ existing drivers is
 * ambiguous and never matched on (mirrors the EFS collision handling — don't guess).
 */
export async function syncDriversFromSamsara(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  listerOverride?: SamsaraDriverLister,
): Promise<DriverSyncResult> {
  const token = listerOverride ? "test" : await loadSamsaraToken(admin, env, orgId);
  if (!token) throw new NoSamsaraTokenError();

  const lister = listerOverride ?? makeSamsaraDriverLister(env, token);
  const raw = await lister();
  const drivers = parseSamsaraDrivers({ data: raw as { id?: string }[] });

  const { data: existingData } = await admin
    .from("drivers")
    .select("id, samsara_driver_id, full_name, phone, samsara_username, identity_source, status")
    .eq("org_id", orgId);
  const existing = (existingData ?? []) as ExistingDriver[];

  const bySamsara = new Map(existing.filter((r) => r.samsara_driver_id).map((r) => [r.samsara_driver_id!, r]));
  const byPhone = new Map(existing.filter((r) => r.phone).map((r) => [normPhone(r.phone!), r]));
  // Collision-aware name index: a key shared by 2+ drivers maps to null (ambiguous → never matched),
  // so we never merge two different people who normalise to the same name.
  const byName = new Map<string, ExistingDriver | null>();
  for (const r of existing) {
    const k = driverMatchKey(r.full_name);
    if (!k) continue;
    byName.set(k, byName.has(k) ? null : r);
  }

  const result: DriverSyncResult = { total: drivers.length, created: 0, updated: 0, deactivated: 0 };

  for (const sd of drivers) {
    const match =
      bySamsara.get(sd.samsaraId) ??
      (sd.phone ? byPhone.get(normPhone(sd.phone)) : undefined) ??
      (byName.get(driverMatchKey(sd.name)) ?? undefined);

    // Identity fields Samsara ALWAYS owns; name + the numeric id are refreshed every sync.
    const identity: Record<string, unknown> = { full_name: sd.name, samsara_driver_id: sd.samsaraId };
    // Phone and username are refreshed ONLY when Samsara actually returned a value — a null in one
    // response (field omitted for that page/driver) must never wipe a good stored value.
    if (sd.phone) identity.phone = sd.phone;
    if (sd.username) identity.samsara_username = sd.username;

    if (match) {
      await admin.from("drivers").update(identity).eq("id", match.id).eq("org_id", orgId);
      result.updated++;
      continue;
    }

    const { error } = await admin.from("drivers").insert({
      org_id: orgId,
      ...identity,
      status: sd.active ? "active" : "inactive",
    });
    if (error) throw new Error(error.message);
    result.created++;
  }

  // Reflect Samsara DEACTIVATIONS: a Samsara-sourced driver we still hold as 'active' but who is no longer in
  // Samsara's active roster has been deactivated there → mark inactive (history kept, never deleted). We never
  // touch manually-created drivers (identity_source = 'manual' is admin-owned). Guarded twice so a thin/failed
  // fetch can't mass-deactivate: (a) only run when the roster returned ≥1 active driver, and (b) never
  // deactivate MORE rows than the active roster size (a run that would wipe most of the roster is treated as a
  // bad fetch and skipped). Deactivation-only (we don't auto-reactivate — that stays an admin decision).
  const activeIds = new Set(drivers.filter((d) => d.active).map((d) => d.samsaraId));
  if (activeIds.size > 0) {
    const stale = existing.filter(
      (r) => r.samsara_driver_id && r.status === "active" && r.identity_source !== "manual" && !activeIds.has(r.samsara_driver_id),
    );
    if (stale.length > 0 && stale.length <= activeIds.size) {
      const { error } = await admin.from("drivers").update({ status: "inactive" }).in("id", stale.map((r) => r.id)).eq("org_id", orgId);
      if (!error) result.deactivated = stale.length;
    } else if (stale.length > activeIds.size) {
      console.warn(`[driver-sync] skipped deactivating ${stale.length} drivers (> active roster ${activeIds.size}) — treating as a bad fetch`);
    }
  }

  return result;
}

const normPhone = (p: string) => p.replace(/\D/g, "");
