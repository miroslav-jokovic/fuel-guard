import { z } from "zod";
import type { MedstopTestOutcome } from "./medstopTests.js";

/**
 * Med-Stop — what OUR api answers about the carrier's drug & alcohol program
 * (docs/plans/safety-dqf/MEDSTOP-PLAN.md §6 F-1/F-2, batch MS1).
 *
 * Nothing here models a Med-Stop payload: the vendor's rows are parsed inside
 * `apps/api/src/modules/medstop/client.ts` and never leave it (D-ARC1). These are the shapes the
 * Settings page and Safety › Drug & Alcohol read.
 */

export const medstopApiKeySchema = z.object({
  apiKey: z.string().trim().min(16).max(512),
  /** Med-Stop's API Admin shows the key's expiry beside it; keys live at most 180 days. */
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export type MedstopApiKeyInput = z.infer<typeof medstopApiKeySchema>;

export interface MedstopConnectionStatus {
  hasKey: boolean;
  enabled: boolean;
  schedulerOn: boolean;
  syncHours: number;
  keyExpiresOn: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** One person on either roster, as the reconciliation lists show them. */
export interface ProgramPerson {
  /** Our driver, when matched — the row links to the driver page. */
  driverId: string | null;
  medstopId: string | null;
  name: string;
}

export interface PoolPace {
  service: "drug" | "alcohol" | "other";
  label: string;
  poolYear: number;
  endsOn: string | null;
  frequency: string | null;
  targetPercent: number;
  currentPercent: number;
  membersAvg: number;
  completedTests: number;
  /** ⌈target × average membership⌉ — the tests the year needs to meet its rate. */
  requiredTests: number;
  /** required − completed, never below zero. */
  testsOwed: number;
  /** Selections Med-Stop has already drawn for the rest of the year. */
  scheduledTests: number;
  /**
   * Selections this year that ended without a test (CANCELED, EXPIRED). Each one is a test the
   * rate still needs and a draw that will not supply it.
   */
  lostSelections: number;
}

export interface DueSelection {
  selectionId: string;
  service: "drug" | "alcohol" | "other";
  selectedOn: string;
  /** Negative for a selection still ahead (the upcoming week). */
  daysSince: number;
  person: ProgramPerson;
  /** A request exists — the test is ordered and waiting on the driver. */
  ordered: boolean;
}

/** One Med-Stop test as a screen shows it (MS2c, F-4). */
export interface MedstopTestView {
  testId: string;
  kind: "drug" | "alcohol" | "medical";
  /** Med-Stop's reason, verbatim: PRE-EMPLOYMENT, RANDOM, POST-ACCIDENT, … */
  reason: string | null;
  /** Where the test is, in words (`medstopStageLabel`). */
  stage: string;
  collectedOn: string | null;
  /** A drug test not yet final: the day its result is due (p90, `medstopResultExpectedOn`). */
  expectedOn: string | null;
  /**
   * The verified outcome. NULL — not "pending" — when the reader may not read testing records
   * (§382.401(a), `canReadTestingRecords`): a recruiter sees the stage and the date, never the result.
   */
  outcome: MedstopTestOutcome | null;
}

/** A test Med-Stop has ORDERED and nobody has been collected for yet. */
export interface MedstopOrderView {
  requestId: string;
  kind: "drug" | "alcohol" | "medical";
  reason: string | null;
  requestedOn: string | null;
  status: string | null;
}

/** The hiring drawer's drug-test step: what Med-Stop holds for this one person (F-4). */
export interface MedstopPersonTests {
  connected: boolean;
  /** Med-Stop's record of this person is matched to our driver by licence or name + date of birth. */
  matched: boolean;
  orders: MedstopOrderView[];
  tests: MedstopTestView[];
  outcomesVisible: boolean;
}

/** A result on Safety › Drug & Alcohol's review list (F-5). Only built for roles that read testing records. */
export interface MedstopResultRow {
  testId: string;
  person: ProgramPerson;
  kind: "drug" | "alcohol" | "medical";
  reason: string | null;
  collectedOn: string | null;
  outcome: MedstopTestOutcome;
}

/**
 * In progress (MS-UX §7A.3): an order Med-Stop has not collected yet, or a test whose result is not
 * final. Any reason. A RANDOM row is only ever built for a reader `canReadTestingRecords` admits —
 * an order not yet collected names a person who has not been told (§382.305(l)).
 */
export interface InProgressRow {
  key: string;
  person: ProgramPerson;
  kind: "drug" | "alcohol" | "medical";
  reason: string | null;
  /** "Ordered, not collected" for an order; the test's stage in words otherwise. */
  stage: string;
  orderedOn: string | null;
  collectedOn: string | null;
  /** A drug test not yet final: the day its result is due (p90). */
  expectedOn: string | null;
  /** Days since the order (not collected) or the collection. */
  daysWaiting: number;
}

/**
 * Medical cards (MS-UX §7A.3, R2): a working driver whose card expires within the horizon or has
 * expired, by EITHER source. `ours` is the card on file (`certifications`, what the DQ file and its
 * alerts read); `medstop` is Med-Stop's date for a certain match, shown beside it only when it differs.
 */
export interface MedicalCardRow {
  person: ProgramPerson;
  ours: string | null;
  medstop: string | null;
  /** The earlier of the two — the safe side — and the days until it (negative = expired). */
  expiresOn: string;
  daysLeft: number;
}

export interface DrugAlcoholProgram {
  connected: boolean;
  syncedAt: string | null;
  lastError: string | null;
  pools: PoolPace[];
  /**
   * Who is selected and not yet tested. NULL — not empty — when the reader may not see it: a
   * selection names a person before they are told, and §382.305(l) wants that notice immediate
   * and unannounced, so the list is held to the roles that read testing records.
   */
  selections: { due: DueSelection[]; reserves: DueSelection[] } | null;
  inProgress: InProgressRow[];
  /**
   * MS2c (F-5): results the DER must see. NULL for roles that may not read testing records.
   * `recent` — positives, refusals, dilutes and unrecognised wordings since the product began
   * watching, the same set the DER was notified of. `history` — the violations the first sweep found
   * already old (D-MS5): never acted on automatically, listed so a person decides.
   */
  results: { recent: MedstopResultRow[]; history: MedstopResultRow[] } | null;
  medical: MedicalCardRow[];
  roster: {
    /** Active here, absent from Med-Stop's active roster: outside the random pool (§382.305). */
    notInPool: ProgramPerson[];
    /** Active in Med-Stop, gone here (terminated / archived): still drawable, should not be. */
    leftButInPool: ProgramPerson[];
  };
}
