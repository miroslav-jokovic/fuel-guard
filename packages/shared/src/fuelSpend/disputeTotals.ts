import { exceptionStatusesIn } from "../findingQueue.js";
import type { FuelExceptionAmountKind } from "./exceptions.js";

/**
 * The three money tiles on Fuel problems (F02-F04 chunk 9b): **Can be disputed / Disputed / Credited
 * back**. They replaced Identified / Claimed / Recovered / Still open when the buying habits left the
 * queue (Q-F2): what remains is billing work with Pilot, so the tiles follow a claim from open to paid.
 *
 * ── ONLY CLAIMABLE MONEY IS ADDED (D-FX5) ───────────────────────────────────────────────────────
 * The ledger's money comes in kinds that must never be summed together. Two of them are money the fleet
 * can claim: `overbilled` (Pilot billed more than we recorded) and `unrecorded` (a bill line with no fill
 * of ours). `underbilled` and `unbilled` are billing gaps in Pilot's favour or not yet invoiced: worth
 * resolving, but nothing is owed back, and adding them would print a claim nobody can make. Measured
 * 2026-10-08: 14 open items; 4 overbilled worth $56.34, then $208.60 underbilled and $2,339.63 unbilled.
 * So "Can be disputed" COUNTS every open item and SUMS only the claimable ones, and says both.
 *
 * Statuses come from the queue axis (C7a) rather than being restated: "can be disputed" is the open and
 * investigating states, "disputed" is the working state. Sums are in whole cents.
 */
export const CLAIMABLE_AMOUNT_KINDS: readonly FuelExceptionAmountKind[] = ["overbilled", "unrecorded"];

export interface DisputeTotalsRow {
  status: string;
  amount_kind: string;
  amount: number | string | null;
  credited_amount: number | string | null;
}

export interface DisputeTotals {
  /** Open or being looked at: every item counted, the claimable money summed. */
  canDispute: { count: number; claims: number; amount: number };
  /** Taken to the vendor and waiting. */
  disputed: { count: number; amount: number };
  /** Settled in our favour: what actually came back, which is not what was claimed (E3). */
  creditedBack: { count: number; amount: number };
}

const cents = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function disputeTotals(rows: readonly DisputeTotalsRow[]): DisputeTotals {
  const canDispute = new Set<string>([...exceptionStatusesIn("open"), ...exceptionStatusesIn("investigating")]);
  const working = new Set<string>(exceptionStatusesIn("working"));
  const claimable = (k: string) => (CLAIMABLE_AMOUNT_KINDS as readonly string[]).includes(k);
  const t = { can: 0, canClaims: 0, canCents: 0, disp: 0, dispCents: 0, cred: 0, credCents: 0 };
  for (const r of rows) {
    if (canDispute.has(r.status)) {
      t.can += 1;
      if (claimable(r.amount_kind)) { t.canClaims += 1; t.canCents += cents(r.amount); }
    } else if (working.has(r.status)) {
      t.disp += 1;
      if (claimable(r.amount_kind)) t.dispCents += cents(r.amount);
    } else if (r.status === "credited") {
      t.cred += 1;
      t.credCents += cents(r.credited_amount);
    }
  }
  return {
    canDispute: { count: t.can, claims: t.canClaims, amount: t.canCents / 100 },
    disputed: { count: t.disp, amount: t.dispCents / 100 },
    creditedBack: { count: t.cred, amount: t.credCents / 100 },
  };
}
