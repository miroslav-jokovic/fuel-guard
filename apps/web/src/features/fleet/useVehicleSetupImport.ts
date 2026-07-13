import { useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  serializeVehicleSetupCsv,
  parseVehicleSetupCsv,
  APU_TYPES,
  deriveHasApu,
  type Vehicle,
  type RawRow,
  type ApuType,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { readFile } from "../import/readFile";

/** One vehicle whose tank capacity and/or baseline MPG will change on commit. */
export interface SetupChange {
  id: string;
  unit_number: string;
  tank_before: number | null;
  tank_after: number | null;
  mpg_before: number | null;
  mpg_after: number | null;
  // CP5: idle-equipment changes (only set when the import touched them).
  equip_changed?: boolean;
  apu_type_before?: string | null;
  apu_type_after?: string | null;
  has_optimized_idle_before?: boolean | null;
  has_optimized_idle_after?: boolean | null;
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
const numEq = (a: number | null, b: number | null) =>
  Number(a ?? NaN) === Number(b ?? NaN) || (a == null && b == null);

/** Build the setup CSV text for the current fleet (active + retired), for download. */
export function buildSetupCsv(vehicles: Vehicle[]): string {
  return serializeVehicleSetupCsv(vehicles);
}

/** Read + parse + diff an uploaded setup CSV against the fleet — no writes. */
export function analyzeSetupImport(
  text: string,
  filename: string,
  vehicles: Vehicle[],
): SetupImportPreview {
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
  "apu_type",
  "has_optimized_idle",
] as const;

/** Build a ready-to-download blank template CSV with 2 illustrative example rows. */
export function buildVehicleImportTemplate(): string {
  const header = VEHICLE_IMPORT_COLUMNS.join(",");
  const ex1 = "EXAMPLE-1,diesel,Freightliner,Cascadia,2021,ABC 1234,,120,6.5,0,active,none,yes";
  const ex2 = "EXAMPLE-2,gasoline,Ford,F-450,2020,XYZ 5678,,50,,45000,active,diesel_apu,no";
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
  apu_type: string | null;
  has_optimized_idle: boolean | null;
  has_apu: boolean | null;
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
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
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
const VALID_STATUSES = ["active", "maintenance", "retired"];

const APU_TYPE_SET = new Set<string>(APU_TYPES);
/** Parse an apu_type cell: blank → leave unchanged (undefined); a valid type → the value; else an error. */
function parseApuCell(raw: string): { value?: string | null; error?: string } {
  const s = raw.trim().toLowerCase();
  if (!s) return {};
  if (APU_TYPE_SET.has(s)) return { value: s };
  return { error: `invalid apu_type "${raw}" (use: ${APU_TYPES.join(" / ")})` };
}
/** Parse a has_optimized_idle cell: blank → unchanged; yes/no (or true/false/1/0) → boolean; else error. */
function parseOptCell(raw: string): { value?: boolean | null; error?: string } {
  const s = raw.trim().toLowerCase();
  if (!s) return {};
  if (["yes", "y", "true", "1"].includes(s)) return { value: true };
  if (["no", "n", "false", "0"].includes(s)) return { value: false };
  return { error: `invalid has_optimized_idle "${raw}" (use: yes / no)` };
}

/**
 * Parse an uploaded CSV and diff it against the existing fleet.
 * – Rows whose unit_number matches an existing vehicle → SetupChange (tank + MPG only).
 * – Rows with an unknown unit_number → VehicleCreateRow (full new vehicle).
 * No database writes are made here.
 */
export function analyzeVehicleImport(
  text: string,
  filename: string,
  vehicles: Vehicle[],
): VehicleImportPreview {
  // Strip UTF-8 BOM (\uFEFF) that Excel silently prepends when saving as "CSV UTF-8".
  // Also strip any other leading invisible characters.
  const clean = text.replace(/^\uFEFF/, "").replace(/^\u200B/, "");

  const errors: string[] = [];
  const byUnit = new Map(vehicles.map((v) => [v.unit_number.trim().toLowerCase(), v]));
  const nonEmpty = clean.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2)
    return {
      filename,
      toCreate: [],
      toUpdate: [],
      unchanged: 0,
      errors: ["The file has no data rows."],
      totalRows: 0,
    };

  // Normalise header: lowercase, trim, remove any residual non-printable characters.
  const headerCells = splitCsv(nonEmpty[0]!).map((h) =>
    h
      .toLowerCase()
      .trim()
      .replace(/[^\x20-\x7e]/g, ""),
  );
  const col = (name: string) => headerCells.indexOf(name);
  const iUnit = col("unit_number");
  if (iUnit === -1) {
    const found = headerCells.filter(Boolean).join(", ") || "(none)";
    return {
      filename,
      toCreate: [],
      toUpdate: [],
      unchanged: 0,
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
    const get = (name: string) => {
      const idx = col(name);
      return idx === -1 ? "" : (cells[idx] ?? "").trim();
    };
    const unit = get("unit_number");
    if (!unit) {
      errors.push(`Line ${lineNum}: missing unit_number — skipped.`);
      continue;
    }
    const key = unit.toLowerCase();
    if (seen.has(key)) {
      errors.push(`Line ${lineNum}: duplicate unit "${unit}" — skipped.`);
      continue;
    }
    seen.add(key);

    const existing = byUnit.get(key);
    if (existing) {
      // Existing vehicle — update tank + MPG only (other fields are not overwritten)
      const tankRaw = get("tank_capacity_gal");
      const mpgRaw = get("baseline_mpg");
      const tankAfter = tankRaw
        ? (parseNumField(tankRaw) ?? Number(existing.tank_capacity_gal))
        : Number(existing.tank_capacity_gal);
      const mpgAfter = mpgRaw ? parseNumField(mpgRaw) : (existing.baseline_mpg ?? null);
      const tankChanged = !numEq(tankAfter, Number(existing.tank_capacity_gal));
      const mpgChanged = !numEq(mpgAfter, existing.baseline_mpg ?? null);
      // CP5: idle equipment (blank cell = leave unchanged).
      const apuCell = parseApuCell(get("apu_type"));
      const optCell = parseOptCell(get("has_optimized_idle"));
      if (apuCell.error) errors.push(`Line ${lineNum}: "${unit}" — ${apuCell.error}`);
      if (optCell.error) errors.push(`Line ${lineNum}: "${unit}" — ${optCell.error}`);
      const apuAfter = apuCell.value !== undefined ? apuCell.value : (existing.apu_type ?? null);
      const optAfter =
        optCell.value !== undefined ? optCell.value : (existing.has_optimized_idle ?? null);
      const apuChanged =
        apuCell.value !== undefined && String(apuAfter ?? "") !== String(existing.apu_type ?? "");
      const optChanged =
        optCell.value !== undefined && (optAfter ?? null) !== (existing.has_optimized_idle ?? null);
      if (tankChanged || mpgChanged || apuChanged || optChanged) {
        toUpdate.push({
          id: existing.id,
          unit_number: existing.unit_number,
          tank_before: Number(existing.tank_capacity_gal),
          tank_after: tankAfter,
          mpg_before: existing.baseline_mpg ?? null,
          mpg_after: mpgAfter,
          equip_changed: apuChanged || optChanged,
          apu_type_before: existing.apu_type ?? null,
          apu_type_after: apuAfter,
          has_optimized_idle_before: existing.has_optimized_idle ?? null,
          has_optimized_idle_after: optAfter,
        });
      } else {
        unchanged++;
      }
    } else {
      // New vehicle — validate required fields
      const fuelRaw = get("fuel_type").toLowerCase();
      if (!fuelRaw || !VALID_FUEL_TYPES.includes(fuelRaw)) {
        errors.push(
          `Line ${lineNum}: "${unit}" — invalid or missing fuel_type. Use: ${VALID_FUEL_TYPES.join(", ")}.`,
        );
        continue;
      }
      const yearRaw = get("year");
      const yearVal = yearRaw ? Number(yearRaw) : null;
      const year = yearVal && Number.isInteger(yearVal) && yearVal > 1900 ? yearVal : null;
      const statusRaw = get("status").toLowerCase();
      const status = VALID_STATUSES.includes(statusRaw) ? statusRaw : "active";
      const apuCellC = parseApuCell(get("apu_type"));
      const optCellC = parseOptCell(get("has_optimized_idle"));
      if (apuCellC.error) errors.push(`Line ${lineNum}: "${unit}" — ${apuCellC.error}`);
      if (optCellC.error) errors.push(`Line ${lineNum}: "${unit}" — ${optCellC.error}`);
      const apuTypeC = apuCellC.value ?? null;
      const hasOptC = optCellC.value ?? null;
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
        apu_type: apuTypeC,
        has_optimized_idle: hasOptC,
        has_apu: deriveHasApu(apuTypeC as ApuType | null),
      });
    }
  }

  return { filename, toCreate, toUpdate, unchanged, errors, totalRows: nonEmpty.length - 1 };
}

/**
 * Serialize header + parsed rows back to CSV text. This lets the CSV-based analyzer above accept BOTH
 * `.csv` and `.xlsx` uploads: the file is decoded once by the shared reader (which understands Excel),
 * then handed to the analyzer as clean CSV. Cells containing quotes/commas/newlines are quoted per RFC 4180.
 */
export function rowsToCsvText(headers: string[], rows: RawRow[]): string {
  const esc = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headerLine = headers.map(esc).join(",");
  const body = rows.map((r) => headers.map((h) => esc(r[h])).join(",")).join("\r\n");
  return body ? `${headerLine}\r\n${body}` : `${headerLine}\r\n`;
}

/**
 * Read an uploaded vehicle file — **CSV or Excel (.xlsx/.xls)** — and analyze it against the fleet.
 * Uses the same robust reader as the EFS importer, so an Excel workbook is decoded properly instead of
 * being misread as raw ZIP bytes, and an unsupported file (PDF, image, …) fails with a clear message.
 */
export async function analyzeVehicleImportFile(
  file: File,
  vehicles: Vehicle[],
): Promise<VehicleImportPreview> {
  const { headers, rows } = await readFile(file);
  return analyzeVehicleImport(rowsToCsvText(headers, rows), file.name, vehicles);
}

/** Batch-commit a vehicle import: insert new vehicles and update existing ones' tank + MPG. */
export function useCommitVehicleImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      preview: VehicleImportPreview,
    ): Promise<{ created: number; updated: number }> => {
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
          apu_type: row.apu_type,
          has_optimized_idle: row.has_optimized_idle,
          has_apu: row.has_apu,
        });
        if (error) throw new Error(`${row.unit_number}: ${error.message}`);
      }
      for (const c of preview.toUpdate) {
        const patch: Record<string, unknown> = {
          tank_capacity_gal: c.tank_after,
          baseline_mpg: c.mpg_after,
        };
        if (c.equip_changed) {
          patch.apu_type = c.apu_type_after ?? null;
          patch.has_optimized_idle = c.has_optimized_idle_after ?? null;
          patch.has_apu = deriveHasApu((c.apu_type_after ?? null) as ApuType | null);
        }
        const { error } = await supabase.from("vehicles").update(patch).eq("id", c.id);
        if (error) throw new Error(`${c.unit_number}: ${error.message}`);
      }
      return { created: preview.toCreate.length, updated: preview.toUpdate.length };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vehicles"] }),
  });
}
