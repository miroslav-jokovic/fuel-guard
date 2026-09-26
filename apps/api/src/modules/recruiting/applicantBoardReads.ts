import type { SupabaseClient } from "@supabase/supabase-js";
import {
  asApplyingAs,
  declaredLicenceJurisdictions,
  type ApplyingAs,
  type QueueAttempt,
  type QueueEmployment,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";
import { DRAFT_APPLYING_AS_SELECT } from "./applicantApplyingAs.js";
import { DRAFT_LICENCES_SELECT, RECORD_JURISDICTION_SELECT } from "./applicantLicences.js";

/**
 * The board's reads — one `.in()` per evidence table for the whole org, grouped in memory.
 *
 * ⚠ **Split out of `applicantBoard.ts` on 2026-09-26 (APPLICATION-FLOW-V2-PLAN §8.5, C1)**, at the
 * 450-line warning, along the line between reading and folding: `boardChecklists` there decides
 * nothing that is not `hiringChecklist.ts`'s, and these decide nothing at all — each is one query
 * and a grouping. They moved unchanged with their comments. That file's header governs them: the
 * set-based shape is the whole point, and the service role bypasses RLS, so every read below carries
 * its own `.eq("org_id", …)` — `applicantBoard.test.ts` asserts it through `expectOrgScoped`.
 *
 * ── SINCE G-7, THE ONLY READS, AND PAGED ──────────────────────────────────────────────────────
 * ⚠ **These are now the drawer's reads too** (`applicantChecklistInputs.ts`, APPLICATION-FLOW-V2
 * G-7, 2026-09-26). The drawer had its own seven, and they had drifted: the board folded no road-test
 * pass flag (A-8) and no ceremony-closed stamp (A-4), so a failed road test read green on the board
 * and red in the drawer. And every read here PAGES (`fetchAllPaged`, ordered by `id`): PostgREST
 * answers at most 1,000 rows, and a `.in()` over a whole board's drivers crosses that on
 * `qualification_records` alone at a few hundred applicants — silently, with the rows past 1,000
 * reading as evidence that does not exist. The board's draft read was worse: it had no `.in()` at
 * all, so it read every draft in the org.
 */

export interface QualificationRow {
  driver_id: string;
  kind: string;
  created_at: string;
  /** AF7: `detail.jurisdiction`, by path. Null on anything but a recorded MVR that named one. */
  jurisdiction?: string | null;
  /** A-8: `detail.source` and `detail.passed`, by path — whether a road test was PASSED (`roadTestCounts`). */
  source?: string | null;
  passed?: string | null;
}

/** What the draft says, by path — never the payload (`applicantApplyingAs.ts`, `applicantLicences.ts`). */
export interface DraftFacts {
  applyingAs: ApplyingAs | null;
  licenceJurisdictions: string[];
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
  if (driverIds.length === 0) return new Map();
  const rows = await paged<QualificationRow>((from, to) =>
    admin
      .from("qualification_records")
      .select(`driver_id, kind, created_at, ${RECORD_JURISDICTION_SELECT}, source:detail->>source, passed:detail->>passed`)
      .eq("org_id", orgId)
      .in("driver_id", driverIds)
      .order("id")
      .range(from, to),
  );
  return groupBy(rows, (r) => r.driver_id);
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
  const rows = await paged<{ invitation_id: string; placement_id: string }>((from, to) =>
    admin
      .from("handbook_marks")
      .select("invitation_id, placement_id")
      .eq("org_id", orgId)
      .in("invitation_id", invitationIds)
      .order("id")
      .range(from, to),
  );
  return groupBy(rows, (r) => r.invitation_id);
}

export async function readPacketMarks(
  admin: SupabaseClient,
  orgId: string,
  invitationIds: readonly string[],
): Promise<Map<string, MarkRow[]>> {
  if (invitationIds.length === 0) return new Map();
  const rows = await paged<MarkRow>((from, to) =>
    admin
      .from("application_packet_marks")
      .select("invitation_id, placement_id, created_at")
      .eq("org_id", orgId)
      .in("invitation_id", invitationIds)
      .order("id")
      .range(from, to),
  );
  return groupBy(rows, (r) => r.invitation_id);
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
  if (driverIds.length === 0) return new Map();
  const rows = await paged<Record<string, unknown>>((from, to) =>
    admin
      .from("driver_employment_history")
      .select("id, driver_id, employer_name, started_on, ended_on, dot_regulated")
      .eq("org_id", orgId)
      .in("driver_id", driverIds)
      .order("id")
      .range(from, to),
  );
  const out = new Map<string, QueueEmployment[]>();
  for (const row of rows) {
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
  if (driverIds.length === 0) return new Map();
  const rows = await paged<Record<string, unknown>>((from, to) =>
    admin
      .from("employer_inquiries")
      .select("driver_id, employment_id, contacted_on, outcome")
      .eq("org_id", orgId)
      .eq("kind", "safety_performance")
      .in("driver_id", driverIds)
      .order("id")
      .range(from, to),
  );
  const out = new Map<string, QueueAttempt[]>();
  for (const row of rows) {
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

/**
 * What each live invitation's draft says, by path (F5, Q-HM14, AF7) — keyed on the INVITATION: a
 * rehire's draft from an earlier application is not evidence that they have started this one.
 * An invitation with no entry has no draft.
 */
export async function readDraftFacts(
  admin: SupabaseClient,
  orgId: string,
  invitationIds: readonly string[],
): Promise<Map<string, DraftFacts>> {
  if (invitationIds.length === 0) return new Map();
  const rows = await paged<{ invitation_id: string; applying_as?: unknown; cdl_state?: unknown; additional_licences?: unknown }>(
    (from, to) =>
      admin
        .from("application_drafts")
        .select(`invitation_id, ${DRAFT_APPLYING_AS_SELECT}, ${DRAFT_LICENCES_SELECT}`)
        .eq("org_id", orgId)
        .in("invitation_id", invitationIds)
        .order("id")
        .range(from, to),
  );
  return new Map(rows.map((d) => [
    d.invitation_id,
    { applyingAs: asApplyingAs(d.applying_as), licenceJurisdictions: declaredLicenceJurisdictions(d) },
  ]));
}

/**
 * `fetchAllPaged` over a PostgREST builder. The cast is supabase-js's typing, not ours: a select
 * parsed from a template literal types its rows as `GenericStringError`, and every row type here is
 * the select's own column list, written once above it.
 */
function paged<T>(makeQuery: (from: number, to: number) => unknown): Promise<T[]> {
  return fetchAllPaged<T>(
    makeQuery as (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  );
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
