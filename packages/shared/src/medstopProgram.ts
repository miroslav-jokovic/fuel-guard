import { shiftDay, type CalendarDay } from "./calendarDay.js";
import type {
  PoolPace,
  ProgramPerson,
  RandomDraw,
  RandomDrawPeriod,
  RandomDrawState,
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
  poolMedstopId: string | null;
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

/** A pool as the draw periods need it: its own start, end and frequency, so the quarter is derived, never assumed. */
export interface DrawPool {
  medstopId: string;
  startsOn: string | null;
  endsOn: string | null;
  frequency: string | null;
}

/**
 * Months per period for Med-Stop's frequency word. Only QUARTERLY has been seen (all 18 pools,
 * 2018–2026, read 2026-10-15); the others are the obvious spellings. An unknown word makes the period
 * the whole pool — the widest honest answer, which lists more draws as due rather than hiding one.
 */
const PERIOD_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, "SEMI-ANNUALLY": 6, SEMIANNUALLY: 6, ANNUALLY: 12, YEARLY: 12 };

const addMonths = (day: CalendarDay, n: number): CalendarDay => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1 + n, d));
  return at.toISOString().slice(0, 10);
};

/** The period of `pool` that `day` falls in, or null when the pool has no start or `day` lies outside it. */
export function drawPeriodOf(pool: DrawPool, day: CalendarDay): RandomDrawPeriod | null {
  const start = pool.startsOn?.slice(0, 10);
  const end = pool.endsOn?.slice(0, 10) ?? null;
  if (!start || day < start || (end !== null && day > end)) return null;
  const months = PERIOD_MONTHS[(pool.frequency ?? "").trim().toUpperCase()] ?? null;
  if (months === null) return { startsOn: start, endsOn: end ?? day, months: null };
  let k = 0;
  while (addMonths(start, (k + 1) * months) <= day) k++;
  const next = addMonths(start, (k + 1) * months);
  const last = shiftDay(next, -1);
  return { startsOn: addMonths(start, k * months), endsOn: end !== null && end < last ? end : last, months };
}

/**
 * The Random tab's list (MS-UX §7A.3, §7A.18): every draw of `today`'s pool year — drawn, tested,
 * lost and ahead — each with its state and its period against today's, plus any earlier draw still
 * due; and the period today falls in, which the tab opens on. The DER's to-do (`due`) leads,
 * earliest-dated first; then what is ahead, soonest first; then the rest, newest first.
 *
 * ⚠ A DRAW'S DATE IS NOT WHEN IT WAS DRAWN (D-MSUX19, 2026-10-15). Med-Stop draws a quarter's names
 * when the quarter opens and spreads their dates across it: on 10/15 the Q4 drug pool already held
 * 16 OPEN draws dated 10/06–12/20, and the office's paper list "HM TESTING 2026" is exactly those
 * people. D-MSUX18 called a draw dated after today "upcoming" and offered no order on it, which split
 * the office's one list into 3 due and 19 not yet. Every OPEN draw of the current period (or an earlier
 * one) is now `due` and orderable; only a draw in a LATER period is `upcoming`.
 *
 * ⚠ FUTURE DRAWS ARE IN THIS LIST, ON THE OWNER'S RULING (2026-10-14). §382.305(l) is about the
 * DRIVER being told early, not the DER knowing the schedule — so the list stays held to the roles that
 * read testing records, and nothing here, nor anything it feeds, tells a driver anything.
 */
export function randomDrawsThisYear(
  selections: readonly SelectionRow[],
  pools: readonly DrawPool[],
  personOf: (medstopId: string | null) => ProgramPerson,
  today: CalendarDay,
): { draws: RandomDraw[]; currentPeriod: RandomDrawPeriod | null } {
  const yearPrefix = `${today.slice(0, 4)}-`;
  const poolById = new Map(pools.map((p) => [p.medstopId, p]));
  const currentPeriod =
    [...pools].sort((a, b) => a.medstopId.localeCompare(b.medstopId)).map((p) => drawPeriodOf(p, today)).find((p) => p !== null) ?? null;
  const draws: RandomDraw[] = [];
  for (const s of selections) {
    if (!s.selectedOn) continue;
    const day = s.selectedOn.slice(0, 10);
    const period = periodAgainstToday(s.poolMedstopId ? poolById.get(s.poolMedstopId) : undefined, day, today);
    const state = drawState(s, period);
    // An earlier year's draw still OPEN and untested is not history: it is still the DER's to-do.
    if (!s.selectedOn.startsWith(yearPrefix) && state !== "due") continue;
    draws.push({
      selectionId: s.medstopId,
      service: serviceOf(s.service),
      selectedOn: day,
      daysSince: daysBetween(day, today),
      person: personOf(s.employeeMedstopId),
      ordered: s.requestMedstopId !== null,
      state,
      period,
      medstopStatus: s.status?.trim() || null,
    });
  }
  const byName = (a: RandomDraw, b: RandomDraw) => a.person.name.localeCompare(b.person.name);
  const of = (keep: (d: RandomDraw) => boolean) => draws.filter(keep);
  return {
    draws: [
      ...of((d) => d.state === "due").sort((a, b) => b.daysSince - a.daysSince || byName(a, b)),
      ...of((d) => d.state === "upcoming").sort((a, b) => a.selectedOn.localeCompare(b.selectedOn) || byName(a, b)),
      ...of((d) => d.state !== "due" && d.state !== "upcoming").sort((a, b) => b.selectedOn.localeCompare(a.selectedOn) || byName(a, b)),
    ],
    currentPeriod,
  };
}

/**
 * A draw's period against today's, in the draw's own pool. A pool that ended before today is all
 * `earlier`; one not yet begun is all `later`. A selection whose pool we do not hold (none in 866,
 * measured 10/15) falls back to its date — ahead of today is `later`, the D-MSUX18 rule; anything else
 * is `earlier`, so an OPEN one is still due and listed under "To test", though not in the period view.
 */
function periodAgainstToday(pool: DrawPool | undefined, day: CalendarDay, today: CalendarDay): RandomDraw["period"] {
  const own = pool ? drawPeriodOf(pool, day) : null;
  if (!pool || !own) return day > today ? "later" : "earlier";
  const now = drawPeriodOf(pool, today);
  if (!now) return (pool.startsOn ?? "").slice(0, 10) > today ? "later" : "earlier";
  return own.startsOn === now.startsOn ? "current" : own.startsOn < now.startsOn ? "earlier" : "later";
}

function drawState(s: SelectionRow, period: RandomDraw["period"]): RandomDrawState {
  // A test is the fact that settles a draw, whatever Med-Stop's status word (REFUSAL, TEST CANCELED).
  if (s.testMedstopId) return "tested";
  const raw = (s.status ?? "").toUpperCase();
  const status = normaliseStatus(s.status);
  if (status === "RESERVE") return raw.includes("EXPIRED") ? "alternate_unused" : "alternate";
  if (status === "OPEN") return period === "later" ? "upcoming" : "due";
  if (status === "CANCELED") return "cancelled";
  if (status === "EXPIRED") return "expired";
  return "other";
}

export interface MatchedPerson extends MedstopPersonRow {
  driverId: string | null;
}

/**
 * The Roster check tab (F-1, MS-UX §7A.2): only the two lists that are violations. The owner's review
 * dropped "licence we lack" (a roster chore, not a drug-and-alcohol decision) and the medical
 * disagreement list (the Medical tab answers it, `medicalCardsDue`).
 */
export function reconcileRosters(
  people: readonly MatchedPerson[],
  drivers: readonly RosterDriverRow[],
): { notInPool: ProgramPerson[]; leftButInPool: ProgramPerson[] } {
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const activeInMedstop = people.filter((p) => p.roster === "active");
  const pooledDrivers = new Set(activeInMedstop.flatMap((p) => (p.driverId ? [p.driverId] : [])));
  const nameOf = (p: MedstopPersonRow) => [p.firstName, p.lastName].filter(Boolean).join(" ") || p.medstopId;

  const notInPool = drivers
    .filter((d) => isWorking(d) && !pooledDrivers.has(d.id))
    .map((d) => ({ driverId: d.id, medstopId: null, name: d.fullName }));

  const leftButInPool: ProgramPerson[] = [];
  for (const p of activeInMedstop) {
    const d = p.driverId ? byId.get(p.driverId) : undefined;
    if (d && !isWorking(d)) leftButInPool.push({ driverId: d.id, medstopId: p.medstopId, name: d.fullName });
    // Med-Stop people we could not match to anyone: if they are active there, nobody here can tell
    // whether they work for us. They are listed with no driver link, for a human to settle.
    if (!p.driverId) leftButInPool.push({ driverId: null, medstopId: p.medstopId, name: nameOf(p) });
  }
  const byName = (a: ProgramPerson, b: ProgramPerson) => a.name.localeCompare(b.name);
  return { notInPool: notInPool.sort(byName), leftButInPool: leftButInPool.sort(byName) };
}

const isWorking = (d: RosterDriverRow) => d.status === "active" && !d.archived;
