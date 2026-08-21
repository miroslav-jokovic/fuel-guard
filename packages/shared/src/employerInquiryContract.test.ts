import { describe, it, expect } from "vitest";
import { driverNameForInquiry } from "./employerInquiryContract.js";

/**
 * §391.23(a)(2), as the one line that makes a former name worth collecting.
 *
 * A carrier must investigate the driver's previous three years of employment. A driver who drove for
 * four of them under a maiden name is a driver that employer's records do not contain: the inquiry
 * goes out naming somebody they have never heard of, the reply is "no record", and a clean safety
 * history is indistinguishable from an absent one. `employer_inquiries` stores the composed body, so
 * this is also what puts the name that was asked about into the qualification file.
 */
describe("the name an inquiry goes out under", () => {
  it("names both, so the employer can find the person being asked about", () => {
    expect(driverNameForInquiry("Susan Godfrey", ["Susan Smith"]))
      .toBe("Susan Godfrey (also known as Susan Smith)");
  });

  it("lists every former name the driver gave", () => {
    expect(driverNameForInquiry("Susan Godfrey", ["Susan Smith", "Susan Marie Smith"]))
      .toBe("Susan Godfrey (also known as Susan Smith, Susan Marie Smith)");
  });

  /** The common case by far, and it must read exactly as it did before the column existed. */
  it("is just the name when there is no other one", () => {
    expect(driverNameForInquiry("Susan Godfrey", [])).toBe("Susan Godfrey");
    expect(driverNameForInquiry("Susan Godfrey", null)).toBe("Susan Godfrey");
    expect(driverNameForInquiry("Susan Godfrey", undefined)).toBe("Susan Godfrey");
  });

  /** A driver who typed their own name into the box should not be introduced to themselves. */
  it("drops a former name that is the current one, whatever the casing", () => {
    expect(driverNameForInquiry("Susan Godfrey", ["susan godfrey"])).toBe("Susan Godfrey");
    expect(driverNameForInquiry("Susan Godfrey", ["Susan Smith", "susan smith"]))
      .toBe("Susan Godfrey (also known as Susan Smith)");
  });

  it("drops blanks rather than printing an empty alias", () => {
    expect(driverNameForInquiry("Susan Godfrey", ["", "   "])).toBe("Susan Godfrey");
  });
});
