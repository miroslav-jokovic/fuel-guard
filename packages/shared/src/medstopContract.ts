import { z } from "zod";

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

export interface MedicalDisagreement {
  person: ProgramPerson;
  ours: string | null;
  medstop: string | null;
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
  selections: { due: DueSelection[]; upcoming: DueSelection[] } | null;
  roster: {
    /** Active here, absent from Med-Stop's active roster: outside the random pool (§382.305). */
    notInPool: ProgramPerson[];
    /** Active in Med-Stop, gone here (terminated / archived): still drawable, should not be. */
    leftButInPool: ProgramPerson[];
    /** Med-Stop matched by name, our driver row carries no licence number. */
    licenceWeLack: ProgramPerson[];
    medicalDisagrees: MedicalDisagreement[];
    /** Med-Stop's active roster, and how many of them are linked to one of our drivers. */
    medstopActive: number;
    matched: number;
  };
}
