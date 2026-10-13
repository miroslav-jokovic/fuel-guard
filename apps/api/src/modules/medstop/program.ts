import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canReadTestingRecords,
  inProgressRows,
  medicalCardsDue,
  poolPace,
  reconcileRosters,
  selectionsAwaitingTest,
  shiftDay,
  type CalendarDay,
  type DrugAlcoholProgram,
  type MatchedPerson,
  type MedstopRoster,
  type ProgramPerson,
  type SelectionRow,
  type UserRole,
} from "@silvicom/shared";
import { getCredential } from "./credentials.js";
import { readRosterDrivers } from "./sync.js";
import { RESULT_REVIEW_DAYS, readResultReview } from "./results.js";
import { readInProgress } from "./inProgress.js";

/**
 * Safety › Drug & Alcohol's one read (MEDSTOP-PLAN.md §6, §7A — five tabs since MS-UX1). The mirror
 * is gathered here; every verdict is shared's (`medstopProgram.ts`, `medstopTabs.ts`). Each tab's count
 * on the page is the length of the list it shows (R5) — nothing here computes a separate number.
 *
 * ⚠ The selection lists are NULL for a role that may not read testing records — not empty, so the
 * page can say "held to the DER" rather than "nobody is due". A selection names a person before they
 * are told; §382.305(l) wants that notice immediate and unannounced, and a fleet manager who can see
 * next week's draw can warn a driver.
 */

const PAGE = 1000;

/** Every page of one mirror read. Each caller names its table literally, so the table gates can see it. */
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label} read failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

interface EmployeeRow {
  medstop_id: string;
  roster: MedstopRoster;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  license_number: string | null;
  license_state: string | null;
  medical_expires_on: string | null;
  driver_id: string | null;
  match_rule: string | null;
}

/** The current medical card per driver, from `certifications` — authoritative since the roster carve-out. */
async function currentMedicalCards(admin: SupabaseClient, orgId: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("certifications")
      .select("subject_id, expires_at")
      .eq("org_id", orgId)
      .eq("subject_type", "driver")
      .eq("kind", "medical_card")
      .is("superseded_by", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`certifications read failed: ${error.message}`);
    for (const c of data ?? []) {
      const prior = out.get(c.subject_id as string);
      const exp = c.expires_at as string | null;
      if (prior === undefined || (exp && (!prior || exp > prior))) out.set(c.subject_id as string, exp);
    }
    if (!data || data.length < PAGE) return out;
  }
}

export async function readDrugAlcoholProgram(
  admin: SupabaseClient,
  orgId: string,
  role: UserRole | null,
  today: CalendarDay,
): Promise<DrugAlcoholProgram> {
  const credential = await getCredential(admin, orgId);
  const testingRoles = canReadTestingRecords(role);
  const [employees, pools, selections, drivers, medical, moving] = await Promise.all([
    readAll<EmployeeRow>((a, b) => admin.from("medstop_employees")
      .select("medstop_id, roster, first_name, last_name, birth_date, license_number, license_state, medical_expires_on, driver_id, match_rule")
      .eq("org_id", orgId).order("medstop_id").range(a, b), "medstop_employees"),
    readAll<{ service: string; name: string | null; pool_year: number; ends_on: string | null; frequency: string | null;
      target_percent: number | null; current_percent: number | null; members_avg: number | null; completed_tests: number | null;
      scheduled_tests: number | null }>((a, b) => admin.from("medstop_pools")
      .select("medstop_id, service, name, pool_year, ends_on, frequency, target_percent, current_percent, members_avg, completed_tests, scheduled_tests")
      .eq("org_id", orgId).order("medstop_id").range(a, b), "medstop_pools"),
    readAll<{ medstop_id: string; employee_medstop_id: string | null; service: string | null; selected_on: string | null;
      request_medstop_id: string | null; test_medstop_id: string | null; status: string | null }>((a, b) => admin.from("medstop_selections")
      .select("medstop_id, employee_medstop_id, service, selected_on, request_medstop_id, test_medstop_id, status")
      .eq("org_id", orgId).order("medstop_id").range(a, b), "medstop_selections"),
    readRosterDrivers(admin, orgId),
    currentMedicalCards(admin, orgId),
    readInProgress(admin, orgId),
  ]);

  const people: MatchedPerson[] = employees.map((e) => ({
    medstopId: e.medstop_id,
    roster: e.roster,
    firstName: e.first_name,
    lastName: e.last_name,
    birthDate: e.birth_date,
    licenseNumber: e.license_number,
    licenseState: e.license_state,
    medicalExpiresOn: e.medical_expires_on,
    driverId: e.driver_id,
  }));
  const selectionRows: SelectionRow[] = selections.map((s) => ({
    medstopId: s.medstop_id,
    employeeMedstopId: s.employee_medstop_id,
    service: s.service,
    selectedOn: s.selected_on,
    requestMedstopId: s.request_medstop_id,
    testMedstopId: s.test_medstop_id,
    status: s.status,
  }));

  const year = Number(today.slice(0, 4));
  const driverName = new Map(drivers.map((d) => [d.id, d.fullName]));
  const byMedstopId = new Map(people.map((p) => [p.medstopId, p]));
  const personOf = (id: string | null): ProgramPerson => {
    const p = id ? byMedstopId.get(id) : undefined;
    const name = p?.driverId ? driverName.get(p.driverId) : undefined;
    return {
      driverId: p?.driverId ?? null,
      medstopId: id,
      name: name ?? ([p?.firstName, p?.lastName].filter(Boolean).join(" ") || "Unknown to Med-Stop's roster"),
    };
  };
  const reconciled = reconcileRosters(people, drivers);
  // R3: Med-Stop's medical date counts only for a licence or name+DOB match.
  const medstopMedical = new Map(
    employees
      .filter((e) => e.driver_id && e.roster === "active" && (e.match_rule === "licence" || e.match_rule === "name_dob"))
      .map((e) => [e.driver_id as string, e.medical_expires_on]),
  );

  return {
    connected: credential?.hasKey === true && credential.enabled,
    syncedAt: credential?.lastSyncedAt ?? null,
    lastError: credential?.lastError ?? null,
    pools: pools
      .filter((p) => p.pool_year === year)
      .map((p) =>
        poolPace(
          {
            service: p.service,
            name: p.name,
            poolYear: p.pool_year,
            endsOn: p.ends_on,
            frequency: p.frequency,
            targetPercent: p.target_percent === null ? null : Number(p.target_percent),
            currentPercent: p.current_percent === null ? null : Number(p.current_percent),
            membersAvg: p.members_avg === null ? null : Number(p.members_avg),
            completedTests: p.completed_tests,
            scheduledTests: p.scheduled_tests,
          },
          selectionRows,
        ),
      ),
    selections: testingRoles ? selectionsAwaitingTest(selectionRows, personOf, today) : null,
    inProgress: inProgressRows(moving.orders, moving.tests, personOf, today, testingRoles),
    // MS2c: the results themselves — testing records, so the same rule as the selections above.
    results: testingRoles ? await readResultReview(admin, orgId, shiftDay(today, -RESULT_REVIEW_DAYS), personOf) : null,
    medical: medicalCardsDue(
      drivers.map((d) => ({ id: d.id, fullName: d.fullName, working: d.status === "active" && !d.archived })),
      medical,
      medstopMedical,
      today,
    ),
    roster: reconciled,
  };
}
