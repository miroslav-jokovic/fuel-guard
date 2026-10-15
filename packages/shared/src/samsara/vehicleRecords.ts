/**
 * A Samsara vehicle RECORD's identity — what `/fleet/vehicles` says it is. Split out of `entities.ts` on
 * 2026-10-15 when the gateway serial pushed that file past the 500-line budget; the record's identity
 * is one concern and the telemetry parsers left behind are another.
 */

import { clean } from "./entities.js";

interface RawSamsaraVehicle {
  id?: string;
  name?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: string | number;
  licensePlate?: string;
  gateway?: { serial?: string; model?: string } | null;
}

export interface SamsaraVehicle {
  samsaraId: string;
  name: string; // Samsara display name — usually the unit number
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  licensePlate: string | null;
  /**
   * The installed gateway's serial, or null when the record has none. A swapped-out device's record
   * stays listed (renamed `NNN - OLD`) with its gateway removed — measured 2026-10-15 on 705, 767, 787
   * and 800 — so this, not the name, says whether a record can still report anything.
   */
  gatewaySerial: string | null;
}

/** Parse a Samsara `/fleet/vehicles` list response (one or more pages merged) into vehicle identities. */
export function parseSamsaraVehicles(response: { data?: RawSamsaraVehicle[] }): SamsaraVehicle[] {
  return (response.data ?? [])
    .filter((v) => v.id != null && String(v.id).trim() !== "")
    .map((v) => {
      const yr = v.year != null ? parseInt(String(v.year), 10) : NaN;
      return {
        samsaraId: String(v.id),
        name: clean(v.name) ?? String(v.id),
        vin: clean(v.vin),
        make: clean(v.make),
        model: clean(v.model),
        year: Number.isFinite(yr) ? yr : null,
        licensePlate: clean(v.licensePlate),
        gatewaySerial: clean(v.gateway?.serial),
      };
    });
}

