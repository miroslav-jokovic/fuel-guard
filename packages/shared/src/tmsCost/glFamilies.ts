import { type IncomeStatement } from "./incomeStatement.js";
import { perMileRate } from "./fleetReport.js";

/**
 * The family map (G6) — ninety-four rows of income statement read as ten rows of answer.
 *
 * **Why this exists.** The income statement reproduces McLeod's printed P&L line for line, which is
 * what makes it trustworthy and what stops it being useful: it cannot tell a boss that fuel is 22%
 * of revenue. That question is answered by grouping, and grouping is the one thing in this section
 * that cannot be derived.
 *
 * **Why it cannot be derived, measured on production 2026-09-03.** McLeod's own class is a
 * bookkeeping decision, not a management one: `40230000 IRP` — $317,971.96 year to date, the states'
 * charge for plating the fleet — is filed under `General & Admin Expenses` beside rent and salaries,
 * and `40790002 Tolls OO` is filed under `Income Tax Expense`. The account NAME cannot carry it
 * either: McLeod truncates `gl_account.descr` to 28 characters at source, so three distinct revenue
 * accounts all read "Gross Trucking Income" and two expense accounts read "Subcontracted Labor:
 * Bonus". Neither the class nor the name is a grouping. Only a person is.
 *
 * **So this map is signed, not computed.** The owner reviewed all 100 accounts that posted between
 * 2026-01-01 and 2026-07-31 and ruled on 2026-09-03, including five calls the data could not make:
 * contractors get their own family; IRP joins IFTA and the permits despite its class; recruiting
 * stands alone; quick pay, bank charges and bad debt become one "financing and collection" family;
 * and unloading fees ride with tolls and scales, because they are charged per load at a dock as a
 * toll is charged per trip on a road. `docs/plans/financial/FINANCE-FLEET-REPORT-PLAN.md` carries
 * the map, the figures behind each family and that ruling.
 *
 * **What happens to an account nobody has ruled on.** It appears, in its own named family, and its
 * dollars are counted. It is not folded into the nearest plausible group and it is not dropped —
 * the same doctrine `buildIncomeStatement` applies to an unrecognised account class, for the same
 * reason: a map that silently absorbs the next account the bookkeeper invents is a map that stops
 * being true without ever saying so. The tie-out is what proves it: the families sum to the
 * statement's own totals on both sides, and the harness reports the difference rather than
 * asserting it is zero.
 *
 * Pure. No clock, no I/O. The dollar figures in the comments above are measurements quoted from the
 * plan; nothing in the code below is one.
 */

/** One signed family: what it is called, which side of the statement it is on, and what is in it. */
export interface GlFamily {
  key: string;
  label: string;
  /** True for the income families — they add to the top line rather than subtracting from it. */
  isRevenue: boolean;
  /** McLeod account codes. A code appears in exactly one family; `glFamilies.test.ts` pins that. */
  glids: string[];
}

/**
 * The signed map, 2026-09-03. Ten families of expense and four of income.
 *
 * Order here is the order they were ruled on and has no meaning in the output — the summary ranks
 * families by what they cost, because "where does the money go" is the question it answers.
 */
export const GL_FAMILIES: GlFamily[] = [
  {
    key: "revenue_freight",
    label: "Freight and fuel surcharge",
    isRevenue: true,
    glids: [
    "30000000", "30000001", "30000002", "30000031", "30000032",
    ],
  },
  {
    key: "revenue_contractor",
    label: "Charged to contractors",
    isRevenue: true,
    glids: [
    "30080000", "30100010", "40100000",
    ],
  },
  {
    key: "revenue_accessorial",
    label: "Detention and accessorial",
    isRevenue: true,
    glids: [
    "30000010", "30000011", "30000012", "30100000", "30100030",
    ],
  },
  {
    key: "revenue_other",
    label: "Gain and loss on sale",
    isRevenue: true,
    glids: [
    "30050000",
    ],
  },
  {
    key: "fuel",
    label: "Fuel and fluids",
    isRevenue: false,
    glids: [
    "40050000", "30220000", "30340000", "30210000",
    ],
  },
  {
    key: "driver_pay",
    label: "Company driver pay",
    isRevenue: false,
    glids: [
    "40000001", "40000000", "40000031", "40000032", "40800000",
    ],
  },
  {
    key: "contractor_pay",
    label: "Contractor pay",
    isRevenue: false,
    glids: [
    "40000002",
    ],
  },
  {
    key: "truck_fixed",
    label: "Lease, insurance and interest",
    isRevenue: false,
    glids: [
    "40140000", "40350000", "40350040", "40350070", "40350060", "40350020",
    "40550000", "40500000",
    ],
  },
  {
    key: "maintenance",
    label: "Maintenance and tires",
    isRevenue: false,
    glids: [
    "40160000", "30240000", "30230000", "30350000", "30250000", "30300000",
    "30270000", "30260000", "30290000", "40150000", "30320000", "30310000",
    "30330000", "30380000", "40780000",
    ],
  },
  {
    key: "road_charges",
    label: "Tolls, scales and unloading",
    isRevenue: false,
    glids: [
    "40790000", "40760000", "40790002", "40700000",
    ],
  },
  {
    key: "jurisdictional",
    label: "Permits, IFTA and IRP",
    isRevenue: false,
    glids: [
    "40310000", "40230000", "40210000", "40190000", "40170000", "40240000",
    "40260000", "40270000", "40290000", "40320000", "40200000", "40220000",
    ],
  },
  {
    key: "recruiting",
    label: "Recruiting and screening",
    isRevenue: false,
    glids: [
    "40400000", "40420000", "40410000", "47750000", "42000000", "43220000",
    "43250000",
    ],
  },
  {
    key: "financing",
    label: "Financing and collection",
    isRevenue: false,
    glids: [
    "40650000", "42500000", "42500001", "40750000", "50000000", "12100000",
    ],
  },
  {
    key: "office",
    label: "Office and administration",
    isRevenue: false,
    glids: [
    "42350000", "42200000", "42300000", "42100000", "42200010", "43200000",
    "47000000", "42600020", "43300000", "43000000", "47500000", "42800000",
    "42400000", "42600030", "42700000", "42600000", "47250000", "40810000",
    "40820000", "42600010", "46000000", "42900000", "43230000", "40250000",
    ],
  },
];

/** The family a line falls in when the signed map does not name its account. Never absorbed. */
export const UNASSIGNED_FAMILY = "Not yet grouped";

export interface FamilyRow {
  key: string;
  label: string;
  isRevenue: boolean;
  /** True for the catch-all above — a signal that the map needs a line, not a rounding bucket. */
  isUnassigned: boolean;
  amount: number;
  toDateAmount: number | null;
  /** Share of the period's revenue. Null when the period booked none to divide by (D-FIN10). */
  pctOfRevenue: number | null;
  toDatePctOfRevenue: number | null;
  /** Dollars per measured mile, or null when the period's mileage cannot support a rate (G10). */
  perMile: number | null;
  /** How many accounts posted into this family in the period — not how many the map names. */
  accounts: number;
}

export interface FamilySummary {
  /** Income families, largest first. */
  revenue: FamilyRow[];
  /** Expense families, largest first, with anything ungrouped last whatever its size. */
  expense: FamilyRow[];
  /**
   * Families against the statement's own totals. Zero unless an account was mapped to the wrong
   * side of the statement, which is the one error this construction cannot absorb silently.
   */
  tieOut: { revenue: number; expenses: number };
}

const round = (n: number) => Math.round(n * 100) / 100 + 0;
const share = (part: number, whole: number | null): number | null =>
  whole == null || whole === 0 ? null : Math.round((part / whole) * 1000) / 10;

/**
 * Group a statement into its families.
 *
 * The SIDE of a line is the statement's, never the map's: a line inside a revenue section counts as
 * revenue even if the map filed its account under an expense family, and it lands in the ungrouped
 * family rather than in a column it does not belong to. That rule is what keeps the tie-out
 * meaningful — a mis-signed map shows up as a visible ungrouped row instead of quietly moving
 * dollars across the statement.
 *
 * `miles` is the period's measured denominator, or null when mileage coverage could not support one.
 * It is passed in rather than derived because this file knows nothing about trucks.
 */
export function buildFamilySummary(statement: IncomeStatement, miles: number | null): FamilySummary {
  const byGlid = new Map<string, GlFamily>();
  for (const family of GL_FAMILIES) for (const glid of family.glids) byGlid.set(glid, family);

  interface Bucket {
    key: string;
    label: string;
    isRevenue: boolean;
    isUnassigned: boolean;
    amount: number;
    toDateAmount: number;
    hasToDate: boolean;
    accounts: number;
  }
  const buckets = new Map<string, Bucket>();
  const put = (family: GlFamily | null, isRevenue: boolean, amount: number, toDate: number | null) => {
    const key = family ? family.key : `unassigned_${isRevenue ? "revenue" : "expense"}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        key,
        label: family ? family.label : UNASSIGNED_FAMILY,
        isRevenue,
        isUnassigned: !family,
        amount: 0,
        toDateAmount: 0,
        hasToDate: false,
        accounts: 0,
      };
      buckets.set(key, b);
    }
    b.amount = round(b.amount + amount);
    if (toDate != null) {
      b.toDateAmount = round(b.toDateAmount + toDate);
      b.hasToDate = true;
    }
    b.accounts++;
  };

  for (const section of statement.sections) {
    // An unrecognised class is counted into neither statement total, so counting it into a family
    // would make the families disagree with the totals they are a summary OF.
    if (section.isUnrecognised) continue;
    for (const line of section.lines) {
      const mapped = byGlid.get(line.glid.trim()) ?? null;
      const family = mapped && mapped.isRevenue === section.isRevenue ? mapped : null;
      put(family, section.isRevenue, line.amount, line.toDateAmount);
    }
  }

  const toRow = (b: Bucket): FamilyRow => ({
    key: b.key,
    label: b.label,
    isRevenue: b.isRevenue,
    isUnassigned: b.isUnassigned,
    amount: b.amount,
    toDateAmount: b.hasToDate ? b.toDateAmount : null,
    pctOfRevenue: share(b.amount, statement.revenue),
    toDatePctOfRevenue: b.hasToDate ? share(b.toDateAmount, statement.toDateRevenue) : null,
    perMile: perMileRate(b.amount, miles),
    accounts: b.accounts,
  });

  // Largest first, because the summary answers "where does the money go" — but anything ungrouped
  // sorts last regardless of size, so it reads as an exception rather than as a family.
  const rank = (rows: FamilyRow[]) =>
    rows.sort((a, b) =>
      a.isUnassigned !== b.isUnassigned ? (a.isUnassigned ? 1 : -1) : b.amount - a.amount,
    );

  const rows = [...buckets.values()].map(toRow);
  const revenue = rank(rows.filter((r) => r.isRevenue));
  const expense = rank(rows.filter((r) => !r.isRevenue));
  const sum = (list: FamilyRow[]) => round(list.reduce((n, r) => n + r.amount, 0));
  return {
    revenue,
    expense,
    tieOut: {
      revenue: round(statement.revenue - sum(revenue)),
      expenses: round(statement.expenses - sum(expense)),
    },
  };
}
