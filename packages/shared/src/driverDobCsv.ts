import { dateOfBirthIssue } from "./rosterContract.js";

/**
 * Bulk date-of-birth import (PSP-PLAN P0b).
 *
 * ── WHY A CSV, AND WHY THIS ONE FIELD ──────────────────────────────────────────────────────────
 * Production on 2026-08-20: 201 drivers who could be screened, a date of birth for none of them.
 * The value almost always already exists in the carrier's payroll or HR export; what was missing was
 * a way to get it in that is not 201 page visits. This is the `vehicleSetupCsv` round trip applied
 * to the one field that blocks everything.
 *
 * Only `date_of_birth` is writable. Licence number and state are the OTHER screening identity
 * fields and are deliberately not importable: the Samsara sync owns them under enrich-never-clobber
 * (D6), and a spreadsheet fighting a telematics sync over a driver's licence number is a worse
 * problem than the 35 drivers it would fix. Those stay a per-driver roster edit.
 *
 * ── MATCHING IS THE DANGEROUS PART, SO IT REFUSES RATHER THAN GUESSES ──────────────────────────
 * A date of birth written onto the wrong driver is not a data-entry slip: it is a screening request
 * about the wrong person, billed (§8), and possibly a record filed against someone whose job depends
 * on it. So an ambiguous row is REJECTED and reported, never resolved by picking the first match.
 * The exported template carries `driver_id` for exactly this reason — an id match cannot be
 * ambiguous — and the name/employee-number fallbacks exist only for the spreadsheet that came out
 * of payroll and has never heard of us.
 *
 * Pure. No I/O, no clock — `today` is an argument, as everywhere else.
 */

/** Template column order. The first four identify; only the last is read back. */
export const DOB_CSV_COLUMNS = [
  "driver_id",
  "full_name",
  "employee_id",
  "cdl_number",
  "date_of_birth",
] as const;

export interface DobCsvDriver {
  id: string;
  full_name: string;
  employee_id: string | null;
  cdl_number: string | null;
  date_of_birth: string | null;
}

export interface DobMatch {
  line: number;
  driverId: string;
  name: string;
  dateOfBirth: string;
  matchedBy: "driver_id" | "employee_id" | "cdl_number" | "name";
}

export type DobRejectReason =
  /** No driver in this org answers to anything on the row. */
  | "no_match"
  /** More than one does — and picking one is how somebody else's birthday lands on this driver. */
  | "ambiguous"
  /** Already on file. The import never overwrites; a correction is a deliberate per-driver edit. */
  | "already_on_file"
  /** The cell is not a date this system will accept, or not a date a driver could have. */
  | "invalid_date";

export interface DobReject {
  line: number;
  /** Whatever the row called the person, so a human can find the line in their own spreadsheet. */
  label: string;
  reason: DobRejectReason;
  detail: string | null;
}

export interface DobImportPlan {
  matches: DobMatch[];
  rejects: DobReject[];
  /** Problems with the FILE rather than with a row — a missing column, an empty sheet. */
  errors: string[];
}

export const DOB_REJECT_LABELS: Record<DobRejectReason, string> = {
  no_match: "No matching driver",
  ambiguous: "Matches more than one driver",
  already_on_file: "Already on file — not overwritten",
  invalid_date: "Not a usable date of birth",
};

const q = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The template: one row per driver, `date_of_birth` blank for the ones that need it. */
export function serializeDobCsv(drivers: readonly DobCsvDriver[]): string {
  const lines = drivers.map((d) =>
    [d.id, d.full_name, d.employee_id ?? "", d.cdl_number ?? "", d.date_of_birth ?? ""]
      .map(q)
      .join(","),
  );
  return [DOB_CSV_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}

/** Split one CSV line into fields, honouring quoted values and escaped ("") quotes. */
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

/**
 * Read one date cell.
 *
 * ISO `YYYY-MM-DD` and `YYYY/MM/DD` only, and `03/04/1980` is REFUSED rather than interpreted.
 * Guessing between the American and the rest-of-the-world reading of that row would silently produce
 * a different person's birthday four times out of twelve, and the failure is invisible: both dates
 * are real, both pass validation, and the wrong one produces a PSP `Failure` we pay for. The error
 * names the fix instead.
 */
function readDate(raw: string, today: string): { value: string } | { error: string } {
  const cell = raw.trim();
  if (cell === "") return { error: "No date in the row" };
  const iso = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(cell);
  if (!iso) {
    return {
      error: `"${cell}" is not YYYY-MM-DD. Format the column as a plain date so nothing has to be guessed.`,
    };
  }
  const normalised = `${iso[1]}-${iso[2]}-${iso[3]}`;
  const issue = dateOfBirthIssue(normalised, today);
  return issue ? { error: issue } : { value: normalised };
}

const norm = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();

/** Index the roster by each key we are willing to match on. A key held by two drivers is poison and
 *  is dropped from the index entirely — see the header. */
function indexDrivers(drivers: readonly DobCsvDriver[]) {
  const build = (pick: (d: DobCsvDriver) => string): Map<string, DobCsvDriver | null> => {
    const map = new Map<string, DobCsvDriver | null>();
    for (const d of drivers) {
      const key = pick(d);
      if (!key) continue;
      map.set(key, map.has(key) ? null : d); // null = ambiguous
    }
    return map;
  };
  return {
    byId: build((d) => norm(d.id)),
    byEmployee: build((d) => norm(d.employee_id)),
    byCdl: build((d) => norm(d.cdl_number)),
    byName: build((d) => norm(d.full_name)),
  };
}

/**
 * What this file would do, before it does anything.
 *
 * Every outcome is reported: matched rows say which key matched them, and every rejected row says
 * why in terms the person holding the spreadsheet can act on. A silent skip would leave somebody
 * believing 201 drivers were imported when 40 were.
 */
export function planDobImport(
  text: string,
  drivers: readonly DobCsvDriver[],
  today: string,
): DobImportPlan {
  const errors: string[] = [];
  const nonEmpty = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return { matches: [], rejects: [], errors: ["The file has no data rows."] };

  const header = splitCsvLine(nonEmpty[0]!).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iDob = col("date_of_birth");
  if (iDob === -1) {
    return { matches: [], rejects: [], errors: ['Missing a "date_of_birth" column.'] };
  }
  const iId = col("driver_id");
  const iName = col("full_name");
  const iEmployee = col("employee_id");
  const iCdl = col("cdl_number");
  if (iId === -1 && iName === -1 && iEmployee === -1 && iCdl === -1) {
    return {
      matches: [],
      rejects: [],
      errors: ['Nothing to match on: include a "driver_id", "employee_id", "cdl_number" or "full_name" column.'],
    };
  }

  const index = indexDrivers(drivers);
  const matches: DobMatch[] = [];
  const rejects: DobReject[] = [];
  const claimed = new Map<string, number>();

  for (let i = 1; i < nonEmpty.length; i++) {
    const line = i + 1;
    const cells = splitCsvLine(nonEmpty[i]!);
    const cell = (idx: number) => (idx === -1 ? "" : (cells[idx] ?? ""));
    const label = cell(iName) || cell(iEmployee) || cell(iId) || cell(iCdl) || `line ${line}`;

    // In trust order: an id cannot be ambiguous, a name very much can.
    const lookups: Array<[Map<string, DobCsvDriver | null>, string, DobMatch["matchedBy"]]> = [
      [index.byId, norm(cell(iId)), "driver_id"],
      [index.byEmployee, norm(cell(iEmployee)), "employee_id"],
      [index.byCdl, norm(cell(iCdl)), "cdl_number"],
      [index.byName, norm(cell(iName)), "name"],
    ];
    // Bound together rather than as two variables: the driver and the key that found them are one
    // fact, and letting them be separately assignable is how a row gets a match with no provenance.
    let found: { driver: DobCsvDriver; matchedBy: DobMatch["matchedBy"] } | null = null;
    let ambiguous = false;
    for (const [map, key, how] of lookups) {
      if (!key || !map.has(key)) continue;
      const hit = map.get(key) ?? null;
      if (hit === null) {
        ambiguous = true;
        continue;
      }
      found = { driver: hit, matchedBy: how };
      break;
    }

    if (!found) {
      rejects.push({
        line,
        label,
        reason: ambiguous ? "ambiguous" : "no_match",
        detail: ambiguous ? "More than one driver answers to this. Add the driver_id column." : null,
      });
      continue;
    }

    const { driver, matchedBy } = found;

    // Never overwrite. A date of birth already on file was put there by somebody who meant it, and a
    // correction is a deliberate act on that driver's own page — not a side effect of a bulk upload.
    if (driver.date_of_birth) {
      rejects.push({ line, label, reason: "already_on_file", detail: null });
      continue;
    }

    const date = readDate(cell(iDob), today);
    if ("error" in date) {
      rejects.push({ line, label, reason: "invalid_date", detail: date.error });
      continue;
    }

    // Two rows claiming one driver is the same failure as one row matching two drivers.
    const previous = claimed.get(driver.id);
    if (previous !== undefined) {
      rejects.push({
        line,
        label,
        reason: "ambiguous",
        detail: `Line ${previous} already sets a date of birth for this driver.`,
      });
      continue;
    }
    claimed.set(driver.id, line);

    matches.push({
      line,
      driverId: driver.id,
      name: driver.full_name,
      dateOfBirth: date.value,
      matchedBy,
    });
  }

  return { matches, rejects, errors };
}
