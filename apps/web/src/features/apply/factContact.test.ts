import { describe, expect, it } from "vitest";
import { contactNotice, contactToast } from "./factContact";
import type { FactRow } from "./applicantFactRows";

/** E3: the office is told what Save will do to how the carrier reaches the applicant, before and after. */
const row = (head: string): FactRow =>
  ({ key: head, path: [head], label: head, input: "text", value: "x", door: "draft", corrected: false, section: "identity" }) as FactRow;

describe("what the card says about the applicant's contact", () => {
  it("says where emails go now, and that Save moves them", () => {
    expect(contactNotice(row("email"), { email: "s@example.test", phoneTexted: false })).toContain("go to s@example.test");
    expect(contactNotice(row("email"), { email: null, phoneTexted: false })).toContain("also sends");
  });

  it("⚠ warns before Save that a texted phone's texts stop, and says nothing when it is not texted", () => {
    expect(contactNotice(row("phone"), { email: null, phoneTexted: true })).toContain("Saving stops them");
    expect(contactNotice(row("phone"), { email: null, phoneTexted: false })).toBeNull();
  });

  it("promises nothing against an API that moves nothing, or for another answer", () => {
    expect(contactNotice(row("email"), undefined)).toBeNull();
    expect(contactNotice(row("city"), { email: "s@example.test", phoneTexted: true })).toBeNull();
  });

  it("says after Save what moved", () => {
    expect(contactToast({ emailMoved: true })).toContain("emails now go to the new address");
    // Q-AM16: the roster's record is named only when it actually followed.
    expect(contactToast({ emailMoved: true })).not.toContain("driver record");
    expect(contactToast({ emailMoved: true, rosterEmailMoved: true })).toContain("driver record has the new address");
    expect(contactToast({ textsStopped: true })).toContain("old number have stopped");
    expect(contactToast(undefined)).toBe("The applicant is shown this change before they sign.");
  });
});
