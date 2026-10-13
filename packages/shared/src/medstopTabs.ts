import { shiftDay, type CalendarDay } from "./calendarDay.js";
import type { InProgressRow, MedicalCardRow, ProgramPerson } from "./medstopContract.js";
import {
  medstopOrderOpen,
  medstopResultExpectedOn,
  medstopStageLabel,
  medstopTestKind,
  medstopTestOutcome,
} from "./medstopTests.js";

/**
 * Two of Safety › Drug & Alcohol's tabs, pure (MEDSTOP-PLAN.md §7A.3, MS-UX1). The api gathers rows;
 * what counts as "in progress" and which medical card is "due" is decided here, once.
 */

const daysBetween = (from: CalendarDay, to: CalendarDay): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export interface InProgressOrder {
  medstopId: string;
  employeeMedstopId: string | null;
  service: string | null;
  reason: string | null;
  status: string | null;
  requestedLocal: string | null;
  testMedstopId: string | null;
}

export interface InProgressTest {
  medstopId: string;
  employeeMedstopId: string | null;
  service: string | null;
  reason: string | null;
  status: string | null;
  result: string | null;
  collectedLocal: string | null;
}

const isRandom = (reason: string | null) => reason?.trim().toUpperCase() === "RANDOM";

/**
 * Every order not collected and every test not final, longest-waiting first.
 *
 * - An order is in progress while Med-Stop still waits for the donor (`medstopOrderOpen`) and no test
 *   exists for it; once a test exists, the TEST is the row.
 * - A test is in progress while its result is not final (`medstopTestOutcome` = pending) and Med-Stop
 *   has not CLOSED it. A closed test without a result (5 in the 12 months to 2026-10-13) is not "in
 *   progress" — it would sit here for ever; it is a record to look at in Med-Stop.
 * - ⚠ RANDOM rows only when `showRandom` (the reader may read testing records): an order not yet
 *   collected names a person who must not be warned (§382.305(l)).
 */
export function inProgressRows(
  orders: readonly InProgressOrder[],
  tests: readonly InProgressTest[],
  personOf: (medstopId: string | null) => ProgramPerson,
  today: CalendarDay,
  showRandom: boolean,
): InProgressRow[] {
  const rows: InProgressRow[] = [];
  for (const o of orders) {
    if (o.testMedstopId || !medstopOrderOpen(o.status)) continue;
    if (!showRandom && isRandom(o.reason)) continue;
    const orderedOn = o.requestedLocal?.slice(0, 10) ?? null;
    rows.push({
      key: `order:${o.medstopId}`,
      person: personOf(o.employeeMedstopId),
      kind: medstopTestKind(o.service),
      reason: o.reason,
      stage: "Ordered, not collected",
      orderedOn,
      collectedOn: null,
      expectedOn: null,
      daysWaiting: orderedOn ? Math.max(0, daysBetween(orderedOn, today)) : 0,
    });
  }
  for (const t of tests) {
    if (t.status?.trim().toUpperCase() === "CLOSED") continue;
    if (medstopTestOutcome(t) !== "pending") continue;
    if (!showRandom && isRandom(t.reason)) continue;
    const collectedOn = t.collectedLocal?.slice(0, 10) ?? null;
    rows.push({
      key: `test:${t.medstopId}`,
      person: personOf(t.employeeMedstopId),
      kind: medstopTestKind(t.service),
      reason: t.reason,
      stage: medstopStageLabel(t.service, t.status),
      orderedOn: null,
      collectedOn,
      expectedOn: medstopResultExpectedOn(t.service, t.collectedLocal),
      daysWaiting: collectedOn ? Math.max(0, daysBetween(collectedOn, today)) : 0,
    });
  }
  return rows.sort((a, b) => b.daysWaiting - a.daysWaiting || a.person.name.localeCompare(b.person.name));
}

export interface MedicalDriver {
  id: string;
  fullName: string;
  working: boolean;
}

/**
 * Working drivers whose medical card expires within `horizonDays` or has expired, by EITHER source,
 * soonest first. `ours` is the card on file (`certifications`); `medstop` is Med-Stop's date for a
 * CERTAIN match only (R3), kept only when it differs from ours. The row's date is the EARLIER of the
 * two: when the sources disagree, the safe side is the one that runs out first (Q-MSUX7 pending).
 */
export function medicalCardsDue(
  drivers: readonly MedicalDriver[],
  ours: ReadonlyMap<string, string | null>,
  medstopCertain: ReadonlyMap<string, string | null>,
  today: CalendarDay,
  horizonDays = 60,
): MedicalCardRow[] {
  const horizon = shiftDay(today, horizonDays);
  const out: MedicalCardRow[] = [];
  for (const d of drivers) {
    if (!d.working) continue;
    const mine = ours.get(d.id)?.slice(0, 10) ?? null;
    const theirs = medstopCertain.get(d.id)?.slice(0, 10) ?? null;
    const dates = [mine, theirs].filter((x): x is string => x !== null).sort();
    const earliest = dates[0];
    if (!earliest || earliest > horizon) continue;
    out.push({
      person: { driverId: d.id, medstopId: null, name: d.fullName },
      ours: mine,
      medstop: theirs !== mine ? theirs : null,
      expiresOn: earliest,
      daysLeft: daysBetween(today, earliest),
    });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft || a.person.name.localeCompare(b.person.name));
}
