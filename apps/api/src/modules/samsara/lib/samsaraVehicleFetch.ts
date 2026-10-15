import {
  parseSamsaraVehicles,
  parseVehicleStatsOdometer,
  parseVehicleFuelPercents,
  type SamsaraVehicle,
  type VehicleFuelLevel,
} from "@silvicom/shared";
import type { Env } from "../../../env.js";
import {
  makeSamsaraVehicleLister,
  makeSamsaraOdometerFetcher,
  type SamsaraVehicleLister,
  type SamsaraOdometerFetcher,
} from "./samsara.js";

/**
 * The vehicle sync's READ half — what Samsara lists, and the three ways a listed record is matched to
 * one of our rows. Moved out of `samsaraVehicleSync.ts` on 2026-10-15 when the five-minute seat pass
 * needed room in that file: it is one of the grandfathered `vehicles` write sites, which may only
 * shrink, so the writes stay there and the pure reads come here.
 */

export interface ExistingRow {
  id: string;
  samsara_vehicle_id: string | null;
  vin: string | null;
  unit_number: string;
  status: string | null;
  samsara_missing_since: string | null;
}

/** The org's powered vehicles, plus each one's odometer and fuel level when the stats call answers. */
export async function fetchSamsaraVehicles(
  env: Env,
  token: string,
  listerOverride?: SamsaraVehicleLister,
  odometerOverride?: SamsaraOdometerFetcher,
): Promise<{ vehicles: SamsaraVehicle[]; odometerMiles: Map<string, number>; fuelByVehicle: Map<string, VehicleFuelLevel> }> {
  const lister = listerOverride ?? makeSamsaraVehicleLister(env, token);
  const raw = await lister();
  const vehicles = parseSamsaraVehicles({ data: raw as { id?: string }[] });

  let odometerMiles = new Map<string, number>();
  let fuelByVehicle = new Map<string, VehicleFuelLevel>();
  try {
    const fetcher = odometerOverride ?? makeSamsaraOdometerFetcher(env, token);
    const stats = (await fetcher()) as Parameters<typeof parseVehicleStatsOdometer>[0];
    odometerMiles = parseVehicleStatsOdometer(stats);
    fuelByVehicle = parseVehicleFuelPercents(stats);
  } catch {
    /* leave stats unset; not fatal */
  }
  return { vehicles, odometerMiles, fuelByVehicle };
}

/** Matching precedence: samsara_vehicle_id → VIN → unit number. */
export function buildVehicleMaps(existing: ExistingRow[]) {
  return {
    bySamsara: new Map(existing.filter((r) => r.samsara_vehicle_id).map((r) => [r.samsara_vehicle_id!, r])),
    byVin: new Map(existing.filter((r) => r.vin).map((r) => [r.vin!.toUpperCase(), r])),
    byUnit: new Map(existing.map((r) => [r.unit_number, r])),
  };
}
