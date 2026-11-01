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
  // Med-Stop's employee follows the canonical driver (0463): the link is our match, one per Med-Stop
  // person, and moving it keeps the pool reconciliation right until the next sweep re-derives it.
  { table: "medstop_employees", column: "driver_id", orgScoped: true },
  { table: "application_invitations", column: "driver_id", orgScoped: true },
  { table: "application_drafts", column: "driver_id", orgScoped: true },
  { table: "application_captures", column: "driver_id", orgScoped: true },
  { table: "seven_day_statements", column: "driver_id", orgScoped: true },
  { table: "applicant_dispositions", column: "driver_id", orgScoped: true },
  // The office's notes on an applicant (0535, HIRING-WORKFLOW-AUDIT §9 P7): working papers that go with
  // the person. Its guard lets `driver_id` move (AN012 keeps it in the org); `on delete restrict`, so a
  // merge that forgot this line would stop at the final driver delete instead of losing them.
  { table: "applicant_notes", column: "driver_id", orgScoped: true },
  // HW5c (0538): the gaps the office recorded after signing — `on delete restrict`, so moved first.
  { table: "driver_employment_gaps", column: "driver_id", orgScoped: true },
  // HW8a (0539): the applicant's "I watched these" and the video links they opened — evidence that goes
  // with the person; each guard lets `driver_id` move inside the carrier (OV022), `on delete restrict`.
  { table: "orientation_video_attestations", column: "driver_id", orgScoped: true },
  { table: "orientation_video_opens", column: "driver_id", orgScoped: true },
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
  /*
   * The account-closure request (0330). A mechanical move rather than a refusal, and the difference
   * is worth writing down: MD010 refuses to merge a driver carrying a signed application, an e-sign
   * consent or an SMS consent, because each of those is a signature by a named person and folding
   * two of them together would assert something nobody signed. A closure request carries no
   * signature — it records that a login was closed on a date — and when two driver records turn out
   * to be one human being, that fact stays true of the surviving record.
   *
   * ⚠ The FK is `on delete restrict`, which is the shape that makes an unhandled entry ABORT the
   * whole merge rather than silently strand a row — the `financial_entries` failure above, exactly.
   */
  { table: "driver_account_closure_requests", column: "driver_id", orgScoped: true },
  /*
   * The office's dispatch of a load (0370, D-LMR6). Mechanical, like the closure request above: a
   * dispatch is not a signature, and when two driver records are one person the load was sent to
   * that person. 0370's guard freezes every column but `driver_id` for exactly this move, and its
   * `on delete restrict` makes a missing entry here abort the merge rather than lose the row.
   */
  { table: "load_dispatches", column: "driver_id", orgScoped: true },
  /*
   * The SMS queue and the do-not-text list (0376, APPLICATION-FLOW-V2-PLAN §8.2, A-11). Mechanical:
   * neither is a signature. A queued text was addressed to the person, and a STOP was said by the
   * person, so both follow the surviving record. ⚠ `sms_suppressions.driver_id` is `on delete set
   * null` on purpose — a STOP is keyed on the phone and must outlive a driver row — so a missing
   * entry here would not abort a merge; it would silently detach the suppression from the driver.
   */
  { table: "sms_outbox", column: "driver_id", orgScoped: true },
  { table: "sms_suppressions", column: "driver_id", orgScoped: true },
  /*
   * The driver a received document was matched to by its sender's phone or address (0448, D-DR12).
   * Mechanical: a match is the roster's guess, not a signature, so it follows the surviving record.
   * 0448's guard freezes every other column of the row for exactly this move. ⚠ `on delete set null`,
   * like `sms_suppressions` — a missing entry would not abort a merge; it would silently send the
   * duplicate's documents back to the Unmatched list.
   */
  { table: "document_sources", column: "matched_driver_id", orgScoped: true },
  /*
   * A tablet follows its driver (0524, D-DE1). Mechanical: when two driver records are one person,
   * that person holds the tablet and that person was handed it. The ledger is append-only (IV021)
   * EXCEPT these two driver columns, which 0524's guard leaves movable for exactly this merge. All
   * three are `on delete restrict`, so a missing entry aborts the merge rather than lose the history.
   */
  { table: "inventory_assets", column: "driver_id", orgScoped: true },
  { table: "asset_movements", column: "from_driver_id", orgScoped: true },
  { table: "asset_movements", column: "to_driver_id", orgScoped: true },
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
