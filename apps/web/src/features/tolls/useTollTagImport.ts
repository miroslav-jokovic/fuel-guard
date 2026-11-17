import { ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import {
  TOLL_PROVIDERS,
  TOLL_PROVIDER_LABEL,
  TOLL_TAG_IMPORT_BATCH,
  TOLL_TAG_SHEET_COLUMNS,
  fieldValueToInstant,
  isInServiceVehicleStatus,
  planTollTagImport,
  readTollTagSheet,
  wallClockInZone,
  type PlannedTollTagLine,
  type TollTagImportItem,
  type TollTagImportResult,
  type TollTagSheetRow,
  type TransponderDto,
  type Vehicle,
} from "@silvicom/shared";
import { apiFetch } from "@/lib/api";
import { readReportGrid } from "@/lib/reportGrid";

/**
 * The toll-tag spreadsheet, client side (TOLLS-PER-TRUCK-PLAN.md TL2b): hand the office a sheet of
 * its trucks to fill in, read the sheet that comes back, show what each line will do, and send the
 * lines in parts so a long fleet shows its progress.
 *
 * The preview and the import run ONE planner (`planTollTagImport`); the API runs it again on what
 * is on file at that moment, and its answer per line is what the drawer finally shows.
 */

export const TOLL_TAG_SHEET_ACCEPT = ".xlsx,.xls,.ods,.csv";

/** One line as the preview shows it: a line the sheet could not read has no plan, only its problem. */
export interface TagPreviewLine {
  row: TollTagSheetRow;
  plan: PlannedTollTagLine | null;
}

export interface TagPreview {
  fileName: string;
  lines: TagPreviewLine[];
  trucksWithoutTag: number;
}

export const vehiclesForImport = (vehicles: readonly Vehicle[]) =>
  vehicles.map((v) => ({ id: v.id, unitNumber: v.unit_number, inService: isInServiceVehicleStatus(v.status) }));

/** Read a dropped file and plan it against the fleet as it is loaded on this page. */
export async function previewTollTagFile(
  file: File,
  ctx: { tags: readonly TransponderDto[]; vehicles: readonly Vehicle[]; zone: string; now?: Date },
): Promise<TagPreview> {
  const sheet = readTollTagSheet(await readReportGrid(file));
  const items: TollTagImportItem[] = [];
  for (const row of sheet.rows) {
    if (row.problem) continue;
    const at = fieldValueToInstant(`${row.since}T00:00`, ctx.zone);
    if (!at) continue;
    items.push({ line: row.line, unitNumber: row.unit, provider: row.provider!, tagNumber: row.tagNumber!, at, issuer: row.issuer });
  }
  const plans = new Map(
    planTollTagImport(items, { tags: ctx.tags, vehicles: vehiclesForImport(ctx.vehicles), now: ctx.now ?? new Date(), zone: ctx.zone }).map((p) => [p.item.line, p]),
  );
  return { fileName: file.name, lines: sheet.rows.map((row) => ({ row, plan: plans.get(row.line) ?? null })), trucksWithoutTag: sheet.trucksWithoutTag };
}

/** The lines that change something — the only ones sent. */
export const changingLines = (p: TagPreview): PlannedTollTagLine[] =>
  p.lines.flatMap((l) => (l.plan && ["add", "move", "backdate"].includes(l.plan.verdict.kind) ? [l.plan] : []));

/** Send the changing lines in parts of `TOLL_TAG_IMPORT_BATCH`, one after another, with progress. */
export function useImportTollTags() {
  const qc = useQueryClient();
  const sent = ref(0);
  const running = ref(false);
  async function run(lines: readonly PlannedTollTagLine[]): Promise<TollTagImportResult[]> {
    running.value = true;
    sent.value = 0;
    const results: TollTagImportResult[] = [];
    try {
      for (let i = 0; i < lines.length; i += TOLL_TAG_IMPORT_BATCH) {
        const rows = lines.slice(i, i + TOLL_TAG_IMPORT_BATCH).map(({ item }) => item);
        const r = await apiFetch<{ results: TollTagImportResult[] }>("/api/tolls/transponders/import", { method: "POST", body: { rows } });
        if (!r.ok || !r.data) {
          const message = r.error?.message ?? "Could not import these lines. Import the sheet again; lines already done are left as they are.";
          results.push(...rows.map((row) => ({ line: row.line, outcome: "refused" as const, message })));
        } else {
          results.push(...r.data.results);
        }
        sent.value = Math.min(lines.length, i + TOLL_TAG_IMPORT_BATCH);
      }
      return results;
    } finally {
      running.value = false;
      void qc.invalidateQueries({ queryKey: ["toll-tags"] });
    }
  }
  return { run, sent, running };
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A calendar day as the date an Excel cell holds: UTC midnight, which Excel shows as that day. */
function excelDay(iso: string, zone: string): Date {
  const wc = wallClockInZone(new Date(iso), zone);
  return new Date(Date.UTC(wc.year, wc.month - 1, wc.day));
}

/**
 * The sheet to fill in: one line per truck in service, already carrying the tags on file with their
 * days, and an empty line for each truck with none. Re-importing it unchanged changes nothing, so the
 * office can fill in the gaps and send the whole thing back. The tag number column is TEXT, so Excel
 * keeps a tag's leading zeros; the provider column offers the three names as a list.
 */
export async function downloadTollTagSheet(vehicles: readonly Vehicle[], tags: readonly TransponderDto[], zone: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Toll tags", { views: [{ state: "frozen", ySplit: 1 }] });
  const c = TOLL_TAG_SHEET_COLUMNS;
  ws.columns = [
    { header: c.unit, key: "unit", width: 12 },
    { header: c.provider, key: "provider", width: 14 },
    { header: c.tagNumber, key: "tag", width: 22, style: { numFmt: "@" } },
    { header: c.since, key: "since", width: 16, style: { numFmt: "mm/dd/yyyy" } },
    { header: c.issuer, key: "issuer", width: 22 },
  ];
  ws.getRow(1).font = { bold: true };

  const onTruck = new Map<string, TransponderDto[]>();
  for (const t of tags) if (t.currentVehicleId && !t.retiredAt) onTruck.set(t.currentVehicleId, [...(onTruck.get(t.currentVehicleId) ?? []), t]);
  const trucks = vehicles.filter((v) => isInServiceVehicleStatus(v.status)).sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));
  for (const v of trucks) {
    const held = onTruck.get(v.id) ?? [];
    if (held.length === 0) ws.addRow({ unit: v.unit_number });
    for (const t of held) {
      const since = t.history.find((h) => h.vehicleId === v.id && h.validTo == null && h.voidedAt == null)?.validFrom;
      ws.addRow({ unit: v.unit_number, provider: TOLL_PROVIDER_LABEL[t.provider], tag: t.tagNumber, since: since ? excelDay(since, zone) : null, issuer: t.issuer });
    }
  }
  const list = `"${TOLL_PROVIDERS.map((p) => TOLL_PROVIDER_LABEL[p]).join(",")}"`;
  for (let r = 2; r <= ws.rowCount + 200; r++) {
    ws.getCell(r, 2).dataValidation = { type: "list", allowBlank: true, formulae: [list] };
    ws.getCell(r, 3).numFmt = "@";
    ws.getCell(r, 4).numFmt = "mm/dd/yyyy";
  }

  const help = wb.addWorksheet("How to fill it in");
  help.getColumn(1).width = 110;
  [
    "One line per tag. A truck with two tags (E-ZPass and K-TAG) has two lines.",
    `${c.unit}: the unit number, as on the Vehicles list. Lines with no tag number are skipped.`,
    `${c.provider}: E-ZPass, K-TAG or ExpressToll.`,
    `${c.tagNumber}: as printed on the tag. Spaces and dashes are fine.`,
    `${c.since}: the day the tag went on this truck. Tolls from that day on are charged to this truck.`,
    `${c.issuer}: optional. The agency on the account, e.g. NTTA or Illinois Tollway.`,
    "Importing the same sheet again changes nothing that is already right.",
  ].forEach((line) => help.addRow([line]));

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "toll-tags.xlsx");
}
