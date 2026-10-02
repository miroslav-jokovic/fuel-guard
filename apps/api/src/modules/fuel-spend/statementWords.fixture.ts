/**
 * A miniature Pilot weekly statement in the REAL geometry of db139445F.pdf (invoice 795506105), shared
 * by the two server paths that re-parse one: the statement ingest and the reconciliation run.
 */
import type { StatementWord } from "@silvicom/shared";

// ── a miniature statement in the REAL geometry of db139445F.pdf (invoice 795506105) ──────────────
export const X = { card: 19, unit: 79, loc: 95, city: 116, state: 167, ticket: 177, auth: 221, po: 264,
  date: 337, odo: 365, prod: 414, units: 448, cost: 471, amount: 511, invoice: 706, retail: 748 };
const HEADER_X = [24, 61, 97, 115, 156, 184, 227, 283, 339, 370, 409, 437, 472, 503, 543, 566, 600, 641, 674, 704, 744];
const HEADER_T = ["Number", "Number", "Loc.", "City", "State", "Number", "Number", "Number", "Date", "Reading",
  "Prod", "Units", "Cost", "Amount", "Qts", "Amount", "Advance", "Disc.", "Tax", "Total", "Total"];
export const w = (text: string, x: number, y: number, page = 1): StatementWord => ({ text, x, y, page });

/** Two tractor fills and one reefer line; totals below are their exact arithmetic. */
export function statementWords(): StatementWord[] {
  const line = (y: number, c: string[], prod: string, units: string, cost: string, amt: string, ret: string) => [
    w(c[0]!, X.card, y), w(c[1]!, X.unit, y), w(c[2]!, X.loc, y), w(c[3]!, X.city, y), w(c[4]!, X.state, y),
    w("051033249", X.ticket, y), w("367611", X.auth, y), w("HENRY SMITH", X.po, y),
    w("08/17", X.date, y), w("335019", X.odo, y), w(prod, X.prod, y), w(units, X.units, y),
    w(cost, X.cost, y), w(amt, X.amount, y), w(amt, X.invoice, y), w(ret, X.retail, y),
  ];
  return [
    w("Acct", 22, 20), w("No:", 44, 20), w("139445", 83, 20),
    w("Invoice", 24, 30), w("Number:", 58, 30), w("795506105", 99, 30),
    w("For", 287, 30), w("Period", 305, 30), w("Beginning", 337, 30), w("08/17/26,", 384, 30),
    w("Ending", 428, 30), w("08/23/26", 462, 30),
    w("Billing", 579, 20), w("Date:", 609, 20), w("08/24/26", 636, 20),
    ...HEADER_T.map((t, i) => w(t, HEADER_X[i]!, 133)),
    ...line(150, ["957562", "684", "041", "Mt", "KY"], "020", "168.6", "4.9442", "833.39", "977.50"),
    ...line(161, ["987568", "648", "1057", "Pasadena", "TX"], "020", "100.0", "5.0000", "500.00", "560.00"),
    ...line(172, ["327974", "699", "037", "Whiteland", "IN"], "033", "30.6", "5.2865", "161.93", "180.70"),
    // printed totals: units 299.2, fuel 1495.32, retail 1718.20, savings 1718.20 − 1495.32 = 222.88
    w("268.6", 432, 300), w("1,333.39", 495, 300), w("020", 96, 302), w("Customer", 117, 302), w("Total", 154, 302),
    w("30.6", 443, 313), w("161.93", 504, 313), w("033", 96, 315), w("Customer", 117, 315), w("Total", 154, 315),
    w("**", 94, 340), w("Customer", 102, 340), w("Total", 139, 340),
    w("299.2", 433, 340), w("1,495.32", 496, 340), w(".00", 622, 340), w(".00", 679, 340), w("1,718.20", 734, 340),
    w("Savings", 94, 372), w("Total", 124, 372), w("222.88", 500, 372),
    w("020", 620, 400), w("Truck", 640, 400), w("Diesel", 665, 400),
    w("033", 620, 411), w("Reefer", 640, 411),
  ];
}

