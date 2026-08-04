import { describe, it, expect } from "vitest";
import { formatPhone } from "./format";

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
