import type { MedstopApplicantCreateView } from "./medstopApplicant.js";
import { z } from "zod";
import type { MedstopTestOutcome } from "./medstopTests.js";
import type { MedicalSourceDate } from "./credentialSources.js";

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
  /** UX3 (0468): ordering tests from the product — off until the first watched order (D-MSUX2). */
  ordersEnabled: boolean;
  /** The office contact every order carries instead of the driver's (D-MSUX5). Admin-only screen. */
  orderContactEmail: string | null;
  orderContactPhone: string | null;
}

/** Settings › Med-Stop: the ordering switch and the office contact, saved together. */
export const medstopOrderingSchema = z
  .object({
    enabled: z.boolean(),
    email: z.string().trim().email().nullable(),
    // Ten digits, the shape 0468's check holds; the screen strips punctuation before sending.
    phone: z.string().regex(/^\d{10}$/).nullable(),
  })
  .strict()
  .refine((o) => !o.enabled || (o.email !== null && o.phone !== null), {
    message: "Ordering needs the office's e-mail and phone — every order carries them instead of the driver's.",
    path: ["enabled"],
  });
export type MedstopOrderingInput = z.infer<typeof medstopOrderingSchema>;

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

/**
 * Where a random draw stands (D-MSUX18, D-MSUX19). `due`: OPEN and not tested, drawn in the current
 * period or an earlier one — the DER's to-do, orderable whatever day Med-Stop dated it inside the
 * period. `upcoming`: OPEN in a LATER period. `alternate`: a reserve not yet used; `alternate_unused`:
 * one that expired unused (not a lost draw). `cancelled` and `expired` ended without a test — both
 * count against the year's rate. `other`: a Med-Stop status nobody mapped, shown as Med-Stop wrote it.
 */
export type RandomDrawState = "due" | "upcoming" | "tested" | "alternate" | "alternate_unused" | "cancelled" | "expired" | "other";

/** The pool period today falls in — the quarter whose draw the Random tab opens on (D-MSUX19). */
export interface RandomDrawPeriod {
  startsOn: string;
  endsOn: string;
  /** Months per period from the pool's frequency (3 = quarterly); null when Med-Stop's word is unknown and the period is the whole pool year. */
  months: number | null;
}

/** One of the year's random draws, as the Random tab lists it. Built only for testing-record readers. */
export interface RandomDraw {
  selectionId: string;
  service: "drug" | "alcohol" | "other";
  selectedOn: string;
  /** Days from the draw to today; negative for a draw still ahead. */
  daysSince: number;
  person: ProgramPerson;
  /** A request exists — the test is ordered and waiting on the driver. */
  ordered: boolean;
  state: RandomDrawState;
  /** The draw's pool period (a quarter, for every pool Med-Stop has run since 2018) against today's. */
  period: "earlier" | "current" | "later";
  /** Med-Stop's own status, verbatim — what `other` shows. */
  medstopStatus: string | null;
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
  /**
   * Med-Stop's id for this person on its APPLICANT roster, certainly matched — what a pre-employment
   * order is placed on (UX4). NULL when Med-Stop does not hold them as an applicant: not at all
   * (`matched` false — "add them in Med-Stop first"), or already on its active roster.
   */
  applicantMedstopId: string | null;
  /**
   * UX5c: what became of creating this applicant in Med-Stop from Part 1 (0471) — null when never
   * attempted. A refusal carries Med-Stop's own sentence, so the office knows to add them by hand.
   */
  applicantCreate: MedstopApplicantCreateView | null;
  orders: MedstopOrderView[];
  tests: MedstopTestView[];
  outcomesVisible: boolean;
}

/**
 * A result on Safety › Drug & Alcohol's review list (F-5). Only built for roles that read testing records.
 * Usually a TEST; an ORDER when Med-Stop closed it as a refusal before any specimen existed, so no test
 * row will ever carry it (MEDSTOP-PLAN §7A.16) — `medstopId` is then the order's id, `collectedOn` the
 * visit's day (else the appointment's), and `outcome` always "refusal".
 */
export interface MedstopResultRow {
  source: "test" | "order";
  medstopId: string;
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
  /** The date the qualification file holds by Q-MSUX7's rule, and the days until it (negative = expired). */
  expiresOn: string;
  daysLeft: number;
  /** A scanned card decides the date — it wins over every source. */
  documented: boolean;
  /** Each outside source's latest date for this driver (McLeod, Med-Stop), in `MEDICAL_SOURCES` order. */
  sources: MedicalSourceDate[];
  /** The sources, or the scanned card, do not all agree. */
  disagree: boolean;
}

export interface MedicalCards {
  due: MedicalCardRow[];
  disagree: MedicalCardRow[];
}

export interface DrugAlcoholProgram {
  connected: boolean;
  syncedAt: string | null;
  lastError: string | null;
  pools: PoolPace[];
  /**
   * The pool year's random draws, past and ahead (D-MSUX18), and the period today falls in — the
   * tab's default view (D-MSUX19); `currentPeriod` is null when no pool covers today. NULL — not empty — when the reader may
   * not see it: a selection names a person before they are told, and §382.305(l) wants that notice
   * immediate and unannounced, so the list is held to the roles that read testing records.
   */
  selections: { draws: RandomDraw[]; currentPeriod: RandomDrawPeriod | null } | null;
  inProgress: InProgressRow[];
  /**
   * MS2c (F-5): results the DER must see. NULL for roles that may not read testing records.
   * `recent` — positives, refusals, dilutes and unrecognised wordings since the product began
   * watching, the same set the DER was notified of. `history` — the violations the first sweep found
   * already old (D-MS5): never acted on automatically, listed so a person decides.
   */
  results: { recent: MedstopResultRow[]; history: MedstopResultRow[] } | null;
  medical: MedicalCards;
  roster: {
    /** Active here, absent from Med-Stop's active roster: outside the random pool (§382.305). */
    notInPool: ProgramPerson[];
    /** Active in Med-Stop, gone here (terminated / archived): still drawable, should not be. */
    leftButInPool: ProgramPerson[];
  };
}
