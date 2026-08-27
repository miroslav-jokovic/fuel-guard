import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectReportKind,
  normalizeAllTransactionLines,
  normalizeTransactionRows,
  normalizeRejectRows,
  reconcileFuelLines,
  type RawRow,
  type ReportKind,
  type ReconciledFuelLine,
  type ParsedDeclined,
  type EfsTransactionLine,
} from "@silvicom/shared";

/**
 * The review-preview analysis, server-side (program step P1.9, D-SEP11 —
 * docs/plans/architecture/SEPARATION-PROGRAM-PLAN.md). Until 2026-08-27 the browser ran the EFS
 * report parsers itself and probed duplicates straight over PostgREST with a VARIABLE table name
 * — the one dynamic `.from()` in the codebase, invisible to every table gate. The commit path
 * had already moved server-side at P0-1; this closes the preview half: the browser now decodes
 * the file and asks, and the collector parses and answers. Every probe here is org-scoped
 * explicitly — the service role bypasses RLS, which is what scoped the browser's probes.
 */
export interface ReportPreview {
  kind: ReportKind;
  alreadyImported: boolean;
  /** First rows of the faithful line parse, for the review table — bounded so a month-size file
   *  does not round-trip thousands of parsed rows it only shows ten of. */
  previewLines: EfsTransactionLine[];
  allLinesCount: number;
  newFuel: ReconciledFuelLine[];
  duplicateFuelCount: number;
  duplicateEfsCount: number;
  unattributedCount: number;
  skippedCount: number;
  newDeclined: ParsedDeclined[];
  duplicateDeclinedCount: number;
  reportFrom: string | null;
  reportTo: string | null;
  rowsByDay: Record<string, number>;
}

const CHUNK = 500;

async function existingFuelRefs(admin: SupabaseClient, orgId: string, refs: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < refs.length; i += CHUNK) {
    const { data, error } = await admin
      .from("fuel_transactions").select("external_ref").eq("org_id", orgId).in("external_ref", refs.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) found.add((r as { external_ref: string }).external_ref);
  }
  return found;
}

async function existingEfsRefs(admin: SupabaseClient, orgId: string, refs: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < refs.length; i += CHUNK) {
    const { data, error } = await admin
      .from("efs_transactions").select("external_ref").eq("org_id", orgId).in("external_ref", refs.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) found.add((r as { external_ref: string }).external_ref);
  }
  return found;
}

async function existingDeclinedRefs(admin: SupabaseClient, orgId: string, refs: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < refs.length; i += CHUNK) {
    const { data, error } = await admin
      .from("declined_transactions").select("external_ref").eq("org_id", orgId).in("external_ref", refs.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) found.add((r as { external_ref: string }).external_ref);
  }
  return found;
}

function countByDay(dates: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dates) {
    if (!d) continue;
    const day = d.slice(0, 10);
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

function dateSpan(isos: (string | null)[]): { from: string | null; to: string | null } {
  const days = isos.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null };
}

export async function previewReport(
  admin: SupabaseClient,
  orgId: string,
  input: { headers: string[]; rows: RawRow[]; fileHash: string },
): Promise<ReportPreview> {
  const kind = detectReportKind(input.headers);

  const { data: hashHit } = await admin
    .from("imports").select("id").eq("org_id", orgId).eq("file_hash", input.fileHash).limit(1);
  const alreadyImported = (hashHit ?? []).length > 0;

  const base: ReportPreview = {
    kind,
    alreadyImported,
    previewLines: [],
    allLinesCount: 0,
    newFuel: [],
    duplicateFuelCount: 0,
    duplicateEfsCount: 0,
    unattributedCount: 0,
    skippedCount: 0,
    newDeclined: [],
    duplicateDeclinedCount: 0,
    reportFrom: null,
    reportTo: null,
    rowsByDay: {},
  };

  if (kind === "transaction") {
    const [{ data: vRows }, { data: dRows }] = await Promise.all([
      admin.from("vehicles").select("id, unit_number").eq("org_id", orgId),
      admin.from("drivers").select("id, full_name").eq("org_id", orgId),
    ]);
    const allLines = normalizeAllTransactionLines(input.rows);
    const { fuelLines, skipped } = normalizeTransactionRows(input.rows);
    const reconciled = reconcileFuelLines(
      fuelLines,
      (vRows ?? []) as { id: string; unit_number: string }[],
      (dRows ?? []) as { id: string; full_name: string }[],
    );
    const [seen, efsSeen] = await Promise.all([
      existingFuelRefs(admin, orgId, reconciled.map((l) => l.external_ref)),
      existingEfsRefs(admin, orgId, allLines.map((l) => l.external_ref)),
    ]);
    const newFuel = reconciled.filter((l) => !seen.has(l.external_ref));
    const span = dateSpan(allLines.map((l) => l.tran_date));
    return {
      ...base,
      previewLines: allLines.slice(0, 10),
      allLinesCount: allLines.length,
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
    const { declined, skipped } = normalizeRejectRows(input.rows);
    const seen = await existingDeclinedRefs(admin, orgId, declined.map((d) => d.external_ref));
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
