/**
 * The driver's half of the dispatch board's Warnings column, pure (DISPATCH-BOARD-V2-PLAN §3.5, §4, DBV4).
 *
 * ── MED CARD AND CDL ARE THE DQ FILE'S, NOT `drivers.*_expires_at` ─────────────────────────────────
 * A dispatcher who books a load for a driver whose medical card lapses mid-trip has the same problem as
 * one who books a truck overdue for its annual (plan §4). The dates are the driver's §391.51 file as
 * `buildDqFile` computes it — the roster's own cells (`dqRosterCells`, D-ROS9) — because two sources for
 * a legal gate IS the defect (D-DQ6). Expired is overdue; inside the file's 30-day window is due.
 * MISSING says nothing here: that is a file to build, the qualification queue's work, and a synced
 * record with no date would otherwise put a false "expired" on the board (DBV3's rule, `pmWarning`).
 *
 * ── THE RANDOM TEST IS REDACTED, ON THE DISPATCH-HOLD PATTERN (Q-DBV3) ─────────────────────────────
 * A drawn driver must go to collection promptly once told, and the dispatcher is the one who plans the
 * truck around that. But the draw list is a testing record (§382.305(l), §382.401(a)), held to the
 * roles `canReadTestingRecords` admits. So the board carries one fact — "send to collection" — with no
 * date, no pool and no result, `dispatchHoldForReader`'s shape (`returnToDuty.ts`): a testing-record
 * reader sees it on every row, and anybody else only on their own trucks (`inMyScope`), the owner's
 * ruling of 2026-10-16. Never for a draw in a later period: that would be notice before the driver's.
 */
import { canReadTestingRecords } from "./auth.js";
import type { UserRole } from "./constants.js";
import type { BoardWarning } from "./dispatchBoardContract.js";
import type { DqRosterCell } from "./dqFile.js";

const CREDENTIAL_KINDS = { medical_card: "medical_card", cdl: "cdl" } as const;

/** The driver's medical card and CDL as warnings, from their DQ file's roster cells. */
export function credentialWarnings(cells: readonly DqRosterCell[]): BoardWarning[] {
  const out: BoardWarning[] = [];
  for (const c of cells) {
    const kind = c.key === "medical_card" || c.key === "cdl" ? CREDENTIAL_KINDS[c.key] : null;
    if (!kind) continue;
    if (c.state === "expired") out.push({ unit: "driver", kind, verdict: "overdue", dueOn: c.goodUntil, milesLeft: null });
    else if (c.state === "expiring") out.push({ unit: "driver", kind, verdict: "due", dueOn: c.goodUntil, milesLeft: null });
  }
  return out;
}

/**
 * May this reader see that this row's driver is drawn? Every row for a testing-record reader; their own
 * trucks for anybody else. The caller passes `mine` from `inMyScope`, so "own" has one definition.
 */
export function randomTestVisible(drawn: boolean, role: UserRole | null | undefined, mine: boolean): boolean {
  return drawn && (canReadTestingRecords(role) || mine);
}

/** The redacted fact itself: a date, a pool or a result here would be the testing record. */
export const RANDOM_TEST_WARNING: BoardWarning = { unit: "driver", kind: "random_test", verdict: "due", dueOn: null, milesLeft: null };
