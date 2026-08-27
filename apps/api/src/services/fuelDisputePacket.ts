/**
 * The document you send the vendor.
 *
 * ── WHY THIS IS THE POINT OF THE LEDGER ──────────────────────────────────────────────────────────
 * Everything upstream of here finds money. This is where a finding becomes a claim: a numbered list of
 * lines with the vendor's own references beside ours, a total, the period, and who produced it on what
 * date. Without it the product tells a carrier they were overbilled and leaves them to retype it into
 * an email, which is where most of it quietly stops.
 *
 * ── RENDERED FROM THE RECORDS, NOT FROM THE SCREEN ───────────────────────────────────────────────
 * Same rule as the spend report: a figure in a document outlives the session that made it and gets
 * quoted back months later, so it is read from `fuel_exceptions` — the rows a detector wrote and a
 * person worked — rather than from whatever the browser happened to be showing. The two cannot
 * disagree because only one of them is a source.
 *
 * ── AND IT SAYS WHAT IT IS CLAIMING ──────────────────────────────────────────────────────────────
 * The four kinds of money are printed apart and never summed (D-FX5). "Billed and never recorded" is a
 * different conversation from "billed above the quoted price", and a packet that added them into one
 * demand would be wrong in a way the vendor would notice first.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { FUEL_EXCEPTION_KIND_LABELS, type FuelExceptionKind } from "@silvicom/shared";
import { newDrawing } from "./dqBinder/pdfDraw.js";
import { letterhead, lead, note, startSection, stampPages } from "./fuelSpendReportDraw.js";
import { setDensity } from "./fuelSpendReportFlow.js";
import { figureTable, type Column, type Row } from "./fuelSpendReportTable.js";
import { usd, num } from "./fuelSpendReportFormat.js";
import { C } from "./fuelSpendReportTheme.js";

const COLUMNS: Column[] = [
  { width: 62, header: "Date" },
  { width: 150, header: "Site" },
  { width: 42, header: "Unit" },
  { width: 78, header: "Reference" },
  { width: 60, header: "Gallons", align: "right" },
  { width: 72, header: "Billed", align: "right" },
  { width: 76, header: "Claimed", align: "right", bar: true, barColor: C.bad },
];

interface ExceptionRow {
  kind: FuelExceptionKind;
  occurred_on: string | null;
  amount: string | number;
  amount_kind: string;
  unit_number: string | null;
  site_number: string | null;
  city: string | null;
  state: string | null;
  evidence: Record<string, unknown>;
}

export interface DisputePacketInput {
  orgId: string;
  ids: string[];
  generatedBy: string | null;
  /** The caller owns the clock, so a render stays deterministic in a test. */
  generatedAt: string;
}

/** What the vendor can look the line up by on their own system. */
function reference(e: ExceptionRow): string {
  const ev = e.evidence ?? {};
  const auth = ev.authNo == null ? null : String(ev.authNo);
  const card = ev.card == null ? null : String(ev.card);
  return [auth ? `Auth ${auth}` : null, card ? `••${card}` : null].filter(Boolean).join("  ") || "—";
}

const gallonsOf = (e: ExceptionRow): number | null => {
  const ev = e.evidence ?? {};
  const g = ev.billedGallons ?? ev.gallons ?? ev.recordedGallons;
  return g == null ? null : Number(g);
};
const billedOf = (e: ExceptionRow): number | null => {
  const ev = e.evidence ?? {};
  const b = ev.billedAmount ?? ev.paid ?? ev.recordedAmount;
  return b == null ? null : Number(b);
};

export async function renderDisputePacket(
  admin: SupabaseClient,
  input: DisputePacketInput,
): Promise<{ pdf: Buffer; lines: number; total: number }> {
  const [{ data: rows }, { data: org }] = await Promise.all([
    admin
      .from("fuel_exceptions")
      .select("kind, occurred_on, amount, amount_kind, unit_number, site_number, city, state, evidence")
      .eq("org_id", input.orgId)
      .in("id", input.ids)
      .order("occurred_on", { ascending: true }),
    admin.from("organizations").select("name").eq("id", input.orgId).maybeSingle(),
  ]);

  const items = (rows ?? []) as ExceptionRow[];
  const carrier = (org as { name?: string } | null)?.name ?? "Carrier";
  const dates = items.map((i) => i.occurred_on).filter((d): d is string => !!d).sort();
  const period = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "—";
  const total = Math.round(items.reduce((a, i) => a + (Number(i.amount) || 0), 0) * 100) / 100;

  const { doc, done } = newDrawing("Fuel billing dispute", { bufferPages: true });
  // 1 is the report's own baseline spacing; the packet is short and never needs the tighter pass.
  setDensity(doc, 1);

  letterhead(doc, carrier, "Fuel billing dispute", "Lines from your statements that do not agree with our own record of the same fills.", [
    { label: "Period", value: period },
    { label: "Lines", value: String(items.length) },
    { label: "Claimed", value: usd(total) },
    { label: "Prepared", value: input.generatedAt.slice(0, 10) },
  ]);

  if (items.length === 0) {
    note(doc, "No findings were selected, so there is nothing to claim.");
    doc.end();
    return { pdf: await done, lines: 0, total: 0 };
  }

  /*
   * Grouped by what is being claimed, because these are different conversations. A line billed above
   * the quoted price is an arithmetic disagreement; a line billed for a fill we have no record of is a
   * question about whether it happened at all. Presented as one list they invite one answer.
   */
  const byKind = new Map<FuelExceptionKind, ExceptionRow[]>();
  for (const e of items) {
    const b = byKind.get(e.kind);
    if (b) b.push(e);
    else byKind.set(e.kind, [e]);
  }

  let section = 1;
  for (const [kind, group] of byKind) {
    const groupTotal = Math.round(group.reduce((a, i) => a + (Number(i.amount) || 0), 0) * 100) / 100;
    startSection(doc, section++, FUEL_EXCEPTION_KIND_LABELS[kind], undefined, 40);
    lead(doc, `${group.length} line${group.length === 1 ? "" : "s"}, ${usd(groupTotal)}.`);
    figureTable(
      doc,
      COLUMNS,
      group.map<Row>((e) => ({
        cells: [
          { text: e.occurred_on ?? "-" },
          { text: [e.site_number, e.city, e.state].filter(Boolean).join(" ") || "-" },
          { text: e.unit_number ?? "-" },
          { text: reference(e) },
          { text: gallonsOf(e) == null ? "-" : num(gallonsOf(e)!, 1) },
          { text: billedOf(e) == null ? "-" : usd(billedOf(e)!) },
          { text: usd(Number(e.amount) || 0), value: Number(e.amount) || 0, bold: true },
        ],
      })),
    );
  }

  note(
    doc,
    "Each line is claimed once and under one heading; the totals above are not added together. " +
      "Gallons and amounts are as they appear on your statement, beside our own recorded fill for the " +
      "same card, date and volume.",
  );

  stampPages(
    doc,
    `${carrier} - fuel billing dispute`,
    `Prepared ${input.generatedAt.slice(0, 10)} from reconciliations recorded against Pilot statements. ` +
      `${items.length} line(s), ${usd(total)}.`,
  );
  doc.end();
  return { pdf: await done, lines: items.length, total };
}
