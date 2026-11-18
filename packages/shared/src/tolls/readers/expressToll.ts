/**
 * ExpressToll (Colorado, E-470) monthly statement → lines (TOLLS-PER-TRUCK-PLAN TL5). Pure.
 *
 * ── THE LAYOUT (measured on six statements, 04/28/26 → 10/27/26, 35 pages) ───────────────────────
 *
 *   Transactions For Device # 7553961   Plate # P1237090-IL
 *   7/28/2026 6:40:22 PM   CO NWP SHERIDAN   Lane 2 North   VTOLL P1237090   $16.50
 *                                                             Total:  $31.90
 *   …                                                   Grand Total:  $1541.25
 *
 * then a page of payments ("8/2/2026 PAYMENT CREDIT $494.30") and the Summary (Previous Balance,
 * Total Tolls, Payments, Ending Balance).
 *
 * ── WHY THE LINE'S PLATE, NOT THE GROUP'S (§1.3) ─────────────────────────────────────────────────
 * Nearly every charge is a camera toll (`VTOLL`, `IOPVTOLL`): the plate the camera read is printed on
 * the line, after the status. On 118 of 831 lines that plate is NOT the plate in the device heading
 * the line is filed under — E-470 bills an account's video tolls under whichever of its devices, and a
 * trailer's `…ST` plate turns up under a truck's device. The line's plate is what drove the road; the
 * heading is filing. So `plate` is the line's, `device` keeps the heading, and only a transponder read
 * (`AVITOLL`, `IOPAVITOLL`) is identified by the device.
 *
 * ── WHAT IT IS HELD TO ───────────────────────────────────────────────────────────────────────────
 * Every device "Total:", the "Grand Total", the Summary's "Total Tolls", and the balance equation
 * Previous − Total Tolls + Payments = Ending, with the payments read line by line. An adjustment line
 * is refused: none of the six statements carries one ("N/A"), and its sign cannot be read from them.
 */
import type { StatementWord } from "../../reconcile/pilotStatement.js";
import {
  band, blankLine, cents, clock, groupRows, isMoney, joined, requireTies, rowText, usDate,
  TollStatementReadError, type Row, type TollStatementLine, type TollStatementRead, type TollStatementTie,
} from "./tollStatementRead.js";

const HEADER = "Transaction Date/Time Location Lane Toll Status* Amount";

/** Column bands, measured: header words at x 47, 169, 350, 412, 531; amounts right-aligned near 545. */
const COL = {
  when: [40, 165], location: [165, 348], lane: [348, 410], status: [410, 520], amount: [520, 620],
} as const satisfies Record<string, readonly [number, number]>;

/** The statement's own legend. A status outside it is refused rather than guessed. */
const TRANSPONDER = new Set(["AVITOLL", "IOPAVITOLL"]);
const STATUSES = new Set([...TRANSPONDER, "VTOLL", "IOPVTOLL", "MVTOLL"]);

const col = (r: Row, c: keyof typeof COL) => band(r, COL[c][0], COL[c][1]);

function summary(rows: readonly Row[], label: string): number | null {
  for (const r of rows) {
    const t = rowText(r);
    for (let i = 0; i + 2 < t.length + 1; i++) {
      if (t.slice(i).join(" ").startsWith(`${label} :`)) {
        const money = t.slice(i).find(isMoney);
        if (money) return cents(money);
      }
    }
  }
  return null;
}

function readCharge(r: Row, device: { id: string; plate: string; state: string | null } | null, index: number): TollStatementLine {
  const t = rowText(r);
  const when = col(r, "when");
  const time = clock(when[1], when[2]);
  const amount = col(r, "amount");
  const [status, plate, ...rest] = col(r, "status");
  if (!time || amount.length !== 1 || !isMoney(amount[0]) || !status || !STATUSES.has(status) || rest.length > 0) {
    throw new TollStatementReadError(`An ExpressToll charge on page ${r.page} cannot be read as printed: "${t.join(" ")}".`);
  }
  if (!device) throw new TollStatementReadError(`An ExpressToll charge on page ${r.page} comes before any device heading.`);
  const line = blankLine("toll", cents(amount[0]), r.page, index);
  line.device = device.id;
  line.rate = status;
  if (TRANSPONDER.has(status)) {
    line.tagNumber = device.id;
  } else {
    if (!plate) throw new TollStatementReadError(`An ExpressToll camera toll on page ${r.page} names no plate: "${t.join(" ")}".`);
    line.plate = plate;
    line.plateState = plate === device.plate ? device.state : null;
  }
  line.location = joined(col(r, "location"));
  line.exitPlaza = line.location;
  line.lane = joined(col(r, "lane"));
  line.exitAt = `${usDate(when[0])}T${time}`;
  return line;
}

export function readExpressTollStatement(words: readonly StatementWord[]): TollStatementRead {
  const rows = groupRows(words);
  const text = rows.map((r) => rowText(r).join(" "));
  if (!text.includes(HEADER)) {
    throw new TollStatementReadError(
      "This does not look like an ExpressToll statement: its transaction header was not found. Check the provider chosen for this file.",
    );
  }
  const head = text.map((t) => /Posted between (\d{1,2}\/\d{1,2}\/\d{4}) and (\d{1,2}\/\d{1,2}\/\d{4}) Acct No : (\d+)/.exec(t)).find(Boolean);
  const previous = summary(rows, "Previous Balance");
  const totalTolls = summary(rows, "Total Tolls");
  const payments = summary(rows, "Payments");
  const ending = summary(rows, "Ending Balance");
  if (!head || previous == null || totalTolls == null || payments == null || ending == null) {
    throw new TollStatementReadError("This ExpressToll statement is missing its period, account or Summary (Previous Balance, Total Tolls, Payments, Ending Balance).");
  }

  const lines: TollStatementLine[] = [];
  const ties: TollStatementTie[] = [];
  let device: { id: string; plate: string; state: string | null } | null = null;
  let deviceSum = 0;
  let grand: number | null = null;
  let inAdjustments = false;
  for (const r of rows) {
    const t = rowText(r);
    if (t.slice(0, 4).join(" ") === "Transactions For Device #") {
      const m = /^([A-Z0-9]+?)(?:-([A-Z]{2}))?$/.exec(t[7] ?? "");
      device = { id: t[4] ?? "", plate: m?.[1] ?? "", state: m?.[2] ?? null };
      deviceSum = 0;
      continue;
    }
    if (t[0] === "Total:" && isMoney(t[1])) {
      ties.push({ label: `Total for device ${device?.id ?? "?"}`, printedCents: cents(t[1]), readCents: deviceSum });
      continue;
    }
    if (t[0] === "Grand" && t[1] === "Total:" && isMoney(t[2])) grand = cents(t[2]);
    if (t[0]?.startsWith("Adjustments/Charges")) inAdjustments = true;
    if (!usDate(t[0]) || r.words[0]!.x >= COL.when[0] + 15) continue;
    if (t[1] === "PAYMENT") {
      const money = t.slice(2).find(isMoney);
      if (!money) throw new TollStatementReadError(`An ExpressToll payment on page ${r.page} has no amount.`);
      const line = blankLine("account_payment", -cents(money), r.page, lines.length);
      line.postedOn = usDate(t[0]);
      line.label = t.slice(1, 3).join(" ");
      lines.push(line);
      continue;
    }
    if (inAdjustments) {
      throw new TollStatementReadError(
        `This ExpressToll statement has an adjustment on page ${r.page} ("${t.join(" ")}"), and none read so far had one, so its sign is not known. Nothing was taken from it; send it to support.`,
      );
    }
    const line = readCharge(r, device, lines.length);
    deviceSum += line.amountCents;
    lines.push(line);
  }
  if (grand == null) throw new TollStatementReadError("This ExpressToll statement has no Grand Total.");

  const tolls = lines.filter((l) => l.kind === "toll").reduce((s, l) => s + l.amountCents, 0);
  const paid = -lines.filter((l) => l.kind === "account_payment").reduce((s, l) => s + l.amountCents, 0);
  ties.push(
    { label: "Grand Total", printedCents: grand, readCents: tolls },
    { label: "Total Tolls", printedCents: -totalTolls, readCents: tolls },
    { label: "Payments", printedCents: payments, readCents: paid },
    { label: "Ending Balance", printedCents: ending, readCents: previous - tolls + paid },
  );
  requireTies("ExpressToll", ties);
  return {
    provider: "expresstoll",
    account: head[3]!,
    periodStart: usDate(head[1])!,
    periodEnd: usDate(head[2])!,
    printedChargesCents: grand,
    lines,
    ties,
  };
}
