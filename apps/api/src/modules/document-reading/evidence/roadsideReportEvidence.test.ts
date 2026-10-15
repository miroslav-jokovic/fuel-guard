import { describe, expect, it } from "vitest";
import { roadsideInspectionReportSchema, type FieldEvidence } from "@silvicom/shared";
import { roadsideReportEvidence } from "./roadsideReportEvidence.js";
import type { OcrPage } from "./rowWitness.js";

/**
 * The officer's report's evidence (D-IC13). The comparison that may confirm a driver (Q-IC11 (a)) stands
 * on three things recorded here: what each reader read, and whether the page's own characters print the
 * licence. These pin that a reader's absence is never agreement, that a licence is found however the paper
 * punctuates it, and that a short value is never "found" by accident.
 */

const doc = (over: Record<string, unknown> = {}) =>
  roadsideInspectionReportSchema.parse({
    reportNumber: "IL1234005678",
    driver: { name: "MARKO PETROVIC", licenseNumber: "P123-4567-8901", licenseState: "IL" },
    units: [{ unitNumber: "1", vin: "3AKJHHDR5NSNA1234" }],
    ...over,
  });

const at = (ev: FieldEvidence[], path: string) => ev.find((e) => e.path === path)!;
const ocrOf = (...texts: string[]): OcrPage[] => [
  { page: 1, width: 1000, height: 1000, items: texts.map((text) => ({ text, box: { x: 0, y: 0, width: 10, height: 10 } })) },
];

describe("roadsideReportEvidence", () => {
  it("records both readers on every field, and `not_read` only where both read nothing", () => {
    const ev = roadsideReportEvidence(doc(), doc(), "rule-1");
    const licence = at(ev, "driver.licenseNumber");
    expect(licence.sources.map((s) => [s.reader, s.value])).toEqual([["passA", "P123-4567-8901"], ["passB", "P123-4567-8901"]]);
    expect(licence.status).toBe("check");
    expect(at(ev, "location").status).toBe("not_read");
  });

  it("⚠ records no pass B source when pass B produced no document — one reader is never agreement", () => {
    const licence = at(roadsideReportEvidence(doc(), null, "rule-1"), "driver.licenseNumber");
    expect(licence.sources.map((s) => s.reader)).toEqual(["passA"]);
  });

  it("⚠ the OCR witness finds a licence however the paper punctuates it, and says which reader it backs", () => {
    const b = doc({ driver: { name: "MARKO PETROVIC", licenseNumber: "P123-4567-8907", licenseState: "IL" } });
    const ev = roadsideReportEvidence(doc(), b, "rule-1", ocrOf("DL#", "P1234567", "8901", "ST IL"));
    expect(at(ev, "driver.licenseNumber").sources.find((s) => s.reader === "ocr")!.value).toEqual(["passA"]);
  });

  it("witnesses only the deciding fields — a name is compared, it never confirms", () => {
    const ev = roadsideReportEvidence(doc(), doc(), "rule-1", ocrOf("MARKO PETROVIC"));
    expect(at(ev, "driver.name").sources.some((s) => s.reader === "ocr")).toBe(false);
    expect(at(ev, "units[0].vin").sources.some((s) => s.reader === "ocr")).toBe(true);
  });

  it("⚠ never 'finds' a value too short to prove anything printed", () => {
    const short = doc({ reportNumber: "12" });
    const ev = roadsideReportEvidence(short, short, "rule-1", ocrOf("A 12 B"));
    expect(at(ev, "reportNumber").sources.find((s) => s.reader === "ocr")!.value).toEqual([]);
  });

  it("emits a row only pass B saw, after A's — a missed violation is shown, never dropped", () => {
    const b = doc({ violations: [{ code: "393.9TS", unitNumber: "1" }] });
    const ev = roadsideReportEvidence(doc(), b, "rule-1");
    const code = at(ev, "violations[0].code");
    expect(code.sources.map((s) => s.reader)).toEqual(["passB"]);
    expect(code.value).toBe("393.9TS");
  });
});
