import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_ORG_TIMEZONE,
  todayInZone,
  buildDriverMatchIndex,
  matchMedstopPerson,
  type MedstopRoster,
  type RosterDriverRow,
} from "@silvicom/shared";
import {
  MedstopClient,
  medstopEmployeeRow,
  medstopPoolRow,
  medstopSelectionRow,
  type MedstopEmployeeRow,
} from "./client.js";
import { sweepMedstopTests, type MedstopTestSweepResult } from "./syncTests.js";

/**
 * One Med-Stop sweep for one org: roster, pools, selections → the mirror (MEDSTOP-PLAN.md §6 F-1/F-2).
 *
 * GET only. Nothing here writes to Med-Stop and nothing here reads a test RESULT — `/Test/*` is
 * `syncTests.ts`'s (MS2), under the testing-records visibility rule.
 *
 * ── ⚠ A SNAPSHOT IS STORED WHOLE OR NOT AT ALL ────────────────────────────────────────────────
 * The three lists are fetched FIRST, and only then written, each through `medstop_replace_snapshot`.
 * A fetch that fails half-way through the active roster must leave yesterday's mirror in place: a
 * partial roster would put every driver on the missing pages on the "not in the random pool" list,
 * which is the one list on the page that must never be wrong in that direction. The function itself
 * refuses an empty snapshot for the same reason (MS001).
 *
 * The match (licence+state → name+DOB → unique name) runs here, at write time, so every reader sees
 * the same answer; `matchMedstopPerson` in shared owns the rule.
 */

export interface MedstopSweepResult {
  employees: number;
  matched: number;
  pools: number;
  selections: number;
  requests: number;
  /** MS2: requests and tests, merged rather than replaced (`syncTests.ts`). */
  tests: MedstopTestSweepResult;
}

const ROSTERS: [MedstopRoster, string][] = [
  ["active", "/Employee/list"],
  ["applicant", "/Employee/applicants"],
  ["terminated", "/Employee/terminated"],
];

/** Our drivers, every status, archived included — a terminated match is what F-1's second list is made of. */
export async function readRosterDrivers(admin: SupabaseClient, orgId: string): Promise<RosterDriverRow[]> {
  const out: RosterDriverRow[] = [];
  // PostgREST answers at most 1,000 rows a page; page explicitly rather than trust one call.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("drivers")
      .select("id, full_name, first_name, last_name, date_of_birth, cdl_number, cdl_state, status, archived_at")
      .eq("org_id", orgId)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`drivers read failed: ${error.message}`);
    for (const d of data ?? []) {
      out.push({
        id: d.id as string,
        fullName: (d.full_name as string) ?? "",
        firstName: d.first_name as string | null,
        lastName: d.last_name as string | null,
        birthDate: d.date_of_birth as string | null,
        cdlNumber: d.cdl_number as string | null,
        cdlState: d.cdl_state as string | null,
        status: d.status as string,
        archived: d.archived_at !== null,
      });
    }
    if (!data || data.length < 1000) return out;
  }
}

function employeeRecord(e: MedstopEmployeeRow, roster: MedstopRoster, match: { driverId: string; rule: string } | null) {
  return {
    medstop_id: e.id,
    roster,
    status: e.status,
    first_name: e.fname,
    last_name: e.lname,
    birth_date: e.birthdate,
    license_number: e.license,
    license_state: e.licensestate?.toUpperCase() ?? null,
    dot_regulated: e.dotstatus === null ? null : e.dotstatus === "Y",
    application_date: e.applicationdate,
    hire_date: e.hiredate,
    termination_date: e.terminationdate,
    last_drug_test: e.lastdrug,
    last_alcohol_test: e.lastalcohol,
    medical_expires_on: e.medexpiration,
    driver_id: match?.driverId ?? null,
    match_rule: match?.rule ?? null,
  };
}

async function replace(admin: SupabaseClient, orgId: string, kind: string, rows: object[]): Promise<void> {
  const { error } = await admin.rpc("medstop_replace_snapshot", { p_org: orgId, p_kind: kind, p_rows: rows });
  if (error) throw new Error(`medstop_replace_snapshot(${kind}) failed: ${error.message}`);
}

export async function sweepMedstop(admin: SupabaseClient, client: MedstopClient, orgId: string): Promise<MedstopSweepResult> {
  // 1. Fetch everything. A person on two lists (a rehire) keeps the most current one: active wins
  //    over applicant, applicant over terminated — the order ROSTERS is walked in.
  const people = new Map<string, { row: MedstopEmployeeRow; roster: MedstopRoster }>();
  for (const [roster, path] of ROSTERS) {
    for (const row of await client.list(path, medstopEmployeeRow)) {
      if (!people.has(row.id)) people.set(row.id, { row, roster });
    }
  }
  const pools = await client.list("/Random/pools", medstopPoolRow);
  const selections = await client.list("/Random/selections", medstopSelectionRow);
  if (people.size === 0) throw new Error("Med-Stop returned no employees on any roster — the mirror was left as it was");

  // 2. Match against our roster.
  const index = buildDriverMatchIndex(await readRosterDrivers(admin, orgId));
  let matched = 0;
  const employees = [...people.values()].map(({ row, roster }) => {
    const match = matchMedstopPerson(
      {
        medstopId: row.id,
        roster,
        firstName: row.fname,
        lastName: row.lname,
        birthDate: row.birthdate,
        licenseNumber: row.license,
        licenseState: row.licensestate,
        medicalExpiresOn: row.medexpiration,
      },
      index,
    );
    if (match) matched++;
    return employeeRecord(row, roster, match);
  });

  // 3. Write, each kind whole.
  await replace(admin, orgId, "employees", employees);
  if (pools.length > 0) {
    await replace(
      admin,
      orgId,
      "pools",
      pools.map((p) => ({
        medstop_id: p.id,
        name: p.name,
        service: p.service,
        category: p.category,
        dot_regulated: p.dotstatus === null ? null : p.dotstatus === "Y",
        pool_year: p.poolyear,
        starts_on: p.startdate,
        ends_on: p.enddate,
        frequency: p.frequency,
        target_percent: p.targetpercent,
        current_percent: p.currentpercent,
        members: p.members,
        members_avg: p.membersavg,
        completed_tests: p.completedtests,
        scheduled_tests: p.scheduledtests,
        status: p.status,
      })),
    );
  }
  if (selections.length > 0) {
    await replace(
      admin,
      orgId,
      "selections",
      selections.map((s) => ({
        medstop_id: s.id,
        pool_medstop_id: s.poolid,
        employee_medstop_id: s.eeid,
        service: s.service,
        selected_on: s.selectiondate,
        request_medstop_id: s.requestid,
        requested_on: s.requestdate,
        test_medstop_id: s.testid,
        tested_on: s.testdate,
        status: s.status,
      })),
    );
  }
  // 4. MS2: requests and tests. After the roster, so a test's person is already matched when the
  //    next merge's code reads it. A 400-day window needs no org zone to the day.
  const tests = await sweepMedstopTests(admin, client, orgId, todayInZone(new Date(), DEFAULT_ORG_TIMEZONE));
  return { employees: employees.length, matched, pools: pools.length, selections: selections.length, requests: client.requests, tests };
}
