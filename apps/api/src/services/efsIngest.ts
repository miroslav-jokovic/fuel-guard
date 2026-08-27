import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectReportKind,
  normalizeAllTransactionLines,
  normalizeTransactionRows,
  reconcileFuelLines,
  driversToProvision,
  derivePricePerGal,
  learnEfsDriverIds,
} from "@silvicom/shared";
import type { Env } from "../env.js";
import { scoreImportWithCascade } from "./scoring/index.js";
import { scoreDeclinedImport } from "./declinedScoring.js";
import { ingestReject } from "./efsIngestReject.js";
import {
  loc,
  emptyResult,
  existingRefs,
  resolveTxnIdentitySplit,
  enrichExistingFills,
  resolveContentIdentitySplit,
  enrichContentMatches,
  reconcileImportCounts,
  createImport,
  DuplicateImportError,
  dateSpan,
  countByDay,
} from "./efsIngestShared.js";
import type {
  ContentIdentifiableFuelLine,
  IdentifiableFuelLine,
  IngestInput,
  IngestResult,
  KnownTxnIdentity,
} from "./efsIngestShared.js";
import type { EfsTransactionLine, ReconciledFuelLine } from "@silvicom/shared";

type PreparedTransaction = {
  allLines: EfsTransactionLine[];
  reconciled: ReconciledFuelLine[];
  skipped: ReturnType<typeof normalizeTransactionRows>["skipped"];
  toInsert: ReconciledFuelLine[];
  toEnrich: ReconciledFuelLine[];
  knownIdentities: Map<string, KnownTxnIdentity>;
  contentMatches: { line: ReconciledFuelLine; existing: KnownTxnIdentity }[];
  duplicateEfs: number;
  span: { from: string | null; to: string | null };
  rowsByDay: Record<string, number>;
};

async function learnTransactionDriverIds(
  admin: SupabaseClient,
  orgId: string,
  reconciled: ReconciledFuelLine[],
  drivers: unknown[],
): Promise<void> {
  const learnedIds = learnEfsDriverIds(
    reconciled.map((l) => ({ driverExtId: l.driver_ext_id ?? null, driverId: l.driver_id })),
  );
  if (!learnedIds.size) return;
  const claimed = new Map(
    (drivers as { id: string; efs_driver_id?: string | null }[])
      .filter((x) => x.efs_driver_id)
      .map((x) => [x.efs_driver_id as string, x.id]),
  );
  for (const [ext, driverId] of learnedIds) {
    const owner = claimed.get(ext);
    if (owner && owner !== driverId) continue;
    await admin
      .from("drivers")
      .update({ efs_driver_id: ext })
      .eq("id", driverId)
      .eq("org_id", orgId)
      .is("efs_driver_id", null);
  }
}

async function prepareTransaction(
  admin: SupabaseClient,
  input: IngestInput,
  vehicles: unknown[],
  drivers: unknown[],
): Promise<PreparedTransaction> {
  const allLines = normalizeAllTransactionLines(input.rows);
  const { fuelLines, skipped } = normalizeTransactionRows(input.rows);
  let driverList = drivers as { id: string; full_name: string }[];
  const toProvision = driversToProvision(
    fuelLines.map((l) => l.driver_name),
    driverList,
  );
  if (toProvision.length) {
    const { data: created } = await admin
      .from("drivers")
      .insert(
        // identity_source 'efs' (0204): a fuel-card name is a payment identity, not an employee.
        // Before 0204 these rows fell to the 'samsara' default and flooded the qualification queue.
        toProvision.map((full_name) => ({ org_id: input.orgId, full_name, status: "active", identity_source: "efs" })),
      )
      .select("id, full_name");
    driverList = [...driverList, ...((created ?? []) as { id: string; full_name: string }[])];
  }
  const reconciled = reconcileFuelLines(
    fuelLines,
    vehicles as { id: string; unit_number: string }[],
    driverList,
  );
  await learnTransactionDriverIds(admin, input.orgId, reconciled, drivers);
  const [fuelSeen, efsSeen] = await Promise.all([
    existingRefs(
      admin,
      "fuel_transactions",
      input.orgId,
      reconciled.map((l) => l.external_ref),
    ),
    existingRefs(
      admin,
      "efs_transactions",
      input.orgId,
      allLines.map((l) => l.external_ref),
    ),
  ]);
  const newFuel = reconciled.filter((l) => !fuelSeen.has(l.external_ref));
  const {
    toInsert: refMisses,
    toEnrich,
    known: knownIdentities,
  } = await resolveTxnIdentitySplit(admin, input.orgId, newFuel);
  const { toInsert, matches: contentMatches } = await resolveContentIdentitySplit(
    admin,
    input.orgId,
    refMisses,
  );
  return {
    allLines,
    reconciled,
    skipped,
    toInsert,
    toEnrich,
    knownIdentities,
    contentMatches,
    duplicateEfs: allLines.filter((l) => efsSeen.has(l.external_ref)).length,
    span: dateSpan(allLines.map((l) => l.tran_date)),
    rowsByDay: countByDay(allLines.map((l) => l.tran_date)),
  };
}

async function persistEfsTransactionLines(
  admin: SupabaseClient,
  orgId: string,
  importId: string,
  allLines: EfsTransactionLine[],
): Promise<void> {
  if (!allLines.length) return;
  const efsRows = allLines.map((l) => ({
    org_id: orgId,
    import_id: importId,
    line_number: l.line_number,
    external_ref: l.external_ref,
    transaction_id: l.transaction_id,
    card_num: l.card_num,
    tran_date: l.tran_date,
    fueled_at: l.fueled_at,
    tran_time: l.tran_time,
    invoice: l.invoice,
    unit: l.unit,
    driver_name: l.driver_name,
    control_id: l.control_id,
    driver_ext_id: l.driver_ext_id,
    trailer_number: l.trailer_number,
    hubometer: l.hubometer,
    trip: l.trip,
    subfleet: l.subfleet,
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

async function persistFuelTransactionRows(
  admin: SupabaseClient,
  env: Env,
  input: IngestInput,
  deps: IngestDeps,
  importId: string,
  toInsert: ReconciledFuelLine[],
  toEnrich: IdentifiableFuelLine[],
  knownIdentities: Map<string, KnownTxnIdentity>,
  contentMatches: { line: ContentIdentifiableFuelLine; existing: KnownTxnIdentity }[],
): Promise<{ enriched: number; scoreError: string | null }> {
  const enriched =
    (await enrichExistingFills(admin, toEnrich, knownIdentities)) +
    (await enrichContentMatches(admin, contentMatches));
  if (!toInsert.length) return { enriched, scoreError: null };
  const fuelRows = toInsert.map((l) => ({
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
    control_id: l.control_id,
    transaction_id: l.transaction_id,
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
  try {
    await deps.scoreImport(admin, env, input.orgId, importId);
    return { enriched, scoreError: null };
  } catch (e) {
    return { enriched, scoreError: e instanceof Error ? e.message : String(e) };
  }
}

async function persistTransactionRows(
  admin: SupabaseClient,
  env: Env,
  input: IngestInput,
  deps: IngestDeps,
  importId: string,
  allLines: EfsTransactionLine[],
  toInsert: ReconciledFuelLine[],
  toEnrich: IdentifiableFuelLine[],
  knownIdentities: Map<string, KnownTxnIdentity>,
  contentMatches: { line: ContentIdentifiableFuelLine; existing: KnownTxnIdentity }[],
): Promise<{ enriched: number; scoreError: string | null }> {
  await persistEfsTransactionLines(admin, input.orgId, importId, allLines);
  return persistFuelTransactionRows(
    admin,
    env,
    input,
    deps,
    importId,
    toInsert,
    toEnrich,
    knownIdentities,
    contentMatches,
  );
}

// Re-exported so existing callers/tests keep importing from efsIngest.js (the split is internal).
export { computeShortfall } from "./efsIngestShared.js";
export type { IngestChannel, IngestInput, IngestResult } from "./efsIngestShared.js";

/**
 * Server-side EFS report ingestion — the write path that the manual browser upload used to run
 * client-side (apps/web/src/features/import/useImport.ts). Moving it here lets the tiered scheduler
 * (Chunk 3) ingest reports delivered to an email/SFTP dropbox with no human present, while giving the
 * write path the guarantees the browser path lacked: it runs under the service-role client + audit,
 * and every step is idempotent so a re-delivered or overlapping report is a safe no-op.
 *
 * Faithfulness contract with the manual path, each clause pinned by a scenario in efsIngest.test.ts:
 *   • same shared parser, same faithful store, same derived events and same shortfall reconciliation —
 *     "stores every line faithfully, derives fuel-only events, reconciles a zero shortfall, and scores"
 *   • same row-level idempotency —
 *     "is idempotent at the ROW level: re-ingesting the same rows under a new file writes nothing new"
 *   • same file-level idempotency on the SHA-256 —
 *     "is idempotent at the FILE level: the same file hash is a no-op"
 * The ONLY behavioural difference is provenance: summary.channel records how the file arrived, proved by
 * "channel defaults to 'auto' for an unattended run".
 */

/**
 * Scoring is injected so the ingest write path can be unit-tested without a live Samsara/Supabase.
 * Defaults call the same services the manual route wraps in a job.
 */
export interface IngestDeps {
  scoreImport: (
    admin: SupabaseClient,
    env: Env,
    orgId: string,
    importId: string,
  ) => Promise<unknown>;
  scoreDeclined: (
    admin: SupabaseClient,
    env: Env,
    orgId: string,
    importId: string,
  ) => Promise<unknown>;
}

const defaultDeps: IngestDeps = {
  scoreImport: (admin, env, orgId, importId) => scoreImportWithCascade(admin, env, orgId, importId),
  scoreDeclined: (admin, env, orgId, importId) => scoreDeclinedImport(admin, env, orgId, importId),
};

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
  let existingImportId: string | null = null;
  try {
    // Org-scoped: file_hash is only unique within a tenant, and two carriers can legitimately
    // receive byte-identical empty/short reports. Unscoped, org B's import would suppress org A's.
    const { data } = await admin
      .from("imports")
      .select("id")
      .eq("org_id", input.orgId)
      .eq("file_hash", input.fileHash)
      .limit(1);
    existingImportId = ((data ?? []) as { id: string }[])[0]?.id ?? null;
  } catch {
    /* file_hash column not present yet — fall through and rely on row-level external_ref dedup */
  }
  if (existingImportId) return { ...emptyResult(kind), alreadyImported: true, importId: existingImportId };

  const [{ data: vehicles }, { data: drivers }] = await Promise.all([
    admin.from("vehicles").select("id, unit_number").eq("org_id", input.orgId),
    admin.from("drivers").select("id, full_name, efs_driver_id").eq("org_id", input.orgId),
  ]);

  if (kind === "transaction") {
    return ingestTransaction(admin, env, input, deps, vehicles ?? [], drivers ?? []);
  }
  return ingestReject(admin, env, input, deps, vehicles ?? [], drivers ?? []);
}

async function ingestTransaction(
  admin: SupabaseClient,
  env: Env,
  input: IngestInput,
  deps: IngestDeps,
  vehicles: unknown[],
  drivers: unknown[],
): Promise<IngestResult> {
  const prepared = await prepareTransaction(admin, input, vehicles, drivers);
  const { allLines, reconciled, skipped, toInsert, duplicateEfs, span, rowsByDay } = prepared;

  let importId: string;
  try {
    importId = await createImport(
      admin,
      {
        org_id: input.orgId,
        source: input.source,
        kind: "transaction",
        filename: input.filename,
        status: "completed",
        total_rows: input.rows.length,
        inserted_rows: allLines.length,
        duplicate_rows: reconciled.length - toInsert.length,
        skipped_rows: skipped.length,
        created_by: input.requestedBy,
      },
      input.fileHash,
    );
  } catch (e) {
    // P1 (0125): the same file landed concurrently via another delivery — a duplicate, not an error.
    if (e instanceof DuplicateImportError)
      return { ...emptyResult("transaction"), alreadyImported: true };
    throw e;
  }

  const { enriched, scoreError } = await persistTransactionRows(
    admin,
    env,
    input,
    deps,
    importId,
    allLines,
    toInsert,
    prepared.toEnrich,
    prepared.knownIdentities,
    prepared.contentMatches,
  );

  // 3) Post-commit reconciliation — verify what landed vs the file and surface any shortfall.
  const { shortfallRows } = await reconcileImportCounts(admin, importId, {
    channel: input.channel ?? "auto",
    span,
    rowsByDay,
    fileLines: allLines.length,
    expectedNewEfs: allLines.length - duplicateEfs,
    expectedNewFuel: toInsert.length,
    enriched,
    scoreError,
  });

  return {
    kind: "transaction",
    alreadyImported: false,
    importId,
    efsLines: allLines.length,
    newFuel: toInsert.length,
    duplicateFuel: reconciled.length - toInsert.length,
    enrichedFuel: enriched,
    duplicateEfs,
    unattributed: toInsert.filter((l) => l.vehicle_id == null).length,
    newDeclined: 0,
    duplicateDeclined: 0,
    skipped: skipped.length,
    reportFrom: span.from,
    reportTo: span.to,
    shortfallRows,
    scoreError,
  };
}
