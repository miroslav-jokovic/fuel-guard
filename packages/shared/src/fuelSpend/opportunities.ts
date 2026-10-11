/**
 * The Fuel Costs savings strip's rows (FS-STRIP, Q-FSV15 ruling 1): the OPEN fuel findings, one row per kind.
 *
 * ── WHY ONE ROW PER KIND AND NO TOTAL ────────────────────────────────────────────────────────────
 * The 2026-10-03 design verdict: buying difference, quote variance, coaching and equipment opportunity
 * must stay separate, because they overlap (one fill can be an off-network premium and a quote gap) and
 * mean different things (a premium is a price difference, an overbilling is a claim). A figure that adds
 * them is a number nobody can act on. So each row is one kind's own count and dollars; there is no
 * sum here, and a caller that adds the rows is writing the defect this file exists to avoid.
 *
 * ── WHY IT READS THE LEDGER ──────────────────────────────────────────────────────────────────────
 * "Review" already exists as the findings inbox (assign, status, evidence, credit). A row therefore
 * counts what is in that queue and links into it, instead of inventing a second list of opportunities
 * with its own idea of what is open.
 *
 * Pure, so the API's read and the tests share one definition of the ranking.
 */
import { FUEL_EXCEPTION_KIND_LABELS, type FuelExceptionKind } from "./exceptions.js";

/** The columns the aggregation needs from `fuel_exceptions`; `amount` arrives as a string from PostgREST. */
export interface OpenExceptionRow {
  kind: FuelExceptionKind;
  amount: number | string | null;
  occurred_on: string;
}

export interface FuelOpportunity {
  kind: FuelExceptionKind;
  /** The kind in the words the inbox uses for it. */
  label: string;
  count: number;
  /** Dollars on this kind's findings. A finding with no amount adds to `count` and not to this. */
  amount: number;
  /** How many of the findings carry an amount, so a row can say "$X on 3 of 5" instead of implying all. */
  withAmount: number;
  /** The earliest `occurred_on` among them, `YYYY-MM-DD`. */
  oldest: string;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Largest dollars first, then most findings, then name — a total order, so a refresh never reshuffles a tie. */
export function summariseOpportunities(rows: readonly OpenExceptionRow[]): FuelOpportunity[] {
  const by = new Map<FuelExceptionKind, FuelOpportunity>();
  for (const r of rows) {
    const amt = r.amount == null || r.amount === "" ? null : Number(r.amount);
    const hasAmt = amt != null && Number.isFinite(amt);
    const cur = by.get(r.kind);
    if (!cur) {
      by.set(r.kind, {
        kind: r.kind,
        label: FUEL_EXCEPTION_KIND_LABELS[r.kind] ?? r.kind,
        count: 1,
        amount: hasAmt ? amt : 0,
        withAmount: hasAmt ? 1 : 0,
        oldest: r.occurred_on,
      });
      continue;
    }
    cur.count += 1;
    if (hasAmt) {
      cur.amount += amt;
      cur.withAmount += 1;
    }
    if (r.occurred_on < cur.oldest) cur.oldest = r.occurred_on;
  }
  return [...by.values()]
    .map((o) => ({ ...o, amount: cents(o.amount) }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count || a.kind.localeCompare(b.kind));
}
