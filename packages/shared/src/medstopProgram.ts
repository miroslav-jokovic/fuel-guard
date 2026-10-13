import { shiftDay, type CalendarDay } from "./calendarDay.js";
import type {
  DueSelection,
  MedicalDisagreement,
  PoolPace,
  ProgramPerson,
} from "./medstopContract.js";

/**
 * The drug & alcohol program's arithmetic, pure (MEDSTOP-PLAN.md §6 F-1/F-2).
 *
 * Every function here answers a question the 2026-10-13 live read (§5A) showed nobody could answer
 * without opening Med-Stop's portal and a roster export side by side: who is outside the random
 * pool, who left and is still in it, which licences we lack, how far the year's rate has to go, and
 * who is selected and untested. The api gathers the rows; the verdicts are made here, once, so the
 * page and any future alert cannot disagree about them.
 */

export type MedstopRoster = "active" | "applicant" | "terminated";

export interface MedstopPersonRow {
  medstopId: string;
  roster: MedstopRoster;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  licenseNumber: string | null;
  licenseState: string | null;
  medicalExpiresOn: string | null;
}

export interface RosterDriverRow {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  cdlNumber: string | null;
  cdlState: string | null;
  status: string;
  archived: boolean;
}

export type MatchRule = "licence" | "name_dob" | "name";

/** Licence numbers are compared as letters and digits only: Med-Stop keeps dashes some states print. */
export const normaliseLicence = (n: string | null | undefined): string =>
  (n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Accents are folded before anything is stripped: Med-Stop's roster is upper-case ASCII ("PENA")
 * while an application may carry "Peña", and stripping first would turn "JOSÉ" into "JOS".
 */
const normaliseName = (n: string | null | undefined): string =>
  (n ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z]/g, "");

/** First and last name; a driver row may only carry `full_name` (McLeod-only rows before 0461). */
function namesOf(d: RosterDriverRow): [string, string] {
  if (d.firstName || d.lastName) return [normaliseName(d.firstName), normaliseName(d.lastName)];
  const parts = d.fullName.trim().split(/\s+/);
  return [normaliseName(parts[0]), normaliseName(parts.length > 1 ? parts[parts.length - 1] : "")];
}

export interface DriverMatchIndex {
  byLicence: Map<string, RosterDriverRow>;
  byName: Map<string, RosterDriverRow[]>;
}

export function buildDriverMatchIndex(drivers: readonly RosterDriverRow[]): DriverMatchIndex {
  const byLicence = new Map<string, RosterDriverRow>();
  const byName = new Map<string, RosterDriverRow[]>();
  for (const d of drivers) {
    const lic = normaliseLicence(d.cdlNumber);
    if (lic) byLicence.set(`${lic}|${(d.cdlState ?? "").toUpperCase()}`, d);
    const [f, l] = namesOf(d);
    if (f && l) byName.set(`${f}|${l}`, [...(byName.get(`${f}|${l}`) ?? []), d]);
  }
  return { byLicence, byName };
}

/**
 * Which of our drivers is this Med-Stop person — or nobody.
 *
 * Licence number + state first: it is the identifier Med-Stop itself keys the donor on (O-5).
 * Then name + date of birth. Then name alone, but ONLY when exactly one driver carries the name —
 * thirteen of our active drivers have no licence on file (§5A) and are still the same people, but a
 * name shared by two drivers is a coin toss, and a wrong match would hide someone outside the pool.
 */
export function matchMedstopPerson(
  person: MedstopPersonRow,
  index: DriverMatchIndex,
): { driverId: string; rule: MatchRule } | null {
  const lic = normaliseLicence(person.licenseNumber);
  if (lic) {
    const d = index.byLicence.get(`${lic}|${(person.licenseState ?? "").toUpperCase()}`);
    if (d) return { driverId: d.id, rule: "licence" };
  }
  const candidates = index.byName.get(`${normaliseName(person.firstName)}|${normaliseName(person.lastName)}`) ?? [];
  if (person.birthDate) {
    const sameDob = candidates.filter((d) => d.birthDate === person.birthDate);
    if (sameDob.length === 1) return { driverId: sameDob[0]!.id, rule: "name_dob" };
  }
  if (candidates.length === 1) {
    const d = candidates[0]!;
    // A birth date on both sides that DISAGREES is two people with one name, not a match.
    if (person.birthDate && d.birthDate && person.birthDate !== d.birthDate) return null;
    return { driverId: d.id, rule: "name" };
  }
  return null;
}

export interface PoolRow {
  service: string;
  name: string | null;
  poolYear: number;
  endsOn: string | null;
  frequency: string | null;
  targetPercent: number | null;
  currentPercent: number | null;
  membersAvg: number | null;
  completedTests: number | null;
  scheduledTests: number | null;
}

export interface SelectionRow {
  medstopId: string;
  employeeMedstopId: string | null;
  service: string | null;
  selectedOn: string | null;
  requestMedstopId: string | null;
  testMedstopId: string | null;
  status: string | null;
}

/** Med-Stop's service codes (`/List/CATEGORYSERVICE`): TD drug, TA alcohol, TM medical. */
export function serviceOf(code: string | null | undefined): "drug" | "alcohol" | "other" {
  if (code === "TD") return "drug";
  if (code === "TA") return "alcohol";
  return "other";
}

const LOST_SELECTION = new Set(["CANCELED", "EXPIRED"]);

/**
 * How far the year's random rate has to go, per pool.
 *
 * Med-Stop's own `currentpercent` is completed ÷ average membership (66 ÷ 155 = 42.58 %, measured),
 * so the year needs ⌈target × average⌉ tests. A linear "expected by today" is deliberately NOT
 * shown: selections are drawn quarterly and land unevenly, and a straight line would call a
 * healthy pool behind for most of every quarter. What is honest is the count still owed, the draws
 * already scheduled to supply it, and the draws this year that ended without a test.
 */
export function poolPace(pool: PoolRow, selections: readonly SelectionRow[]): PoolPace {
  const service = serviceOf(pool.service);
  const target = pool.targetPercent ?? 0;
  const avg = pool.membersAvg ?? 0;
  const completed = pool.completedTests ?? 0;
  const required = Math.ceil((target / 100) * avg);
  const yearPrefix = `${pool.poolYear}-`;
  const lost = selections.filter(
    (s) =>
      serviceOf(s.service) === service &&
      (s.selectedOn ?? "").startsWith(yearPrefix) &&
      LOST_SELECTION.has(normaliseStatus(s.status)) &&
      !s.testMedstopId,
  ).length;
  return {
    service,
    label: service === "drug" ? "Drug" : service === "alcohol" ? "Alcohol" : (pool.name ?? pool.service),
    poolYear: pool.poolYear,
    endsOn: pool.endsOn,
    frequency: pool.frequency,
    targetPercent: target,
    currentPercent: pool.currentPercent ?? 0,
    membersAvg: avg,
    completedTests: completed,
    requiredTests: required,
    testsOwed: Math.max(0, required - completed),
    scheduledTests: pool.scheduledTests ?? 0,
    lostSelections: lost,
  };
}

/** 'EXPIRED RESERVE' is a reserve that was never activated, not a lost draw; only the first word counts for the rest. */
function normaliseStatus(s: string | null): string {
  const v = (s ?? "").toUpperCase();
  if (v.includes("RESERVE")) return "RESERVE";
  return v.split(" ")[0] ?? "";
}

const daysBetween = (from: CalendarDay, to: CalendarDay): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Selected and not tested: `due` is on or before today, `upcoming` is the next `aheadDays`.
 * Only OPEN draws count — a RESERVE is not a selection until Med-Stop activates it, and a closed
 * one is done.
 */
export function selectionsAwaitingTest(
  selections: readonly SelectionRow[],
  personOf: (medstopId: string | null) => ProgramPerson,
  today: CalendarDay,
  aheadDays = 7,
): { due: DueSelection[]; upcoming: DueSelection[] } {
  const horizon = shiftDay(today, aheadDays);
  const due: DueSelection[] = [];
  const upcoming: DueSelection[] = [];
  for (const s of selections) {
    if (normaliseStatus(s.status) !== "OPEN" || s.testMedstopId || !s.selectedOn) continue;
    const day = s.selectedOn.slice(0, 10);
    if (day > horizon) continue;
    const row: DueSelection = {
      selectionId: s.medstopId,
      service: serviceOf(s.service),
      selectedOn: day,
      daysSince: daysBetween(day, today),
      person: personOf(s.employeeMedstopId),
      ordered: s.requestMedstopId !== null,
    };
    (day <= today ? due : upcoming).push(row);
  }
  due.sort((a, b) => b.daysSince - a.daysSince);
  upcoming.sort((a, b) => a.selectedOn.localeCompare(b.selectedOn));
  return { due, upcoming };
}

export interface MatchedPerson extends MedstopPersonRow {
  driverId: string | null;
}

/**
 * The four reconciliation lists (F-1). `ourMedical` is the medical card's current expiry per driver
 * from `certifications` — the authoritative source since the roster carve-out, not `drivers`.
 */
export function reconcileRosters(
  people: readonly MatchedPerson[],
  drivers: readonly RosterDriverRow[],
  ourMedical: ReadonlyMap<string, string | null>,
): {
  notInPool: ProgramPerson[];
  leftButInPool: ProgramPerson[];
  licenceWeLack: ProgramPerson[];
  medicalDisagrees: MedicalDisagreement[];
  matched: number;
} {
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const activeInMedstop = people.filter((p) => p.roster === "active");
  const pooledDrivers = new Set(activeInMedstop.flatMap((p) => (p.driverId ? [p.driverId] : [])));
  const isWorking = (d: RosterDriverRow) => d.status === "active" && !d.archived;
  const nameOf = (p: MedstopPersonRow) => [p.firstName, p.lastName].filter(Boolean).join(" ") || p.medstopId;

  const notInPool = drivers
    .filter((d) => isWorking(d) && !pooledDrivers.has(d.id))
    .map((d) => ({ driverId: d.id, medstopId: null, name: d.fullName }));

  const leftButInPool: ProgramPerson[] = [];
  const licenceWeLack: ProgramPerson[] = [];
  const medicalDisagrees: MedicalDisagreement[] = [];
  for (const p of activeInMedstop) {
    const d = p.driverId ? byId.get(p.driverId) : undefined;
    if (!d) continue;
    const person = { driverId: d.id, medstopId: p.medstopId, name: d.fullName };
    if (!isWorking(d)) {
      leftButInPool.push(person);
      continue;
    }
    if (!normaliseLicence(d.cdlNumber) && normaliseLicence(p.licenseNumber)) licenceWeLack.push(person);
    const ours = ourMedical.get(d.id) ?? null;
    const theirs = p.medicalExpiresOn ? p.medicalExpiresOn.slice(0, 10) : null;
    if (ours !== theirs && (ours || theirs)) medicalDisagrees.push({ person, ours, medstop: theirs });
  }
  // Med-Stop people we could not match to anyone: if they are active there, nobody here can tell
  // whether they work for us. They are listed as "left" with no driver link, for a human to settle.
  for (const p of activeInMedstop) {
    if (!p.driverId) leftButInPool.push({ driverId: null, medstopId: p.medstopId, name: nameOf(p) });
  }
  const byName = (a: ProgramPerson, b: ProgramPerson) => a.name.localeCompare(b.name);
  return {
    notInPool: notInPool.sort(byName),
    leftButInPool: leftButInPool.sort(byName),
    licenceWeLack: licenceWeLack.sort(byName),
    medicalDisagrees: medicalDisagrees.sort((a, b) => byName(a.person, b.person)),
    matched: pooledDrivers.size,
  };
}
