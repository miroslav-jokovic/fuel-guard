import { describe, it, expect } from "vitest";
import { planDobImport, serializeDobCsv, type DobCsvDriver } from "./driverDobCsv.js";

const TODAY = "2026-08-20";

const driver = (over: Partial<DobCsvDriver> = {}): DobCsvDriver => ({
  id: "11111111-1111-4111-8111-111111111111",
  full_name: "Susan Godfrey",
  employee_id: "E-100",
  cdl_number: "PA334554",
  date_of_birth: null,
  ...over,
});

const csv = (...lines: string[]) => lines.join("\r\n") + "\r\n";
const HEADER = "driver_id,full_name,employee_id,cdl_number,date_of_birth";

describe("the template", () => {
  it("carries the id that makes a match unambiguous, and leaves the date blank to fill in", () => {
    const out = serializeDobCsv([driver()]);
    expect(out.split("\r\n")[0]).toBe(HEADER);
    expect(out).toContain("11111111-1111-4111-8111-111111111111,Susan Godfrey,E-100,PA334554,");
  });

  it("quotes a name containing a comma so the round trip survives it", () => {
    expect(serializeDobCsv([driver({ full_name: "Godfrey, Susan" })])).toContain('"Godfrey, Susan"');
  });
});

describe("matching a row to a driver", () => {
  it("matches on the id and says so", () => {
    const plan = planDobImport(
      csv(HEADER, `${driver().id},,,,1949-12-11`),
      [driver()],
      TODAY,
    );
    expect(plan.matches).toEqual([
      {
        line: 2,
        driverId: driver().id,
        name: "Susan Godfrey",
        dateOfBirth: "1949-12-11",
        matchedBy: "driver_id",
      },
    ]);
  });

  /** The payroll export that has never heard of us: names and dates, nothing else. */
  it("matches a payroll sheet on name alone", () => {
    const plan = planDobImport(
      csv("full_name,date_of_birth", "Susan Godfrey,1949-12-11"),
      [driver()],
      TODAY,
    );
    expect(plan.matches[0]).toMatchObject({ matchedBy: "name", dateOfBirth: "1949-12-11" });
  });

  it("prefers the id over the name when the row carries both", () => {
    const other = driver({ id: "22222222-2222-4222-8222-222222222222", full_name: "Gary Thomas" });
    const plan = planDobImport(
      csv(HEADER, `${other.id},Susan Godfrey,,,1970-01-05`),
      [driver(), other],
      TODAY,
    );
    expect(plan.matches[0]).toMatchObject({ driverId: other.id, matchedBy: "driver_id" });
  });

  it("matches on an employee number and on a licence number", () => {
    const byEmployee = planDobImport(csv("employee_id,date_of_birth", "E-100,1949-12-11"), [driver()], TODAY);
    expect(byEmployee.matches[0]?.matchedBy).toBe("employee_id");
    const byCdl = planDobImport(csv("cdl_number,date_of_birth", "PA334554,1949-12-11"), [driver()], TODAY);
    expect(byCdl.matches[0]?.matchedBy).toBe("cdl_number");
  });

  it("ignores case and surrounding space in the keys", () => {
    const plan = planDobImport(csv("full_name,date_of_birth", "  SUSAN GODFREY ,1949-12-11"), [driver()], TODAY);
    expect(plan.matches).toHaveLength(1);
  });
});

describe("what it refuses to do", () => {
  /**
   * The whole reason this module exists rather than a loop over PATCH: a date of birth on the wrong
   * driver is a screening request about the wrong person, billed, and possibly a record filed against
   * somebody whose job depends on it.
   */
  it("refuses two drivers with the same name instead of picking one", () => {
    const twin = driver({ id: "33333333-3333-4333-8333-333333333333", employee_id: "E-200", cdl_number: null });
    const plan = planDobImport(csv("full_name,date_of_birth", "Susan Godfrey,1949-12-11"), [driver(), twin], TODAY);
    expect(plan.matches).toEqual([]);
    expect(plan.rejects[0]).toMatchObject({ reason: "ambiguous", label: "Susan Godfrey" });
    expect(plan.rejects[0]?.detail).toContain("driver_id");
  });

  it("refuses two rows that both claim one driver, naming the earlier line", () => {
    const plan = planDobImport(
      csv(HEADER, `${driver().id},,,,1949-12-11`, `${driver().id},,,,1950-01-01`),
      [driver()],
      TODAY,
    );
    expect(plan.matches).toHaveLength(1);
    expect(plan.rejects[0]).toMatchObject({ line: 3, reason: "ambiguous" });
    expect(plan.rejects[0]?.detail).toContain("Line 2");
  });

  it("never overwrites a date of birth already on file", () => {
    const known = driver({ date_of_birth: "1949-12-11" });
    const plan = planDobImport(csv(HEADER, `${known.id},,,,1970-01-05`), [known], TODAY);
    expect(plan.matches).toEqual([]);
    expect(plan.rejects[0]?.reason).toBe("already_on_file");
  });

  it("reports a row that matches nobody", () => {
    const plan = planDobImport(csv("full_name,date_of_birth", "Nobody Here,1949-12-11"), [driver()], TODAY);
    expect(plan.rejects[0]).toMatchObject({ reason: "no_match", label: "Nobody Here" });
  });

  /**
   * 03/04/1980 is two different real dates depending on where the spreadsheet came from, both pass
   * validation, and the wrong one is invisible until PSP charges us for a Failure. Refused, with the
   * fix named.
   */
  it("refuses an ambiguous date format rather than guessing between them", () => {
    const plan = planDobImport(csv("full_name,date_of_birth", "Susan Godfrey,03/04/1980"), [driver()], TODAY);
    expect(plan.matches).toEqual([]);
    expect(plan.rejects[0]?.reason).toBe("invalid_date");
    expect(plan.rejects[0]?.detail).toContain("YYYY-MM-DD");
  });

  it("accepts YYYY/MM/DD, which cannot be read two ways", () => {
    const plan = planDobImport(csv("full_name,date_of_birth", "Susan Godfrey,1949/12/11"), [driver()], TODAY);
    expect(plan.matches[0]?.dateOfBirth).toBe("1949-12-11");
  });

  it("applies the roster's own age rules", () => {
    const tooYoung = planDobImport(csv("full_name,date_of_birth", "Susan Godfrey,2015-01-01"), [driver()], TODAY);
    expect(tooYoung.rejects[0]?.detail).toContain("18");
    const future = planDobImport(csv("full_name,date_of_birth", "Susan Godfrey,2030-01-01"), [driver()], TODAY);
    expect(future.rejects[0]?.detail).toContain("future");
  });
});

describe("what it says about the file itself", () => {
  it("refuses a file with no date column", () => {
    expect(planDobImport(csv("full_name,dob", "Susan Godfrey,1949-12-11"), [driver()], TODAY).errors[0])
      .toContain("date_of_birth");
  });

  it("refuses a file with nothing to match on", () => {
    expect(planDobImport(csv("date_of_birth", "1949-12-11"), [driver()], TODAY).errors[0])
      .toContain("Nothing to match on");
  });

  it("refuses an empty sheet", () => {
    expect(planDobImport(csv(HEADER), [driver()], TODAY).errors[0]).toContain("no data rows");
  });

  it("tolerates extra columns and any column order", () => {
    const plan = planDobImport(
      csv("payroll_ref,date_of_birth,full_name", "X-1,1949-12-11,Susan Godfrey"),
      [driver()],
      TODAY,
    );
    expect(plan.matches).toHaveLength(1);
  });
});
