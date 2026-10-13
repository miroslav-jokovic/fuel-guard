import { shiftDay, type CalendarDay } from "./calendarDay.js";
import type { InProgressRow, MedicalCardRow, MedicalCards, ProgramPerson } from "./medstopContract.js";
import { MEDICAL_SOURCES, resolveMedicalExpiry, type MedicalCardState } from "./credentialSources.js";
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
 * The Medical cards tab (UX2, D-MSUX4b), from the same per-driver state evidence files from — the card
 * on file and each source's latest claim (`credential_source_dates`, 0467) — so the tab and the
 * qualification file cannot tell two stories.
 *
 * - `due`: working drivers whose card runs out within `horizonDays` or has, soonest first. The date is
 *   the one Q-MSUX7's rule gives (`resolveMedicalExpiry`): what the file holds, or will hold once the
 *   next sweep files it.
 * - `disagree`: working drivers whose sources do not all agree — the owner's "flagged for review".
 *   The office settles one by filing the card's scan, which then wins.
 */
export function medicalCards(
  drivers: readonly MedicalDriver[],
  states: ReadonlyMap<string, MedicalCardState>,
  today: CalendarDay,
  horizonDays = 60,
): MedicalCards {
  const horizon = shiftDay(today, horizonDays);
  const due: MedicalCardRow[] = [];
  const disagree: MedicalCardRow[] = [];
  for (const d of drivers) {
    const state = d.working ? states.get(d.id) : undefined;
    if (!state) continue;
    const resolved = resolveMedicalExpiry(state.onFile, state.claims);
    const expiresOn = resolved.expiresOn ?? state.onFile?.expiresOn?.slice(0, 10) ?? null;
    if (!expiresOn) continue;
    const row: MedicalCardRow = {
      person: { driverId: d.id, medstopId: null, name: d.fullName },
      expiresOn,
      daysLeft: daysBetween(today, expiresOn),
      documented: resolved.rule === "documented",
      sources: MEDICAL_SOURCES.flatMap((source) => state.claims.filter((c) => c.source === source)),
      disagree: resolved.disagree,
    };
    if (expiresOn <= horizon) due.push(row);
    if (resolved.disagree) disagree.push(row);
  }
  const order = (a: MedicalCardRow, b: MedicalCardRow) => a.daysLeft - b.daysLeft || a.person.name.localeCompare(b.person.name);
  return { due: due.sort(order), disagree: disagree.sort(order) };
}
