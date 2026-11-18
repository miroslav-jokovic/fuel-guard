/**
 * New Jersey E-ZPass monthly account statement → lines (TOLLS-PER-TRUCK-PLAN TL5, Q-TL2: the fleet's
 * one E-ZPass account is issued by the NJ service centre). Pure.
 *
 * ── THE LAYOUT (measured on five statements, 04/27/26 → 09/26/26, 197 pages) ─────────────────────
 * Every transaction page carries the same header (`DATE DATE /PLATE AGENCY PLAZA DATE TIME PLAZA DATE
 * TIME PLAN CL AMOUNT BALANCE`) at the same x, so columns are fixed bands, confirmed by that header —
 * the Pilot-statement method. One printed line per charge:
 *
 *   posting date · transaction date · tag (11 digits) or plate (`ILP1313152`) or the words of a
 *   non-toll line · agency · entry plaza/date/time (closed-road tolls only) · exit plaza/date/time ·
 *   plan · class · amount · running balance
 *
 * ── WHY EVERY LINE IS HELD TO THE RUNNING BALANCE ────────────────────────────────────────────────
 * The amount is printed unsigned except on a toll credit (`-$9.67`), and a `Prepaid Payment` raises the
 * balance while an `Adjustment` may lower it. The balance column is the provider's own arithmetic on
 * every single line: previous balance − this line = this balance, from "Beginning Balance" to
 * "Ending Balance". So the sign is READ from that step, and a line that is misread, merged or skipped
 * breaks the chain at that line — far stronger than a grand total, which a misclassified line still
 * satisfies (review 2026-11-18, item 9). The summary's "Tolls, Non-Tolls and Fees" and "Payments and
 * Credits" are then tied as well.
 */
import type { StatementWord } from "../../reconcile/pilotStatement.js";
import {
  band, blankLine, cents, clock, groupRows, isMoney, joined, requireTies, rowText, usDate,
  TollStatementReadError, type Row, type TollLineKind, type TollStatementLine, type TollStatementRead,
} from "./tollStatementRead.js";

const HEADER = ["DATE", "DATE", "/PLATE", "AGENCY", "PLAZA", "DATE", "TIME", "PLAZA", "DATE", "TIME", "PLAN", "CL", "AMOUNT", "BALANCE"];

/** Left edges of each column's VALUES, measured on the five statements (header `DATE` sits at x≈50). */
const COL = {
  posted: [40, 85], transacted: [85, 118], id: [118, 205], agency: [205, 236], entryPlaza: [236, 255],
  entryDate: [255, 284], entryTime: [284, 305], exitPlaza: [305, 328], exitDate: [328, 358],
  exitTime: [358, 388], plan: [388, 438], cls: [438, 468], amount: [468, 525], balance: [525, 640],
} as const satisfies Record<string, readonly [number, number]>;

/** The non-toll lines the statements print, by their words. Anything else is refused, not guessed. */
const NON_TOLL: Record<string, TollLineKind> = {
  "Prepaid Payment": "account_payment",
  "Service Fee": "service_fee",
  "Tagsale Tagint": "tag_purchase",
  Adjustment: "adjustment",
};

const TAG = /^\d{11}$/;
const PLATE = /^([A-Z]{2})([A-Z0-9]{2,10})$/;

const amountWord = (c: number) => `$${(c / 100).toFixed(2)}`;

const col = (r: Row, c: keyof typeof COL) => band(r, COL[c][0], COL[c][1]);

function summaryAmount(rows: readonly Row[], label: string): number {
  for (const r of rows) {
    const t = rowText(r).join(" ");
    const m = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(-?\\$[\\d,]+\\.\\d\\d)`).exec(t);
    if (m) return cents(m[1]!);
  }
  throw new TollStatementReadError(`This E-ZPass statement has no "${label}" line, so it cannot be checked. Upload the full statement.`);
}

function readLine(r: Row, index: number): { line: TollStatementLine; printedCents: number; balanceCents: number } {
  const amount = col(r, "amount");
  const balance = col(r, "balance");
  if (amount.length !== 1 || balance.length !== 1 || !isMoney(amount[0]) || !isMoney(balance[0])) {
    throw new TollStatementReadError(`An E-ZPass line on page ${r.page} has no readable amount and balance: "${rowText(r).join(" ")}".`);
  }
  const printedCents = cents(amount[0]);
  const line = blankLine("toll", printedCents, r.page, index);
  line.postedOn = usDate(col(r, "posted")[0]);
  line.balanceCents = cents(balance[0]);
  const id = col(r, "id");
  const only = id.length === 1 ? id[0]! : null;
  const plate = only && !TAG.test(only) ? PLATE.exec(only) : null;
  if (only && TAG.test(only)) line.tagNumber = only;
  else if (plate) [line.plateState, line.plate] = [plate[1]!, plate[2]!];
  else {
    const words = id.join(" ");
    const kind = NON_TOLL[words];
    if (!kind) {
      throw new TollStatementReadError(
        `An E-ZPass line on page ${r.page} is neither a tag, a plate nor a kind of charge we know: "${words}". Nothing was taken from this statement; send it to support so the line can be named.`,
      );
    }
    line.kind = kind;
    line.label = words;
    return { line, printedCents, balanceCents: line.balanceCents };
  }
  line.agency = joined(col(r, "agency"));
  line.entryPlaza = joined(col(r, "entryPlaza"));
  const entryDate = usDate(col(r, "entryDate")[0]);
  const entryTime = clock(col(r, "entryTime")[0]);
  line.entryAt = entryDate && entryTime ? `${entryDate}T${entryTime}` : null;
  line.exitPlaza = joined(col(r, "exitPlaza"));
  const exitDate = usDate(col(r, "exitDate")[0]);
  const exitTime = clock(col(r, "exitTime")[0]);
  if (!exitDate || !exitTime || !line.agency) {
    throw new TollStatementReadError(`An E-ZPass toll on page ${r.page} has no agency or exit date and time: "${rowText(r).join(" ")}".`);
  }
  line.exitAt = `${exitDate}T${exitTime}`;
  line.rate = joined(col(r, "plan"));
  line.vehicleClass = joined(col(r, "cls"));
  return { line, printedCents, balanceCents: line.balanceCents };
}

export function readEzpassNjStatement(words: readonly StatementWord[]): TollStatementRead {
  const rows = groupRows(words);
  const all = rows.map((r) => rowText(r).join(" "));
  if (!rows.some((r) => rowText(r).join(" ") === HEADER.join(" "))) {
    throw new TollStatementReadError(
      "This does not look like a New Jersey E-ZPass statement: its transaction header was not found. Check the provider chosen for this file.",
    );
  }
  const period = all.map((t) => /Statement Period: (\d\d\/\d\d\/\d\d) - (\d\d\/\d\d\/\d\d)/.exec(t)).find(Boolean);
  const account = all.map((t) => /Account #: ([\d ]+\d)/.exec(t)).find(Boolean);
  if (!period || !account) throw new TollStatementReadError("This E-ZPass statement has no account number or statement period on its first page.");

  const beginning = summaryAmount(rows, "Beginning Balance");
  const ending = summaryAmount(rows, "Ending Balance");
  const charges = summaryAmount(rows, "Tolls, Non-Tolls and Fees");
  const payments = summaryAmount(rows, "Payments and Credits");

  const lines: TollStatementLine[] = [];
  let previous = beginning;
  let brokenAt: string | null = null;
  for (const r of rows) {
    const first = r.words[0];
    if (!first || first.x >= COL.posted[1] || !usDate(first.text) || !usDate(col(r, "transacted")[0])) continue;
    const { line, printedCents, balanceCents } = readLine(r, lines.length);
    const step = previous - balanceCents; // positive = the balance went down = a charge
    // A `Tagsale Tagint` line is a memo: the balance does not move on it, and the `Adjustment` printed
    // next, for the same amount, is what charges the account (all three statements that carry one,
    // 06/29, 08/11 and 09/21). So a non-toll line may leave the balance where it was and is then kept
    // at $0.00 with its printed amount in its label; a toll never may.
    const memo = line.kind !== "toll" && step === 0;
    if (memo) line.label = `${line.label} ${amountWord(printedCents)} (memo, balance unchanged)`;
    const signAgrees = line.kind === "toll" ? step === printedCents : memo || Math.abs(step) === Math.abs(printedCents);
    if (!signAgrees && brokenAt == null) {
      brokenAt = `line ${lines.length + 1} (page ${r.page}): balance went from ${previous / 100} to ${balanceCents / 100} but the line reads ${printedCents / 100}`;
    }
    line.amountCents = step;
    previous = balanceCents;
    lines.push(line);
  }
  if (brokenAt) {
    throw new TollStatementReadError(`This E-ZPass statement's running balance does not follow its lines at ${brokenAt}. Nothing was taken from it.`);
  }
  // Which summary bucket a line counts in is the provider's call, read off its own totals: on all three
  // statements carrying an `Adjustment`, "Payments and Credits" is the top-ups LESS the adjustment and
  // "Tolls, Non-Tolls and Fees" leaves it out (06/27–07/26: $27,000.00 − $90.00 = $26,910.00 printed).
  const inPayments = (k: TollLineKind) => k === "account_payment" || k === "adjustment";
  const readPayments = -lines.filter((l) => inPayments(l.kind)).reduce((s, l) => s + l.amountCents, 0);
  const readCharges = lines.filter((l) => !inPayments(l.kind)).reduce((s, l) => s + l.amountCents, 0);
  const ties = [
    { label: "Ending Balance", printedCents: ending, readCents: previous },
    { label: "Tolls, Non-Tolls and Fees", printedCents: charges, readCents: readCharges },
    { label: "Payments and Credits", printedCents: payments, readCents: readPayments },
  ];
  requireTies("E-ZPass", ties);
  return {
    provider: "ezpass",
    account: account[1]!.replace(/\s/g, ""),
    periodStart: usDate(period[1])!,
    periodEnd: usDate(period[2])!,
    printedChargesCents: charges,
    lines,
    ties,
  };
}
