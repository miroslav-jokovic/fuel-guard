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
} from "@fleetguard/shared";
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
  // transaction
  allLines: EfsTransactionLine[]; // faithful, every line (preview + system of record)
  newFuel: ReconciledFuelLine[]; // derived fuel events for scoring
  duplicateFuelCount: number;
  unattributedCount: number;
  skippedCount: number;
  // reject
  newDeclined: ParsedDeclined[];
  duplicateDeclinedCount: number;
}

async function existingRefs(table: string, refs: string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const { data } = await supabase.from(table).select("external_ref").in("external_ref", refs);
  return new Set((data ?? []).map((r) => (r as { external_ref: string }).external_ref));
}

/** Read + classify + reconcile + dedup a file into a review preview (no writes). */
export async function analyzeImport(
  file: File,
  vehicles: Vehicle[],
  drivers: Driver[],
): Promise<ImportPreview> {
  const { headers, rows } = await readFile(file);
  const kind = detectReportKind(headers);
  const source: "xlsx" | "csv" = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
  const base = {
    kind,
    source,
    filename: file.name,
    totalRows: rows.length,
    allLines: [] as EfsTransactionLine[],
    newFuel: [] as ReconciledFuelLine[],
    duplicateFuelCount: 0,
    unattributedCount: 0,
    skippedCount: 0,
    newDeclined: [] as ParsedDeclined[],
    duplicateDeclinedCount: 0,
  };

  if (kind === "transaction") {
    const allLines = normalizeAllTransactionLines(rows); // faithful, every column/row
    const { fuelLines, skipped } = normalizeTransactionRows(rows);
    const reconciled = reconcileFuelLines(fuelLines, vehicles, drivers);
    const seen = await existingRefs("fuel_transactions", reconciled.map((l) => l.external_ref));
    const newFuel = reconciled.filter((l) => !seen.has(l.external_ref));
    return {
      ...base,
      allLines,
      newFuel,
      duplicateFuelCount: reconciled.length - newFuel.length,
      unattributedCount: newFuel.filter((l) => l.vehicle_id == null).length,
      skippedCount: skipped.length,
    };
  }

  if (kind === "reject") {
    const declined = normalizeRejectRows(rows);
    const seen = await existingRefs("declined_transactions", declined.map((d) => d.external_ref));
    const newDeclined = declined.filter((d) => !seen.has(d.external_ref));
    return { ...base, newDeclined, duplicateDeclinedCount: declined.length - newDeclined.length };
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
      const { data: imp, error: impErr } = await supabase
        .from("imports")
        .insert({
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
        })
        .select("id")
        .single();
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
          try {
            await apiFetch("/api/transactions/backfill", { method: "POST" });
          } catch {
            /* scoring can be retried */
          }
        }
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
