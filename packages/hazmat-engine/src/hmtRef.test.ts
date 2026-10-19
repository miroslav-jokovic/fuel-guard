import { describe, expect, it } from "vitest";
import { parseHmtRef } from "./hmtRef";
import { pgRowForRef, type DsEntry } from "./placards/classify";

/**
 * The ref's two parts, where the entry id holds a "#" itself (2026-10-19: `UN1950-aerosols#2`). The shipped
 * dataset's only such entry with two PG rows, UN1788-hydrobromic-acid#2, lists the same column 8A on both,
 * so @hazmat/golden's ref census cannot see a wrong PG row there; this pins the PG half directly.
 */
describe("parseHmtRef", () => {
  it("splits at the last '#', so an entry id holding one stays whole", () => {
    expect(parseHmtRef("UN1950-aerosols#2#none")).toEqual({ entryId: "UN1950-aerosols#2", pg: null });
    expect(parseHmtRef("UN1788-hydrobromic-acid#2#III")).toEqual({ entryId: "UN1788-hydrobromic-acid#2", pg: "III" });
    expect(parseHmtRef("UN1203-gasoline#II")).toEqual({ entryId: "UN1203-gasoline", pg: "II" });
    expect(parseHmtRef("UN1203-gasoline")).toEqual({ entryId: "UN1203-gasoline", pg: null });
  });

  it("gives pgRowForRef the printed PG's row on an id holding '#', not the first row", () => {
    const entry = { entryId: "UN1788-hydrobromic-acid#2", pgRows: [{ pg: "II", exceptionsRef: "154" }, { pg: "III", exceptionsRef: "999" }] } as unknown as DsEntry;
    expect(pgRowForRef(entry, "UN1788-hydrobromic-acid#2#III")).toMatchObject({ pg: "III", exceptionsRef: "999" });
  });
});
