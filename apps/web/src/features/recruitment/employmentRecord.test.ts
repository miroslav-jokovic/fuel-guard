import { describe, expect, it } from "vitest";
import type { EmploymentHistory } from "@silvicom/shared";
import { blankEmployer } from "@/components/employment/employerRow";
import { historyToFields, historyWrite } from "./employmentRecord";

/**
 * The office record's save path behind the one employer form (HW5b, EM-5, EM-6): an office add is
 * "Added by the office", the street is carried, a change sends only what changed, and the inquiry's
 * derived status and dates are never sent from the form.
 */
const DRIVER = "11111111-1111-4111-8111-111111111111";
const ROW: EmploymentHistory = {
  id: "22222222-2222-4222-8222-222222222222", driver_id: DRIVER, employer_name: "Old Carrier", usdot_number: null,
  employer_address_line1: "12 Depot Rd", employer_city: "Joliet", employer_state: "IL", employer_phone: null,
  employer_email: null, position_held: "Driver", started_on: "2022-01-01", ended_on: "2024-01-01",
  dot_regulated: true, operated_cmv: null, subject_to_fmcsr: null, safety_sensitive: null, reason_for_leaving: "Moved",
  inquiry_status: "responded", inquiry_sent_on: "2024-02-01", inquiry_response_on: "2024-02-10",
  source: "application", notes: "Called twice", created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
};

describe("an office add (EM-5)", () => {
  it("is saved as added by the office, with the street, and with no inquiry status typed in", () => {
    const fields = { ...blankEmployer(), employer_name: "Werner", started_on: "2023-01-01", address_line1: "1 Frontier Rd", city: "Omaha", state: "NE" };
    const { body, errors } = historyWrite(fields, "", DRIVER, null);
    expect(errors).toEqual({});
    expect(body).toMatchObject({
      driver_id: DRIVER, source: "manual", employer_name: "Werner", employer_address_line1: "1 Frontier Rd",
      employer_city: "Omaha", employer_state: "NE", operated_cmv: true, dot_regulated: true,
    });
    // The create schema fills its own default ("pending"); the form never sends one of its own.
    expect(body).not.toHaveProperty("inquiry_sent_on");
    expect(body).not.toHaveProperty("inquiry_response_on");
  });

  it("refuses a job with no name, under the form's own box", () => {
    expect(historyWrite(blankEmployer(), "", DRIVER, null).errors).toHaveProperty("employer_name");
  });
});

describe("a change to a row (EM-6)", () => {
  it("sends only what changed — never the inquiry, never the source", () => {
    const fields = { ...historyToFields(ROW), city: "Chicago" };
    expect(historyWrite(fields, ROW.notes!, DRIVER, ROW).body).toEqual({ employer_city: "Chicago" });
  });

  it("sends nothing for a row nobody changed, though the form shows an unstated 'drove a truck' as Yes", () => {
    expect(historyToFields(ROW).operated_cmv).toBe(true);
    expect(historyWrite(historyToFields(ROW), ROW.notes!, DRIVER, ROW).body).toEqual({});
  });

  it("writes an answer that was given — a No to 'drove a truck', the (iv) answers, the notes", () => {
    const fields = { ...historyToFields(ROW), operated_cmv: false, subject_to_fmcsr: true, safety_sensitive: false };
    expect(historyWrite(fields, "Called three times", DRIVER, ROW).body).toEqual({
      operated_cmv: false, subject_to_fmcsr: true, safety_sensitive: false, notes: "Called three times",
    });
  });

  it("reads the record's street into the form's street box", () => {
    expect(historyToFields(ROW).address_line1).toBe("12 Depot Rd");
  });
});
