import { PNL_REVENUE_TYPES, PNL_EXPENSE_TYPES } from "./ledgerControl.js";

/**
 * The general ledger as an income statement — the shape the carrier's own bosses already read.
 *
 * **Why this exists at all.** The owner's monthly P&L is printed out of McLeod and reviewed line by
 * line; the finance section that cannot reproduce it is a second set of books, and a second set of
 * books is worse than none. Measured 2026-09-03 against `PROFIT LOSS JULY 2026.pdf`: the staged
 * ledger reproduces the printed statement to the cent for July (revenue 4,828,189.24, expenses
 * 4,058,143.38, net 770,045.86) and for the fiscal year to date on 94 expense rows and 13 revenue
 * rows. This module is what turns those rows back into the page the owner recognises.
 *
 * **Pure by contract (D-FLEET9, FINANCE-FLEET-REPORT-PLAN §2.5).** No clock, no I/O, no constant
 * that is a dollar, a month or a rate. Feed it the staged rows and the account master; get the
 * statement. Every figure the page prints comes out of here, so a figure that is wrong is wrong in
 * one testable place.
 *
 * **Three properties that are decisions, not implementation details:**
 *
 *  · **Order is McLeod's, and it is `type_id` then `glid` — never the description.** Verified
 *    against the July PDF: 30210000 Additives → 30220000 DEF → 30230000 Shop Parts → 30240000 OTR
 *    Repairs over $1000 → 30250000 OTR Repairs under $1000, line for line. And the description
 *    CANNOT be the key: McLeod truncates `gl_account.descr` at 28 characters at source, so three
 *    distinct revenue accounts all read "Gross Trucking Income" and two expense accounts read
 *    "Subcontracted Labor: Bonus". Every row therefore carries its account code.
 *
 *  · **Nothing falls through.** `glIncome.ts` classifies against the revenue set and the expense
 *    set and drops anything matching neither — including `type_id` values that ARE income-statement
 *    classes but are absent from those two lists ("Other Revenue and Gains", "Other Expenses and
 *    Losses"; four such accounts are staged and none has posted yet). Silently losing a dollar
 *    because its class was not enumerated is the failure this file refuses: an unrecognised class
 *    becomes its own visible section and its total is stated, never absorbed.
 *
 *  · **Sign is the ledger's own.** Revenue accounts post credits (negative nets) and expenses post
 *    debits (positive). The statement flips revenue once, here, so every figure it emits is
 *    positive-is-more-of-that-thing, and a genuine contra balance (July: Business Licenses
 *    −3,193.93, a refund) stays negative because it genuinely is.
 */

/** One staged `mcleod_gl_totals` row, at whatever period grain the caller read. */
export interface LedgerTotalRow {
  glid: string;
  post_module: string;
  net_amount: number;
  line_count: number;
}

/** One `mcleod_gl_accounts` row — McLeod's chart of accounts. */
export interface LedgerAccount {
  glid: string;
  descr: string | null;
  type_id: string | null;
}

export interface IncomeStatementInputs {
  /** Rows inside the period the statement is FOR. */
  period: LedgerTotalRow[];
  /**
   * Rows inside the wider to-date period (fiscal year to the end of `period`, normally). Omit for
   * a statement with no comparative column; pass the same rows to compare a period with itself.
   */
  toDate?: LedgerTotalRow[];
  accounts: LedgerAccount[];
}

/** The posting modules behind one account line, so a reader can drill from a total to its source. */
export interface AccountModule {
  post_module: string;
  amount: number;
  lines: number;
}

export interface IncomeStatementLine {
  glid: string;
  /** McLeod's own name, truncated to 28 chars at source and NOT unique — always shown with `glid`. */
  descr: string | null;
  amount: number;
  /** Share of the period's total revenue, in per cent. Null when the period booked no revenue. */
  pctOfRevenue: number | null;
  toDateAmount: number | null;
  toDatePctOfRevenue: number | null;
  modules: AccountModule[];
}

export interface IncomeStatementSection {
  /** McLeod's `type_id`, verbatim, or `null` for accounts whose class the master does not carry. */
  typeId: string | null;
  label: string;
  /** True when this section adds to the top line rather than subtracting from it. */
  isRevenue: boolean;
  /**
   * True when the class was not one this build recognises. Its dollars are shown and are NOT rolled
   * into revenue or expenses — the number is reported, the guess is not made.
   */
  isUnrecognised: boolean;
  lines: IncomeStatementLine[];
  total: number;
  toDateTotal: number | null;
}

export interface IncomeStatement {
  sections: IncomeStatementSection[];
  revenue: number;
  expenses: number;
  net: number;
  toDateRevenue: number | null;
  toDateExpenses: number | null;
  toDateNet: number | null;
  /**
   * Dollars in classes this build does not recognise, net. Nonzero means an account class appeared
   * that the section order below has never seen — a fact for the reader, not a rounding error to
   * absorb, and the signal that `SECTION_ORDER` needs a line.
   */
  unrecognisedNet: number;
}

const round = (n: number) => Math.round(n * 100) / 100 + 0;

/**
 * Section order, matching the printed statement's own sequence.
 *
 * The two "Other" classes sit between the operating sections and tax exactly as McLeod prints them,
 * and they are here despite having posted nothing in any staged month (four accounts: Driver Road
 * Expenses, Theft, State Tax, Payroll Tax Adj; one revenue account: Investment Gain/Loss). Listing
 * a class before it has dollars is how a class stops being able to arrive unnoticed.
 */
const SECTION_ORDER: string[] = [
  "Revenue",
  "Operating Expenses",
  "General & Admin Expenses",
  "Other Revenue and Gains",
  "Other Expenses and Losses",
  "Income Tax Expense",
];

const REVENUE_TYPES = new Set<string>([...PNL_REVENUE_TYPES, "Other Revenue and Gains"]);
const EXPENSE_TYPES = new Set<string>([...PNL_EXPENSE_TYPES, "Other Expenses and Losses"]);

/**
 * Balance-sheet classes, excluded from the statement entirely rather than reported as unrecognised.
 *
 * They are not an anomaly — a GL sweep returns them because a ledger holds them, and a driver
 * advance repaid or a loan drawn is neither revenue nor expense. Naming them here is what lets
 * `unrecognisedNet` mean "a class we have never seen" instead of "the balance sheet, as usual".
 */
const BALANCE_SHEET_TYPES = new Set<string>([
  "Current Assets",
  "Fixed Assets",
  "Other Assets",
  "Current Liabilities",
  "Long Term Liabilities",
  "Equity",
]);

interface Agg {
  amount: number;
  modules: Map<string, AccountModule>;
}

function aggregate(rows: LedgerTotalRow[], typeOf: (glid: string) => string | null | undefined) {
  const byAccount = new Map<string, Agg>();
  for (const r of rows) {
    const glid = r.glid.trim();
    const type = typeOf(glid);
    if (type != null && BALANCE_SHEET_TYPES.has(type)) continue;
    // Revenue is flipped ONCE, here, so every figure downstream reads positive-is-more.
    const signed = type != null && REVENUE_TYPES.has(type) ? -r.net_amount : r.net_amount;
    let a = byAccount.get(glid);
    if (!a) {
      a = { amount: 0, modules: new Map() };
      byAccount.set(glid, a);
    }
    a.amount = round(a.amount + signed);
    const mod = r.post_module.trim() || "—";
    const m = a.modules.get(mod);
    if (m) {
      m.amount = round(m.amount + signed);
      m.lines += r.line_count;
    } else {
      a.modules.set(mod, { post_module: mod, amount: round(signed), lines: r.line_count });
    }
  }
  return byAccount;
}

/**
 * Build the statement.
 *
 * `pctOfRevenue` divides by the period's own total revenue, which is what the printed statement
 * does — including for the to-date column, which divides by to-date revenue. A period with no
 * revenue yields `null` rather than 0 or Infinity (D-FIN10: an absent denominator is not a zero).
 */
export function buildIncomeStatement(inputs: IncomeStatementInputs): IncomeStatement {
  const typeByGlid = new Map<string, string | null>(
    inputs.accounts.map((a) => [a.glid.trim(), a.type_id?.trim() ?? null]),
  );
  const descrByGlid = new Map<string, string | null>(
    inputs.accounts.map((a) => [a.glid.trim(), a.descr]),
  );
  const typeOf = (glid: string) => typeByGlid.get(glid);

  const period = aggregate(inputs.period, typeOf);
  const toDate = inputs.toDate ? aggregate(inputs.toDate, typeOf) : null;

  // Every account either side of the comparison, so an account that posted only in the wider
  // period still shows its to-date figure instead of vanishing from the statement.
  const glids = new Set<string>([...period.keys(), ...(toDate ? toDate.keys() : [])]);

  const groups = new Map<string, string[]>();
  for (const glid of glids) {
    const key = typeByGlid.get(glid) ?? "";
    const list = groups.get(key);
    if (list) list.push(glid);
    else groups.set(key, [glid]);
  }

  let revenue = 0;
  let expenses = 0;
  let toDateRevenue = 0;
  let toDateExpenses = 0;
  let unrecognisedNet = 0;

  // Totals first: `pctOfRevenue` needs the revenue total before any line is built.
  for (const [type, list] of groups) {
    const isRevenue = REVENUE_TYPES.has(type);
    const isExpense = EXPENSE_TYPES.has(type);
    for (const glid of list) {
      const amt = period.get(glid)?.amount ?? 0;
      const td = toDate?.get(glid)?.amount ?? 0;
      if (isRevenue) {
        revenue = round(revenue + amt);
        toDateRevenue = round(toDateRevenue + td);
      } else if (isExpense) {
        expenses = round(expenses + amt);
        toDateExpenses = round(toDateExpenses + td);
      } else {
        unrecognisedNet = round(unrecognisedNet + amt);
      }
    }
  }

  const pct = (amount: number, base: number): number | null =>
    base === 0 ? null : Math.round((amount / base) * 1000) / 10;

  const sections: IncomeStatementSection[] = [];
  // Known classes in the printed order, then anything else, so a new class appears at the end
  // rather than silently reordering the statement a boss has learned to read.
  const seen = new Set<string>();
  const ordered = [
    ...SECTION_ORDER.filter((t) => groups.has(t)),
    ...[...groups.keys()].filter((t) => !SECTION_ORDER.includes(t)).sort(),
  ];

  for (const type of ordered) {
    if (seen.has(type)) continue;
    seen.add(type);
    const list = groups.get(type);
    if (!list) continue;
    const isRevenue = REVENUE_TYPES.has(type);
    const isUnrecognised = !isRevenue && !EXPENSE_TYPES.has(type);

    // Within a section, McLeod's own print order: ascending account code (verified against the
    // July 2026 statement, §1.4 of the plan).
    list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    let total = 0;
    let toDateTotal = 0;
    const lines: IncomeStatementLine[] = list.map((glid) => {
      const p = period.get(glid);
      const t = toDate?.get(glid);
      const amount = p?.amount ?? 0;
      const toDateAmount = toDate ? (t?.amount ?? 0) : null;
      total = round(total + amount);
      if (toDateAmount != null) toDateTotal = round(toDateTotal + toDateAmount);
      return {
        glid,
        descr: descrByGlid.get(glid) ?? null,
        amount,
        pctOfRevenue: pct(amount, revenue),
        toDateAmount,
        toDatePctOfRevenue: toDateAmount == null ? null : pct(toDateAmount, toDateRevenue),
        // Biggest first: a reader drilling into an account wants the module that moved the money.
        modules: [...(p?.modules.values() ?? [])].sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount)),
      };
    });

    sections.push({
      typeId: type === "" ? null : type,
      label: type === "" ? "Unclassified accounts" : type,
      isRevenue,
      isUnrecognised,
      lines,
      total,
      toDateTotal: toDate ? toDateTotal : null,
    });
  }

  return {
    sections,
    revenue,
    expenses,
    net: round(revenue - expenses),
    toDateRevenue: toDate ? toDateRevenue : null,
    toDateExpenses: toDate ? toDateExpenses : null,
    toDateNet: toDate ? round(toDateRevenue - toDateExpenses) : null,
    unrecognisedNet,
  };
}
