import { z } from "zod";
import type { DriverFuelFileFormat, DriverFuelRefusal, DriverFuelStatedTotal } from "./ifta/driverFuelFile.js";

/**
 * `POST /api/ifta/receipt-uploads` — driver-paid fuel files into the IFTA credit (IFTA-PRECISION-PLAN
 * IP8, D-IP7). One route, two passes over the SAME code: `commit: false` answers what the file would
 * add (the preview the office reads before anything lands), `commit: true` lands exactly that. A
 * preview computed by a second implementation would be a preview that can disagree with the import.
 *
 * The file travels as its bytes (base64), not as rows the browser parsed: the server owns the
 * parse, the hash recorded on the upload is of what was actually sent, and a browser cannot
 * submit a row the file does not contain.
 */

/** 4 MB of file. The two real files are 9 KB and 12 KB; a year of a whole fleet's receipts fits. */
export const IFTA_RECEIPT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export const iftaReceiptUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(1).max(Math.ceil((IFTA_RECEIPT_UPLOAD_MAX_BYTES * 4) / 3) + 4),
  commit: z.boolean(),
  /**
   * The truck for each question the preview asked (`truckQuestions[].key` → vehicle id). Applies only
   * to the rows that question covers; a row whose truck the file or Samsara already decided keeps it.
   */
  truckChoices: z.record(z.string().min(1).max(200), z.uuid()).default({}),
});
export type IftaReceiptUploadRequest = z.input<typeof iftaReceiptUploadRequestSchema>;

export const iftaReceiptVoidRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export type IftaTruckBasis = "unit_in_file" | "driver_assignment" | "chosen_at_upload";

/** One accepted line of the file and what the upload does with it. */
export interface IftaReceiptUploadRow {
  line: number;
  /** `new` lands on commit; `already_present` is live from an earlier upload; `needs_truck` waits on a choice. */
  status: "new" | "already_present" | "needs_truck";
  jurisdiction: string;
  fueledOn: string;
  gallons: number;
  station: string | null;
  unitAsFiled: string | null;
  driverAsFiled: string | null;
  vehicleId: string | null;
  unitNumber: string | null;
  truckBasis: IftaTruckBasis | null;
  /** The question this row waits on, when `needs_truck`. */
  truckKey: string | null;
}

/** A truck the file does not decide by itself, asked once for all the rows it covers. */
export interface IftaTruckQuestion {
  key: string;
  /** "Esteban Machado" or "unit 999" — what the file said. */
  label: string;
  rows: number;
  why: string;
  /** The truck the rest of the evidence points at, when one does. Never applied without a choice. */
  suggestion: { vehicleId: string; unitNumber: string | null } | null;
}

export interface IftaReceiptUploadResponse {
  format: DriverFuelFileFormat;
  fileName: string;
  fileSha256: string;
  rows: IftaReceiptUploadRow[];
  refused: DriverFuelRefusal[];
  voidedInSource: number;
  /** The file's own totals, ours beside them; `agrees: false` is said on the preview. */
  statedTotals: Array<DriverFuelStatedTotal & { agrees: boolean }>;
  truckQuestions: IftaTruckQuestion[];
  /** Null on a preview. */
  committed: { uploadId: string; imported: number; alreadyPresent: number } | null;
}

/** One past upload, for the list the office undoes a wrong file from. */
export interface IftaReceiptUploadSummary {
  id: string;
  fileName: string;
  format: DriverFuelFileFormat;
  uploadedAt: string;
  uploadedBy: string | null;
  rowsImported: number;
  rowsAlreadyPresent: number;
  rowsRefused: number;
  gallons: number;
  firstDay: string | null;
  lastDay: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}
