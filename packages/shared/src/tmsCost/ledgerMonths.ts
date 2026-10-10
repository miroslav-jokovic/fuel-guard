/**
 * Whether a month's ledger is the whole month, or only as much of it as had happened when the
 * sweep ran (G11).
 *
 * **The failure this exists for, measured on production 2026-09-03.** The McLeod financial sweep
 * is run by hand behind the carrier's VPN, and the last run was 2026-08-28 — four days before
 * August ended. It therefore staged eleven August lines: a GPS fee, an Oregon permit and an MVR
 * charge, $8,430.00 of expense and **no revenue at all**. Nothing distinguished that from a
 * finished month, because the only test anything applied was "does this month have rows".
 *
 * The consequence was not subtle. The finance page opens on the last full calendar month, which on
 * 2026-09-03 is August, so the report said the fleet **earned $0.00, spent $8,430.00 and kept
 * −$8,430.00** — and the twelve-month trend drew a cliff to the axis on its final point. Every
 * figure was computed correctly from the rows that were there. That is the whole problem: a
 * plausible, precise, entirely wrong report, and it recurs every month between the 1st and the
 * next sweep rather than being a one-off state.
 *
 * **The rule is a comparison the rows already carry, never a date.** A month is complete when the
 * newest sweep that touched it ran after the month was over. `period_end` is McLeod's own
 * exclusive upper bound for the period (2026-09-01 for August), so the test is whether the sweep
 * is dated later than that — which keeps working for a sweep that stops for a fortnight next
 * spring, and says nothing about this particular rollout.
 *
 * **Why a whole day of margin.** `swept_at` is UTC and the carrier books in US local time, so a
 * sweep at 00:30 UTC on the 1st ran at 19:30 the previous evening where the entries are made and
 * would miss the tail of the month. Requiring the sweep to be dated strictly after `period_end`
 * covers every US timezone, and errs toward withholding a month rather than publishing a partial
 * one — which is the direction D-FIN10 requires.
 *
 * **What this rule does NOT claim.** It does not say the month is closed. McLeod keeps posting
 * accruals and adjustments to a month for days after it ends, and a sweep on the 2nd cannot hold
 * an entry booked on the 5th. Every figure is as of its sweep, which is why the sweep date travels
 * with the answer instead of being replaced by a badge that says "final".
 *
 * **A sweep after month end is necessary, not sufficient (Q10, ruled 2026-10-10).** McLeod's
 * accountant posts a month 10–39 days after it ends, and recurring journals post first. Measured
 * 2026-10-10: the 10-09 sweep ran nine days after September ended and found eight `RJ` lines and
 * nothing else, so September passed the date test and the fleet report opened on a month with no
 * revenue. So a month is also refused until it carries the module that earned the most revenue in
 * the last complete month before it, AND the module that spent the most. From December 2025 to
 * August 2026 those were BILL every month, and SET every month but December (GJ) — September holds
 * neither.
 *
 * **Why the leading module and not every module (a measured deviation from Q10's text).** The owner
 * ruled option (a) of Q10 in `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §4: "a month is
 * reportable when its ledger carries the revenue-bearing posting modules the preceding complete
 * months carried". Read literally, as every module every earlier month carried, the production
 * ledger refuses months that are complete. December 2025 carried a $100.00 DED line on a revenue
 * account and January did not, so January would be withheld for want of a hundred dollars; DEDV,
 * MISC and SETV come and go the same way, so March would be withheld too. The leading module keeps
 * what made (a) the recommendation — derived from the ledger, no constant, follows the carrier if it
 * ever bills through another module — and it cannot be tripped by a module that carried a few
 * dollars once. It also judges expense, which answers the objection Q10 raised against option (b):
 * a month that lost its expenses would otherwise report a margin that is far too good.
 *
 * The first month the read reaches has nothing before it to be judged against, so only the date
 * test applies to it. Callers therefore read the whole staged history rather than the report's
 * window, so January is judged against December rather than against nothing.
 *
 * Pure. No clock, no I/O, and no constant that is a month or a threshold.
 */

import { pnlSideOfType, type LedgerAccount, type LedgerTotalRow } from "./incomeStatement.js";

/** One month of staged ledger, with what decides whether it can be reported. */
export interface LedgerMonthInput {
  /** `YYYY-MM`. */
  month: string;
  /** McLeod's exclusive period upper bound, `YYYY-MM-DD` — 2026-09-01 for August. */
  periodEnd: string;
  /** The newest `swept_at` over the month's rows, or null when no sweep has landed any. */
  sweptAt: string | null;
  /** The month's staged rows. Only their module, account and amount are read. */
  rows: LedgerTotalRow[];
}

export interface LedgerMonth {
  month: string;
  periodEnd: string;
  sweptAt: string | null;
  /** True when the newest sweep ran after the month was over AND the month carries its leading modules. */
  complete: boolean;
  /**
   * How the month is short. `absent` — no sweep has staged a single row. `partial` — a sweep
   * staged rows while the month was still running, so what is there is real and is not all of it.
   * `unposted` — the sweep ran after the month ended, but the month does not carry the module that
   * earned, or the one that spent, the most in the last complete month before it (Q10). Null when
   * the month is complete.
   */
  shortfall: "absent" | "partial" | "unposted" | null;
  /** The leading modules the month does not carry yet, sorted. Empty unless `unposted`. */
  missingModules: string[];
}

/** The day part of a timestamp, which is all the comparison against a period bound may use. */
const day = (stamp: string): string => stamp.slice(0, 10);

/**
 * The module that carried the most revenue and the one that carried the most expense, by the
 * statement's own signs (revenue flipped to positive). Null for a side the month has none of.
 */
function leadingModules(rows: LedgerTotalRow[], typeOf: (glid: string) => string | null | undefined) {
  const totals = { revenue: new Map<string, number>(), expense: new Map<string, number>() };
  for (const r of rows) {
    const side = pnlSideOfType(typeOf(r.glid.trim()));
    if (!side) continue;
    const signed = side === "revenue" ? -r.net_amount : r.net_amount;
    const mod = r.post_module.trim();
    totals[side].set(mod, (totals[side].get(mod) ?? 0) + signed);
  }
  const top = (m: Map<string, number>) => {
    let best: string | null = null;
    for (const [mod, amt] of m) if (amt > 0 && (best === null || amt > m.get(best)!)) best = mod;
    return best;
  };
  return [top(totals.revenue), top(totals.expense)].filter((m): m is string => m !== null);
}

export function assessLedgerMonths(months: LedgerMonthInput[], accounts: LedgerAccount[]): LedgerMonth[] {
  const typeByGlid = new Map(accounts.map((a) => [a.glid.trim(), a.type_id?.trim() ?? null]));
  const typeOf = (glid: string) => typeByGlid.get(glid);
  // Oldest first, because a month is judged against the complete month BEFORE it. The answer is
  // returned in the caller's order.
  const ordered = [...months].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
  // Empty until the first complete month: a month with nothing before it is judged on its date.
  let expected: string[] = [];
  const verdicts = new Map<string, LedgerMonth>();
  for (const m of ordered) {
    const base = { month: m.month, periodEnd: m.periodEnd, sweptAt: m.sweptAt };
    if (!m.sweptAt) {
      verdicts.set(m.month, { ...base, complete: false, shortfall: "absent", missingModules: [] });
      continue;
    }
    // Strictly after the exclusive period end: a sweep dated 2026-09-01 for August ran at some
    // point on the 1st, which is the previous evening in every US timezone.
    if (!(day(m.sweptAt) > m.periodEnd)) {
      verdicts.set(m.month, { ...base, complete: false, shortfall: "partial", missingModules: [] });
      continue;
    }
    // "Carries" means the module posted to the same side of the statement, not merely a line
    // anywhere: a BILL line on a balance-sheet account is not a month's billing.
    const carried = new Set<string>();
    for (const r of m.rows) {
      if (pnlSideOfType(typeOf(r.glid.trim()))) carried.add(r.post_module.trim());
    }
    const missingModules = [...new Set(expected)].filter((x) => !carried.has(x)).sort();
    if (missingModules.length) {
      // An unposted month does not set the bar for the month after it: the month after is judged
      // against the last month that was complete.
      verdicts.set(m.month, { ...base, complete: false, shortfall: "unposted", missingModules });
      continue;
    }
    expected = leadingModules(m.rows, typeOf);
    verdicts.set(m.month, { ...base, complete: true, shortfall: null, missingModules: [] });
  }
  return months.map((m) => verdicts.get(m.month)!);
}

/**
 * Why one month is withheld, as a clause that completes "2026-09 …". One wording, shared by the
 * statement, the overview, the chart and the page's opening note, so the four never describe the
 * same month two ways.
 */
export function ledgerMonthWhy(m: LedgerMonth): string {
  if (m.shortfall === "unposted") {
    return `has not been fully posted in McLeod yet (no ${m.missingModules.join(", ")} lines)`;
  }
  if (m.shortfall === "partial") {
    return `was swept on ${m.sweptAt ? day(m.sweptAt) : "an unknown day"}, before the month ended`;
  }
  return "has not been swept from McLeod yet";
}

/**
 * What the page prints instead of the figures, for the months it cannot report.
 *
 * Written for a reader rather than a log, and it names the months: "some months are incomplete"
 * sends a reader looking for which. The two shortfalls get two sentences because they are two
 * different situations and the fix for each is different — one waits for a sweep, the other waits
 * for a re-sweep after month end.
 */
export function ledgerMonthsReason(months: LedgerMonth[]): string | null {
  const partial = months.filter((m) => m.shortfall === "partial");
  const absent = months.filter((m) => m.shortfall === "absent");
  const unposted = months.filter((m) => m.shortfall === "unposted");
  const sentences: string[] = [];
  if (partial.length) {
    const named = partial.map((m) => `${m.month} (swept ${day(m.sweptAt!)})`).join(", ");
    sentences.push(
      `${named} ${partial.length === 1 ? "was" : "were"} swept before the month ended, so only part of the ledger is here — those figures are left out rather than reported short.`,
    );
  }
  for (const m of unposted) {
    sentences.push(
      `${m.month} ${ledgerMonthWhy(m)} — McLeod's accountant posts a month some days after it ends, so it is left out rather than reported short.`,
    );
  }
  if (absent.length) {
    sentences.push(
      `The McLeod sweep has not reached ${absent.map((m) => m.month).join(", ")} at all.`,
    );
  }
  return sentences.length ? sentences.join(" ") : null;
}
