import type { SupabaseClient } from "@supabase/supabase-js";
import { LABEL_PRESETS, POINTS_PER_INCH, toTspl } from "@silvicom/qr";
import { SCANNER_TEST_PAYLOAD, type LabelFaceDto, type PrintJobDto, type PrintJobStatus, type PrintLabelsRequest, type StationJob } from "@silvicom/shared";
import type { ServiceError } from "../inventory/types.js";
import { resolveLabelFaces } from "../inventory/labels.js";
import { renderLabelBitmap } from "./labelRaster.js";
import { getDefaults, getPrinter, rollStockOrNull } from "./printers.js";

/**
 * The print queue (PRINTERS-AND-SCANNERS-PLAN.md §4; 0526).
 *
 * ── PRINT NEVER ASKS ─────────────────────────────────────────────────────────────────────────
 * A request may name a printer; without one, the effective default is used (the person's, else the
 * organization's). No default and no printer named is the one case that answers `no_printer`, and
 * the screen turns that into "choose a printer in Settings" — the only time anybody is asked.
 *
 * ── RENDERED WHEN QUEUED ─────────────────────────────────────────────────────────────────────
 * The bytes are made here, in the printer's language, with the printer's stock and nudge as they are
 * at the press of the button (0526's header, D-PS2). Resolving the faces also ISSUES a tag code to
 * anything without one — the same ordering `labels.ts` argues for the PDF, so a printed code is
 * always a stored code.
 */

/** Direct-thermal rolls in this shop have a ~3 mm gap; the printer learns the exact one itself. */
const ROLL_GAP_MM = 3;

const fail = (code: string, error: string): ServiceError => ({ code, error });

interface JobRow {
  id: string;
  printer_id: string;
  description: string;
  label_count: number;
  status: PrintJobStatus;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  printers: { name: string } | null;
}

const JOB_COLUMNS = "id, printer_id, description, label_count, status, error, created_at, finished_at, printers(name)";

const toJobDto = (row: JobRow): PrintJobDto => ({
  id: row.id,
  printerId: row.printer_id,
  printerName: row.printers?.name ?? "",
  description: row.description,
  labelCount: row.label_count,
  status: row.status,
  error: row.error,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
});

const describe = (count: number, firstName: string | undefined): string =>
  (count === 1 ? `Label — ${firstName ?? "1 label"}` : `${count} labels${firstName ? ` — ${firstName} and others` : ""}`).slice(0, 200);

export async function getJob(admin: SupabaseClient, orgId: string, jobId: string): Promise<PrintJobDto | null> {
  const { data } = await admin.from("print_jobs").select(JOB_COLUMNS).eq("org_id", orgId).eq("id", jobId).maybeSingle();
  return data ? toJobDto(data as unknown as JobRow) : null;
}

export async function printLabels(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  input: PrintLabelsRequest,
): Promise<{ job: PrintJobDto; dropped: number } | ServiceError> {
  // A retried request: the job already exists, so answer with it rather than printing again.
  const existing = await getJob(admin, orgId, input.id);
  if (existing) return { job: existing, dropped: 0 };

  let printerId = input.printerId ?? null;
  if (!printerId) {
    const defaults = await getDefaults(admin, orgId, userId, "label");
    if ("code" in defaults) return defaults;
    printerId = defaults.effectivePrinterId;
  }
  if (!printerId) return fail("no_printer", "No label printer is set up yet. Choose one in Settings → Devices.");
  const printer = await getPrinter(admin, orgId, printerId);
  if (!printer) return fail("not_found", "That printer does not exist.");
  if (printer.retired_at) return fail("printer_retired", "That printer is retired. Choose another in Settings → Devices.");
  const stockId = rollStockOrNull(printer.stock_id);
  if (!stockId) return fail("unknown_stock", `${printer.name} is set to a stock this system cannot print on.`);

  const resolved = await resolveLabelFaces(admin, orgId, input.targets, userId);
  if ("code" in resolved) return resolved;
  if (resolved.faces.length === 0) return fail("not_found", "None of those things can be labelled any more.");
  return queueFaces(admin, orgId, userId, input.id, printer, stockId, resolved.faces, resolved.dropped);
}

/**
 * A test label for one printer, from Settings → Devices: it proves the whole path (station, queue,
 * driver, stock, nudge) and carries `SCANNER_TEST_PAYLOAD`, so the same label then tests a scanner on
 * whatever device scans it. Issues no tag — the face is fixed, not resolved.
 */
export async function printTestLabel(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  printerId: string,
  jobId: string,
): Promise<{ job: PrintJobDto; dropped: number } | ServiceError> {
  const existing = await getJob(admin, orgId, jobId);
  if (existing) return { job: existing, dropped: 0 };
  const printer = await getPrinter(admin, orgId, printerId);
  if (!printer) return fail("not_found", "That printer does not exist.");
  if (printer.retired_at) return fail("printer_retired", "That printer is retired.");
  const stockId = rollStockOrNull(printer.stock_id);
  if (!stockId) return fail("unknown_stock", `${printer.name} is set to a stock this system cannot print on.`);
  const face = {
    target: { kind: "asset", assetId: "00000000-0000-4000-8000-000000000000" },
    payload: SCANNER_TEST_PAYLOAD,
    code: "TEST",
    lines: [printer.name, "Scan me in Settings → Devices"],
  } as LabelFaceDto;
  return queueFaces(admin, orgId, userId, jobId, printer, stockId, [face], 0);
}

type PrinterForJob = NonNullable<Awaited<ReturnType<typeof getPrinter>>>;

async function queueFaces(
  admin: SupabaseClient,
  orgId: string,
  userId: string | null,
  jobId: string,
  printer: PrinterForJob,
  stockId: NonNullable<ReturnType<typeof rollStockOrNull>>,
  faces: LabelFaceDto[],
  dropped: number,
): Promise<{ job: PrintJobDto; dropped: number } | ServiceError> {
  const bitmaps = faces.map((face) =>
    renderLabelBitmap(face, { presetId: stockId, dpi: printer.dpi, offsetX: printer.offset_x_dots, offsetY: printer.offset_y_dots }),
  );
  const label = LABEL_PRESETS[stockId].label;
  const toMm = (pt: number) => (pt / POINTS_PER_INCH) * 25.4;
  const payload = toTspl(bitmaps, { widthMm: toMm(label.width), heightMm: toMm(label.height), gapMm: ROLL_GAP_MM });

  const { data, error } = await admin
    .from("print_jobs")
    .insert({
      id: jobId,
      org_id: orgId,
      printer_id: printer.id,
      requested_by: userId,
      description: describe(faces.length, faces[0]?.lines[0] ?? faces[0]?.code),
      label_count: faces.length,
      // PostgREST takes bytea as a hex string.
      payload: `\\x${Buffer.from(payload).toString("hex")}`,
    })
    .select(JOB_COLUMNS)
    .single();
  if (error) {
    // Two presses racing with one id: the loser answers with the winner's job.
    if (error.code === "23505") {
      const winner = await getJob(admin, orgId, jobId);
      if (winner) return { job: winner, dropped };
    }
    if (error.code === "PS004") return fail("printer_retired", "That printer is retired. Choose another in Settings → Devices.");
    return fail("db_error", error.message);
  }
  return { job: toJobDto(data as unknown as JobRow), dropped };
}

export async function listJobs(admin: SupabaseClient, orgId: string, limit = 50): Promise<PrintJobDto[] | ServiceError> {
  const { data, error } = await admin
    .from("print_jobs")
    .select(JOB_COLUMNS)
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return fail("db_error", error.message);
  return (data as unknown as JobRow[]).map(toJobDto);
}

/** Only a job still waiting can be cancelled; one already sent is on its way to the paper. */
export async function cancelJob(admin: SupabaseClient, orgId: string, jobId: string): Promise<PrintJobDto | ServiceError> {
  const { data, error } = await admin
    .from("print_jobs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", jobId)
    .eq("status", "queued")
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (error) return fail("db_error", error.message);
  if (!data) {
    const job = await getJob(admin, orgId, jobId);
    if (!job) return fail("not_found", "That print job does not exist.");
    return fail("job_not_cancellable", "That job has already gone to the printer.");
  }
  return toJobDto(data as unknown as JobRow);
}

// ── The station's side ────────────────────────────────────────────────────────────────────────

/** The next job for this station, or null. 0526's RPC does the locking and the heartbeat. */
export async function claimNextJob(admin: SupabaseClient, stationId: string): Promise<StationJob | null | ServiceError> {
  const { data, error } = await admin.rpc("print_claim_next_job", { p_station: stationId });
  if (error) return fail("db_error", error.message);
  const row = (data as Array<{ job_id: string; system_name: string; payload: string; label_count: number }> | null)?.[0];
  if (!row) return null;
  // bytea arrives as "\x…" hex.
  const hex = row.payload.startsWith("\\x") ? row.payload.slice(2) : row.payload;
  return {
    jobId: row.job_id,
    systemName: row.system_name,
    labelCount: row.label_count,
    payloadBase64: Buffer.from(hex, "hex").toString("base64"),
  };
}

export async function finishJob(
  admin: SupabaseClient,
  stationId: string,
  jobId: string,
  ok: boolean,
  errorText: string | undefined,
): Promise<PrintJobStatus | ServiceError> {
  const { data, error } = await admin.rpc("print_finish_job", {
    p_station: stationId,
    p_job: jobId,
    p_ok: ok,
    p_error: errorText ?? null,
  });
  if (error) {
    if (error.code === "PS005") return fail("not_found", "That job is not this station's.");
    if (error.code === "PS002") return fail("job_not_sent", "That job was never handed to this station.");
    return fail("db_error", error.message);
  }
  return data as PrintJobStatus;
}
