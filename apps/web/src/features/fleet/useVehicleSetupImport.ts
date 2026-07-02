import { useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  serializeVehicleSetupCsv,
  parseVehicleSetupCsv,
  type Vehicle,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";

/** One vehicle whose tank capacity and/or baseline MPG will change on commit. */
export interface SetupChange {
  id: string;
  unit_number: string;
  tank_before: number | null;
  tank_after: number | null;
  mpg_before: number | null;
  mpg_after: number | null;
}

export interface SetupImportPreview {
  filename: string;
  changes: SetupChange[]; // matched rows with at least one changed value
  unchanged: number; // matched rows whose values already match the file
  unmatchedUnits: string[]; // unit numbers in the file with no vehicle
  errors: string[]; // per-row parse issues
  totalRows: number;
}

const norm = (u: string) => u.trim().toLowerCase();
const numEq = (a: number | null, b: number | null) => Number(a ?? NaN) === Number(b ?? NaN) || (a == null && b == null);

/** Build the setup CSV text for the current fleet (active + retired), for download. */
export function buildSetupCsv(vehicles: Vehicle[]): string {
  return serializeVehicleSetupCsv(vehicles);
}

/** Read + parse + diff an uploaded setup CSV against the fleet — no writes. */
export function analyzeSetupImport(text: string, filename: string, vehicles: Vehicle[]): SetupImportPreview {
  const { rows, errors } = parseVehicleSetupCsv(text);
  const byUnit = new Map(vehicles.map((v) => [norm(v.unit_number), v]));
  const changes: SetupChange[] = [];
  const unmatchedUnits: string[] = [];
  let unchanged = 0;

  for (const row of rows) {
    const v = byUnit.get(norm(row.unit_number));
    if (!v) {
      unmatchedUnits.push(row.unit_number);
      continue;
    }
    // Blank cells mean "leave unchanged" → fall back to the vehicle's current value.
    const tankAfter = row.tank_capacity_gal ?? Number(v.tank_capacity_gal);
    const mpgAfter = row.baseline_mpg ?? v.baseline_mpg ?? null;
    const tankChanged = !numEq(tankAfter, Number(v.tank_capacity_gal));
    const mpgChanged = !numEq(mpgAfter, v.baseline_mpg ?? null);
    if (tankChanged || mpgChanged) {
      changes.push({
        id: v.id,
        unit_number: v.unit_number,
        tank_before: Number(v.tank_capacity_gal),
        tank_after: tankAfter,
        mpg_before: v.baseline_mpg ?? null,
        mpg_after: mpgAfter,
      });
    } else {
      unchanged++;
    }
  }
  return { filename, changes, unchanged, unmatchedUnits, errors, totalRows: rows.length };
}

/** Commit the previewed changes — one update per changed vehicle, keyed by id. */
export function useCommitVehicleSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (preview: SetupImportPreview): Promise<number> => {
      for (const c of preview.changes) {
        const { error } = await supabase
          .from("vehicles")
          .update({ tank_capacity_gal: c.tank_after, baseline_mpg: c.mpg_after })
          .eq("id", c.id);
        if (error) throw new Error(`${c.unit_number}: ${error.message}`);
      }
      return preview.changes.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicles"] }),
  });
}
