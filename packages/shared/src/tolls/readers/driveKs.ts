/**
 * DriveKS (Kansas Turnpike Authority) K-TAG monthly statement → lines (TOLLS-PER-TRUCK-PLAN TL5). Pure.
 *
 * ── THE LAYOUT (measured on seven statements, April → October 2026, 325 pages) ───────────────────
 * Charges are printed in groups, one per transponder or plate:
 *
 *   Transponder/Plate KTA.02168949            Sub-Total: $44.24
 *   04/23/26 12:50 PM ML     MAINLINE   OTA  5  TBR   $22.12
 *
 * A plate-billed group reads `IL-P848214 (676)`: the plate, then the unit DriveKS has on file for it,
 * which is the account's word, not evidence (§1.3: ~60 of its plates are placeholders) — so it is kept
 * in the label and never used to choose a truck. A group can run onto the next page without repeating
 * its heading.
 *
 * ── WHY COLUMNS ARE MEASURED FROM EACH PAGE'S OWN HEADER ─────────────────────────────────────────
 * The statement is laid out for duplex printing: odd and even pages are shifted ~10 pt against each
 * other (the date column sits at x=28 on one, 38–39 on the next). Fixed bands would cut words in two on
 * half the pages, so each page's `Date Time Zone Location/Exit Agency CL Rate Amt` header sets the
 * offset for the lines under it.
 *
 * ── WHAT IT IS HELD TO ───────────────────────────────────────────────────────────────────────────
 * Every group's printed "Sub-Total", and the Billing Period Summary's "Tolls". A non-zero "Fees" is
 * refused: none of the seven statements carries one, so there is no line layout to read it from yet,
 * and a fee read as zero would be money lost.
 */
import type { StatementWord } from "../../reconcile/pilotStatement.js";
import {
  band, blankLine, cents, clock, groupRows, isMoney, joined, requireTies, rowText, usDate,
  TollStatementReadError, type Row, type TollStatementLine, type TollStatementRead, type TollStatementTie,
} from "./tollStatementRead.js";

/**
 * Offsets from the header's `Date` word, measured on the seven statements. Amounts are right-aligned
 * just left of `Amt` (+374…+379); the amount band stops at +400 because page 1's sidebar notice
 * ("NOTICE: You have received…") starts at +410 on the same lines and would otherwise join the amount.
 */
const REL = {
  date: [-5, 30], time: [30, 58], meridiem: [58, 72], zone: [72, 115], location: [115, 280],
  agency: [280, 318], cls: [318, 331], rate: [331, 360], amount: [360, 400],
} as const satisfies Record<string, readonly [number, number]>;

const GROUP = /^Transponder\/Plate$/;

/** The amount printed right after a Billing Period Summary label ("Tolls", "Fees"); null if absent. */
function summary(rows: readonly Row[], label: string): number | null {
  for (const r of rows) {
    const t = rowText(r);
    const i = t.indexOf(label);
    if (i >= 0 && isMoney(t[i + 1])) return cents(t[i + 1]!);
  }
  return null;
}

export function readDriveKsStatement(words: readonly StatementWord[]): TollStatementRead {
  const rows = groupRows(words);
  const text = rows.map((r) => rowText(r).join(" "));
  if (!text.some((t) => t.startsWith("Date Time Zone Location/Exit Agency CL Rate Amt"))) {
    throw new TollStatementReadError(
      "This does not look like a DriveKS K-TAG statement: its transaction header was not found. Check the provider chosen for this file.",
    );
  }
  const account = text.map((t) => /ACCOUNT ID: (\d+)/.exec(t)).find(Boolean);
  const period = text.map((t) => /(\d\d\/\d\d\/\d{4}) - (\d\d\/\d\d\/\d{4})/.exec(t)).find(Boolean);
  const tolls = summary(rows, "Tolls");
  const fees = summary(rows, "Fees");
  if (!account || !period || tolls == null) {
    throw new TollStatementReadError("This K-TAG statement has no account, billing period or \"Tolls\" summary on its first page.");
  }
  if (fees) {
    throw new TollStatementReadError(
      `This K-TAG statement charges fees of $${(fees / 100).toFixed(2)}, and none of the statements read so far had any, so there is no line to charge them from. Nothing was taken from it; send it to support.`,
    );
  }

  const lines: TollStatementLine[] = [];
  const ties: TollStatementTie[] = [];
  let origin: number | null = null;
  let group: { tagNumber: string | null; plate: string | null; plateState: string | null; label: string | null; tie: TollStatementTie } | null = null;

  for (const r of rows) {
    const t = rowText(r);
    if (t[0] === "Date" && t[1] === "Time") {
      origin = r.words[0]!.x;
      continue;
    }
    if (GROUP.test(t[0] ?? "")) {
      const id = t[1] ?? "";
      const sub = t.indexOf("Sub-Total:");
      if (sub < 0 || !isMoney(t[sub + 1])) {
        throw new TollStatementReadError(`A K-TAG group on page ${r.page} has no Sub-Total: "${t.join(" ")}".`);
      }
      const plate = /^([A-Z]{2})-([A-Z0-9]+)$/.exec(id);
      const unit = /^\((.+)\)$/.exec(t[2] ?? "");
      group = {
        tagNumber: plate ? null : id,
        plate: plate ? plate[2]! : null,
        plateState: plate ? plate[1]! : null,
        label: unit ? `DriveKS lists this plate on unit ${unit[1]}` : null,
        tie: { label: `Sub-Total for ${id}`, printedCents: cents(t[sub + 1]!), readCents: 0 },
      };
      ties.push(group.tie);
      continue;
    }
    if (origin == null || !usDate(t[0]) || Math.abs(r.words[0]!.x - origin) > 6) continue;
    const at = (c: keyof typeof REL) => band(r, origin! + REL[c][0], origin! + REL[c][1]);
    const time = clock(at("time")[0], at("meridiem")[0]);
    if (!time) continue; // a date under the Date column with no time is not a charge line
    const amount = at("amount");
    if (amount.length !== 1 || !isMoney(amount[0])) {
      throw new TollStatementReadError(`A K-TAG charge on page ${r.page} has no single readable amount: "${t.join(" ")}".`);
    }
    if (!group) throw new TollStatementReadError(`A K-TAG charge on page ${r.page} comes before any transponder heading.`);
    const line = blankLine("toll", cents(amount[0]), r.page, lines.length);
    line.tagNumber = group.tagNumber;
    line.plate = group.plate;
    line.plateState = group.plateState;
    line.label = group.label;
    line.exitPlaza = joined(at("zone"));
    line.location = joined(at("location"));
    line.agency = joined(at("agency"));
    line.vehicleClass = joined(at("cls"));
    line.rate = joined(at("rate"));
    line.exitAt = `${usDate(t[0])}T${time}`;
    group.tie.readCents += line.amountCents;
    lines.push(line);
  }

  ties.push({ label: "Tolls", printedCents: tolls, readCents: lines.reduce((s, l) => s + l.amountCents, 0) });
  requireTies("K-TAG", ties);
  return {
    provider: "ktag",
    account: account[1]!,
    periodStart: usDate(period[1])!,
    periodEnd: usDate(period[2])!,
    printedChargesCents: tolls,
    lines,
    ties,
  };
}
