import type { SupabaseClient } from "@supabase/supabase-js";
import { LABEL_PRESET_IDS, type LabelPresetId } from "@silvicom/qr";
import type {
  CreatePrinterRequest,
  PrintDefaultsDto,
  PrinterDto,
  PrintPurpose,
  SetDefaultRequest,
  UpdatePrinterRequest,
} from "@silvicom/shared";
import type { ServiceError } from "../inventory/types.js";
import { isRollStock } from "./labelRaster.js";
import { isOnline } from "./stations.js";

/**
 * Printers and the default a Print button uses without asking (PRINTERS-AND-SCANNERS-PLAN.md D-PS3,
 * D-PS4; 0526).
 *
 * ── THE STOCK IS CHECKED AGAINST THE CATALOGUE, NOT RESTATED ─────────────────────────────────
 * A printer's `stock_id` is a `@silvicom/qr` preset id that feeds one label at a time. 0526 does not
 * list the ids in a CHECK (a new stock is not a migration); this file asks the catalogue, which is
 * the one place they are defined.
 *
 * ── "EFFECTIVE" IS DERIVED, NEVER STORED ─────────────────────────────────────────────────────
 * Which printer Print uses is the person's own choice, else the organization's — and never a retired
 * printer: a retired default stays as a row (so the screen can say "your default was retired") and
 * simply stops being effective. Nothing is rewritten when a printer retires.
 */

interface PrinterRow {
  id: string;
  name: string;
  station_id: string;
  system_name: string;
  language: "tspl";
  stock_id: string;
  dpi: number;
  offset_x_dots: number;
  offset_y_dots: number;
  retired_at: string | null;
  print_stations: { name: string; last_seen_at: string | null; revoked_at: string | null } | null;
}

const PRINTER_COLUMNS =
  "id, name, station_id, system_name, language, stock_id, dpi, offset_x_dots, offset_y_dots, retired_at, print_stations(name, last_seen_at, revoked_at)";

const fail = (code: string, error: string): ServiceError => ({ code, error });

export const rollStockOrNull = (id: string): LabelPresetId | null =>
  (LABEL_PRESET_IDS as readonly string[]).includes(id) && isRollStock(id as LabelPresetId) ? (id as LabelPresetId) : null;

function toPrinterDto(row: PrinterRow): PrinterDto {
  const station = row.print_stations;
  return {
    id: row.id,
    name: row.name,
    stationId: row.station_id,
    stationName: station?.name ?? "",
    systemName: row.system_name,
    language: row.language,
    stockId: row.stock_id,
    dpi: row.dpi,
    offsetXDots: row.offset_x_dots,
    offsetYDots: row.offset_y_dots,
    online: row.retired_at === null && station !== null && station.revoked_at === null && isOnline(station.last_seen_at),
    retired: row.retired_at !== null,
  };
}

/** 0526's guards, named for the screen. */
function fromDbError(error: { code?: string; message: string }): ServiceError {
  if (error.code === "23505") return fail("duplicate_printer", "A printer with that name already exists.");
  if (error.code === "PS001") return fail("not_found", "That print station does not exist.");
  if (error.code === "PS004") return fail("printer_retired", "That printer is retired and cannot be chosen.");
  return fail("db_error", error.message);
}

export async function listPrinters(admin: SupabaseClient, orgId: string): Promise<PrinterDto[] | ServiceError> {
  const { data, error } = await admin.from("printers").select(PRINTER_COLUMNS).eq("org_id", orgId).order("name");
  if (error) return fromDbError(error);
  return (data as unknown as PrinterRow[]).map(toPrinterDto);
}

export async function getPrinter(admin: SupabaseClient, orgId: string, printerId: string): Promise<PrinterRow | null> {
  const { data } = await admin.from("printers").select(PRINTER_COLUMNS).eq("org_id", orgId).eq("id", printerId).maybeSingle();
  return (data as unknown as PrinterRow | null) ?? null;
}

export async function createPrinter(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  input: CreatePrinterRequest,
): Promise<PrinterDto | ServiceError> {
  if (!rollStockOrNull(input.stockId)) return fail("unknown_stock", "A label printer needs a roll stock — one label at a time.");
  const { data, error } = await admin
    .from("printers")
    .insert({
      org_id: orgId,
      station_id: input.stationId,
      name: input.name,
      system_name: input.systemName,
      language: input.language,
      stock_id: input.stockId,
      dpi: input.dpi,
      offset_x_dots: input.offsetXDots,
      offset_y_dots: input.offsetYDots,
      created_by: userId,
    })
    .select(PRINTER_COLUMNS)
    .single();
  if (error) return fromDbError(error);
  return toPrinterDto(data as unknown as PrinterRow);
}

export async function updatePrinter(
  admin: SupabaseClient,
  orgId: string,
  printerId: string,
  patch: UpdatePrinterRequest,
): Promise<PrinterDto | ServiceError> {
  if (patch.stockId !== undefined && !rollStockOrNull(patch.stockId)) {
    return fail("unknown_stock", "A label printer needs a roll stock — one label at a time.");
  }
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.systemName !== undefined) row.system_name = patch.systemName;
  if (patch.stockId !== undefined) row.stock_id = patch.stockId;
  if (patch.offsetXDots !== undefined) row.offset_x_dots = patch.offsetXDots;
  if (patch.offsetYDots !== undefined) row.offset_y_dots = patch.offsetYDots;
  if (patch.retired !== undefined) row.retired_at = patch.retired ? new Date().toISOString() : null;
  const { data, error } = await admin
    .from("printers")
    .update(row)
    .eq("org_id", orgId)
    .eq("id", printerId)
    .select(PRINTER_COLUMNS)
    .maybeSingle();
  if (error) return fromDbError(error);
  if (!data) return fail("not_found", "That printer does not exist.");
  return toPrinterDto(data as unknown as PrinterRow);
}

interface DefaultRow {
  user_id: string | null;
  printer_id: string;
  printers: { retired_at: string | null } | null;
}

export async function getDefaults(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  purpose: PrintPurpose,
): Promise<PrintDefaultsDto | ServiceError> {
  const { data, error } = await admin
    .from("print_defaults")
    .select("user_id, printer_id, printers(retired_at)")
    .eq("org_id", orgId)
    .eq("purpose", purpose);
  if (error) return fromDbError(error);
  const rows = data as unknown as DefaultRow[];
  const org = rows.find((r) => r.user_id === null) ?? null;
  const mine = userId ? (rows.find((r) => r.user_id === userId) ?? null) : null;
  const live = (r: DefaultRow | null) => (r && r.printers?.retired_at == null ? r.printer_id : null);
  return {
    purpose,
    organizationPrinterId: org?.printer_id ?? null,
    myPrinterId: mine?.printer_id ?? null,
    effectivePrinterId: live(mine) ?? live(org),
  };
}

/**
 * Set or clear one default. Written as delete-then-insert of one row rather than an upsert: the
 * unique indexes are partial (0526), which `on conflict` cannot target, and a partial-payload upsert
 * is refused in this repo anyway (`lint:upserts`).
 */
export async function setDefault(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  input: SetDefaultRequest,
): Promise<PrintDefaultsDto | ServiceError> {
  const forUser = input.scope === "me" ? userId : null;
  let del = admin.from("print_defaults").delete().eq("org_id", orgId).eq("purpose", input.purpose);
  del = forUser ? del.eq("user_id", forUser) : del.is("user_id", null);
  const { error: delError } = await del;
  if (delError) return fromDbError(delError);
  if (input.printerId) {
    const { error } = await admin.from("print_defaults").insert({
      org_id: orgId,
      user_id: forUser,
      purpose: input.purpose,
      printer_id: input.printerId,
      updated_by: userId,
    });
    if (error) return fromDbError(error);
  }
  return getDefaults(admin, orgId, userId, input.purpose);
}
