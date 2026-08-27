import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The driver-merge reassignment list — the reason merge_driver stopped being re-issued (D-SEP5,
 * 0264). Every mechanical `driver-FK → canonical` move lives HERE, in the roster module, and
 * rides into merge_driver_v2 as a parameter; the function validates each name against
 * information_schema before any dynamic SQL runs, and executes the whole merge in one
 * transaction.
 *
 * ADDING A TABLE WITH A DRIVER FK? Add its (table, column) here — that is the entire cost.
 * `check-driver-references.mjs` fails the build when a migration adds a drivers(id) FK that
 * neither this list, the in-function set, nor the refusal set accounts for — the cascade trap
 * 0234/0236/0238 could only warn about in comments is now a gate.
 *
 * NOT in this list, on purpose:
 *  - driver_applications / esign_consents / sms_consents — the MD010 refusal set: signed
 *    evidence that may never be moved; the function refuses the merge before the first write.
 *  - driver_scores / driver_performance_weeks (per-week dedup), certifications (temporal
 *    supersede), documents (polymorphic subject), driver_duty_sessions (open-shift dedup),
 *    drivers itself (link coalescing + the guarded delete) — semantic moves, handled inside
 *    merge_driver_v2 where they have been stable since 0239.
 */
export const DRIVER_REASSIGNMENTS: ReadonlyArray<{ table: string; column: string; orgScoped?: boolean }> = [
  { table: "fuel_transactions", column: "driver_id" },
  { table: "fuel_cards", column: "driver_id" },
  { table: "declined_transactions", column: "driver_id" },
  { table: "idle_events", column: "driver_id" },
  { table: "hos_duty_segments", column: "driver_id" },
  { table: "driver_time_off", column: "driver_id" },
  { table: "loads", column: "driver_id" },
  { table: "load_stop_photos", column: "driver_id" },
  { table: "hazmat_loads", column: "driver_id" },
  { table: "invites", column: "driver_id" },
  { table: "vehicles", column: "assigned_driver_id" },
  { table: "vehicles", column: "owner_driver_id" },
  // recruiting evidence follows the driver (0234): append-only stores, no per-driver uniqueness
  { table: "driver_employment_history", column: "driver_id", orgScoped: true },
  { table: "employer_inquiries", column: "driver_id", orgScoped: true },
  { table: "driver_authorizations", column: "driver_id", orgScoped: true },
  { table: "psp_requests", column: "driver_id", orgScoped: true },
  { table: "application_invitations", column: "driver_id", orgScoped: true },
  { table: "application_drafts", column: "driver_id", orgScoped: true },
  { table: "application_captures", column: "driver_id", orgScoped: true },
  { table: "seven_day_statements", column: "driver_id", orgScoped: true },
  { table: "applicant_dispositions", column: "driver_id", orgScoped: true },
  // §391.51 events go with the driver (0203)
  { table: "qualification_records", column: "driver_id", orgScoped: true },
  // The four FKs check-driver-references.mjs found UNHANDLED by the SQL merge on its first run
  // (2026-08-27) — the cascade trap, proven: a merge stranded rollup attribution and pattern
  // reports (set null), silently kept exceptions on a dead name, and would have ABORTED outright
  // the first time a source driver carried financial entries (on delete restrict).
  { table: "idle_rollup_days", column: "attributed_driver_id", orgScoped: true },
  { table: "case_pattern_reports", column: "driver_id", orgScoped: true },
  { table: "fuel_exceptions", column: "driver_id", orgScoped: true },
  { table: "financial_entries", column: "driver_id", orgScoped: true },
];

/** Atomically fold a duplicate driver into the canonical one. One rpc = one transaction — the
 *  reassignment list is data, the semantics live in merge_driver_v2 (0264). */
export async function mergeDriver(
  admin: SupabaseClient,
  orgId: string,
  sourceId: string,
  canonicalId: string,
): Promise<{ error: { code?: string; message: string } | null }> {
  const { error } = await admin.rpc("merge_driver_v2", {
    p_org: orgId,
    p_source: sourceId,
    p_canonical: canonicalId,
    p_simple_moves: DRIVER_REASSIGNMENTS.map((m) => ({
      table: m.table,
      column: m.column,
      org_scoped: m.orgScoped ?? false,
    })),
  });
  return { error: error ? { code: error.code, message: error.message } : null };
}
