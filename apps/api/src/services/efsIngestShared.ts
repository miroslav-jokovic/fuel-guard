/** Shared plumbing for the EFS ingest write paths (transaction + reject) — types, dedup lookups,
 * import-row creation and reconciliation helpers. Split from efsIngest.ts (file-size budget); the
 * behaviour is unchanged and efsIngest.ts re-exports the public symbols so callers/tests are stable. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawRow, ReportKind } from "@fuelguard/shared";

/** How the report reached us — recorded on imports.summary.channel for auditing (no migration needed). */
export type IngestChannel = "manual" | "auto";

export interface IngestInput {
  orgId: string;
  /** The authenticated user who triggered a manual run, or null for an unattended scheduler run. */
  requestedBy: string | null;
  source: "xlsx" | "csv";
  filename: string;
  /** SHA-256 hex of the raw file bytes — the file-level idempotency key (imports.file_hash). */
  fileHash: string;
  headers: string[];
  rows: RawRow[];
  channel?: IngestChannel;
}

export interface IngestResult {
  kind: ReportKind;
  /** True when this exact file (by SHA-256) was already committed — nothing was written. */
  alreadyImported: boolean;
  importId: string | null;
  // transaction
  efsLines: number;
  newFuel: number;
  duplicateFuel: number;
  duplicateEfs: number;
  unattributed: number;
  // reject
  newDeclined: number;
  duplicateDeclined: number;
  skipped: number;
  reportFrom: string | null;
  reportTo: string | null;
  /** Expected-new rows that did NOT land (dedupe collision / constraint drop). null = could not verify. */
  shortfallRows: number | null;
  /** Non-fatal scoring error — the import is committed; scoring can be retried. */
  scoreError: string | null;
}

export const loc = (...parts: (string | null)[]) => parts.filter(Boolean).join(", ") || null;

/** Expected-new minus what actually landed (never negative). null when the DB count is unavailable. */
export function computeShortfall(expectedNew: number, dbCount: number | null): number | null {
  return dbCount == null ? null : Math.max(0, expectedNew - dbCount);
}

/** Min/max business day (YYYY-MM-DD) across ISO/date strings — the report's covered period. */
export function dateSpan(values: (string | null)[]): { from: string | null; to: string | null } {
  const days = values.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null };
}

/** Per-day row counts (business date) — the reconciliation fingerprint persisted on the import. */
export function countByDay(dates: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dates) {
    if (!d) continue;
    const day = d.slice(0, 10);
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

/**
 * Look up which external_refs already exist in a table, in URL-safe batches. A month of data is
 * thousands of refs; a single .in() would blow past the PostgREST URL limit and silently return
 * nothing (making every row look "new"). 150/chunk mirrors the client path's headroom.
 */
export async function existingRefs(admin: SupabaseClient, table: string, refs: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 150;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const { data, error } = await admin.from(table).select("external_ref").in("external_ref", slice);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { external_ref: string }[]) found.add(r.external_ref);
  }
  return found;
}

export async function countByImport(admin: SupabaseClient, table: string, importId: string): Promise<number | null> {
  const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("import_id", importId);
  return count ?? null;
}

export function emptyResult(kind: ReportKind): IngestResult {
  return {
    kind,
    alreadyImported: false,
    importId: null,
    efsLines: 0,
    newFuel: 0,
    duplicateFuel: 0,
    duplicateEfs: 0,
    unattributed: 0,
    newDeclined: 0,
    duplicateDeclined: 0,
    skipped: 0,
    reportFrom: null,
    reportTo: null,
    shortfallRows: null,
    scoreError: null,
  };
}

/** Insert the parent import row, tolerating a schema without the file_hash column (pre-migration 0017). */
export async function createImport(
  admin: SupabaseClient,
  base: Record<string, unknown>,
  fileHash: string | null,
): Promise<string> {
  const withHash = fileHash ? { ...base, file_hash: fileHash } : base;
  let res = await admin.from("imports").insert(withHash).select("id").single();
  if (res.error?.message?.includes("file_hash")) {
    res = await admin.from("imports").insert(base).select("id").single();
  }
  if (res.error || !res.data) throw new Error(res.error?.message ?? "could not create import record");
  return (res.data as { id: string }).id;
}
