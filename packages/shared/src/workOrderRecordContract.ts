/**
 * One FleetPal work order in full — its jobs, their part and labour lines, and the vendor invoices billed
 * against it (FLEETPAL-INTEGRATION-PLAN.md F14, D-FP27). Two readers: the roadside inspection's rendered
 * repair record (INSPECTION-CHALLENGE-PLAN IC11, Q-IC12 (a)) and the Shop's work order drawer. Moved here
 * from the API on 2026-11-17 so the web reads the contract the route sends instead of restating it.
 *
 * The invoice's number, date and amount are FleetPal's record of the vendor's bill. The paper itself — the
 * PDF the shop scanned onto the invoice in FleetPal — is NOT in this record: it is fetched live, on request,
 * through `WorkOrderFilesDto` below (F16, D-FP28). Q-IC12 (a) was ruled on 2026-10-15 believing FleetPal's
 * API served no files; its September spec did not, and the live one (2026-11-18, 174 paths) does.
 */
export interface WorkOrderLine {
  /** PART, LABOR, SERVICE, FEE or TAX, as FleetPal types it. */
  type: string | null;
  description: string | null;
  partNumber: string | null;
  /** Hours on a LABOR line. */
  quantity: number | null;
  unitOfMeasure: string | null;
  total: number | null;
}

export interface WorkOrderJob {
  name: string | null;
  description: string | null;
  complaint: string | null;
  lines: WorkOrderLine[];
  total: number | null;
}

export interface WorkOrderInvoice {
  /** FleetPal's own id for the invoice — the key its attached files are asked for by (F16). */
  invoiceId: string;
  purchaseOrder: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  /** STANDARD or CREDIT; a CREDIT's amount is stored positive (0351). */
  invoiceType: string | null;
  amount: number | null;
}

export interface WorkOrderRecord {
  fleetpalId: string;
  reference: string | null;
  status: string | null;
  openedAt: string | null;
  completedAt: string | null;
  description: string | null;
  jobs: WorkOrderJob[];
  invoices: WorkOrderInvoice[];
}

/** `GET /api/maintenance/work-orders/:id` — `id` is our row's id, the one every Shop list carries. */
export interface WorkOrderDetailDto {
  /** OUR row's id — what `/work-orders/:id/files` takes, also when the drawer was opened by FleetPal's id. */
  id: string;
  record: WorkOrderRecord;
  /** FleetPal's own fleet number for the unit; null when the vendor sent none. */
  unitNumber: string | null;
  /** The least recent sync of the five FleetPal resources the record is drawn from; null when one never synced. */
  asOf: string | null;
}

/**
 * One file attached to a vendor invoice in FleetPal — usually the shop's scanned PDF (F16, D-FP28).
 * FleetPal's signed link is deliberately NOT here: it expires in an hour and it opens the file to anybody
 * holding it, so the browser asks our API for the bytes by `invoiceId` + `index` instead.
 */
export interface WorkOrderFile {
  invoiceId: string;
  /** FleetPal's position of the file on its invoice (`Attachment.index`). */
  index: number;
  filename: string;
  contentType: string | null;
}

/**
 * `GET /api/maintenance/work-orders/:id/files` — read live from FleetPal on every open, never stored.
 * The three states are three different sentences on the page: "no file attached" is only ever said after
 * FleetPal answered, so a disconnected or unreachable FleetPal can never read as a missing receipt.
 */
export type WorkOrderFilesDto =
  | { state: "read"; files: WorkOrderFile[] }
  | { state: "not_connected" }
  | { state: "unreachable" };
