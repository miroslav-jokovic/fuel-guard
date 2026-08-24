/**
 * Persists a parsed vendor fuel statement (FUEL-SPEND-RECONCILIATION-PLAN WP4).
 *
 * ── THE PARSE IS RE-RUN HERE, NOT TRUSTED FROM THE CLIENT ────────────────────────────────────────
 * The browser decodes the PDF (only it has pdfjs) but it sends WORDS, not conclusions: this service
 * calls `parsePilotStatement` itself and refuses anything whose totals do not reproduce the vendor's
 * own printed `** Customer Total` / `Retail Total` / `Savings Total` to the cent (D-FR3). A statement
 * asserted by a browser is a number nobody can stand behind, and these rows are what a discount
 * conversation with Pilot would rest on.
 *
 * ── SUPERSEDE, NEVER UPDATE ──────────────────────────────────────────────────────────────────────
 * Pilot reissues a statement under the same invoice number when a line is adjusted. A re-upload
 * INSERTS a new statement and points the previous one at it (0243); nothing here ever rewrites a
 * figure in place. `fuel_statements` is in `RETENTION_FORBIDDEN` for the same reason.
 *
 * ── ORG SCOPING ──────────────────────────────────────────────────────────────────────────────────
 * Every query below filters `org_id` explicitly. The service role bypasses RLS, so the filter IS the
 * tenant boundary — asserted by `expectOrgScoped` in the tests.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parsePilotStatement,
  PILOT_FAMILY_BRANDS,
  type StatementLine,
  type StatementWord,
  type PilotStatementParse,
} from "@fuelguard/shared";
import { eachPage } from "../lib/paging.js";

export const STATEMENT_BUCKET = "fuel-statements";

export interface StatementIngestResult {
  ok: boolean;
  error?: string;
  /** Why the statement was refused, in the vendor's own arithmetic. Empty when accepted. */
  tieOutFailures?: string[];
  statementId?: string;
  invoiceNo?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  lines?: number;
  fills?: number;
  /** Set when this upload replaced an earlier statement for the same invoice. */
  supersededStatementId?: string;
  /** Statement sites that matched no station in the registry — reported, never guessed into a brand. */
  unresolvedSites?: string[];
  sourceStored?: boolean;
}

interface StationRow {
  id: string;
  brand: string;
  store_number: string | null;
  state: string | null;
}

/**
 * Resolve each line's (store number, state) to a station in the registry.
 *
 * Keyed on BOTH parts because store numbers are not unique across networks — 715 and 718 are Mr. Fuel
 * stores in Missouri and Love's stores in Virginia and Alabama. Restricted to the Pilot family because
 * that is whose statement this is; a Love's row must never absorb a Pilot line's site number. On the
 * five real 2026-07/08 statements this resolved 582 of 582 distinct site/state pairs.
 */
async function resolveStations(
  admin: SupabaseClient,
  lines: StatementLine[],
): Promise<{ byKey: Map<string, StationRow>; unresolved: string[] }> {
  const wanted = new Set<string>();
  for (const l of lines) {
    if (l.site && l.state) wanted.add(`${l.site}|${l.state}`);
  }
  const byKey = new Map<string, StationRow>();
  if (wanted.size === 0) return { byKey, unresolved: [] };

  await eachPage<StationRow>(
    (from, to) =>
      admin
        .from("fuel_stations")
        .select("id, brand, store_number, state")
        .in("brand", PILOT_FAMILY_BRANDS)
        .range(from, to),
    (batch) => {
      for (const s of batch) {
        if (!s.store_number || !s.state) continue;
        const key = `${s.store_number.replace(/^0+(?=\d)/, "")}|${s.state}`;
        if (wanted.has(key)) byKey.set(key, s);
      }
    },
  );
  return { byKey, unresolved: [...wanted].filter((k) => !byKey.has(k)).sort() };
}

function statementRow(parsed: PilotStatementParse, orgId: string, source: SourceDoc, uploadedBy: string | null) {
  const sum = (pick: (l: StatementLine) => number | null | undefined) =>
    Math.round(parsed.lines.reduce((a, l) => a + (pick(l) ?? 0), 0) * 100) / 100;
  const fuelAmount = sum((l) => l.netAmount);
  const misc = sum((l) => l.miscAmount);
  const tax = sum((l) => l.salesTax);
  const retail = sum((l) => l.retailAmount);
  const invoiceTotal = Math.round((fuelAmount + misc + tax) * 100) / 100;
  return {
    org_id: orgId,
    vendor: "pilot",
    account_no: parsed.account,
    invoice_no: parsed.invoiceNumber ?? `${parsed.startDate ?? "?"}_${parsed.endDate ?? "?"}`,
    period_start: parsed.startDate,
    period_end: parsed.endDate,
    billing_date: parsed.billingDate,
    total_gallons: Math.round(parsed.lines.reduce((a, l) => a + l.gallons, 0) * 100) / 100,
    fuel_amount: fuelAmount,
    misc_amount: misc,
    sales_tax: tax,
    invoice_total: invoiceTotal,
    retail_total: retail,
    savings: Math.round((retail - invoiceTotal) * 100) / 100,
    printed_units: parsed.printed.units,
    printed_amount: parsed.printed.amount,
    printed_retail: parsed.printed.retail,
    printed_savings: parsed.printed.savings,
    line_count: parsed.lines.length,
    source_format: "pdf_statement",
    source_filename: source.filename,
    source_path: source.path,
    source_sha256: source.sha256,
    source_bytes: source.bytes,
    uploaded_by: uploadedBy,
  };
}

interface SourceDoc {
  filename: string | null;
  path: string | null;
  sha256: string | null;
  bytes: number | null;
}

export interface StatementIngestInput {
  words: StatementWord[];
  filename?: string | null;
  /** The source PDF, base64. Stored as evidence so a figure can be traced to the document it came from. */
  sourceBase64?: string | null;
}

export async function ingestFuelStatement(
  admin: SupabaseClient,
  orgId: string,
  uploadedBy: string | null,
  input: StatementIngestInput,
): Promise<StatementIngestResult> {
  const parsed = parsePilotStatement(input.words);
  if (!parsed.headerFound) {
    return { ok: false, error: "That PDF isn't a Pilot statement — no transaction table was found." };
  }
  if (!parsed.tieOut.ok) {
    return { ok: false, error: "The statement didn't add up.", tieOutFailures: parsed.tieOut.failures };
  }

  const invoiceNo = parsed.invoiceNumber ?? `${parsed.startDate ?? "?"}_${parsed.endDate ?? "?"}`;

  // Store the source document FIRST: a statement row that points at a missing object is worse than an
  // orphan object, which the storage reconciler already knows how to sweep.
  const source = await storeSource(admin, orgId, invoiceNo, input);

  const { byKey, unresolved } = await resolveStations(admin, parsed.lines);

  const { data: inserted, error: insErr } = await admin
    .from("fuel_statements")
    .insert(statementRow(parsed, orgId, source, uploadedBy))
    .select("id")
    .single();
  if (insErr || !inserted) return { ok: false, error: insErr?.message ?? "Could not record the statement." };
  const statementId = (inserted as { id: string }).id;

  const rows = parsed.lines.map((l) => {
    const station = l.site && l.state ? byKey.get(`${l.site}|${l.state}`) : undefined;
    return {
      org_id: orgId,
      statement_id: statementId,
      line_number: l.rowNumber,
      product_code: l.productCode,
      product: l.product,
      tank_type: l.tank,
      tran_date: l.tranDate,
      card_ref: l.cardRef,
      unit_number: l.unit,
      po_name: l.poNumber,
      auth_no: l.authNo,
      ticket_no: l.ticket,
      odometer: l.odometer,
      site_number: l.site,
      city: l.city,
      state: l.state,
      station_id: station?.id ?? null,
      brand: station?.brand ?? null,
      gallons: l.gallons,
      unit_cost: l.unitCost,
      fuel_amount: l.netAmount,
      misc_amount: l.miscAmount,
      sales_tax: l.salesTax,
      invoice_total: l.invoiceTotal,
      retail_total: l.retailAmount,
    };
  });
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("fuel_statement_lines").insert(rows.slice(i, i + 500));
    if (error) {
      // The statement is worthless without its lines; take it back out rather than leave a total with
      // nothing behind it. Its own uniqueness index would otherwise block the next upload too.
      await admin.from("fuel_statements").delete().eq("org_id", orgId).eq("id", statementId);
      return { ok: false, error: error.message };
    }
  }

  const supersededStatementId = await supersedePrevious(admin, orgId, invoiceNo, statementId);

  return {
    ok: true,
    statementId,
    invoiceNo,
    periodStart: parsed.startDate,
    periodEnd: parsed.endDate,
    lines: rows.length,
    fills: parsed.fills.length,
    supersededStatementId,
    unresolvedSites: unresolved,
    sourceStored: source.path != null,
  };
}

/**
 * Point the previous live statement for this invoice at the new one. Runs AFTER the lines land, so a
 * failed upload never retires a good statement — until this succeeds the old one is still the live row.
 */
async function supersedePrevious(
  admin: SupabaseClient,
  orgId: string,
  invoiceNo: string,
  newId: string,
): Promise<string | undefined> {
  const { data } = await admin
    .from("fuel_statements")
    .select("id")
    .eq("org_id", orgId)
    .eq("vendor", "pilot")
    .eq("invoice_no", invoiceNo)
    .is("superseded_by", null)
    .neq("id", newId)
    .maybeSingle();
  const prior = (data as { id: string } | null)?.id;
  if (!prior) return undefined;
  await admin
    .from("fuel_statements")
    .update({ superseded_by: newId, superseded_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", prior);
  return prior;
}

/** Put the source PDF in the private bucket, keyed by org. Never fatal — the parse is the product. */
async function storeSource(
  admin: SupabaseClient,
  orgId: string,
  invoiceNo: string,
  input: StatementIngestInput,
): Promise<SourceDoc> {
  const empty: SourceDoc = { filename: input.filename ?? null, path: null, sha256: null, bytes: null };
  if (!input.sourceBase64) return empty;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.sourceBase64, "base64");
  } catch {
    return empty;
  }
  if (bytes.length === 0) return empty;
  // Hash what we are ACTUALLY storing, server-side — a client-supplied digest attests to nothing.
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `${orgId}/${invoiceNo}-${sha256.slice(0, 12)}.pdf`;
  const { error } = await admin.storage
    .from(STATEMENT_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) return { ...empty, sha256, bytes: bytes.length };
  return { filename: input.filename ?? null, path, sha256, bytes: bytes.length };
}
