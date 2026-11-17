/**
 * One FleetPal work order in full — its jobs, their part and labour lines, and the vendor invoices billed
 * against it (FLEETPAL-INTEGRATION-PLAN.md F14, D-FP27). Two readers: the roadside inspection's rendered
 * repair record (INSPECTION-CHALLENGE-PLAN IC11, Q-IC12 (a)) and the Shop's work order drawer. Moved here
 * from the API on 2026-11-17 so the web reads the contract the route sends instead of restating it.
 *
 * FleetPal's API serves no files, so this IS the receipt the product can show: the vendor's invoice
 * number, date and amount, as FleetPal records them, never an image of the paper (Q-IC12).
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
  record: WorkOrderRecord;
  /** FleetPal's own fleet number for the unit; null when the vendor sent none. */
  unitNumber: string | null;
  /** The least recent sync of the five FleetPal resources the record is drawn from; null when one never synced. */
  asOf: string | null;
}
