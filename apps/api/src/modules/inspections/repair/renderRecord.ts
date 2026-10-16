import { formatDisplayDate, formatDisplayDateTime } from "@silvicom/shared";
import { CONTENT_WIDTH, INK, MARGIN, MUTED, PAGE_HEIGHT, body, field, heading, muted, newDrawing, pdfkitText, rule, table, title, type Column } from "../../../lib/pdfDraw.js";
import type { WorkOrderRecord } from "../../fleetpal/index.js";

/**
 * The rendered repair record of a roadside inspection (INSPECTION-CHALLENGE-PLAN IC11 B2, D-IC14; Q-IC12
 * (a), Q-IC13): filed on the inspection as `roadside_repair_record` (0484) when safety certifies.
 *
 * ── WHAT IT IS, SAID ON ITS FACE ─────────────────────────────────────────────────────────────────
 * It is OUR rendering of FleetPal's work order, jobs, parts, labour and invoices — FleetPal's API serves no
 * files (Q-IC12) — so its head says so and names the time FleetPal's data was read as of. An auditor
 * reading it must be able to tell the maintenance record (FleetPal) from the certification (ours).
 *
 * ── WHAT IT CERTIFIES IS FROZEN WITH IT ──────────────────────────────────────────────────────────
 * Pure: the caller reads everything first and passes it in, so the bytes depend on nothing but this
 * input. The certification block is the 396.9(d)(3)(i) "Signature of Carrier Official, Title, and Date
 * Signed", recorded electronically — the signer is the signed-in person, never a typed name.
 */

export interface RepairRecordUnit {
  name: string;
  violations: { code: string | null; description: string | null }[];
  settlement: "accepted" | "outside" | "at_scene";
  /** Who recorded the repair, and when; null for the officer's "repaired at the scene". */
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  /** The accepted work order as the proposal showed it, when FleetPal no longer holds it. */
  workOrderRef: string | null;
  workOrder: WorkOrderRecord | null;
}

export interface RepairRecordInput {
  carrier: { name: string; dotNumber: string | null };
  inspection: { reportNumber: string | null; reportState: string | null; inspectionDate: string | null; level: number | null; location: string | null };
  units: RepairRecordUnit[];
  fleetpalAsOf: string | null;
  certification: { id: string; signerName: string; signerTitle: string; signedOn: string; certifiedAt: string };
  timeZone: string;
}

const money = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const qty = (n: number | null, unit: string | null) => (n === null ? "—" : `${Number(n.toFixed(3))}${unit ? ` ${unit.toLowerCase()}` : ""}`);

/** Heading, statement, three fields and the colophon: ~95pt, measured on a rendered page (2026-10-16). */
const CERTIFICATION_HEIGHT = 110;

const LINES: Column[] = [
  { width: 64, header: "Type" },
  { width: 200, header: "Description" },
  { width: 90, header: "Part no." },
  { width: 74, header: "Qty", align: "right" },
  { width: CONTENT_WIDTH - 428, header: "Total", align: "right" },
];
const INVOICES: Column[] = [
  { width: 120, header: "Purchase order" },
  { width: 140, header: "Invoice no." },
  { width: 100, header: "Date" },
  { width: 70, header: "Type" },
  { width: CONTENT_WIDTH - 430, header: "Amount", align: "right" },
];

function workOrder(doc: PDFKit.PDFDocument, wo: WorkOrderRecord, zone: string): void {
  field(doc, "FleetPal work order", wo.reference ?? wo.fleetpalId);
  field(doc, "Status", wo.status ?? "—");
  field(doc, "Opened", formatDisplayDateTime(wo.openedAt, "—", zone));
  field(doc, "Completed", formatDisplayDateTime(wo.completedAt, "not completed", zone));
  if (wo.description) field(doc, "Description", wo.description);
  for (const job of wo.jobs) {
    doc.moveDown(0.4);
    body(doc, `Job: ${job.name ?? "unnamed"}${job.total === null ? "" : ` — ${money(job.total)}`}`);
    if (job.complaint) muted(doc, `Complaint: ${job.complaint}`);
    if (job.lines.length) {
      doc.moveDown(0.2);
      table(doc, LINES, job.lines.map((l) => [
        { text: l.type ?? "—" },
        { text: l.description ?? "—" },
        { text: l.partNumber ?? "—" },
        { text: qty(l.quantity, l.type === "LABOR" ? "hours" : l.unitOfMeasure) },
        { text: money(l.total) },
      ]));
    }
  }
  doc.moveDown(0.4);
  if (wo.invoices.length) {
    body(doc, "Vendor invoices billed to this work order");
    doc.moveDown(0.2);
    table(doc, INVOICES, wo.invoices.map((i) => [
      { text: i.purchaseOrder ?? "—" },
      { text: i.invoiceNumber ?? "—" },
      { text: formatDisplayDate(i.invoiceDate) },
      { text: i.invoiceType ?? "—" },
      { text: money(i.amount) },
    ]));
  } else {
    muted(doc, "No vendor invoice is billed to this work order in FleetPal (an invoice reaches a work order only through a purchase order raised on it).");
  }
}

function unitBlock(doc: PDFKit.PDFDocument, u: RepairRecordUnit, zone: string): void {
  heading(doc, u.name);
  for (const v of u.violations) body(doc, `${v.code ?? "—"}${v.description ? ` — ${v.description}` : ""}`);
  doc.moveDown(0.4);
  if (u.settlement === "at_scene") {
    body(doc, "Repaired at the scene, as the officer recorded on the report (FMCSA defect verification 1).");
    return;
  }
  field(doc, "Repair recorded by", `${u.decidedBy ?? "a former user"}, ${formatDisplayDateTime(u.decidedAt, "—", zone)}`);
  if (u.settlement === "outside") {
    field(doc, "Repaired outside FleetPal", u.note ?? "—");
    return;
  }
  if (u.workOrder) workOrder(doc, u.workOrder, zone);
  else field(doc, "FleetPal work order", `${u.workOrderRef ?? "—"} (no longer in FleetPal's records as of this rendering)`);
}

export async function renderRepairRecord(input: RepairRecordInput): Promise<Buffer> {
  const { inspection: i, certification: c, timeZone: zone } = input;
  const report = [i.reportState, i.reportNumber].filter(Boolean).join(" ") || "—";
  const { doc, done } = newDrawing(`Repair record — roadside inspection ${report}`);

  title(doc, "Roadside inspection repair record");
  muted(doc, `49 CFR 396.9(d). Rendered by Silvicom 360 from FleetPal's maintenance record as of ${formatDisplayDateTime(input.fleetpalAsOf, "an unknown time", zone)}.`);
  doc.moveDown(0.6);
  field(doc, "Motor carrier", input.carrier.name);
  field(doc, "USDOT", input.carrier.dotNumber ?? "—");
  field(doc, "Report", report);
  field(doc, "Inspected", `${formatDisplayDate(i.inspectionDate)}${i.level === null ? "" : `, level ${i.level}`}`);
  if (i.location) field(doc, "Location", i.location);
  doc.moveDown(0.4);
  rule(doc);

  for (const u of input.units) {
    doc.moveDown(0.6);
    unitBlock(doc, u, zone);
    doc.moveDown(0.4);
    rule(doc);
  }

  // The certification is one block — its heading never left at a page's foot with the signature overleaf.
  if (doc.y + CERTIFICATION_HEIGHT > PAGE_HEIGHT - doc.page.margins.bottom) doc.addPage();
  else doc.moveDown(0.8);
  heading(doc, "Certification");
  body(doc, "I certify that all violations noted on this roadside inspection report have been corrected.");
  doc.moveDown(0.4);
  field(doc, "Signature of carrier official", `${c.signerName} (signed electronically)`);
  field(doc, "Title", c.signerTitle);
  field(doc, "Date signed", formatDisplayDate(c.signedOn));
  doc.moveDown(0.6);
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(
    pdfkitText(doc, `Recorded by Silvicom 360 at ${formatDisplayDateTime(c.certifiedAt, "—", zone)} by the signed-in user named above. Certification ${c.id}.`),
    MARGIN, doc.y, { width: CONTENT_WIDTH },
  );
  doc.fillColor(INK);
  doc.end();
  return done;
}
