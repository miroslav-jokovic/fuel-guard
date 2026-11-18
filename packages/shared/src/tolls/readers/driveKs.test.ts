import { describe, expect, it } from "vitest";
import { readDriveKsStatement } from "./driveKs.js";
import { words, type FixtureLine } from "./fixtureWords.js";

/**
 * The DriveKS layout as the owner's seven statements print it (measured 2026-11-18): page 1's header
 * at x=39 with the sidebar notice beside the charges, page 2 shifted 10 pt left for duplex printing, a
 * group that runs over the page break, and a plate group carrying DriveKS's unit in brackets. All
 * numbers invented.
 */
const charge = (page: number, y: number, x0: number, time: string, ampm: string, zone: string, location: string, amount: string, extra: string[] = []): FixtureLine =>
  [page, y, `04/10/26@${x0}`, `${time}@${x0 + 35}`, `${ampm}@${x0 + 61}`, `${zone}@${x0 + 74}`, `${location}@${x0 + 118}`, `OTA@${x0 + 285}`, `5@${x0 + 321}`, `TBR@${x0 + 334}`, `${amount}@${x0 + 378}`, ...extra];

function statement(o: { fees?: string; secondAmount?: string } = {}): FixtureLine[] {
  return [
    [1, 196, "ACCOUNT@370", "ID:@400", "900001@415"],
    [1, 204, "04/01/2026@360", "-@396", "04/30/2026@403"],
    [1, 219, "Date@39", "Time@74", "Zone@113", "Location/Exit@157", "Agency@324", "CL@360", "Rate@373", "Amt@423"],
    [1, 233, "Transponder/Plate@39", "KTA.09990001@101", "Sub-Total:@382@234", "$30.00@417@234"],
    charge(1, 243, 39, "06:53", "AM", "ML", "MAINLINE", "$22.12"),
    charge(1, 253, 39, "05:51", "PM", "ANTLRS", "ANTLERS", o.secondAmount ?? "$3.81", ["NOTICE:@449", "You@478"]),
    [1, 579, "Previous@450", "Balance@485", "$100.00@551"],
    [1, 589, "Tolls@450", "$51.24@551"],
    [1, 599, "900001@372", "Fees@450", `${o.fees ?? "$0.00"}@571`],
    [2, 66, "Date@28", "Time@63", "Zone@102", "Location/Exit@146", "Agency@313", "CL@349", "Rate@362", "Amt@413"],
    charge(2, 83, 28, "02:32", "PM", "177ML", "US", "$4.07"),
    [2, 103, "Transponder/Plate@28", "IL-P7654321@90", "(676)@140", "Sub-Total:@371", "$21.24@406"],
    charge(2, 113, 28, "08:19", "AM", "HLLTE", "HALLET-SH", "$21.24"),
  ];
}

describe("readDriveKsStatement", () => {
  it("reads every charge under its transponder or plate, following each page's own columns", () => {
    const read = readDriveKsStatement(words(statement()));
    expect(read).toMatchObject({ provider: "ktag", account: "900001", periodStart: "2026-04-01", periodEnd: "2026-04-30", printedChargesCents: 5124 });
    expect(read.lines.map((l) => [l.tagNumber ?? l.plate, l.exitAt, l.amountCents])).toEqual([
      ["KTA.09990001", "2026-04-10T06:53", 2212],
      ["KTA.09990001", "2026-04-10T17:51", 381],
      ["KTA.09990001", "2026-04-10T14:32", 407], // page 2, before the next heading: same transponder
      ["P7654321", "2026-04-10T08:19", 2124],
    ]);
    expect(read.lines[0]).toMatchObject({ exitPlaza: "ML", location: "MAINLINE", agency: "OTA", vehicleClass: "5", rate: "TBR" });
  });

  it("keeps DriveKS's unit for a plate as words, never as the truck", () => {
    const plate = readDriveKsStatement(words(statement())).lines[3]!;
    expect(plate).toMatchObject({ plateState: "IL", label: "DriveKS lists this plate on unit 676" });
  });

  it("holds every group to its printed Sub-Total", () => {
    const read = readDriveKsStatement(words(statement()));
    expect(read.ties).toContainEqual({ label: "Sub-Total for KTA.09990001", printedCents: 3000, readCents: 3000 });
    expect(() => readDriveKsStatement(words(statement({ secondAmount: "$3.18" })))).toThrow(/Sub-Total for KTA\.09990001: printed \$30\.00, read \$29\.37/);
  });

  it("refuses a statement that charges fees, since no line says what they were for", () => {
    expect(() => readDriveKsStatement(words(statement({ fees: "$5.00" })))).toThrow(/charges fees of \$5\.00/);
  });

  it("refuses a file that is not a DriveKS statement", () => {
    expect(() => readDriveKsStatement(words(statement().filter((l) => l[2] !== "Date@39" && l[2] !== "Date@28")))).toThrow(/does not look like a DriveKS K-TAG statement/);
  });
});
