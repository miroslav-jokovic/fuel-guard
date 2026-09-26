import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueAttempt, QueueEmployment } from "@silvicom/shared";
import { RECORD_JURISDICTION_SELECT } from "./applicantLicences.js";

/**
 * The board's reads — one `.in()` per evidence table for the whole org, grouped in memory.
 *
 * ⚠ **Split out of `applicantBoard.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the
 * 450-line warning, along the line between reading and folding: `boardChecklists` there decides
 * nothing that is not `hiringChecklist.ts`'s, and these decide nothing at all — each is one query
 * and a grouping. They moved unchanged with their comments. That file's header governs them: the
 * set-based shape is the whole point, and the service role bypasses RLS, so every read below carries
 * its own `.eq("org_id", …)` — `applicantBoard.test.ts` asserts it through `expectOrgScoped`.
 */

export interface QualificationRow {
  driver_id: string;
  kind: string;
  created_at: string;
  /** AF7: `detail.jurisdiction`, by path. Null on anything but a recorded MVR that named one. */
  jurisdiction?: string | null;
}

export interface MarkRow {
  invitation_id: string;
  placement_id: string;
  created_at: string;
}

/**
 * Every §391.51 event for every applicant, in one query.
 *
 * ⚠ `created_at` as well as `kind`, and only because `days_waiting` needs a date. Recurrence and
 * expiry still belong to `dqCatalogue.ts` — nothing here forms an opinion about when an MVR goes
 * stale, which is the second opinion B3's own comment refused to invite.
 */
export async function readQualificationRecords(
  admin: SupabaseClient,
  orgId: string,
  driverIds: readonly string[],
): Promise<Map<string, QualificationRow[]>> {
  const { data } = await admin
    .from("qualification_records")
    .select(`driver_id, kind, created_at, ${RECORD_JURISDICTION_SELECT}`)
    .eq("org_id", orgId)
    .in("driver_id", driverIds);
  return groupBy((data ?? []) as QualificationRow[], (r) => r.driver_id);
}

/**
 * The packet places collected, per invitation.
 *
 * ⚠ Keyed on the INVITATION, never the driver — 0339 scopes them that way because a rehire signs
 * their own packet and the two must not merge. A driver-keyed count adds last year's twenty-two to
 * this year's none and reports a packet signed that nobody has opened.
 */
export async function readHandbookMarks(
  admin: SupabaseClient,
  orgId: string,
  invitationIds: readonly string[],
): Promise<Map<string, Array<{ invitation_id: string; placement_id: string }>>> {
  if (invitationIds.length === 0) return new Map();
  const { data } = await admin
    .from("handbook_marks")
    .select("invitation_id, placement_id")
    .eq("org_id", orgId)
    .in("invitation_id", invitationIds);
  return groupBy((data ?? []) as Array<{ invitation_id: string; placement_id: string }>, (r) => r.invitation_id);
}

export async function readPacketMarks(
  admin: SupabaseClient,
  orgId: string,
  invitationIds: readonly string[],
): Promise<Map<string, MarkRow[]>> {
  if (invitationIds.length === 0) return new Map();
  const { data } = await admin
    .from("application_packet_marks")
    .select("invitation_id, placement_id, created_at")
    .eq("org_id", orgId)
    .in("invitation_id", invitationIds);
  return groupBy((data ?? []) as MarkRow[], (r) => r.invitation_id);
}

/**
 * The declared §391.21(b)(10) employment history, per driver (Q-HM9).
 *
 * ⚠ Read whole rather than counted, because `driverInquiryQueue` decides which of these employers
 * are actually owed an inquiry — DOT-regulated, and inside the §391.23(a)(2) three-year window
 * measured from the hire date. A `count` here could not answer either question, and a `.eq` on
 * `dot_regulated` would be this module forming the opinion its own header says it must not.
 */
export async function readEmploymentHistory(
  admin: SupabaseClient,
  orgId: string,
  driverIds: readonly string[],
): Promise<Map<string, QueueEmployment[]>> {
  const { data } = await admin
    .from("driver_employment_history")
    .select("id, driver_id, employer_name, started_on, ended_on, dot_regulated")
    .eq("org_id", orgId)
    .in("driver_id", driverIds);
  const out = new Map<string, QueueEmployment[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const driverId = String(row.driver_id);
    const list = out.get(driverId) ?? [];
    list.push({
      id: String(row.id),
      employerName: String(row.employer_name),
      startedOn: String(row.started_on),
      endedOn: (row.ended_on as string | null) ?? null,
      dotRegulated: Boolean(row.dot_regulated),
    });
    out.set(driverId, list);
  }
  return out;
}

/**
 * The §391.23(c)(2) contact attempts, per driver (Q-HM9).
 *
 * ⚠ `safety_performance` only, matching `loadInquiryQueue` and `applicantChecklist`: `drug_alcohol`
 * is §40.25 and applies to non-FMCSA DOT safety-sensitive employment, which §391.23(e) routes to the
 * Clearinghouse instead. Counting it would hold this step open against an inquiry nobody owes.
 */
export async function readInquiries(
  admin: SupabaseClient,
  orgId: string,
  driverIds: readonly string[],
): Promise<Map<string, QueueAttempt[]>> {
  const { data } = await admin
    .from("employer_inquiries")
    .select("driver_id, employment_id, contacted_on, outcome")
    .eq("org_id", orgId)
    .eq("kind", "safety_performance")
    .in("driver_id", driverIds);
  const out = new Map<string, QueueAttempt[]>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const driverId = String(row.driver_id);
    const list = out.get(driverId) ?? [];
    list.push({
      employmentId: String(row.employment_id),
      contactedOn: String(row.contacted_on),
      outcome: row.outcome as QueueAttempt["outcome"],
    });
    out.set(driverId, list);
  }
  return out;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(key(row));
    if (list) list.push(row);
    else out.set(key(row), [row]);
  }
  return out;
}
