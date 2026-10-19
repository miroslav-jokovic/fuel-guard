import { describe, expect, it } from "vitest";
import { matchReportFile } from "./reportFileMatch";

const INSPECTIONS = [
  { id: "a", reportNumber: "3282002265", reportState: "IL" },
  { id: "b", reportNumber: "CV44901292", reportState: "CA" },
  { id: "c", reportNumber: "2026101412", reportState: "IN" },
];

describe("which inspection a dropped report belongs to", () => {
  it("is the inspection whose report number is a whole word of the file name, with or without its state", () => {
    expect(matchReportFile("3282002265.pdf", INSPECTIONS)).toBe("a");
    expect(matchReportFile("report IL3282002265 scan.PDF", INSPECTIONS)).toBe("a");
    expect(matchReportFile("cv44901292-page1.jpg", INSPECTIONS)).toBe("b");
  });

  it("is nobody when the number is only part of a word — a phone's photo name holds ten digits by chance", () => {
    expect(matchReportFile("IMG_20261014123456.jpg", INSPECTIONS)).toBeNull();
    expect(matchReportFile("X3282002265.pdf", INSPECTIONS)).toBeNull();
    expect(matchReportFile("scan.pdf", INSPECTIONS)).toBeNull();
  });

  it("is nobody when two inspections match, rather than a guess", () => {
    expect(matchReportFile("3282002265 and CV44901292.pdf", INSPECTIONS)).toBeNull();
  });
});
