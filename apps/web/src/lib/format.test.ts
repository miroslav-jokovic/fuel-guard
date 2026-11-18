import { describe, it, expect } from "vitest";
import { describeDriverEdit, formatDate, formatDateTime, formatPhone, phoneDialString } from "./format";

describe("phoneDialString", () => {
  it("dials every US shape Samsara stores as +1 and ten digits", () => {
    for (const raw of ["5125550134", "+15125550134", "15125550134", "512-555-0134", "(512) 555-0134"]) {
      expect(phoneDialString(raw)).toBe("+15125550134");
    }
  });
  it("keeps an international number as stored, with its plus", () => {
    expect(phoneDialString("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("gives no number for a blank or a value no phone could dial", () => {
    expect(phoneDialString(null)).toBeNull();
    expect(phoneDialString("   ")).toBeNull();
    expect(phoneDialString("n/a")).toBeNull();
    expect(phoneDialString("ext 42")).toBeNull();
  });
});

describe("formatDate", () => {
  it("formats a calendar date without timezone shifting", () => {
    expect(formatDate("2026-08-08T00:00:00.000Z")).toBe("08/08/2026");
  });
  it("returns an em dash for missing dates", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("formats a timestamp with date and time", () => {
    expect(formatDateTime("2026-08-08T15:04:00.000Z")).toMatch(/08\/08\/2026/);
  });
  it("returns an em dash for missing timestamps", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});

describe("formatPhone", () => {
  it("formats a bare 10-digit number", () => {
    expect(formatPhone("5125550134")).toBe("(512) 555-0134");
  });
  it("strips a leading +1 / country code", () => {
    expect(formatPhone("+15125550134")).toBe("(512) 555-0134");
    expect(formatPhone("15125550134")).toBe("(512) 555-0134");
  });
  it("normalises already-punctuated forms", () => {
    expect(formatPhone("512-555-0134")).toBe("(512) 555-0134");
    expect(formatPhone(" (512) 555-0134 ")).toBe("(512) 555-0134");
  });
  it("returns an em dash for empty/null", () => {
    expect(formatPhone(null)).toBe("—");
    expect(formatPhone(undefined)).toBe("—");
    expect(formatPhone("")).toBe("—");
    expect(formatPhone("   ")).toBe("—");
  });
  it("leaves non-NANP numbers untouched (trimmed)", () => {
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhone("5125550134x22")).toBe("5125550134x22");
    expect(formatPhone("911")).toBe("911");
  });
});

/**
 * What a driver edit turned out to mean (R6a).
 *
 * These are not "saved successfully" messages. Both are consequences the person did not necessarily
 * ask for: claiming a row stops the sync enriching it, permanently; stamping a termination date
 * starts the §391.51(c) retention clock. Before R6a both were written to `audit_logs.meta` and to
 * nowhere the person could see.
 */
describe("describeDriverEdit", () => {
  const flags = (over: Partial<{ claimedFromTelematics: boolean; stampedTerminationDate: boolean }> = {}) => ({
    claimedFromTelematics: false,
    stampedTerminationDate: false,
    ...over,
  });

  it("says nothing for an edit that meant only itself", () => {
    // Null, not "Saved." — so an ordinary edit renders no second line at all.
    expect(describeDriverEdit(flags())).toBeNull();
  });

  it("says the row left the sync", () => {
    expect(describeDriverEdit(flags({ claimedFromTelematics: true }))).toContain("maintained here");
  });

  it("says the retention clock started", () => {
    expect(describeDriverEdit(flags({ stampedTerminationDate: true }))).toContain("termination date");
  });

  it("says both when both are true, rather than only the first", () => {
    const said = describeDriverEdit(flags({ claimedFromTelematics: true, stampedTerminationDate: true }))!;
    expect(said).toContain("maintained here");
    expect(said).toContain("termination date");
  });
});
