import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parsePlacardTablesGovInfo } from "./parsePlacardsGovInfo.js";
import { parseSegregationGridGovInfo } from "./parseSegregationGovInfo.js";

// The full GovInfo captures are gitignored (large); regenerate via `pnpm tsx import/captureGovInfo.ts`.
// Skip (never fail) when absent — e.g. a fresh CI checkout.
const rd = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const has = (p: string) => existsSync(new URL(p, import.meta.url));
const PRESENT = has("./fixtures/govinfo/placardTables-172-504.xml") && has("./fixtures/govinfo/segregation-177-848.xml");
if (!PRESENT) console.warn("[hazmat-data] SKIP parseGovInfoTables — captured fixtures absent (run import/captureGovInfo.ts)");
const placards = PRESENT ? parsePlacardTablesGovInfo(rd("./fixtures/govinfo/placardTables-172-504.xml")) : [];
const seg = PRESENT ? parseSegregationGridGovInfo(rd("./fixtures/govinfo/segregation-177-848.xml")) : [];

describe.skipIf(!PRESENT)("parsePlacardTablesGovInfo — official GovInfo §172.504", () => {
  it("parses both tables into 23 specs with correct table signatures", () => {
    expect(placards.length).toBe(23);
    const t1 = placards.filter((s) => s.table === 1);
    const t2 = placards.filter((s) => s.table === 2);
    expect(t1.some((s) => s.classOrDivision.startsWith("2.3") && s.placardName === "POISON GAS")).toBe(true);
    expect(t2.some((s) => s.classOrDivision === "3" && s.placardName === "FLAMMABLE")).toBe(true);
  });

  it("keeps 6.2 → NONE with no design reference (GPO omits the trailing empty cell)", () => {
    const sixTwo = placards.find((s) => s.classOrDivision === "6.2");
    expect(sixTwo).toBeTruthy();
    expect(sixTwo!.placardName).toBe("NONE");
    expect(sixTwo!.designRef).toBeNull();
  });

  it("drops the RADIOACTIVE <SU> footnote marker and the CLASS 9 trailing see-reference", () => {
    expect(placards.some((s) => s.placardName === "RADIOACTIVE")).toBe(true);
    expect(placards.some((s) => s.placardName === "CLASS 9")).toBe(true);
  });

  it("applies the fuel wording overlay (3→GASOLINE, Combustible liquid→FUEL OIL)", () => {
    expect(placards.find((s) => s.table === 2 && s.classOrDivision === "3")!.wordingOptions).toContain("GASOLINE");
    expect(placards.find((s) => s.classOrDivision === "Combustible liquid")!.wordingOptions).toContain("FUEL OIL");
  });
});

describe.skipIf(!PRESENT)("parseSegregationGridGovInfo — official GovInfo §177.848(d)", () => {
  it("parses the 18×18 grid into 173 non-blank cells", () => {
    expect(seg.length).toBe(173);
  });

  it("has the known verified values (3↔5.1 = O away-from, 3↔1.1 1.2 = X prohibited)", () => {
    const cell = (r: string, c: string) => seg.find((x) => x.rowClass === r && x.colClass === c)?.value;
    expect(cell("3", "5.1")).toBe("O");
    expect(cell("5.1", "3")).toBe("O");
    expect(cell("3", "1.1 1.2")).toBe("X");
  });
});
