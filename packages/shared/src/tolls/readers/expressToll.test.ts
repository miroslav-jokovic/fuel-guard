import { describe, expect, it } from "vitest";
import { readExpressTollStatement } from "./expressToll.js";
import { words, type FixtureLine } from "./fixtureWords.js";
import { readTollStatement } from "./index.js";

/**
 * The ExpressToll layout as the owner's six statements print it (measured 2026-11-18): a camera toll
 * filed under a device whose plate is not the one the camera read, a trailer plate, the first line on
 * a page whose date sits 3 pt above the rest of it, and the payments-and-summary page. Numbers invented.
 */
const HEADER = (page: number, y: number): FixtureLine => [page, y, "Transaction@47", "Date/Time@102", "Location@169", "Lane@350", "Toll@412", "Status*@432", "Amount@531"];

function statement(o: { adjustment?: boolean; payment?: string } = {}): FixtureLine[] {
  return [
    [1, 272, "Statement@131", "for@175", "Transactions@193", "Posted@251", "between@283", "7/28/2026@318", "and@363", "8/27/2026@381", "Acct@425", "No@448", ":@461", "9000001@470"],
    HEADER(1, 294),
    [1, 310, "Transactions@47", "For@106", "Device@124", "#@156", "7000001@165", "Plate@212", "#@238", "P1111111-IL@247"],
    [1, 323, "8/25/2026@47", "4:25:27@86", "AM@118", "TX@169", "N@181", "Tarrant@188", "Parkway@220", "IOPVTOLL@412", "P1111111@453", "$9.00@545"],
    [1, 336, "7/28/2026@47", "6:40:22@86", "PM@118", "CO@169", "NWP@184", "SHERIDAN@204", "Lane@350", "2@370", "North@377", "VTOLL@412", "P2222222@439", "$16.50@541"],
    [1, 350, "Total:@489", "$25.50@544"],
    [1, 380, "Transactions@47", "For@106", "Device@124", "#@156", "7000002@165", "Plate@212", "#@238", "1234567ST-IL@247"],
    HEADER(2, 60.7),
    [2, 71.2, "7/30/2026@47", "5:56:24@86", "PM@118", "TX@169@74.2", "DFW-I35E@182@74.2", "PLAZA@223@74.2", "IOPVTOLL@412@74.2", "1234567ST@453@74.2", "$3.96@545@74.2"],
    [2, 89.6, "Total:@484", "$3.96@539"],
    [2, 120, "Grand@445", "Total:@472", "$29.46@529"],
    [3, 96, "Previous@387", "Balance@427", ":@463", "$100.00@532"],
    [3, 101, "8/2/2026@48", "PAYMENT@93", "CREDIT@279", `${o.payment ?? "$20.00"}@338`],
    [3, 113, "8/10/2026@48", "PAYMENT@93", "CREDIT@279", "$10.00@338", "Total@417", "Tolls@440", ":@463", "-$29.46@524"],
    [3, 130, "Payments@419", ":@462", "$30.00@527"],
    [3, 154, "Adjustments/Charges@46", "Made@139", "between@162", "7/28/2026@199", "and@246", "8/27/2026@264"],
    [3, 157, "Ending@394", "Balance@426", ":@463", "$100.54@532"],
    ...(o.adjustment ? [[3, 184, "8/20/2026@48", "CORRECTION@93", "$5.00@338"] as FixtureLine] : [[3, 184, "N/A@48"] as FixtureLine]),
  ];
}

describe("readExpressTollStatement", () => {
  it("takes each camera toll's plate from its own line, not from the device it is filed under", () => {
    const read = readExpressTollStatement(words(statement()));
    expect(read).toMatchObject({ provider: "expresstoll", account: "9000001", periodStart: "2026-07-28", periodEnd: "2026-08-27", printedChargesCents: 2946 });
    const tolls = read.lines.filter((l) => l.kind === "toll");
    expect(tolls.map((l) => [l.device, l.plate, l.plateState, l.rate, l.exitAt, l.amountCents])).toEqual([
      ["7000001", "P1111111", "IL", "IOPVTOLL", "2026-08-25T04:25:27", 900],
      ["7000001", "P2222222", null, "VTOLL", "2026-07-28T18:40:22", 1650],
      ["7000002", "1234567ST", "IL", "IOPVTOLL", "2026-07-30T17:56:24", 396], // first line of page 2, date 3 pt high
    ]);
    expect(tolls[1]).toMatchObject({ location: "CO NWP SHERIDAN", exitPlaza: "CO NWP SHERIDAN", lane: "Lane 2 North", tagNumber: null });
  });

  it("reads the payments as credits and ties the balance equation", () => {
    const read = readExpressTollStatement(words(statement()));
    expect(read.lines.filter((l) => l.kind === "account_payment").map((l) => l.amountCents)).toEqual([-2000, -1000]);
    expect(read.ties).toContainEqual({ label: "Ending Balance", printedCents: 10054, readCents: 10054 });
    expect(() => readExpressTollStatement(words(statement({ payment: "$2.00" })))).toThrow(/Payments: printed \$30\.00, read \$12\.00/);
  });

  it("refuses an adjustment, whose sign none of the statements shows", () => {
    expect(() => readExpressTollStatement(words(statement({ adjustment: true })))).toThrow(/has an adjustment on page 3/);
  });

  it("is what readTollStatement runs for ExpressToll, and the E-ZPass reader refuses the same words", () => {
    const w = words(statement());
    expect(readTollStatement("expresstoll", w).lines).toHaveLength(5);
    expect(() => readTollStatement("ezpass", w)).toThrow(/does not look like a New Jersey E-ZPass statement/);
  });
});
