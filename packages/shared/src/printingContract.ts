import { z } from "zod";
import { recordId } from "./recordId.js";
import { labelTargetSchema, MAX_LABELS_PER_RUN } from "./inventoryLabelContract.js";

/**
 * Printers chosen once in Settings, and the print queue behind every Print button
 * (PRINTERS-AND-SCANNERS-PLAN.md; migration 0526).
 *
 * Three audiences share these shapes: the office screens (Settings → Devices, the Labels screen),
 * the API, and the print station program, which speaks only the `station*` shapes and a bearer
 * token. A station never sees a person, an org id or a printer it does not drive.
 *
 * ── THE STATUS VOCABULARY IS THE DATABASE'S ──────────────────────────────────────────────────
 * `queued → sent → printed | failed | unknown`, or `cancelled` — 0526's CHECK, restated here once
 * because zod must validate what the API returns; the matrix pins the database side. `unknown` is
 * not an error: it is a job the station took and never reported, which may or may not be on paper
 * (0526's header), and the screen says exactly that and offers Retry.
 */

export const PRINT_JOB_STATUSES = ["queued", "sent", "printed", "failed", "unknown", "cancelled"] as const;
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number];

export const PRINTER_LANGUAGES = ["tspl"] as const;
export type PrinterLanguage = (typeof PRINTER_LANGUAGES)[number];

export const PRINT_PURPOSES = ["label"] as const;
export type PrintPurpose = (typeof PRINT_PURPOSES)[number];

/** A station that has not been heard from for this long is shown offline. Its long poll is 25 s. */
export const STATION_ONLINE_WINDOW_MS = 90_000;

/** The nudge's bound, in printer dots — half an inch at 203 dpi; 0526's CHECK. */
export const MAX_PRINTER_OFFSET_DOTS = 100;

const name = z.string().trim().min(1).max(80);

// ── Stations ──────────────────────────────────────────────────────────────────────────────────

export const discoveredPrinterSchema = z.object({ name: z.string().min(1).max(200) });
export type DiscoveredPrinter = z.infer<typeof discoveredPrinterSchema>;

export const printStationSchema = z.object({
  id: recordId(),
  name: z.string(),
  paired: z.boolean(),
  /** Seconds-fresh check-in, judged by the API with `STATION_ONLINE_WINDOW_MS`. */
  online: z.boolean(),
  lastSeenAt: z.string().nullable(),
  hostName: z.string().nullable(),
  agentVersion: z.string().nullable(),
  revoked: z.boolean(),
  /** While a pairing code is outstanding — the code itself is shown once and never stored. */
  pairingExpiresAt: z.string().nullable(),
  discoveredPrinters: z.array(discoveredPrinterSchema),
});
export type PrintStationDto = z.infer<typeof printStationSchema>;

export const createStationSchema = z.object({ name });
export type CreateStationRequest = z.infer<typeof createStationSchema>;

/** The answer to creating a station or asking for a new code: the code, once. */
export const pairingCodeSchema = z.object({
  station: printStationSchema,
  pairingCode: z.string(),
  expiresAt: z.string(),
});
export type PairingCodeDto = z.infer<typeof pairingCodeSchema>;

// ── Printers ──────────────────────────────────────────────────────────────────────────────────

export const printerSchema = z.object({
  id: recordId(),
  name: z.string(),
  stationId: recordId(),
  stationName: z.string(),
  systemName: z.string(),
  language: z.enum(PRINTER_LANGUAGES),
  stockId: z.string(),
  dpi: z.number().int(),
  offsetXDots: z.number().int(),
  offsetYDots: z.number().int(),
  online: z.boolean(),
  retired: z.boolean(),
});
export type PrinterDto = z.infer<typeof printerSchema>;

const offset = z.number().int().min(-MAX_PRINTER_OFFSET_DOTS).max(MAX_PRINTER_OFFSET_DOTS);

export const createPrinterSchema = z.object({
  name,
  stationId: recordId(),
  systemName: z.string().trim().min(1).max(200),
  language: z.enum(PRINTER_LANGUAGES).default("tspl"),
  /** Validated against `@silvicom/qr`'s one-label stocks at the API edge (the label contract's reason). */
  stockId: z.string().min(1).max(40),
  dpi: z.union([z.literal(203), z.literal(300)]).default(203),
  offsetXDots: offset.default(0),
  offsetYDots: offset.default(0),
});
export type CreatePrinterRequest = z.infer<typeof createPrinterSchema>;

export const updatePrinterSchema = z
  .object({
    name,
    systemName: z.string().trim().min(1).max(200),
    stockId: z.string().min(1).max(40),
    offsetXDots: offset,
    offsetYDots: offset,
    retired: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");
export type UpdatePrinterRequest = z.infer<typeof updatePrinterSchema>;

// ── Defaults ──────────────────────────────────────────────────────────────────────────────────

/** Which printer a Print button uses, and why — the person's own choice wins (D-PS4). */
export const printDefaultsSchema = z.object({
  purpose: z.enum(PRINT_PURPOSES),
  organizationPrinterId: recordId().nullable(),
  myPrinterId: recordId().nullable(),
  /** What Print will use right now: mine, else the organization's, else none — never a retired one. */
  effectivePrinterId: recordId().nullable(),
});
export type PrintDefaultsDto = z.infer<typeof printDefaultsSchema>;

export const setDefaultSchema = z.object({
  purpose: z.enum(PRINT_PURPOSES).default("label"),
  scope: z.enum(["organization", "me"]),
  /** Null clears the choice. */
  printerId: recordId().nullable(),
});
export type SetDefaultRequest = z.infer<typeof setDefaultSchema>;

// ── Jobs ──────────────────────────────────────────────────────────────────────────────────────

export const printJobSchema = z.object({
  id: recordId(),
  printerId: recordId(),
  printerName: z.string(),
  description: z.string(),
  labelCount: z.number().int(),
  status: z.enum(PRINT_JOB_STATUSES),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type PrintJobDto = z.infer<typeof printJobSchema>;

/**
 * Print labels. `id` is generated by the browser so a retried request is the same job (D-INV27).
 * `printerId` is optional: absent, the effective default is used — the owner's "never asks".
 */
export const printLabelsSchema = z.object({
  id: recordId(),
  printerId: recordId().optional(),
  targets: z.array(labelTargetSchema).min(1).max(MAX_LABELS_PER_RUN),
});
export type PrintLabelsRequest = z.infer<typeof printLabelsSchema>;

// ── The station's side ────────────────────────────────────────────────────────────────────────

export const stationPairSchema = z.object({
  pairingCode: z.string().trim().min(6).max(20),
  hostName: z.string().trim().min(1).max(120),
  agentVersion: z.string().trim().min(1).max(40),
});
export type StationPairRequest = z.infer<typeof stationPairSchema>;

export const stationPairResponseSchema = z.object({ token: z.string(), stationName: z.string() });
export type StationPairResponse = z.infer<typeof stationPairResponseSchema>;

export const stationHelloSchema = z.object({
  hostName: z.string().trim().min(1).max(120),
  agentVersion: z.string().trim().min(1).max(40),
  printers: z.array(discoveredPrinterSchema).max(50),
});
export type StationHello = z.infer<typeof stationHelloSchema>;

/** A job handed to the station: where to print, and the bytes, base64. */
export const stationJobSchema = z.object({
  jobId: recordId(),
  systemName: z.string(),
  labelCount: z.number().int(),
  payloadBase64: z.string(),
});
export type StationJob = z.infer<typeof stationJobSchema>;

export const stationReportSchema = z.object({
  ok: z.boolean(),
  error: z.string().max(500).optional(),
});
export type StationReport = z.infer<typeof stationReportSchema>;

// ── The test label, and what a scan of it says about the scanner ──────────────────────────────

/**
 * What a printer's test label encodes. Chosen to exercise the three ways a keyboard-mode scanner
 * mistypes (plan §3): colons (a non-US layout turns them into another character — the fault that
 * breaks every real label), mixed case (Caps Lock on the host inverts it) and a hyphen (moved on
 * many European layouts). Never a real tag: `TEST` is not a tag kind, so it can never resolve to
 * anything in the shop.
 */
export const SCANNER_TEST_PAYLOAD = "SIL1:TEST:Ok-42z";

export const printTestLabelSchema = z.object({ id: recordId() });
export type PrintTestLabelRequest = z.infer<typeof printTestLabelSchema>;

export type ScannerTestVerdict = "works" | "caps_lock" | "keyboard_layout" | "not_the_test_label";

/** Read a scan of the test label: works, or which setting on THIS device is wrong. */
export function diagnoseScannerTest(scanned: string): ScannerTestVerdict {
  const text = scanned.replace(/[\r\n\t]+$/g, "").trim();
  if (text === SCANNER_TEST_PAYLOAD) return "works";
  const swapped = [...SCANNER_TEST_PAYLOAD].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join("");
  if (text === swapped) return "caps_lock";
  // Same length and starting like ours, but the punctuation came out different: the keys were
  // right and the host's keyboard layout turned them into other characters.
  if (text.length === SCANNER_TEST_PAYLOAD.length && /^sil1/i.test(text)) return "keyboard_layout";
  return "not_the_test_label";
}
