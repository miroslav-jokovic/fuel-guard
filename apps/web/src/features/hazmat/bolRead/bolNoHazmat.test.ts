import { describe, expect, it } from "vitest";
import { noHazmatEvidence } from "./bolNoHazmat";
import { pagesAudit, read } from "./bolPrefill.fixtures";

/**
 * The three things "No hazardous materials on this BOL" needs (bolNoHazmat.ts): both readers, a clean page
 * scan, every page here. Each case removes one and expects exactly its doubt.
 */
describe("noHazmatEvidence", () => {
  it("has no doubt when both readers read no line, the OCR found no mark and the page rule passed", () => {
    expect(noHazmatEvidence(read([], { paperAudit: pagesAudit("pass"), scan: [] }))).toEqual({ doubts: [], marks: [], markPages: [] });
  });

  it("doubts a read only one reader made", () => {
    const solo = read([], { paperAudit: pagesAudit("pass"), scan: [] });
    solo.evidence = solo.evidence.map((e) => ({ ...e, sources: e.sources.filter((s) => s.reader !== "passB") }));
    expect(noHazmatEvidence(solo).doubts).toEqual(["one_reader"]);
  });

  it("takes no OCR for nothing found — a read without the scan is unbacked", () => {
    expect(noHazmatEvidence(read([], { paperAudit: pagesAudit("pass") })).doubts).toEqual(["no_page_scan"]);
  });

  it("names what the OCR found and where", () => {
    expect(noHazmatEvidence(read([], { paperAudit: pagesAudit("pass"), scan: ["UN1993"] }))).toEqual({ doubts: ["marks_on_page"], marks: ["UN1993"], markPages: [1] });
  });

  it("doubts a clean OCR when the born-digital text layer found a mark on page 2", () => {
    const r = read([], { paperAudit: pagesAudit("pass"), scan: [] });
    const lines = r.evidence.find((e) => e.path === "hazmat.lines")!;
    lines.sources.push({ reader: "textLayer", page: 2, bbox: null, value: ["RQ"] });
    expect(noHazmatEvidence(r)).toEqual({ doubts: ["marks_on_page"], marks: ["RQ"], markPages: [2] });
  });

  it("doubts a paper whose page rule did not pass, or that has no audit at all", () => {
    expect(noHazmatEvidence(read([], { paperAudit: pagesAudit("cannot_tell"), scan: [] })).doubts).toEqual(["pages_unconfirmed"]);
    expect(noHazmatEvidence(read([], { scan: [] })).doubts).toEqual(["pages_unconfirmed"]);
  });

  it("doubts everything on a read that recorded no hazmat.lines evidence", () => {
    const r = read([], { paperAudit: pagesAudit("pass"), scan: [] });
    r.evidence = r.evidence.filter((e) => e.path !== "hazmat.lines");
    expect(noHazmatEvidence(r).doubts).toEqual(["one_reader", "no_page_scan"]);
  });
});
