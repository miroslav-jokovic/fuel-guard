import { describe, expect, it } from "vitest";
import { blankEmployer, employerFields, employerRecord } from "./employerRow";

/**
 * A job between its stored row and the one employer form (HW5b), for the answers that are not a Yes or a
 * No: a question nobody answered, and the driver's "Not sure" to the one DOT question (Q-AM9 (a)).
 */
describe("a job's unanswered questions, stored and read back", () => {
  it("reads a stored null as unanswered, never as a Yes put in front of the office", () => {
    const fields = employerFields({ employer_name: "Midwest Freight", operated_cmv: null, dot_regulated: null });
    expect([fields.operated_cmv, fields.dot_regulated]).toEqual([null, null]);
  });

  it("reads a row that never had the two questions as the Yes its own form showed then", () => {
    const fields = employerFields({ employer_name: "Midwest Freight" });
    expect([fields.operated_cmv, fields.dot_regulated]).toEqual([true, true]);
  });

  it("keeps Not sure while the DOT question is open, and drops it once anyone answers", () => {
    const unsure = { ...blankEmployer(), employer_name: "Midwest Freight", started_on: "2024-01-01", dot_not_sure: true };
    expect(employerRecord(unsure).dot_not_sure).toBe(true);
    expect(employerFields(employerRecord(unsure)).dot_not_sure).toBe(true);
    expect("dot_not_sure" in employerRecord({ ...unsure, dot_regulated: false })).toBe(false);
  });

  it("writes no such key for a job the driver answered", () => {
    expect("dot_not_sure" in employerRecord({ ...blankEmployer(), employer_name: "A", dot_regulated: true })).toBe(false);
  });
});
