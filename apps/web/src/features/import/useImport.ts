import { useMutation, useQueryClient } from "@tanstack/vue-query";
import {
  detectReportKind,
  normalizeTransactionRows,
  normalizeAllTransactionLines,
  normalizeRejectRows,
  reconcileFuelLines,
  derivePricePerGal,
  type ReportKind,
  type ReconciledFuelLine,
  type ParsedDeclined,
  type EfsTransactionLine,
  type Vehicle,
  type Driver,
} from "@fuelguard/shared";
import { supabase } from "@/lib/supabase";
import { useSessionStore } from "@/stores/session";
import { apiFetch } from "@/lib/api";
import { genUuid } from "@/lib/uuid";
import { readFile } from "./readFile";

export interface ImportPreview {
  kind: ReportKind;
  source: "xlsx" | "csv";
  filename: string;
  totalRows: number;
  fileHash: string;
  alreadyImported: boolean; // true if this exact file was committed before
  // transaction
  allLines: EfsTransactionLine[]; // faithful, every line (preview + system of record)
  newFuel: ReconciledFuelLine[]; // derived fuel events for scoring
  duplicateFuelCount: number;
  /** Faithful EFS lines already present from an earlier import (won't be re-inserted). */
  duplicateEfsCount: number;
  unattributedCount: number;
  skippedCount: number;
  // reject
  newDeclined: ParsedDeclined[];
  duplicateDeclinedCount: number;
  // the period the file covers (YYYY-MM-DD), for at-a-glance validation
  reportFrom: string | null;
  reportTo: string | null;
  /** Rows per business day in the FILE — persisted so silent data loss is detectable after commit. */
  rowsByDay: Record<string, number>;
}

/** Per-day row counts (business date) — the reconciliation fingerprint of a report file. */
function countByDay(dates: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dates) {
    if (!d) continue;
    const day = d.slice(0, 10);
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

/** Min/max date (YYYY-MM-DD) across a set of ISO timestamps. */
function dateSpan(isos: (string | null)[]): { from: string | null; to: string | null } {
  const days = isos.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null };
}

/** SHA-256 hex digest of the file contents using the Web Crypto API. */
async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function existingRefs(table: string, refs: string[]): Promise<Set<string>> {
  // Query in batches: a month of data can be thousands of refs, and a single .in() would blow past the
  // request URL limit and silently return nothing (making every row look "new" in the preview).
  const found = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    const { data, error } = await supabase.from(table).select("external_ref").in("external_ref", slice);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) found.add((r as { external_ref: string }).external_ref);
  }
  return found;
}

/** Read + classify + reconcile + dedup a file into a review preview (no writes). */
export async function analyzeImport(
  file: File,
  vehicles: Vehicle[],
  drivers: Driver[],
): Promise<ImportPreview> {
  const [{ headers, rows }, fileHash] = await Promise.all([readFile(file), hashFile(file)]);
  const kind = detectReportKind(headers);
  const source: "xlsx" | "csv" = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";

  // Check whether this exact file was already imported (by SHA-256 hash).
  // Gracefully degrade if migration 0017 (file_hash column) has not been applied yet.
  let alreadyImported = false;
  try {
    const { data: existing } = await supabase
      .from("imports")
      .select("id")
      .eq("file_hash", fileHash)
      .limit(1);
    alreadyImported = (existing ?? []).length > 0;
  } catch {
    // file_hash column not yet in schema — treat as not-yet-imported
  }

  const base = {
    kind,
    source,
    filename: file.name,
    totalRows: rows.length,
    fileHash,
    alreadyImported,
    allLines: [] as EfsTransactionLine[],
    newFuel: [] as ReconciledFuelLine[],
    duplicateFuelCount: 0,
    duplicateEfsCount: 0,
    unattributedCount: 0,
    skippedCount: 0,
    newDeclined: [] as ParsedDeclined[],
    duplicateDeclinedCount: 0,
    reportFrom: null as string | null,
    reportTo: null as string | null,
    rowsByDay: {} as Record<string, number>,
  };

  if (kind === "transaction") {
    const allLines = normalizeAllTransactionLines(rows); // faithful, every column/row
    const { fuelLines, skipped } = normalizeTransactionRows(rows);
    const reconciled = reconcileFuelLines(fuelLines, vehicles, drivers);
    const [seen, efsSeen] = await Promise.all([
      existingRefs("fuel_transactions", reconciled.map((l) => l.external_ref)),
      existingRefs("efs_transactions", allLines.map((l) => l.external_ref)),
    ]);
    const newFuel = reconciled.filter((l) => !seen.has(l.external_ref));
    const span = dateSpan(allLines.map((l) => l.fueled_at));
    return {
      ...base,
      allLines,
      newFuel,
      duplicateFuelCount: reconciled.length - newFuel.length,
      duplicateEfsCount: allLines.filter((l) => efsSeen.has(l.external_ref)).length,
      unattributedCount: newFuel.filter((l) => l.vehicle_id == null).length,
      skippedCount: skipped.length,
      reportFrom: span.from,
      reportTo: span.to,
      rowsByDay: countByDay(allLines.map((l) => l.tran_date)),
    };
  }

  if (kind === "reject") {
    const { declined, skipped } = normalizeRejectRows(rows);
    const seen = await existingRefs("declined_transactions", declined.map((d) => d.external_ref));
    const newDeclined = declined.filter((d) => !seen.has(d.external_ref));
    const span = dateSpan(declined.map((d) => d.declined_at));
    return {
      ...base,
      newDeclined,
      duplicateDeclinedCount: declined.length - newDeclined.length,
      skippedCount: skipped.length,
      reportFrom: span.from,
      reportTo: span.to,
      rowsByDay: countByDay(declined.map((d) => d.declined_at)),
    };
  }

  return base;
}

const loc = (...parts: (string | null)[]) => parts.filter(Boolean).join(", ") || null;

/** Commit a reviewed preview: faithful store + derived scoring events + declined, all idempotent. */
export function useCommitImport() {
  const qc = useQueryClient();
  const session = useSessionStore();
  return useMutation({
    mutationFn: async (preview: ImportPreview): Promise<void> => {
      if (!session.orgId) throw new Error("No organization in session");
      const org_id = session.orgId;

      const inserted =
        preview.kind === "transaction" ? preview.allLines.length : preview.newDeclined.length;
      const basePayload = {
        org_id,
        source: preview.source,
        kind: preview.kind === "reject" ? "reject" : "transaction",
        filename: preview.filename,
        status: "completed",
        total_rows: preview.totalRows,
        inserted_rows: inserted,
        duplicate_rows: preview.duplicateFuelCount + preview.duplicateDeclinedCount,
        skipped_rows: preview.skippedCount,
        created_by: session.userId,
      };
      // Include file_hash only when migration 0017 has been applied; fall back without it.
      // Cast to any because Supabase generated types won't include file_hash until types are regenerated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const insertPayload: any = preview.fileHash ? { ...basePayload, file_hash: preview.fileHash } : basePayload;
      let impResult = await supabase
        .from("imports")
        .insert(insertPayload)
        .select("id")
        .single();
      if (impResult.error?.message?.includes("file_hash")) {
        impResult = await supabase.from("imports").insert(basePayload).select("id").single();
      }
      const { data: imp, error: impErr } = impResult;
      if (impErr || !imp) throw new Error(impErr?.message ?? "Could not create import record");
      const importId = (imp as { id: string }).id;

      if (preview.kind === "transaction") {
        // 1) Faithful system of record — every line, every column, verbatim.
        if (preview.allLines.length) {
          const efsRows = preview.allLines.map((l) => ({
            org_id,
            import_id: importId,
            line_number: l.line_number,
            external_ref: l.external_ref,
            card_num: l.card_num,
            tran_date: l.tran_date,
            fueled_at: l.fueled_at,
            invoice: l.invoice,
            unit: l.unit,
            driver_name: l.driver_name,
            odometer: l.odometer,
            location_name: l.location_name,
            city: l.city,
            state: l.state,
            fees: l.fees,
            item: l.item,
            unit_price: l.unit_price,
            qty: l.qty,
            amt: l.amt,
            db: l.db,
            currency: l.currency,
          }));
          const { error } = await supabase
            .from("efs_transactions")
            .upsert(efsRows, { onConflict: "org_id,external_ref", ignoreDuplicates: true });
          if (error) throw new Error(error.message);
        }

        // 2) Derived fuel events for the anomaly engine.
        if (preview.newFuel.length) {
          const fuelRows = preview.newFuel.map((l) => ({
            id: genUuid(),
            org_id,
            vehicle_id: l.vehicle_id,
            driver_id: l.driver_id,
            fueled_at: l.fueled_at,
            fueled_at_precision: l.fueled_at_precision,
            odometer: l.odometer,
            gallons: l.gallons,
            total_cost: l.total_cost,
            price_per_gal: l.price_per_gal ?? derivePricePerGal(l.gallons, l.total_cost),
            location_text: loc(l.location_text, l.city, l.state),
            city: l.city,
            state: l.state,
            card_ref: l.card_ref,
            source: "fuel_card",
            external_ref: l.external_ref,
            import_id: importId,
            entered_by: session.userId,
          }));
          const { error } = await supabase
            .from("fuel_transactions")
            .upsert(fuelRows, { onConflict: "org_id,external_ref", ignoreDuplicates: true });
          if (error) throw new Error(error.message);
          // Score only THIS import's rows, in the background (returns immediately — no long wait).
          try {
            await apiFetch("/api/transactions/score-import", { method: "POST", body: { importId } });
          } catch {
            /* scoring can be retried; the upload itself is already committed */
          }
        }
      }

      // 3) Post-commit reconciliation: VERIFY what actually landed vs what the file contained, and
      // persist it on the import row. Silent losses (dedupe collisions, constraint drops) become
      // visible numbers instead of being discovered weeks later on the dashboard.
      if (preview.kind === "transaction") {
        const [{ count: efsCount }, { count: fuelCount }] = await Promise.all([
          supabase.from("efs_transactions").select("id", { count: "exact", head: true }).eq("import_id", importId),
          supabase.from("fuel_transactions").select("id", { count: "exact", head: true }).eq("import_id", importId),
        ]);
        const expectedNewEfs = preview.allLines.length - preview.duplicateEfsCount;
        const summary = {
          report_from: preview.reportFrom,
          report_to: preview.reportTo,
          rows_by_day: preview.rowsByDay,
          file_lines: preview.allLines.length,
          expected_new_efs_lines: expectedNewEfs,
          expected_new_fuel_events: preview.newFuel.length,
          db_efs_lines: efsCount ?? null,
          db_fuel_events: fuelCount ?? null,
          shortfall_fuel_events: fuelCount == null ? null : Math.max(0, preview.newFuel.length - fuelCount),
          shortfall_efs_lines: efsCount == null ? null : Math.max(0, expectedNewEfs - efsCount),
        };
        await supabase.from("imports").update({ summary }).eq("id", importId);
      } else if (preview.kind === "reject") {
        const { count: decCount } = await supabase
          .from("declined_transactions")
          .select("id", { count: "exact", head: true })
          .eq("import_id", importId);
        const summary = {
          report_from: preview.reportFrom,
          report_to: preview.reportTo,
          rows_by_day: preview.rowsByDay,
          expected_new_declines: preview.newDeclined.length,
          db_declines: decCount ?? null,
          shortfall_declines: decCount == null ? null : Math.max(0, preview.newDeclined.length - decCount),
        };
        await supabase.from("imports").update({ summary }).eq("id", importId);
      }

      if (preview.kind === "reject" && preview.newDeclined.length) {
        const declinedRows = preview.newDeclined.map((d) => ({
          org_id,
          import_id: importId,
          declined_at: d.declined_at,
          card_ref: d.card_ref,
          invoice: d.invoice,
          location_id: d.location_id,
          unit: d.unit,
          driver_ext_id: d.driver_ext_id,
          driver_name: d.driver_name,
          location_text: d.location_text,
          city: d.city,
          state: d.state,
          error_code: d.error_code,
          error_description: d.error_description,
          policy: d.policy,
          policy_name: d.policy_name,
          external_ref: d.external_ref,
        }));
        const { error } = await supabase
          .from("declined_transactions")
          .upsert(declinedRows, { onConflict: "org_id,external_ref", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        // Score the declined attempts for theft signals in the background.
        await apiFetch("/api/transactions/score-declined-import", { method: "POST", body: { importId } });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["efs_transactions"] });
      qc.invalidateQueries({ queryKey: ["fuel_transactions"] });
      qc.invalidateQueries({ queryKey: ["declined_transactions"] });
      qc.invalidateQueries({ queryKey: ["imports"] });
    },
  });
}
