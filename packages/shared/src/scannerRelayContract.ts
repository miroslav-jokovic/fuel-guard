import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * A scanner plugged into one PC, used from any device (SCANNER-RELAY-PLAN.md; migration 0532).
 *
 * Three audiences, as for printing (`printingContract.ts`): the office screens (Settings → Printers &
 * scanners, the Scan page's "Use the office scanner"), the API, and the print station program, which
 * speaks only the `station*` shapes and its bearer token.
 *
 * ── THE NUMBERS ARE THE PLAN'S, SAID ONCE ────────────────────────────────────────────────────
 * The lease (D-SR3), the freshness bar (D-SR5) and the station's hold are read by the database
 * (0532 states the lease and the hold in SQL, and the matrix pins them there), the API, the station
 * and the screen. They are restated nowhere else in TypeScript.
 */

/** How long a tab holds a scanner after its last wait for reads — 0532's `scanner_take`. */
export const SCANNER_LEASE_MS = 90_000;
/** A read older than this is never handed to a page (D-SR5): it is an instruction about "now". */
export const SCANNER_READ_FRESH_MS = 60_000;
/** The longest a station keeps a read it could not send, before dropping it — 0532 caps the age at this. */
export const STATION_READ_HOLD_MS = 30_000;
/** 0532's CHECK on `scanner_reads.code`. */
export const MAX_SCAN_LENGTH = 200;
/** The first print station program that reads scanners. An older one prints, and is told to update. */
export const SCANNER_STATION_MIN_VERSION = "1.1.0";

/** Whether a station's program reads scanners — `agentVersion` as its hello reported it. */
export function stationReadsScanners(agentVersion: string | null): boolean {
  const parts = (agentVersion ?? "").split(".").map((p) => Number.parseInt(p, 10));
  const min = SCANNER_STATION_MIN_VERSION.split(".").map((p) => Number.parseInt(p, 10));
  for (let i = 0; i < min.length; i += 1) {
    const have = Number.isFinite(parts[i]) ? parts[i]! : 0;
    if (have !== min[i]) return have > min[i]!;
  }
  return true;
}

const usbId = z.string().regex(/^[0-9a-f]{4}$/);
const name = z.string().trim().min(1).max(80);

// ── The station's side ────────────────────────────────────────────────────────────────────────

/** A serial port the station's operating system reports. The ids only when the system said them. */
export const serialPortSchema = z.object({
  name: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
  vendorId: usbId.optional(),
  productId: usbId.optional(),
});
export type SerialPort = z.infer<typeof serialPortSchema>;

export const SCANNER_READER_STATES = ["reading", "waiting", "failed"] as const;
export type ScannerReaderState = (typeof SCANNER_READER_STATES)[number];

/**
 * How the station's reader of one scanner is doing: `reading` (port open), `waiting` (the port is not
 * there — unplugged, or the scanner is still in keyboard mode), `failed` (the port is there and would
 * not open; `error` says what the system said — another program holding it, chiefly).
 */
export const scannerReaderStateSchema = z.object({
  scannerId: recordId(),
  state: z.enum(SCANNER_READER_STATES),
  /** The port actually opened — differs from the scanner's own when a renumbered port was followed. */
  portName: z.string().max(200).nullable(),
  error: z.string().max(300).optional(),
});
export type ScannerReaderStateReport = z.infer<typeof scannerReaderStateSchema>;

/** A scanner this station is to read, as the hello's answer hands it over. */
export const stationScannerSchema = z.object({
  id: recordId(),
  portName: z.string(),
  vendorId: z.string().nullable(),
  productId: z.string().nullable(),
});
export type StationScanner = z.infer<typeof stationScannerSchema>;

export const stationHelloResponseSchema = z.object({
  ok: z.literal(true),
  stationName: z.string(),
  scanners: z.array(stationScannerSchema),
});
export type StationHelloResponse = z.infer<typeof stationHelloResponseSchema>;

/** One read, as the station sends it. `ageMs` instead of a time: the PC's clock may be wrong. */
export const stationScanSchema = z.object({
  scannerId: recordId(),
  code: z.string().min(1).max(MAX_SCAN_LENGTH),
  ageMs: z.number().int().min(0).max(10 * 60_000),
});
export type StationScanRequest = z.infer<typeof stationScanSchema>;

// ── The office's side ─────────────────────────────────────────────────────────────────────────

/**
 * What Settings says about a scanner, worst first, judged by the API:
 *  · `station_offline` — the PC is off, asleep, or its program stopped;
 *  · `station_too_old` — its program predates scanners (`SCANNER_STATION_MIN_VERSION`);
 *  · `failed` — the port is there and would not open (`statusDetail` has the system's words);
 *  · `waiting` — the port is not there: unplugged, or the scanner is still in keyboard mode;
 *  · `ready` — the station has the port open.
 */
export const SCANNER_STATUSES = ["ready", "waiting", "failed", "station_too_old", "station_offline"] as const;
export type ScannerStatus = (typeof SCANNER_STATUSES)[number];

export const scannerSchema = z.object({
  id: recordId(),
  name: z.string(),
  stationId: recordId(),
  stationName: z.string(),
  portName: z.string(),
  retired: z.boolean(),
  status: z.enum(SCANNER_STATUSES),
  statusDetail: z.string().nullable(),
  /** Who holds it now, if anybody; `byYou` is the signed-in person, on any of their devices. */
  holder: z
    .object({ name: z.string(), since: z.string(), byYou: z.boolean() })
    .nullable(),
  lastReadAt: z.string().nullable(),
  /** Whether the last read reached a device — "nobody was using it" when false (D-SR4). */
  lastReadDelivered: z.boolean().nullable(),
});
export type ScannerDto = z.infer<typeof scannerSchema>;

/** What one station reported as its serial ports — what Settings offers when adding a scanner. */
export const stationPortsSchema = z.object({
  stationId: recordId(),
  ports: z.array(serialPortSchema),
  reportedAt: z.string(),
});
export type StationPortsDto = z.infer<typeof stationPortsSchema>;

/** Add a scanner on a station's port. Its USB ids are taken from the station's report, not sent. */
export const createScannerSchema = z.object({ name, stationId: recordId(), portName: z.string().trim().min(1).max(200) });
export type CreateScannerRequest = z.infer<typeof createScannerSchema>;

export const updateScannerSchema = z
  .object({ name, portName: z.string().trim().min(1).max(200), retired: z.literal(true) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");
export type UpdateScannerRequest = z.infer<typeof updateScannerSchema>;

/** Take a scanner for THIS tab (`session`: a random id the tab keeps). `force` takes it over. */
export const takeScannerSchema = z.object({ session: recordId(), force: z.boolean().default(false) });
export type TakeScannerRequest = z.infer<typeof takeScannerSchema>;

export const releaseScannerSchema = z.object({ session: recordId() });
export type ReleaseScannerRequest = z.infer<typeof releaseScannerSchema>;

export const takeScannerResponseSchema = z.object({
  outcome: z.enum(["taken", "held"]),
  /** Who holds it: this person when taken, the other person when held. */
  holderName: z.string(),
  heldUntil: z.string(),
});
export type TakeScannerResponse = z.infer<typeof takeScannerResponseSchema>;

export const scannerReadSchema = z.object({ id: z.number().int(), code: z.string(), readAt: z.string() });
export type ScannerRead = z.infer<typeof scannerReadSchema>;

/**
 * The tab's wait. `held` false means this tab no longer holds the scanner (taken over, retired, or a
 * lapse somebody else filled) — `holderName` says who has it, when anybody does.
 */
export const scannerWaitResponseSchema = z.object({
  held: z.boolean(),
  holderName: z.string().nullable(),
  reads: z.array(scannerReadSchema),
});
export type ScannerWaitResponse = z.infer<typeof scannerWaitResponseSchema>;
