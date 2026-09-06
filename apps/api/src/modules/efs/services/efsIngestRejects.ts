import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A bad row costs one row, never a window (D-FIN2, FINANCE-GO-LIVE-PLAN §1.2).
 *
 * What happened. The historical EFS refetch queued on 2026-08-28 to repair two April–May holes
 * (~$494k of fuel against McLeod's fuel account) failed with `numeric field overflow` on ONE row
 * of ONE window, and because the whole window's upsert was one statement, every other fill in
 * that window was refused with it. The job sat `failed` for six days; April's canonical fuel
 * stayed $368k below the ledger. The row itself could not be named afterwards — the response was
 * never stored, only hashed.
 *
 * Two rules follow, both implemented here:
 *
 *  1. A value that cannot fit its column is nulled BEFORE the write when the column is advisory
 *     (odometer, a derived price per gallon) — the fill's dollars and gallons are the fact the
 *     ledger tie-out needs, and a driver who typed eleven digits into the pump keypad must not
 *     cost the carrier the fill. Column capacities here mirror the migrations by name, so a
 *     widened column is a one-line change in the same place.
 *  2. A batch Postgres refuses is retried one row at a time; the rows it still refuses are written
 *     VERBATIM to `import_rows` — the ingestion audit trail 0007 promised and nothing wired until
 *     now — with the database's own error text, and counted on `imports.error_rows`. Nothing is
 *     dropped silently, and the reject names itself.
 */

/** Postgres `numeric(precision, scale)` capacity: |value| < 10^(precision − scale). */
const NUMERIC_CAPACITY = {
  /** fuel_transactions.odometer, efs_transactions.odometer — numeric(10,1) (0003, 0011). */
  odometer: { precision: 10, scale: 1 },
  /** fuel_transactions.price_per_gal — numeric(8,3) (0003). */
  price_per_gal: { precision: 8, scale: 3 },
} as const;

export type GuardedNumeric = keyof typeof NUMERIC_CAPACITY;

/** True when `value` fits the named column. Null and non-finite values "fit" — they are stored as null. */
export function fitsColumn(column: GuardedNumeric, value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return true;
  const { precision, scale } = NUMERIC_CAPACITY[column];
  return Math.abs(value) < 10 ** (precision - scale);
}

export interface NulledField {
  external_ref: string;
  field: GuardedNumeric;
  value: number;
}

/**
 * Returns the value if it fits its column, else null — and records what was dropped so the
 * import can say so. The record is the point: a silently nulled odometer is a guess, a recorded
 * one is a measurement of the source.
 */
export function guardNumeric(
  column: GuardedNumeric,
  value: number | null | undefined,
  externalRef: string,
  nulled: NulledField[],
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (fitsColumn(column, value)) return value;
  nulled.push({ external_ref: externalRef, field: column, value });
  return null;
}

export interface RejectedRow {
  row: Record<string, unknown>;
  error: string;
}

/**
 * Write a batch; when Postgres refuses the batch, retry row by row so one refused row does not
 * take the rest of the window with it. Returns the rows that were still refused, each with the
 * database's own error text.
 *
 * The caller passes the write itself (a closure over its own literal table upsert) rather than a
 * table name: the table gates (`lint:table-writers`, `lint:boundaries`) read literal
 * `.from("…")` calls, and a dynamic `.from(table)` here would make the two busiest write sites in
 * the fuel module invisible to them. Idempotency is unchanged — the caller's `onConflict` /
 * `ignoreDuplicates` apply to every retry.
 */
export async function upsertRowsIsolatingFailures<R extends Record<string, unknown>>(
  rows: R[],
  write: (rows: R[]) => PromiseLike<{ error: { message: string } | null }>,
): Promise<RejectedRow[]> {
  if (!rows.length) return [];
  const batch = await write(rows);
  if (!batch.error) return [];
  const rejected: RejectedRow[] = [];
  for (const row of rows) {
    const one = await write([row]);
    if (one.error) rejected.push({ row, error: one.error.message });
  }
  // A batch that failed but whose every row then succeeded alone is a transient (lock, timeout),
  // not a bad row — and there is nothing to reject. Only a row Postgres refuses ON ITS OWN is one.
  return rejected;
}

/**
 * File the rejects and the nulled fields on the ingestion audit trail. `status='error'` rows did
 * not land; `status='committed'` rows landed with a named field stored as null. `error_rows` on
 * the import counts only the former — the latter are fills the ledger will see.
 */
export async function recordImportRejects(
  admin: SupabaseClient,
  orgId: string,
  importId: string,
  rejected: RejectedRow[],
  nulled: NulledField[],
): Promise<void> {
  const auditRows: Record<string, unknown>[] = [];
  let n = 0;
  for (const r of rejected) {
    auditRows.push({
      org_id: orgId,
      import_id: importId,
      row_number: ++n,
      raw: r.row,
      external_ref: typeof r.row.external_ref === "string" ? r.row.external_ref : null,
      status: "error",
      error_message: r.error,
    });
  }
  for (const f of nulled) {
    auditRows.push({
      org_id: orgId,
      import_id: importId,
      row_number: ++n,
      raw: { external_ref: f.external_ref, [f.field]: f.value },
      external_ref: f.external_ref,
      status: "committed",
      error_message: `${f.field} ${f.value} does not fit its column and was stored as null; the fill itself landed`,
    });
  }
  if (!auditRows.length) return;
  const { error } = await admin.from("import_rows").insert(auditRows);
  if (error) throw new Error(error.message);
  if (rejected.length) {
    const { error: e2 } = await admin.from("imports").update({ error_rows: rejected.length }).eq("id", importId);
    if (e2) throw new Error(e2.message);
  }
}
