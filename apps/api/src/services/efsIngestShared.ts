/** Shared plumbing for the EFS ingest write paths (transaction + reject) — types, dedup lookups,
 * import-row creation and reconciliation helpers. Split from efsIngest.ts (file-size budget); the
 * behaviour is unchanged and efsIngest.ts re-exports the public symbols so callers/tests are stable. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFullCardNumber, sameCardFill } from "@silvicom/shared";
import type { RawRow, ReportKind } from "@silvicom/shared";

/** How the report reached us — recorded on imports.summary.channel for auditing (no migration needed). */
export type IngestChannel = "manual" | "auto";

export interface IngestInput {
  orgId: string;
  /** The authenticated user who triggered a manual run, or null for an unattended scheduler run. */
  requestedBy: string | null;
  source: "xlsx" | "csv" | "efs_feed";
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
  /** Rows whose EFS transaction identity was already stored, so the existing row was enriched. */
  enrichedFuel?: number;
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
/**
 * Which of these external_refs already exist FOR THIS ORG.
 *
 * The org filter is not optional. The unique indexes behind these tables are `(org_id, external_ref)`,
 * so a ref belonging to a DIFFERENT tenant does not block an insert — but an unscoped lookup would
 * report it as already-seen and drop the row from the insert batch. The result is a silently missing
 * transaction, and the shortfall check cannot catch it because the expected count shrinks by exactly
 * the same amount. EFS invoice numbers are per-merchant sequences, so collisions across carriers are
 * expected rather than hypothetical.
 */
export async function existingRefs(admin: SupabaseClient, table: string, orgId: string, refs: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 150;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const slice = refs.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    const { data, error } = await admin.from(table).select("external_ref").eq("org_id", orgId).in("external_ref", slice);
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

/** P1 (2026-08 audit): thrown when the file-hash unique index (0125) refuses a concurrent duplicate
 *  delivery of the same file — the read-then-write "alreadyImported" check is racy by nature; the DB
 *  is the arbiter. Callers treat it exactly like the pre-checked alreadyImported case. */
export class DuplicateImportError extends Error {
  constructor() {
    super("this file was imported concurrently by another delivery");
    this.name = "DuplicateImportError";
  }
}

/** Insert the parent import row, tolerating a schema without the file_hash column (pre-migration 0017). */
export async function createImport(
  admin: SupabaseClient,
  base: Record<string, unknown>,
  fileHash: string | null,
): Promise<string> {
  const withHash = fileHash ? { ...base, file_hash: fileHash } : base;
  let res = await admin.from("imports").insert(withHash).select("id").single();
  // A 23505 here can only be uq_imports_org_file_hash (0125): the same file landed concurrently via
  // another channel/replica between our pre-check and this insert. Not an error — a duplicate.
  if (res.error?.code === "23505") throw new DuplicateImportError();
  if (res.error?.message?.includes("file_hash")) {
    res = await admin.from("imports").insert(base).select("id").single();
  }
  if (res.error || !res.data) throw new Error(res.error?.message ?? "could not create import record");
  return (res.data as { id: string }).id;
}

/** One already-stored fueling event, keyed by EFS's own transaction identity. */
export interface KnownTxnIdentity {
  id: string;
  card_ref: string | null;
  control_id: string | null;
  odometer: number | null;
  transaction_id: string | null;
}

/** `${transactionId}|${tankType}` — the identity of ONE fueling event (migration 0107). */
export const txnIdentityKey = (transactionId: string | null | undefined, tankType: string | null | undefined): string | null =>
  transactionId ? `${transactionId}|${tankType ?? "tractor"}` : null;

/**
 * Which of these EFS transaction identities this org already holds.
 *
 * This is the cross-channel dedupe that `external_ref` cannot do: a file report keys its ref on the
 * Invoice column while the SOAP feed keys on the Stable Transaction ID, so the same physical fill
 * arriving both ways produces two refs that will never collide — but ONE `transactionId`. Looking the
 * identity up separately is what lets the caller enrich the existing row instead of inserting a twin.
 */
export async function existingTxnIdentities(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
): Promise<Map<string, KnownTxnIdentity>> {
  const out = new Map<string, KnownTxnIdentity>();
  const CHUNK = 150;
  const distinct = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < distinct.length; i += CHUNK) {
    const slice = distinct.slice(i, i + CHUNK);
    if (!slice.length) continue;
    const { data, error } = await admin
      .from("fuel_transactions")
      .select("id, transaction_id, tank_type, card_ref, control_id, odometer")
      .eq("org_id", orgId)
      .in("transaction_id", slice);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as (KnownTxnIdentity & { tank_type: string | null })[]) {
      const key = txnIdentityKey(r.transaction_id, r.tank_type);
      if (key) out.set(key, r);
    }
  }
  return out;
}

/** A parsed fuel line, narrowed to the fields the identity split needs. */
export interface IdentifiableFuelLine {
  transaction_id: string | null;
  tank_type: string | null;
  card_ref: string | null;
  control_id: string | null;
  odometer: number | null;
}

/**
 * Split a batch into rows to INSERT and rows that should ENRICH a fill we already hold.
 *
 * `external_ref` only dedupes within a delivery channel — a file report builds it from the Invoice
 * column, the SOAP feed from the Stable Transaction ID — so the same physical fill arriving both ways
 * produces two refs that can never collide, but ONE EFS `transactionId`. Resolving that identity
 * separately is what lets the caller update the row it already has instead of inserting a twin.
 *
 * Rows with no transaction id (older report variants) fall through to `toInsert` unchanged, still
 * guarded by external_ref exactly as before.
 */
export async function resolveTxnIdentitySplit<T extends IdentifiableFuelLine>(
  admin: SupabaseClient,
  orgId: string,
  lines: T[],
): Promise<{ toInsert: T[]; toEnrich: T[]; known: Map<string, KnownTxnIdentity> }> {
  const known = await existingTxnIdentities(
    admin,
    orgId,
    lines.map((l) => l.transaction_id).filter((v): v is string => !!v),
  );
  const hit = (l: T): boolean => {
    const k = txnIdentityKey(l.transaction_id, l.tank_type);
    return k != null && known.has(k);
  };
  return { toInsert: lines.filter((l) => !hit(l)), toEnrich: lines.filter(hit), known };
}

/**
 * Fold a later delivery's richer fields into the fill we already stored. Returns how many rows changed.
 *
 * Strictly additive: it fills gaps and upgrades a MASKED card number to an unmasked one, never the
 * reverse. That direction matters — a masked ref cannot identify a card, so overwriting a full number
 * with one would blind the card-identity rules on data that was previously fine.
 */
export async function enrichExistingFills(
  admin: SupabaseClient,
  toEnrich: IdentifiableFuelLine[],
  known: Map<string, KnownTxnIdentity>,
): Promise<number> {
  let enriched = 0;
  for (const l of toEnrich) {
    const existing = known.get(txnIdentityKey(l.transaction_id, l.tank_type)!);
    if (!existing) continue;
    const patch: Record<string, unknown> = {};
    if (isFullCardNumber(l.card_ref) && !isFullCardNumber(existing.card_ref)) patch.card_ref = l.card_ref;
    if (l.control_id && !existing.control_id) patch.control_id = l.control_id;
    if (l.odometer != null && existing.odometer == null) patch.odometer = l.odometer;
    if (!existing.transaction_id && l.transaction_id) patch.transaction_id = l.transaction_id;
    if (!Object.keys(patch).length) continue;
    const { error } = await admin.from("fuel_transactions").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);
    enriched += 1;
  }
  return enriched;
}

/** A parsed fuel line, narrowed to the fields the CONTENT identity match needs (identity fields + the
 *  physical fill facts). */
export interface ContentIdentifiableFuelLine extends IdentifiableFuelLine {
  fueled_at: string;
  fueled_at_precision: string | null;
  gallons: number;
}

/** Two gallons figures within this are the same dispense (EFS reports 3 decimals; float slop only). */
const CONTENT_GALLONS_TOLERANCE = 0.005;

const contentTank = (t: string | null | undefined): string => (t === "reefer" ? "reefer" : "tractor");

/**
 * CONTENT identity split (2026-08 duplication incident, residual class). The txn-identity split above
 * catches twins only when BOTH copies carry the same EFS transaction id — but the store-derive/repair
 * path historically inserted rows WITHOUT transaction_id, and a file variant carrying `TransactionId`
 * (not `Stable Transaction ID`) keys its ref differently from the store-derived ref, so the same fill
 * could arrive with two refs AND no shared transaction id. Content identity is the physical backstop:
 * the SAME CARD billed the SAME GALLONS at the SAME INSTANT into the SAME TANK is one dispense, no
 * matter which channel delivered it or what ref it carries.
 *
 * Deliberately narrow (precision-first):
 *   • only lines with an INSTANT-precision fueling time participate — two date-only rows share the noon
 *     sentinel, so "same instant" would conflate two legitimate same-day fills;
 *   • card identity via sameCardFill (full-number exact match, or last-4 + control id) — a bare masked
 *     ref never matches on its own;
 *   • gallons must match to the EFS reporting precision.
 * Matches are routed to ENRICH (same additive patch as the txn-identity path); everything else inserts.
 */
export async function resolveContentIdentitySplit<T extends ContentIdentifiableFuelLine>(
  admin: SupabaseClient,
  orgId: string,
  lines: T[],
): Promise<{ toInsert: T[]; matches: { line: T; existing: KnownTxnIdentity }[] }> {
  const candidates = lines.filter((l) => l.fueled_at_precision === "instant" && l.card_ref);
  if (!candidates.length) return { toInsert: lines, matches: [] };

  interface ContentRow extends KnownTxnIdentity {
    fueled_at: string;
    gallons: number | string;
    tank_type: string | null;
  }
  const byInstant = new Map<number, ContentRow[]>();
  const instants = [...new Set(candidates.map((l) => l.fueled_at))];
  const CHUNK = 150;
  for (let i = 0; i < instants.length; i += CHUNK) {
    const slice = instants.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("fuel_transactions")
      .select("id, transaction_id, tank_type, card_ref, control_id, odometer, fueled_at, gallons")
      .eq("org_id", orgId)
      .in("fueled_at", slice);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as ContentRow[]) {
      const t = Date.parse(r.fueled_at);
      const g = byInstant.get(t);
      if (g) g.push(r);
      else byInstant.set(t, [r]);
    }
  }

  const matches: { line: T; existing: KnownTxnIdentity }[] = [];
  const matchedIds = new Set<string>();
  const toInsert: T[] = [];
  for (const l of lines) {
    if (l.fueled_at_precision !== "instant" || !l.card_ref) {
      toInsert.push(l);
      continue;
    }
    const rows = byInstant.get(Date.parse(l.fueled_at)) ?? [];
    const hit = rows.find(
      (r) =>
        !matchedIds.has(r.id) &&
        Math.abs(Number(r.gallons) - l.gallons) <= CONTENT_GALLONS_TOLERANCE &&
        contentTank(r.tank_type) === contentTank(l.tank_type) &&
        sameCardFill(
          { cardRef: r.card_ref, controlId: r.control_id },
          { cardRef: l.card_ref, controlId: l.control_id },
        ),
    );
    if (hit) {
      matchedIds.add(hit.id); // one existing row absorbs at most one incoming line
      matches.push({ line: l, existing: hit });
    } else {
      toInsert.push(l);
    }
  }
  return { toInsert, matches };
}

/** Enrich content-identity matches with the same strictly-additive patch as enrichExistingFills. */
export async function enrichContentMatches(
  admin: SupabaseClient,
  matches: { line: IdentifiableFuelLine; existing: KnownTxnIdentity }[],
): Promise<number> {
  let enriched = 0;
  for (const { line: l, existing } of matches) {
    const patch: Record<string, unknown> = {};
    if (isFullCardNumber(l.card_ref) && !isFullCardNumber(existing.card_ref)) patch.card_ref = l.card_ref;
    if (l.control_id && !existing.control_id) patch.control_id = l.control_id;
    if (l.odometer != null && existing.odometer == null) patch.odometer = l.odometer;
    if (!existing.transaction_id && l.transaction_id) patch.transaction_id = l.transaction_id;
    if (!Object.keys(patch).length) continue;
    const { error } = await admin.from("fuel_transactions").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);
    enriched += 1;
  }
  return enriched;
}

/**
 * Post-commit reconciliation: count what actually landed for this import, compare it to what the
 * parse expected, and persist both onto `imports.summary`.
 *
 * This is the honesty check on the write path. Without it a partially-failed upsert looks identical
 * to a clean one — the ingest returns "ok", the row count is quietly short, and the gap only surfaces
 * weeks later as a truck with missing fills. `shortfall_*` being non-null is the signal to
 * investigate; `summary` is also what the SOAP poller's operator log reads back.
 */
export async function reconcileImportCounts(
  admin: SupabaseClient,
  importId: string,
  ctx: {
    channel: string;
    span: { from: string | null; to: string | null };
    rowsByDay: Record<string, number>;
    fileLines: number;
    expectedNewEfs: number;
    /** toInsert, NOT the whole new-row set: enriched rows keep their original import_id and are
     *  deliberately absent from this import's counts. */
    expectedNewFuel: number;
    enriched: number;
    scoreError: string | null;
  },
): Promise<{ dbEfs: number | null; dbFuel: number | null; shortfallRows: number | null }> {
  const [dbEfs, dbFuel] = await Promise.all([
    countByImport(admin, "efs_transactions", importId),
    countByImport(admin, "fuel_transactions", importId),
  ]);
  const shortEfs = computeShortfall(ctx.expectedNewEfs, dbEfs);
  const shortFuel = computeShortfall(ctx.expectedNewFuel, dbFuel);
  const shortfallRows = shortEfs == null && shortFuel == null ? null : (shortEfs ?? 0) + (shortFuel ?? 0);

  await admin.from("imports").update({
    summary: {
      channel: ctx.channel,
      report_from: ctx.span.from,
      report_to: ctx.span.to,
      rows_by_day: ctx.rowsByDay,
      file_lines: ctx.fileLines,
      expected_new_efs_lines: ctx.expectedNewEfs,
      expected_new_fuel_events: ctx.expectedNewFuel,
      enriched_fuel_events: ctx.enriched,
      db_efs_lines: dbEfs,
      db_fuel_events: dbFuel,
      shortfall_efs_lines: shortEfs,
      shortfall_fuel_events: shortFuel,
      score_error: ctx.scoreError,
    },
  }).eq("id", importId);

  return { dbEfs, dbFuel, shortfallRows };
}
