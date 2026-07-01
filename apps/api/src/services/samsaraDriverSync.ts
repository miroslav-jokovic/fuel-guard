import type { SupabaseClient } from "@supabase/supabase-js";
import { parseSamsaraDrivers } from "@fuelguard/shared";
import type { Env } from "../env.js";
import { loadSamsaraToken } from "../lib/samsaraToken.js";
import { makeSamsaraDriverLister, type SamsaraDriverLister } from "../lib/samsara.js";
import { NoSamsaraTokenError } from "./samsaraVehicleSync.js";

export interface DriverSyncResult {
  total: number;
  created: number;
  updated: number;
}

interface ExistingDriver {
  id: string;
  samsara_driver_id: string | null;
  full_name: string;
  phone: string | null;
}

/**
 * Pull the org's drivers from Samsara and upsert them into `drivers`. Matching precedence:
 * samsara_driver_id → phone → full name. On a match we refresh name + phone and stamp
 * samsara_driver_id, but never clobber user-owned fields (employee_id, status). Mirrors the vehicle
 * sync so admins manage the roster in one place.
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
    .select("id, samsara_driver_id, full_name, phone")
    .eq("org_id", orgId);
  const existing = (existingData ?? []) as ExistingDriver[];

  const bySamsara = new Map(existing.filter((r) => r.samsara_driver_id).map((r) => [r.samsara_driver_id!, r]));
  const byPhone = new Map(existing.filter((r) => r.phone).map((r) => [normPhone(r.phone!), r]));
  const byName = new Map(existing.map((r) => [r.full_name.trim().toLowerCase(), r]));

  const result: DriverSyncResult = { total: drivers.length, created: 0, updated: 0 };

  for (const sd of drivers) {
    const match =
      bySamsara.get(sd.samsaraId) ??
      (sd.phone ? byPhone.get(normPhone(sd.phone)) : undefined) ??
      byName.get(sd.name.trim().toLowerCase());

    const identity = { full_name: sd.name, phone: sd.phone, samsara_driver_id: sd.samsaraId };

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

  return result;
}

const normPhone = (p: string) => p.replace(/\D/g, "");
