import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectReportKind,
  normalizeAllTransactionLines,
  normalizeTransactionRows,
  normalizeRejectRows,
  reconcileFuelLines,
  driversToProvision,
  derivePricePerGal,
  type RawRow,
  type ReportKind,
} from "@fuelguard/shared";
import type { Env } from "../env.js";
import { scoreImportWithCascade } from "./scoring/index.js";
import { scoreDeclinedImport } from "./declinedScoring.js";

/**
 * Server-side EFS report ingestion — the write path that the manual browser upload used to run
 * client-side (apps/web/src/features/import/useImport.ts). Moving it here lets the tiered scheduler
 * (Chunk 3) ingest reports delivered to an email/SFTP dropbox with no human present, while giving the
 * write path the guarantees the browser path lacked: it runs under the service-role client + audit,
 * and every step is idempotent so a re-delivered or overlapping report is a safe no-op.
 *
 * Faithfulness contract with the manual path (verified in efsIngest.test.ts):
 *   • same shared parser (normalizeAllTransactionLines / normalizeTransactionRows / normalizeRejectRows)
 *   • same idempotency: file-level SHA-256 (imports.file_hash) + row-level external_ref upsert dedup
 *   • same faithful store (efs_transactions) + derived scoring events (fuel_transactions) + declines
 *   • same post-commit shortfall reconciliation written onto imports.summary
 * The ONLY behavioural difference is provenance: summary.channel records how the file arrived.
 */

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

/**
 * Scoring is injected so the ingest write path can be unit-tested without a live Samsara/Supabase.
 * Defaults call the same services the manual route wraps in a job.
 */
export interface IngestDeps {
  scoreImport: (admin: SupabaseClient, env: Env, orgId: string, importId: string) => Promise<unknown>;
  scoreDeclined: (admin: SupabaseClient, env: Env, orgId: string, importId: string) => Promise<unknown>;
}

const defaultDeps: IngestDeps = {
  scoreImport: (admin, env, orgId, importId) => scoreImportWithCascade(admin, env, orgId, importId),
  scoreDeclined: (admin, env, orgId, importId) => scoreDeclinedImport(admin, env, orgId, importId),
};

const loc = (...parts: (string | null)[]) => parts.filter(Boolean).join(", ") || null;

/** Expected-new minus what actually landed (never negative). null when the DB count is unavailable. */
export function computeShortfall(expectedNew: number, dbCount: number | null): number | null {
  return dbCount == null ? null : Math.max(0, expectedNew - dbCount);
}

/** Min/max business day (YYYY-MM-DD) across ISO/date strings — the report's covered period. */
function dateSpan(values: (string | null)[]): { from: string | null; to: string | null } {
  const days = values.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort();
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null };
}

/** Per-day row counts (business date) — the reconciliation fingerprint persisted on the import. */
function countByDay(dates: (string | null)[]): Record<string, number> {
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
async function existingRefs(admin: SupabaseClient, table: string, refs: string[]): Promise<Set<string>> {
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

async function countByImport(admin: SupabaseClient, table: string, importId: string): Promise<number | null> {
  const { count } = await admin.from(table).select("id", { count: "exact", head: true }).eq("import_id", importId);
  return count ?? null;
}

function emptyResult(kind: ReportKind): IngestResult {
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
async function createImport(
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

/**
 * Ingest one parsed EFS report (Transaction Detail or Reject) end-to-end: classify, dedup, write the
 * faithful store + derived scoring events + declines, reconcile the shortfall onto imports.summary, and
 * score. Every write is idempotent; an already-seen file or an unknown report kind is a safe no-op.
 */
export async function ingestReport(
  admin: SupabaseClient,
  env: Env,
  input: IngestInput,
  deps: IngestDeps = defaultDeps,
): Promise<IngestResult> {
  const kind = detectReportKind(input.headers);
  if (kind === "unknown") {
    // Unattended runs must never fabricate data from an unrecognized file. Chunk 5 quarantines the
    // artifact; here we simply write nothing and report it so the caller/digest can surface it.
    return emptyResult("unknown");
  }

  // File-level idempotency: this exact file was already committed → no-op. Guard the query in case the
  // file_hash column predates migration 0017 (treat as not-yet-imported, same as the client path).
  let alreadyImported = false;
  try {
    const { data } = await admin.from("imports").select("id").eq("file_hash", input.fileHash).limit(1);
    alreadyImported = ((data ?? []) as unknown[]).length > 0;
  } catch {
    /* file_hash column not present yet — fall through and rely on row-level external_ref dedup */
  }
  if (alreadyImported) return { ...emptyResult(kind), alreadyImported: true };

  const [{ data: vehicles }, { data: drivers }] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", input.orgId),
    admin.from("drivers").select("id, full_name").eq("org_id", input.orgId),
  ]);

  if (kind === "transaction") {
    return ingestTransaction(admin, env, input, deps, vehicles ?? [], drivers ?? []);
  }
  return ingestReject(admin, env, input, deps);
}

async function ingestTransaction(
  admin: SupabaseClient,
  env: Env,
  input: IngestInput,
  deps: IngestDeps,
  vehicles: unknown[],
  drivers: unknown[],
): Promise<IngestResult> {
  const allLines = normalizeAllTransactionLines(input.rows); // faithful: every line, every column
  const { fuelLines, skipped } = normalizeTransactionRows(input.rows); // merged fuel-only events
  // Auto-provision a driver record for any EFS name with no match, so the fill is attributed instead of
  // left driverless (EFS carries the correct name; the gap is only a missing record). Deduped/normalized.
  let driverList = drivers as { id: string; full_name: string }[];
  const toProvision = driversToProvision(fuelLines.map((l) => l.driver_name), driverList);
  if (toProvision.length) {
    const { data: created } = await admin
      .from("drivers")
      .insert(toProvision.map((full_name) => ({ org_id: input.orgId, full_name, status: "active" })))
      .select("id, full_name");
    driverList = [...driverList, ...((created ?? []) as { id: string; full_name: string }[])];
  }
  const reconciled = reconcileFuelLines(fuelLines, vehicles as { id: string; unit_number: string }[], driverList);

  const [fuelSeen, efsSeen] = await Promise.all([
    existingRefs(admin, "fuel_transactions", reconciled.map((l) => l.external_ref)),
    existingRefs(admin, "efs_transactions", allLines.map((l) => l.external_ref)),
  ]);
  const newFuel = reconciled.filter((l) => !fuelSeen.has(l.external_ref));
  const duplicateEfs = allLines.filter((l) => efsSeen.has(l.external_ref)).length;
  const span = dateSpan(allLines.map((l) => l.tran_date));
  const rowsByDay = countByDay(allLines.map((l) => l.tran_date));

  const importId = await createImport(
    admin,
    {
      org_id: input.orgId,
      source: input.source,
      kind: "transaction",
      filename: input.filename,
      status: "completed",
      total_rows: input.rows.length,
      inserted_rows: allLines.length,
      duplicate_rows: reconciled.length - newFuel.length,
      skipped_rows: skipped.length,
      created_by: input.requestedBy,
    },
    input.fileHash,
  );

  // 1) Faithful system of record — every line, every column, verbatim.
  if (allLines.length) {
    const efsRows = allLines.map((l) => ({
      org_id: input.orgId,
      import_id: importId,
      line_number: l.line_number,
      external_ref: l.external_ref,
      card_num: l.card_num,
      tran_date: l.tran_date,
      fueled_at: l.fueled_at,
      tran_time: l.tran_time,
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
    const { error } = await admin
      .from("efs_transactions")
      .upsert(efsRows, { onConflict: "org_id,external_ref", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  // 2) Derived fuel events for the anomaly engine.
  let scoreError: string | null = null;
  if (newFuel.length) {
    const fuelRows = newFuel.map((l) => ({
      org_id: input.orgId,
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
      tank_type: l.tank_type,
      source: "fuel_card",
      external_ref: l.external_ref,
      import_id: importId,
      entered_by: input.requestedBy,
    }));
    const { error } = await admin
      .from("fuel_transactions")
      .upsert(fuelRows, { onConflict: "org_id,external_ref", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    // Score this import's rows (+ auto-cascade to neighboring fills). We are already inside the
    // efs_ingest background job, so awaiting is correct. A scoring hiccup must NOT discard a committed
    // import — record it and let the nightly reconcile / manual rebuild retry.
    try {
      await deps.scoreImport(admin, env, input.orgId, importId);
    } catch (e) {
      scoreError = e instanceof Error ? e.message : String(e);
    }
  }

  // 3) Post-commit reconciliation — verify what landed vs the file, persist it, surface any shortfall.
  const [dbEfs, dbFuel] = await Promise.all([
    countByImport(admin, "efs_transactions", importId),
    countByImport(admin, "fuel_transactions", importId),
  ]);
  const expectedNewEfs = allLines.length - duplicateEfs;
  const shortEfs = computeShortfall(expectedNewEfs, dbEfs);
  const shortFuel = computeShortfall(newFuel.length, dbFuel);
  const shortfallRows = shortEfs == null && shortFuel == null ? null : (shortEfs ?? 0) + (shortFuel ?? 0);

  await admin
    .from("imports")
    .update({
      summary: {
        channel: input.channel ?? "auto",
        report_from: span.from,
        report_to: span.to,
        rows_by_day: rowsByDay,
        file_lines: allLines.length,
        expected_new_efs_lines: expectedNewEfs,
        expected_new_fuel_events: newFuel.length,
        db_efs_lines: dbEfs,
        db_fuel_events: dbFuel,
        shortfall_efs_lines: shortEfs,
        shortfall_fuel_events: shortFuel,
        score_error: scoreError,
      },
    })
    .eq("id", importId);

  return {
    kind: "transaction",
    alreadyImported: false,
    importId,
    efsLines: allLines.length,
    newFuel: newFuel.length,
    duplicateFuel: reconciled.length - newFuel.length,
    duplicateEfs,
    unattributed: newFuel.filter((l) => l.vehicle_id == null).length,
    newDeclined: 0,
    duplicateDeclined: 0,
    skipped: skipped.length,
    reportFrom: span.from,
    reportTo: span.to,
    shortfallRows,
    scoreError,
  };
}

async function ingestReject(
  admin: SupabaseClient,
  env: Env,
  input: IngestInput,
  deps: IngestDeps,
): Promise<IngestResult> {
  const { declined, skipped } = normalizeRejectRows(input.rows);
  const seen = await existingRefs(admin, "declined_transactions", declined.map((d) => d.external_ref));
  const newDeclined = declined.filter((d) => !seen.has(d.external_ref));
  const span = dateSpan(declined.map((d) => d.declined_at));
  const rowsByDay = countByDay(declined.map((d) => d.declined_at));

  const importId = await createImport(
    admin,
    {
      org_id: input.orgId,
      source: input.source,
      kind: "reject",
      filename: input.filename,
      status: "completed",
      total_rows: input.rows.length,
      inserted_rows: newDeclined.length,
      duplicate_rows: declined.length - newDeclined.length,
      skipped_rows: skipped.length,
      created_by: input.requestedBy,
    },
    input.fileHash,
  );

  let scoreError: string | null = null;
  if (newDeclined.length) {
    const declinedRows = newDeclined.map((d) => ({
      org_id: input.orgId,
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
    const { error } = await admin
      .from("declined_transactions")
      .upsert(declinedRows, { onConflict: "org_id,external_ref", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    try {
      await deps.scoreDeclined(admin, env, input.orgId, importId);
    } catch (e) {
      scoreError = e instanceof Error ? e.message : String(e);
    }
  }

  const dbDeclined = await countByImport(admin, "declined_transactions", importId);
  const shortfallRows = computeShortfall(newDeclined.length, dbDeclined);

  await admin
    .from("imports")
    .update({
      summary: {
        channel: input.channel ?? "auto",
        report_from: span.from,
        report_to: span.to,
        rows_by_day: rowsByDay,
        expected_new_declines: newDeclined.length,
        db_declines: dbDeclined,
        shortfall_declines: shortfallRows,
        score_error: scoreError,
      },
    })
    .eq("id", importId);

  return {
    ...emptyResult("reject"),
    importId,
    newDeclined: newDeclined.length,
    duplicateDeclined: declined.length - newDeclined.length,
    skipped: skipped.length,
    reportFrom: span.from,
    reportTo: span.to,
    shortfallRows,
    scoreError,
  };
}
