import { TOLL_PROVIDERS, normaliseTagNumber, type TollProvider } from "./tollTags.js";
import type { CalendarDay } from "../calendarDay.js";

/**
 * The office's toll-tag spreadsheet, read (TOLLS-PER-TRUCK-PLAN.md TL2b). Pure: it takes the cell grid
 * the browser decoded (`apps/web/src/lib/reportGrid.ts` reads .xlsx, .xls, .ods and .csv by their
 * bytes) and returns one row per line, each either usable or carrying the sentence that says what to
 * fix. Deciding what a usable row DOES to the fleet is `tollTagImport.ts`'s job, on both sides.
 *
 * ── THE COLUMNS ARE FOUND BY NAME, NOT POSITION ──────────────────────────────────────────────
 * The sheet we hand out has five columns in a fixed order, but the file that comes back is often the
 * office's own list (a fleet roster with a tag column added, an agency's tag export with a truck
 * column typed in). So the header row is looked for in the first ten rows, and each column is found
 * by the names people actually give it. Truck, provider, tag number and the start day are required;
 * "Issued by" is optional.
 *
 * ── THE START DAY IS REQUIRED, NEVER DEFAULTED ───────────────────────────────────────────────
 * A toll is charged to the truck that held the tag on the day (D-TL3), and the owner is loading six
 * months of statements (Q-TL4). A row without its day would have to default to today, which throws
 * away exactly the months the import exists to cover. So a blank day is a row to fix, not a guess.
 */

export type SheetCell = string | number | null | undefined;

/** The five columns, by the header we write in the template — the names the office sees. */
export const TOLL_TAG_SHEET_COLUMNS = {
  unit: "Truck",
  provider: "Provider",
  tagNumber: "Tag number",
  since: "On truck since",
  issuer: "Issued by",
} as const;
type Column = keyof typeof TOLL_TAG_SHEET_COLUMNS;

/** Header spellings met in real lists, compared with case, spaces and punctuation removed. */
const HEADER_ALIASES: Record<Column, readonly string[]> = {
  unit: ["truck", "unit", "unitnumber", "unitno", "truckno", "trucknumber", "truckunit", "tractor", "tractorno"],
  provider: ["provider", "tollprovider", "tagtype", "tagprovider", "network"],
  tagNumber: ["tagnumber", "tag", "tagno", "transponder", "transpondernumber", "transponderno", "tagid", "deviceno", "devicenumber"],
  since: ["ontrucksince", "since", "ontruck", "installed", "installedon", "dateinstalled", "startdate", "from", "assigned", "assignedon", "date"],
  issuer: ["issuedby", "issuer", "agency", "issuingagency", "account", "authority"],
};

const squash = (s: SheetCell): string => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Provider as people write it: `E-ZPass`, `EZ Pass`, `ezpass`, `K-TAG`, `KTag`, `Express Toll`.
 * I-PASS is an E-ZPass agency (Q-TL2), so it reads as E-ZPass; NTTA's TollTag and TxTag are not
 * among the three providers and are refused rather than guessed.
 */
const PROVIDER_ALIASES: Record<string, TollProvider> = {
  ezpass: "ezpass",
  ezp: "ezpass",
  ipass: "ezpass",
  ktag: "ktag",
  kansasturnpike: "ktag",
  expresstoll: "expresstoll",
  e470: "expresstoll",
};

export function readTollProvider(raw: SheetCell): TollProvider | null {
  const s = squash(raw);
  if ((TOLL_PROVIDERS as readonly string[]).includes(s)) return s as TollProvider;
  return PROVIDER_ALIASES[s] ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");
function realDay(y: number, m: number, d: number): CalendarDay | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * A spreadsheet date cell as a calendar day, or null. Three shapes arrive:
 *   · an ISO string — the decoder writes Excel date cells as `2026-05-14T00:00:00.000Z`, the day the
 *     cell shows (Excel stores no zone; ExcelJS reads it as UTC midnight), so the first ten
 *     characters ARE the day and no zone is consulted;
 *   · a number — an Excel serial a CSV or an unformatted cell carries (days since 1899-12-30);
 *   · typed text, read the US way the office writes it: `5/14/2026`, `05-14-26`.
 */
export function readSheetDay(raw: SheetCell): CalendarDay | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 20000 || raw > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 86_400_000);
    return realDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (iso) return realDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (us) {
    const y = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    return realDay(y, Number(us[1]), Number(us[2]));
  }
  if (/^\d+(\.\d+)?$/.test(s)) return readSheetDay(Number(s));
  return null;
}

/** One line of the sheet. `problem` is null exactly when every field below it is usable. */
export interface TollTagSheetRow {
  /** The spreadsheet's own row number, so "line 14" means the row the office sees as 14. */
  line: number;
  unit: string;
  provider: TollProvider | null;
  /** What was typed, for the preview when it could not be read. */
  providerText: string;
  tagNumber: string | null;
  tagText: string;
  since: CalendarDay | null;
  sinceText: string;
  issuer: string | null;
  problem: string | null;
}

export interface TollTagSheet {
  rows: TollTagSheetRow[];
  /** Lines naming a truck with no tag number — the template's empty rows — left out, and counted. */
  trucksWithoutTag: number;
}

export class TollTagSheetError extends Error {}

const text = (c: SheetCell): string => (c == null ? "" : String(c).trim());

function findHeader(grid: readonly (readonly SheetCell[])[]): { row: number; at: Partial<Record<Column, number>> } | null {
  for (let r = 0; r < Math.min(10, grid.length); r++) {
    const at: Partial<Record<Column, number>> = {};
    (grid[r] ?? []).forEach((cell, c) => {
      const h = squash(cell);
      if (!h) return;
      for (const col of Object.keys(HEADER_ALIASES) as Column[]) {
        if (at[col] === undefined && HEADER_ALIASES[col].includes(h)) {
          at[col] = c;
          return;
        }
      }
    });
    if (at.unit !== undefined && at.tagNumber !== undefined) return { row: r, at };
  }
  return null;
}

/**
 * The grid, read. Throws `TollTagSheetError` with the sentence to show when the sheet as a whole
 * cannot be used (no header row, a required column missing); a bad LINE is a row with a `problem`.
 */
export function readTollTagSheet(grid: readonly (readonly SheetCell[])[]): TollTagSheet {
  const header = findHeader(grid);
  if (!header) {
    throw new TollTagSheetError(
      `No header row found. The sheet needs columns named "${TOLL_TAG_SHEET_COLUMNS.unit}" and "${TOLL_TAG_SHEET_COLUMNS.tagNumber}" in one of its first ten rows. Download the sheet from this page to start from the right columns.`,
    );
  }
  const missing = (["provider", "since"] as const).filter((c) => header.at[c] === undefined);
  if (missing.length) {
    throw new TollTagSheetError(`The sheet has no ${missing.map((c) => `"${TOLL_TAG_SHEET_COLUMNS[c]}"`).join(" or ")} column. Add it and import again.`);
  }
  const cell = (row: readonly SheetCell[], col: Column): SheetCell => {
    const i = header.at[col];
    return i === undefined ? null : row[i];
  };

  const rows: TollTagSheetRow[] = [];
  let trucksWithoutTag = 0;
  for (let r = header.row + 1; r < grid.length; r++) {
    const raw = grid[r] ?? [];
    const unit = text(cell(raw, "unit"));
    const tagText = text(cell(raw, "tagNumber"));
    if (!tagText) {
      if (unit) trucksWithoutTag++;
      continue;
    }
    const providerText = text(cell(raw, "provider"));
    const sinceCell = cell(raw, "since");
    const provider = readTollProvider(providerText);
    const tagNumber = normaliseTagNumber(tagText);
    const since = readSheetDay(typeof sinceCell === "string" ? sinceCell.trim() : sinceCell);
    const issuer = text(cell(raw, "issuer")).slice(0, 64) || null;

    let problem: string | null = null;
    if (!unit) problem = "No truck. Type the truck's unit number.";
    else if (!providerText) problem = "No provider. Write E-ZPass, K-TAG or ExpressToll.";
    else if (!provider) problem = `"${providerText}" is not E-ZPass, K-TAG or ExpressToll.`;
    else if (!tagNumber) problem = "The tag number must be 4 to 24 letters and digits, as printed on the tag.";
    else if (!text(sinceCell)) problem = "No start day. Give the day the tag went on this truck.";
    else if (!since) problem = `"${text(sinceCell)}" is not a date. Write it as MM/DD/YYYY.`;

    rows.push({ line: r + 1, unit, provider, providerText, tagNumber, tagText, since, sinceText: text(sinceCell), issuer, problem });
  }
  return { rows, trucksWithoutTag };
}
