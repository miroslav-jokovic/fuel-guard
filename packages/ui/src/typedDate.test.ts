import { describe, expect, it } from "vitest";
import { maskTypedDate, parseTypedDate, spellTypedDate, typedDateText, type TypedDateKind } from "./typedDate";

/**
 * APPLICATION-SCREEN-MAP §9 (D-AM6): the owner's examples first. "1001" is October 1 of this year,
 * "10011985" is October 1, 1985. Every other row of the §9 table follows.
 */
const TODAY = "2026-11-09";
const read = (text: string, kind: TypedDateKind = "any") => {
  const r = parseTypedDate(text, kind, TODAY);
  return r.ok ? r.iso : r.problem;
};

describe("a date typed the way the owner types it", () => {
  it("reads 1001 as October 1 of this year, and 10011985 as October 1, 1985", () => {
    expect(read("1001")).toBe("2026-10-01");
    expect(read("10011985")).toBe("1985-10-01");
  });

  it("reads separators as typed", () => {
    for (const t of ["10/1/85", "10-1-85", "10.1.1985", "10 1 85", "10/01/1985"]) expect(read(t, "dob"), t).toBe("1985-10-01");
    expect(read("1/5")).toBe("2026-01-05");
  });

  it("breaks a run of digits where a person means it, without leading zeros", () => {
    expect(read("315")).toBe("2026-03-15");
    expect(read("15")).toBe("2026-01-05");
    expect(read("0105")).toBe("2026-01-05");
    expect(read("1213")).toBe("2026-12-13");
    expect(read("31585", "dob")).toBe("1985-03-15");
  });

  it("puts a two-digit year in the century the field makes sense of", () => {
    expect(read("100185", "dob")).toBe("1985-10-01");
    // A birth year of '05 is 2005 (21), and '25 can only be 1925 — 101 is not an applicant's age, so it asks.
    expect(read("100105", "dob")).toBe("2005-10-01");
    expect(read("100125", "dob")).toBe("badAge");
    expect(read("100128", "future")).toBe("2028-10-01");
    expect(read("100124", "past")).toBe("2024-10-01");
    expect(read("100127", "past")).toBe("1927-10-01");
  });

  it("never assumes this year for a date of birth", () => {
    expect(read("1001", "dob")).toBe("needsYear");
  });

  it("puts a past-only date with no year into last year rather than the future", () => {
    expect(read("1215", "past")).toBe("2025-12-15");
    expect(read("1001", "past")).toBe("2026-10-01");
    expect(read("1109", "past")).toBe("2026-11-09");
  });

  it("refuses a day the month does not have, and a month that does not exist", () => {
    expect(read("0230")).toBe("badDay");
    expect(read("02/29/2027")).toBe("badDay");
    expect(read("02/29/2028")).toBe("2028-02-29");
    expect(read("13/01/2026")).toBe("badMonth");
    expect(read("0/1")).toBe("badMonth");
  });

  it("says a half-typed date is still being typed, not wrong", () => {
    for (const t of ["1", "10", "10/0", "10/01/1", "10/01/198"]) expect(read(t), t).toBe("incomplete");
    expect(read("")).toBe("empty");
    expect(read("Oct 1")).toBe("unreadable");
    expect(read("100119851")).toBe("unreadable");
  });

  it("reads a month on a month field", () => {
    expect(read("0319", "month")).toBe("2019-03");
    expect(read("319", "month")).toBe("2019-03");
    expect(read("3/19", "month")).toBe("2019-03");
    expect(read("032019", "month")).toBe("2019-03");
    expect(read("1226", "month")).toBe("2026-12");
    expect(read("1227", "month")).toBe("1927-12");
  });
});

describe("the box as it is typed in", () => {
  it("draws the slashes where the reading breaks, so the screen shows how it is read", () => {
    expect(maskTypedDate("1001", "any")).toBe("10/01");
    expect(maskTypedDate("10011985", "dob")).toBe("10/01/1985");
    expect(maskTypedDate("315", "any")).toBe("3/15");
    expect(maskTypedDate("10", "any")).toBe("10");
    expect(maskTypedDate("032019", "month")).toBe("03/2019");
    // Re-masking its own output changes nothing, and backspacing over a slash leaves the digits.
    expect(maskTypedDate("10/01/1985", "dob")).toBe("10/01/1985");
    expect(maskTypedDate("10/0", "any")).toBe("10/0");
  });

  it("leaves separators the driver typed alone", () => {
    expect(maskTypedDate("10/1/85", "dob")).toBe("10/1/85");
    expect(maskTypedDate("10-1-85", "dob")).toBe("10-1-85");
  });

  it("reads back what it writes for a stored value", () => {
    expect(typedDateText("1985-10-01")).toBe("10/01/1985");
    expect(typedDateText("2019-03")).toBe("03/2019");
    expect(typedDateText("")).toBe("");
    expect(read(typedDateText("1985-10-01"), "dob")).toBe("1985-10-01");
    expect(read(typedDateText("2019-03"), "month")).toBe("2019-03");
  });
});

describe("the date in words", () => {
  it("spells it in the page's language", () => {
    expect(spellTypedDate("1985-10-01")).toBe("October 1, 1985");
    expect(spellTypedDate("1985-10-01", "es")).toBe("1 de octubre de 1985");
    expect(spellTypedDate("2019-03")).toBe("March 2019");
    expect(spellTypedDate("2019-03", "es")).toBe("marzo de 2019");
  });
});
