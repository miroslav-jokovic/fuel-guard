import type { Vehicle } from "./fleet.js";

/**
 * Bulk vehicle setup via a CSV round-trip. Export writes one row per vehicle; the fleet manager fills in
 * tank capacity + baseline MPG offline and uploads the file back. Only those two fields are writable on
 * import — everything else is reference-only and matched by `unit_number`. Pure + testable (no I/O here).
 */

/** Column order for the exported template. `unit_number` is the join key; the trailing three are read-only. */
export const SETUP_CSV_COLUMNS = [
  "unit_number",
  "tank_capacity_gal",
  "baseline_mpg",
  "make",
  "model",
  "year",
  "fuel_type",
  "current_odometer",
  "apu_type",
  "has_optimized_idle",
] as const;

/** The only fields an import will write back to a vehicle. */
export const SETUP_EDITABLE_FIELDS = ["tank_capacity_gal", "baseline_mpg"] as const;

type SetupVehicle = Pick<
  Vehicle,
  | "unit_number"
  | "tank_capacity_gal"
  | "baseline_mpg"
  | "make"
  | "model"
  | "year"
  | "fuel_type"
  | "current_odometer"
  | "apu_type"
  | "has_optimized_idle"
>;

export interface ParsedSetupRow {
  line: number; // 1-based source line (for error messages)
  unit_number: string;
  /** null = cell left blank → leave the vehicle's value unchanged. */
  tank_capacity_gal: number | null;
  baseline_mpg: number | null;
}

export interface ParseSetupResult {
  rows: ParsedSetupRow[];
  errors: string[];
}

const q = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Serialize vehicles to the setup CSV template (header + one row each). */
export function serializeVehicleSetupCsv(vehicles: SetupVehicle[]): string {
  const header = SETUP_CSV_COLUMNS.join(",");
  const lines = vehicles.map((v) =>
    [
      v.unit_number,
      v.tank_capacity_gal ?? "",
      v.baseline_mpg ?? "",
      v.make ?? "",
      v.model ?? "",
      v.year ?? "",
      v.fuel_type,
      v.current_odometer ?? "",
      v.apu_type ?? "",
      v.has_optimized_idle == null ? "" : v.has_optimized_idle ? "yes" : "no",
    ]
      .map(q)
      .join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

/** Split one CSV line into fields, honoring double-quoted values and escaped ("") quotes. */
function splitCsvLine(line: string): string[] {
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

/** Parse a non-blank numeric cell. Returns { value } on success, { error } on a bad number, or null if blank. */
function parseCell(
  raw: string,
  field: string,
  line: number,
): { value: number } | { error: string } | null {
  const s = raw.replace(/[$,]/g, "").trim();
  if (s === "") return null; // blank → leave unchanged
  const num = Number(s);
  if (!Number.isFinite(num)) return { error: `Line ${line}: ${field} "${raw}" is not a number.` };
  if (num < 0) return { error: `Line ${line}: ${field} cannot be negative.` };
  return { value: num };
}

/**
 * Parse an uploaded setup CSV into per-row editable values. Tolerant of column order and extra columns
 * (matched by header name). Blank editable cells are returned as null so a partially-filled sheet is safe.
 */
export function parseVehicleSetupCsv(text: string): ParseSetupResult {
  const errors: string[] = [];
  const rawLines = text
    .split(/\r\n|\n|\r/)
    .filter((l, i, arr) => l.trim() !== "" || i < arr.length - 1);
  const nonEmpty = rawLines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return { rows: [], errors: ["The file has no data rows."] };

  const header = splitCsvLine(nonEmpty[0]!).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iUnit = col("unit_number");
  const iTank = col("tank_capacity_gal");
  const iMpg = col("baseline_mpg");
  if (iUnit === -1) return { rows: [], errors: ['Missing required "unit_number" column.'] };
  if (iTank === -1 && iMpg === -1) {
    return {
      rows: [],
      errors: ['Nothing to import: include a "tank_capacity_gal" and/or "baseline_mpg" column.'],
    };
  }

  const rows: ParsedSetupRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < nonEmpty.length; i++) {
    const line = i + 1; // 1-based, header is line 1
    const cells = splitCsvLine(nonEmpty[i]!);
    const unit = (cells[iUnit] ?? "").trim();
    if (unit === "") {
      errors.push(`Line ${line}: missing unit number — row skipped.`);
      continue;
    }
    const key = unit.toLowerCase();
    if (seen.has(key)) {
      errors.push(`Line ${line}: duplicate unit "${unit}" — first occurrence used.`);
      continue;
    }
    seen.add(key);

    let tank: number | null = null;
    let mpg: number | null = null;
    if (iTank !== -1) {
      const r = parseCell(cells[iTank] ?? "", "tank_capacity_gal", line);
      if (r && "error" in r) errors.push(r.error);
      else if (r) tank = r.value;
    }
    if (iMpg !== -1) {
      const r = parseCell(cells[iMpg] ?? "", "baseline_mpg", line);
      if (r && "error" in r) errors.push(r.error);
      else if (r) mpg = r.value;
    }
    rows.push({ line, unit_number: unit, tank_capacity_gal: tank, baseline_mpg: mpg });
  }
  return { rows, errors };
}
