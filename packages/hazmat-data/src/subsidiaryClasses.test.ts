import { describe, expect, it } from "vitest";
import { labelCodeTokens, subsidiaryClassesOf, withSubsidiaryClasses } from "./subsidiaryClasses.js";
import { listDatasetVersions, loadDataset } from "./index.js";

describe("subsidiary classes derived from column (6) (D-PC1)", () => {
  it("reads a label cell for what it says, including the eCFR text's slips", () => {
    expect(labelCodeTokens("8")).toEqual(["8"]);
    expect(labelCodeTokens("8, 6.1")).toEqual(["8", "6.1"]);
    expect(labelCodeTokens("8.6.1")).toEqual(["8", "6.1"]); // UN1052
    expect(labelCodeTokens("6.1. 4.1")).toEqual(["6.1", "4.1"]); // UN3535
    expect(labelCodeTokens("1.4G")).toEqual(["1.4G"]);
    expect(labelCodeTokens("1")).toEqual(["1"]); // an explosive subsidiary (PHMSA 05-0282)
    expect(labelCodeTokens("Empty")).toEqual([]); // UN2908
    expect(labelCodeTokens("None")).toEqual([]);
    expect(labelCodeTokens("")).toEqual([]);
  });

  it("is every label code of the rows that is not the primary, once, in column order", () => {
    expect(subsidiaryClassesOf("8", [{ labelCodes: ["8", "6.1"] }, { labelCodes: ["8", "6.1"] }])).toEqual(["6.1"]);
    expect(subsidiaryClassesOf("3", [{ labelCodes: ["3", "8", "6.1"] }])).toEqual(["8", "6.1"]);
    expect(subsidiaryClassesOf("1.2G", [{ labelCodes: ["1.2G", "8", "6.1"] }])).toEqual(["8", "6.1"]);
    expect(subsidiaryClassesOf("3", [{ labelCodes: ["3"] }])).toEqual([]);
    expect(subsidiaryClassesOf("8", [{ labelCodes: ["8.6.1"] }])).toEqual(["6.1"]);
    expect(subsidiaryClassesOf("7", [{ labelCodes: ["Empty"] }])).toEqual([]);
    // Column (3) blank: the division is assigned with the approval, so no label can be told to be subsidiary.
    expect(subsidiaryClassesOf(null, [{ labelCodes: ["1"] }])).toEqual([]);
  });

  it("fills only the entries the cut's file left empty, and leaves an attested value alone", () => {
    const ds = loadDataset();
    const filled = ds.entries.find((e) => e.subsidiaryClasses.length > 0)!;
    const touched = withSubsidiaryClasses({ ...ds, entries: [{ ...filled, subsidiaryClasses: ["9"] }] });
    expect(touched.entries[0]!.subsidiaryClasses).toEqual(["9"]);
  });

  // The vacuity guard every census over subsidiaries rests on: the field was empty on every entry of every cut
  // until 2026-10-26, and every test that folded over it certified nothing.
  for (const version of listDatasetVersions().filter((v) => v >= "2026.07.1")) {
    it(`loads the subsidiary classes column (6) lists, dataset ${version}`, () => {
      const ds = loadDataset(version);
      const withSubs = ds.entries.filter((e) => e.subsidiaryClasses.length > 0);
      expect(withSubs.length).toBeGreaterThan(550);
      const find = (id: string) => ds.entries.find((e) => e.idNumber === id)!;
      expect(find("2922").subsidiaryClasses).toEqual(["6.1"]); // Corrosive liquids, toxic, n.o.s.
      expect(find("3098").subsidiaryClasses).toEqual(["8"]); // Oxidizing liquid, corrosive, n.o.s.
      expect(find("2924").subsidiaryClasses).toEqual(["8"]); // Flammable liquids, corrosive, n.o.s.
      expect(find("3123").subsidiaryClasses).toEqual(["4.3"]); // Toxic liquids, water-reactive, n.o.s.
      expect(find("1052").subsidiaryClasses).toEqual(["6.1"]); // the "8.6.1" cell
      expect(find("1760").subsidiaryClasses).toEqual([]); // Corrosive liquids, n.o.s.: no subsidiary
      // No entry lists its own primary as a subsidiary.
      expect(ds.entries.filter((e) => e.hazardClass && e.subsidiaryClasses.includes(e.hazardClass))).toEqual([]);
    });
  }
});
