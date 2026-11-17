import { describe, expect, it } from "vitest";
import { readSheetDay, readTollProvider, readTollTagSheet, TollTagSheetError } from "./tollTagSheet.js";
import { findVehicle, planTollTagImport, tollTagImportSchema, type ImportVehicle, type TollTagImportItem } from "./tollTagImport.js";
import type { TransponderDto } from "./tollContract.js";

const ZONE = "America/Chicago";
const NOW = new Date("2026-11-17T18:00:00Z");
const TRUCKS: ImportVehicle[] = [
  { id: "v654", unitNumber: "654", inService: true },
  { id: "v702", unitNumber: "702", inService: true },
  { id: "v900", unitNumber: "900", inService: false },
];
const HEAD = ["Truck", "Provider", "Tag number", "On truck since", "Issued by"];

function tag(over: Partial<TransponderDto> & Pick<TransponderDto, "history">): TransponderDto {
  return { id: "t1", provider: "ezpass", tagNumber: "00812345678", issuer: null, note: null, retiredAt: null, retiredReason: null, currentVehicleId: null, ...over };
}
const entry = (id: string, vehicleId: string, unitNumber: string, validFrom: string, validTo: string | null = null, voidedAt: string | null = null) => ({
  id,
  vehicleId,
  unitNumber,
  validFrom,
  validTo,
  voidedAt,
  voidReason: voidedAt ? "typo" : null,
});
const item = (over: Partial<TollTagImportItem> = {}): TollTagImportItem => ({
  line: 2,
  unitNumber: "654",
  provider: "ezpass",
  tagNumber: "00812345678",
  at: "2026-05-14T05:00:00.000Z",
  issuer: null,
  ...over,
});
const plan = (items: TollTagImportItem[], tags: TransponderDto[] = []) =>
  planTollTagImport(items, { tags, vehicles: TRUCKS, now: NOW, zone: ZONE }).map((p) => p.verdict);

describe("reading the toll tag sheet", () => {
  it("reads the template's columns and keeps the spreadsheet's own line numbers", () => {
    const sheet = readTollTagSheet([HEAD, ["654", "E-ZPass", "008-1234 5678", "05/14/2026", "NJ"], ["702", "K-TAG", "KT0000777", "2026-06-01T00:00:00.000Z", null]]);
    expect(sheet.rows.map((r) => [r.line, r.unit, r.provider, r.tagNumber, r.since, r.issuer, r.problem])).toEqual([
      [2, "654", "ezpass", "00812345678", "2026-05-14", "NJ", null],
      [3, "702", "ktag", "KT0000777", "2026-06-01", null, null],
    ]);
  });

  it("finds the header below a title row and in another column order, by the names people use", () => {
    const sheet = readTollTagSheet([["Silvicom toll tags"], [], ["Transponder", "Unit #", "Since", "Tag type"], ["812345678", "654", "5/14/26", "EZ Pass"]]);
    expect(sheet.rows[0]).toMatchObject({ line: 4, unit: "654", provider: "ezpass", tagNumber: "812345678", since: "2026-05-14", problem: null });
  });

  it("leaves out a truck line with no tag, and counts it", () => {
    const sheet = readTollTagSheet([HEAD, ["654", null, null, null], ["702", "", "", ""], [null, null, null, null]]);
    expect(sheet.rows).toEqual([]);
    expect(sheet.trucksWithoutTag).toBe(2);
  });

  it("says what to fix on each bad line instead of guessing", () => {
    const sheet = readTollTagSheet([
      HEAD,
      [null, "E-ZPass", "00812345678", "05/14/2026"],
      ["654", "TxTag", "00812345678", "05/14/2026"],
      ["654", "", "00812345678", "05/14/2026"],
      ["654", "K-TAG", "12/34", "05/14/2026"],
      ["654", "K-TAG", "KT0000777", ""],
      ["654", "K-TAG", "KT0000777", "14/05/2026"],
    ]);
    expect(sheet.rows.map((r) => r.problem)).toEqual([
      "No truck. Type the truck's unit number.",
      '"TxTag" is not E-ZPass, K-TAG or ExpressToll.',
      "No provider. Write E-ZPass, K-TAG or ExpressToll.",
      "The tag number must be 4 to 24 letters and digits, as printed on the tag.",
      "No start day. Give the day the tag went on this truck.",
      '"14/05/2026" is not a date. Write it as MM/DD/YYYY.',
    ]);
  });

  it("refuses the whole sheet when it has no header, or lacks the provider or day column", () => {
    expect(() => readTollTagSheet([["a", "b"], ["1", "2"]])).toThrow(TollTagSheetError);
    expect(() => readTollTagSheet([["Truck", "Tag number", "Provider"]])).toThrow(/"On truck since"/);
    expect(() => readTollTagSheet([["Truck", "Tag number", "On truck since"]])).toThrow(/"Provider"/);
  });

  it("reads a day from an Excel serial, an ISO date cell and US typing, and nothing else", () => {
    expect(readSheetDay(46156)).toBe("2026-05-14");
    expect(readSheetDay("46156")).toBe("2026-05-14");
    expect(readSheetDay("2026-05-14T00:00:00.000Z")).toBe("2026-05-14");
    expect(readSheetDay("05-14-2026")).toBe("2026-05-14");
    expect(readSheetDay("2/30/2026")).toBeNull();
    expect(readSheetDay("May 14")).toBeNull();
    expect(readSheetDay(12)).toBeNull();
  });

  it("knows the three providers however they are spelled, and no others", () => {
    expect(["E-ZPass", "ez pass", "I-PASS", "K-TAG", "Ktag", "Express Toll", "expresstoll"].map(readTollProvider)).toEqual([
      "ezpass",
      "ezpass",
      "ezpass",
      "ktag",
      "ktag",
      "expresstoll",
      "expresstoll",
    ]);
    expect(readTollProvider("PrePass")).toBeNull();
    expect(readTollProvider("TollTag")).toBeNull();
  });
});

describe("planning the import", () => {
  it("adds a tag that is not on file, on the truck the line names", () => {
    expect(plan([item()])).toEqual([{ kind: "add", vehicleId: "v654" }]);
  });

  it("matches a unit typed with a prefix or leading zeros, but never two trucks", () => {
    expect(findVehicle(TRUCKS, "Unit 654").map((v) => v.id)).toEqual(["v654"]);
    expect(findVehicle(TRUCKS, "#0702").map((v) => v.id)).toEqual(["v702"]);
    expect(plan([item({ unitNumber: "655" })])[0]).toMatchObject({ kind: "refused", reason: "No truck 655 in the fleet. Check the unit number." });
    const twins: ImportVehicle[] = [...TRUCKS, { id: "v0654", unitNumber: "0654", inService: true }];
    expect(planTollTagImport([item({ unitNumber: "00654" })], { tags: [], vehicles: twins, now: NOW, zone: ZONE })[0]!.verdict.kind).toBe("refused");
  });

  it("refuses a truck that is not in service, and a day in the future", () => {
    expect(plan([item({ unitNumber: "900" })])[0]).toMatchObject({ kind: "refused", reason: expect.stringContaining("not in service") });
    expect(plan([item({ at: "2026-11-18T06:00:00.000Z" })])[0]).toMatchObject({ kind: "refused", reason: "That day is in the future." });
  });

  it("leaves a tag alone that is already on that truck from that day or earlier, so a second import changes nothing", () => {
    const t = tag({ currentVehicleId: "v654", history: [entry("a1", "v654", "654", "2026-04-01T05:00:00.000Z")] });
    expect(plan([item()], [t])).toEqual([{ kind: "unchanged", transponderId: "t1", since: "2026-04-01T05:00:00.000Z" }]);
  });

  it("matches the tag on file when Excel dropped its leading zeros", () => {
    const t = tag({ currentVehicleId: "v654", history: [entry("a1", "v654", "654", "2026-04-01T05:00:00.000Z")] });
    expect(plan([item({ tagNumber: "812345678" })], [t])[0]!.kind).toBe("unchanged");
  });

  it("starts the tag earlier on the same truck when it was typed in from a later day", () => {
    const t = tag({ currentVehicleId: "v654", history: [entry("a1", "v654", "654", "2026-11-17T15:00:00.000Z")] });
    expect(plan([item()], [t])).toEqual([
      { kind: "backdate", vehicleId: "v654", transponderId: "t1", entryId: "a1", previousFrom: "2026-11-17T15:00:00.000Z" },
    ]);
  });

  it("refuses to start it earlier over another truck's time with the tag", () => {
    const t = tag({
      currentVehicleId: "v654",
      history: [entry("a2", "v654", "654", "2026-07-01T05:00:00.000Z"), entry("a1", "v702", "702", "2026-03-01T06:00:00.000Z", "2026-07-01T05:00:00.000Z")],
    });
    expect(plan([item()], [t])[0]).toMatchObject({ kind: "refused", reason: expect.stringContaining("on unit 702 until 07/01/2026") });
  });

  it("moves a tag from another truck when the line's day is after that truck got it", () => {
    const t = tag({ currentVehicleId: "v702", history: [entry("a1", "v702", "702", "2026-03-01T06:00:00.000Z")] });
    expect(plan([item()], [t])).toEqual([{ kind: "move", vehicleId: "v654", transponderId: "t1", fromUnit: "702" }]);
  });

  it("refuses to slide a move under another truck's later start, naming that truck and day", () => {
    const t = tag({ currentVehicleId: "v702", history: [entry("a1", "v702", "702", "2026-06-01T05:00:00.000Z")] });
    expect(plan([item()], [t])[0]).toMatchObject({ kind: "refused", reason: expect.stringContaining("on unit 702 since 06/01/2026") });
  });

  it("puts a tag that is on no truck back on from a day after its last truck, and not before", () => {
    const off = tag({ history: [entry("a1", "v702", "702", "2026-01-01T06:00:00.000Z", "2026-05-01T05:00:00.000Z")] });
    expect(plan([item()], [off])[0]).toMatchObject({ kind: "move", fromUnit: null });
    expect(plan([item({ at: "2026-04-01T05:00:00.000Z" })], [off])[0]).toMatchObject({ kind: "refused", reason: expect.stringContaining("until 05/01/2026") });
  });

  it("ignores voided entries when deciding", () => {
    const t = tag({ history: [entry("a1", "v702", "702", "2026-06-01T05:00:00.000Z", null, "2026-11-01T00:00:00Z")] });
    expect(plan([item()], [t])[0]).toMatchObject({ kind: "move", fromUnit: null });
  });

  it("refuses a retired tag", () => {
    const t = tag({ retiredAt: "2026-09-01T05:00:00.000Z", history: [] });
    expect(plan([item()], [t])[0]).toMatchObject({ kind: "refused", reason: expect.stringContaining("retired 09/01/2026") });
  });

  it("refuses both lines of a tag that is in the sheet twice, each naming the other", () => {
    const verdicts = plan([item({ line: 4 }), item({ line: 9, tagNumber: "812345678", unitNumber: "702" }), item({ line: 5, tagNumber: "99990000" })]);
    expect(verdicts[0]).toMatchObject({ kind: "refused", reason: expect.stringContaining("also on line 9") });
    expect(verdicts[1]).toMatchObject({ kind: "refused", reason: expect.stringContaining("also on line 4") });
    expect(verdicts[2]!.kind).toBe("add");
  });

  it("keeps the same digits under two providers as two tags", () => {
    expect(plan([item({ line: 2 }), item({ line: 3, provider: "ktag" })]).map((v) => v.kind)).toEqual(["add", "add"]);
  });

  it("holds a request to its batch size and normalises the tag number", () => {
    const row = { line: 2, unitNumber: "654", provider: "ezpass", tagNumber: "008-1234 5678", at: "2026-05-14T05:00:00.000Z" };
    expect(tollTagImportSchema.parse({ rows: [row] }).rows[0]!.tagNumber).toBe("00812345678");
    expect(tollTagImportSchema.safeParse({ rows: [] }).success).toBe(false);
    expect(tollTagImportSchema.safeParse({ rows: Array.from({ length: 51 }, (_, i) => ({ ...row, line: i + 2 })) }).success).toBe(false);
  });
});
