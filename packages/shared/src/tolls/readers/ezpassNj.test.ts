import { describe, expect, it } from "vitest";
import { readEzpassNjStatement } from "./ezpassNj.js";
import { words, type FixtureLine } from "./fixtureWords.js";
import { groupRows } from "./tollStatementRead.js";

/**
 * The NJ E-ZPass layout, column for column as the owner's five statements print it (x positions
 * measured 2026-11-18), with invented tags, plates and account. Balances run down the page exactly as
 * the provider's do: previous − charge = this balance.
 */
const HEADER: FixtureLine = [1, 200, "DATE@50", "DATE@92", "/PLATE@155", "AGENCY@209", "PLAZA@237", "DATE@261", "TIME@287", "PLAZA@309", "DATE@334", "TIME@360", "PLAN@403", "CL@445", "AMOUNT@471", "BALANCE@529"];
const head: FixtureLine[] = [
  [1, 40, "Account@450", "#:@480", "1000@495", "2000@515", "3000@535", "4@555"],
  [1, 50, "Statement@430", "Period:@470", "04/27/26@500", "-@535", "05/26/26@540"],
  HEADER,
];
const toll = (y: number, tag: string, amount: string, balance: string, agency = "ILTOLL", plaza = "17"): FixtureLine =>
  [1, y, "04/27/26@46", "04/26/26@89", `${tag}@123`, `${agency}@212`, `${plaza}@314`, "04/26/26@330", "20:53@360", "BUSINESS@390", "5@447", `${amount}@491`, `${balance}@545`];
const closedRoad: FixtureLine = [1, 216, "04/27/26@46", "04/26/26@89", "09990000002@123", "OTIC@214", "49@243", "04/26/26@257", "12:32@286", "211@313", "04/26/26@330", "14:52@360", "BUSINESS@390", "5@447", "$42.50@487", "$957.50@545"];
const summary = (charges: string, payments: string, ending: string): FixtureLine[] => [
  [2, 600, "Beginning@450", "Balance@490", "$1,000.00@560"],
  [2, 610, "Tolls,@450", "Non-Tolls@475", "and@510", "Fees@525", charges + "@560"],
  [2, 620, "Payments@450", "and@490", "Credits@505", payments + "@560"],
  [2, 630, "Ending@450", "Balance@480", ending + "@560"],
];

/** Every kind the five statements print, in one month: tags, a closed-road toll, a plate toll, a credit, top-up, fee, tag sale. */
function month(overrides: { tollAmount?: string; tagsale?: string } = {}): FixtureLine[] {
  return [
    ...head,
    closedRoad,
    toll(224, "09990000001", overrides.tollAmount ?? "$7.50", "$950.00"),
    [1, 232, "04/28/26@46", "04/12/26@89", "ILP7654321@123", "PTC@215", "CAL@241", "04/11/26@257", "16:00@286", "WRN@311", "04/12/26@330", "04:32@360", "BUSINESS@390", "5@447", "$50.00@487", "$900.00@545"],
    [1, 240, "04/28/26@46", "04/04/26@89", "09990000001@123", "NYSTA@212", "48A@312", "04/04/26@330", "11:58@360", "STANDARD@390", "5H@445", "-$10.00@489", "$910.00@545"],
    [1, 248, "04/28/26@46", "04/28/26@89", "Service@123", "Fee@145", "$1.00@491", "$909.00@541"],
    [1, 256, "05/01/26@46", "05/01/26@89", "Prepaid@123", "Payment@146", "$9,000.00@480", "$9,909.00@541"],
    [1, 264, "05/02/26@46", "05/02/26@89", "Tagsale@123", "Tagint@144", `${overrides.tagsale ?? "$90.00"}@487`, "$9,909.00@541"],
    [1, 272, "05/02/26@46", "05/02/26@89", "Adjustment@123", "$90.00@487", "$9,819.00@541"],
    ...summary("$91.00", "$8,910.00", "$9,819.00"),
  ];
}

describe("readEzpassNjStatement", () => {
  it("reads every kind of line with its sign taken from the running balance", () => {
    const read = readEzpassNjStatement(words(month()));
    expect(read).toMatchObject({ provider: "ezpass", account: "1000200030004", periodStart: "2026-04-27", periodEnd: "2026-05-26", printedChargesCents: 9100 });
    expect(read.lines.map((l) => [l.kind, l.amountCents])).toEqual([
      ["toll", 4250], ["toll", 750], ["toll", 5000], ["toll", -1000], ["service_fee", 100],
      ["account_payment", -900000], ["tag_purchase", 0], ["adjustment", 9000],
    ]);
    const [closed, open, plate] = read.lines;
    expect(closed).toMatchObject({ tagNumber: "09990000002", agency: "OTIC", entryPlaza: "49", entryAt: "2026-04-26T12:32", exitPlaza: "211", exitAt: "2026-04-26T14:52", vehicleClass: "5", postedOn: "2026-04-27" });
    expect(open).toMatchObject({ entryPlaza: null, entryAt: null, exitPlaza: "17", exitAt: "2026-04-26T20:53" });
    expect(plate).toMatchObject({ tagNumber: null, plate: "P7654321", plateState: "IL" });
    expect(read.lines[6]!.label).toBe("Tagsale Tagint $90.00 (memo, balance unchanged)");
  });

  it("counts an adjustment in Payments and Credits, as the provider's own totals do", () => {
    const read = readEzpassNjStatement(words(month()));
    expect(read.ties).toContainEqual({ label: "Payments and Credits", printedCents: 891000, readCents: 891000 });
    expect(read.ties).toContainEqual({ label: "Tolls, Non-Tolls and Fees", printedCents: 9100, readCents: 9100 });
  });

  it("refuses a statement whose line does not match the balance step, naming the line", () => {
    expect(() => readEzpassNjStatement(words(month({ tollAmount: "$75.00" })))).toThrow(/running balance does not follow its lines at line 2 \(page 1\)/);
  });

  it("refuses a toll that leaves the balance unchanged: only a non-toll line may be a memo", () => {
    const lines = month();
    lines.splice(4, 0, toll(228, "09990000003", "$5.00", "$950.00"));
    expect(() => readEzpassNjStatement(words(lines))).toThrow(/running balance does not follow its lines at line 3 \(page 1\)/);
  });

  it("refuses a line kind it has never seen instead of guessing what it is", () => {
    const lines = month();
    lines.splice(4, 0, [1, 228, "04/27/26@46", "04/27/26@89", "Violation@123", "Notice@150", "$25.00@487", "$925.00@541"]);
    expect(() => readEzpassNjStatement(words(lines))).toThrow(/neither a tag, a plate nor a kind of charge we know: "Violation Notice"/);
  });

  it("refuses a file that is not an E-ZPass statement", () => {
    expect(() => readEzpassNjStatement(words(month().filter((l) => l !== HEADER)))).toThrow(/does not look like a New Jersey E-ZPass statement/);
  });
});

describe("groupRows", () => {
  it("joins words up to 3.5 pt apart into one line and keeps lines 4 pt apart separate", () => {
    const rows = groupRows(words([[1, 71.2, "7/30/2026@47"], [1, 74.2, "TX@169"], [1, 78.2, "next@47"]]));
    expect(rows.map((r) => r.words.map((w) => w.text))).toEqual([["7/30/2026", "TX"], ["next"]]);
  });
});
