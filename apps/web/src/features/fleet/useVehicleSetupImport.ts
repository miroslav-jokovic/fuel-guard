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
  const { rows, errors } = parseVehicleSetupCsv(text.replace(/^\uFEFF/, ""));
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

// ── Full vehicle import (create new + update existing) ───────────────────────

/** All columns accepted by the vehicle import template. */
export const VEHICLE_IMPORT_COLUMNS = [
  "unit_number",
  "fuel_type",
  "make",
  "model",
  "year",
  "plate",
  "vin",
  "tank_capacity_gal",
  "baseline_mpg",
  "current_odometer",
  "status",
] as const;

/** Build a ready-to-download blank template CSV with 2 illustrative example rows. */
export function buildVehicleImportTemplate(): string {
  const header = VEHICLE_IMPORT_COLUMNS.join(",");
  const ex1 = "EXAMPLE-1,diesel,Freightliner,Cascadia,2021,ABC 1234,,120,6.5,0,active";
  const ex2 = "EXAMPLE-2,gasoline,Ford,F-450,2020,XYZ 5678,,50,,45000,active";
  return [header, ex1, ex2].join("\r\n") + "\r\n";
}

/** Data needed to create a brand-new vehicle from a CSV row. */
export interface VehicleCreateRow {
  unit_number: string;
  fuel_type: string;
  make: string | null;
  model: string | null;
  year: number | null;
  plate: string | null;
  vin: string | null;
  tank_capacity_gal: number;
  baseline_mpg: number | null;
  current_odometer: number;
  status: string;
}

/** Result of analysing a full vehicle import CSV (create + update + errors). */
export interface VehicleImportPreview {
  filename: string;
  toCreate: VehicleCreateRow[];
  toUpdate: SetupChange[];
  unchanged: number;
  errors: string[];
  totalRows: number;
}

/** Split one CSV line into raw string cells, honoring double-quoted fields. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseNumField(raw: string): number | null {
  const s = raw.replace(/[$,]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const VALID_FUEL_TYPES = ["diesel", "gasoline", "def", "electric", "other"];
const VALID_STATUSES   = ["active", "maintenance", "retired"];

/**
 * Parse an uploaded CSV and diff it against the existing fleet.
 * – Rows whose unit_number matches an existing vehicle → SetupChange (tank + MPG only).
 * – Rows with an unknown unit_number → VehicleCreateRow (full new vehicle).
 * No database writes are made here.
 */
export function analyzeVehicleImport(text: string, filename: string, vehicles: Vehicle[]): VehicleImportPreview {
  // Strip UTF-8 BOM (\uFEFF) that Excel silently prepends when saving as "CSV UTF-8".
  // Also strip any other leading invisible characters.
  const clean = text.replace(/^\uFEFF/, "").replace(/^\u200B/, "");

  const errors: string[] = [];
  const byUnit = new Map(vehicles.map((v) => [v.unit_number.trim().toLowerCase(), v]));
  const nonEmpty = clean.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2)
    return { filename, toCreate: [], toUpdate: [], unchanged: 0, errors: ["The file has no data rows."], totalRows: 0 };

  // Normalise header: lowercase, trim, remove any residual non-printable characters.
  const headerCells = splitCsv(nonEmpty[0]!).map((h) =>
    h.toLowerCase().trim().replace(/[^\x20-\x7e]/g, ""),
  );
  const col = (name: string) => headerCells.indexOf(name);
  const iUnit = col("unit_number");
  if (iUnit === -1) {
    const found = headerCells.filter(Boolean).join(", ") || "(none)";
    return {
      filename, toCreate: [], toUpdate: [], unchanged: 0,
      errors: [`Missing required "unit_number" column. Columns found: ${found}`],
      totalRows: 0,
    };
  }

  const toCreate: VehicleCreateRow[] = [];
  const toUpdate: SetupChange[] = [];
  let unchanged = 0;
  const seen = new Set<string>();

  for (let i = 1; i < nonEmpty.length; i++) {
    const lineNum = i + 1;
    const cells = splitCsv(nonEmpty[i]!);
    const get = (name: string) => { const idx = col(name); return idx === -1 ? "" : (cells[idx] ?? "").trim(); };
    const unit = get("unit_number");
    if (!unit) { errors.push(`Line ${lineNum}: missing unit_number — skipped.`); continue; }
    const key = unit.toLowerCase();
    if (seen.has(key)) { errors.push(`Line ${lineNum}: duplicate unit "${unit}" — skipped.`); continue; }
    seen.add(key);

    const existing = byUnit.get(key);
    if (existing) {
      // Existing vehicle — update tank + MPG only (other fields are not overwritten)
      const tankRaw = get("tank_capacity_gal");
      const mpgRaw  = get("baseline_mpg");
      const tankAfter = tankRaw ? (parseNumField(tankRaw) ?? Number(existing.tank_capacity_gal)) : Number(existing.tank_capacity_gal);
      const mpgAfter  = mpgRaw  ? parseNumField(mpgRaw)  : existing.baseline_mpg ?? null;
      const tankChanged = !numEq(tankAfter, Number(existing.tank_capacity_gal));
      const mpgChanged  = !numEq(mpgAfter,  existing.baseline_mpg ?? null);
      if (tankChanged || mpgChanged) {
        toUpdate.push({ id: existing.id, unit_number: existing.unit_number, tank_before: Number(existing.tank_capacity_gal), tank_after: tankAfter, mpg_before: existing.baseline_mpg ?? null, mpg_after: mpgAfter });
      } else { unchanged++; }
    } else {
      // New vehicle — validate required fields
      const fuelRaw = get("fuel_type").toLowerCase();
      if (!fuelRaw || !VALID_FUEL_TYPES.includes(fuelRaw)) {
        errors.push(`Line ${lineNum}: "${unit}" — invalid or missing fuel_type. Use: ${VALID_FUEL_TYPES.join(", ")}.`);
        continue;
      }
      const yearRaw = get("year");
      const yearVal = yearRaw ? Number(yearRaw) : null;
      const year = yearVal && Number.isInteger(yearVal) && yearVal > 1900 ? yearVal : null;
      const statusRaw = get("status").toLowerCase();
      const status = VALID_STATUSES.includes(statusRaw) ? statusRaw : "active";
      toCreate.push({
        unit_number: unit,
        fuel_type: fuelRaw,
        make: get("make") || null,
        model: get("model") || null,
        year,
        plate: get("plate") || null,
        vin: get("vin") || null,
        tank_capacity_gal: parseNumField(get("tank_capacity_gal")) ?? 0,
        baseline_mpg: parseNumField(get("baseline_mpg")),
        current_odometer: parseNumField(get("current_odometer")) ?? 0,
        status,
      });
    }
  }

  return { filename, toCreate, toUpdate, unchanged, errors, totalRows: nonEmpty.length - 1 };
}

/** Batch-commit a vehicle import: insert new vehicles and update existing ones' tank + MPG. */
export function useCommitVehicleImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (preview: VehicleImportPreview): Promise<{ created: number; updated: number }> => {
      for (const row of preview.toCreate) {
        const { error } = await supabase.from("vehicles").insert({
          unit_number: row.unit_number,
          fuel_type: row.fuel_type,
          make: row.make,
          model: row.model,
          year: row.year,
          plate: row.plate,
          vin: row.vin,
          tank_capacity_gal: row.tank_capacity_gal,
          baseline_mpg: row.baseline_mpg,
          current_odometer: row.current_odometer,
          status: row.status,
        });
        if (error) throw new Error(`${row.unit_number}: ${error.message}`);
      }
      for (const c of preview.toUpdate) {
        const { error } = await supabase
          .from("vehicles")
          .update({ tank_capacity_gal: c.tank_after, baseline_mpg: c.mpg_after })
          .eq("id", c.id);
        if (error) throw new Error(`${c.unit_number}: ${error.message}`);
      }
      return { created: preview.toCreate.length, updated: preview.toUpdate.length };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicles"] }),
  });
}
