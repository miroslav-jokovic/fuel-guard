import { describe, it, expect } from "vitest";
import { dateOfBirthIssue, driverUpdateSchema, touchesDriverLifecycle } from "./rosterContract.js";

/**
 * Date of birth is the input that gates PSP, a SambaSafety MVR and a Clearinghouse query, and PSP
 * bills on a `Failure` response — so these are cost-control assertions, not form-polish ones
 * (PSP-PLAN.md §4a, P0).
 */
describe("dateOfBirthIssue — the rules that stop a billed lookup that could never match", () => {
  const today = "2026-08-19";

  it("accepts an ordinary adult date of birth", () => {
    expect(dateOfBirthIssue("1980-03-14", today)).toBeNull();
  });

  it("rejects a day that does not exist — the gap isoDateSchema's regex leaves open", () => {
    // 2026-02-31 passes /^\d{4}-\d{2}-\d{2}$/ and then makes Postgres throw a 500.
    expect(dateOfBirthIssue("1990-02-31", today)).toBe("That is not a real date");
    expect(dateOfBirthIssue("1990-13-01", today)).toBe("That is not a real date");
  });

  it("rejects the transposed century — 2025 typed for 1925, and the future outright", () => {
    expect(dateOfBirthIssue("2027-01-01", today)).toBe("Date of birth cannot be in the future");
    expect(dateOfBirthIssue("1825-06-01", today)).toBe(
      "Check the year — that date of birth is over 120 years ago",
    );
  });

  it("takes PSP's floor of 18, not §391.11(b)(1)'s 21 — fitness to drive is the gate's question", () => {
    expect(dateOfBirthIssue("2009-08-20", today)).toBe("A driver must be at least 18 years old");
    expect(dateOfBirthIssue("2008-08-19", today)).toBeNull(); // 18 exactly, on the birthday
    expect(dateOfBirthIssue("2008-08-20", today)).toBe("A driver must be at least 18 years old");
    expect(dateOfBirthIssue("2007-01-01", today)).toBeNull(); // 19 — well clear of §391.11's 21
  });

  it("counts whole years by the birthday, never by dividing milliseconds", () => {
    // A leap-day birth one day short of the birthday is 17, and ms/365.25 rounds it to 18.
    expect(dateOfBirthIssue("2008-02-29", "2026-02-28")).toBe("A driver must be at least 18 years old");
    expect(dateOfBirthIssue("2008-02-29", "2026-03-01")).toBeNull();
  });
});

describe("driverUpdateSchema — date_of_birth goes through the stricter rule", () => {
  it("clears the field on an empty string, as a blanked date input posts it", () => {
    const parsed = driverUpdateSchema.safeParse({ date_of_birth: "" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.date_of_birth).toBeNull();
  });

  it("refuses an impossible date rather than passing it to Postgres", () => {
    expect(driverUpdateSchema.safeParse({ date_of_birth: "1990-02-31" }).success).toBe(false);
  });

  it("still accepts a plain valid one", () => {
    expect(driverUpdateSchema.safeParse({ date_of_birth: "1975-11-02" }).success).toBe(true);
  });
});

describe("touchesDriverLifecycle — gated on the FIELD, not on the value", () => {
  it("catches both halves of one act", () => {
    expect(touchesDriverLifecycle({ status: "terminated" })).toBe(true);
    // `termination_date` alone reaches the same §391.51(c) retention clock by a side door.
    expect(touchesDriverLifecycle({ termination_date: "2026-01-01" })).toBe(true);
  });

  it("catches UN-terminating too, which a rule about the value `terminated` would miss", () => {
    expect(touchesDriverLifecycle({ status: "active" })).toBe(true);
    expect(touchesDriverLifecycle({ status: "on_leave" })).toBe(true);
  });

  it("leaves an ordinary roster edit alone", () => {
    expect(touchesDriverLifecycle({ date_of_birth: "1980-01-01", cdl_number: "D1" })).toBe(false);
    expect(touchesDriverLifecycle({})).toBe(false);
  });

  it("reads a CLEARED field as a touch — `null` is still a change", () => {
    expect(touchesDriverLifecycle({ termination_date: null })).toBe(true);
  });
});
