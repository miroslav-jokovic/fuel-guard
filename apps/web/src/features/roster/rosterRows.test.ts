import { describe, expect, it } from "vitest";
import type { Driver } from "@silvicom/shared";
import { filterRoster, type RosterRowFilters } from "./rosterRows";

const driver = (id: string, over: Partial<Driver> = {}): Driver =>
  ({ id, full_name: id.toUpperCase(), status: "active", archived_at: null, phone: null, employee_id: null, samsara_username: null, current_hos_vehicle: null, ...over }) as Driver;

const base: RosterRowFilters = { term: "", status: "", showArchived: false, seat: "", seated: new Set(), units: new Map(), file: "", due: "", req: "" };
const names = (ds: Driver[]) => ds.map((d) => d.id);

describe("the Drivers list's search (HOME-TIME-VISIBILITY-PLAN D-HT22)", () => {
  // Production's case, 2026-11-23: the unit number sat inside another driver's phone number.
  const leonard = driver("leonard", { phone: "(312) 555-0134" });
  const jane = driver("jane", { phone: "(773) 676-2210" });
  const units = new Map([["leonard", ["676"]], ["jane", ["412"]]]);

  it("finds the driver in the truck, and not the one whose phone holds the digits", () => {
    expect(names(filterRoster([leonard, jane], new Map(), { ...base, units, term: "676" }))).toEqual(["leonard"]);
  });

  it("finds the truck Samsara has him signed in to, when the roster seats him elsewhere", () => {
    const signedIn = driver("sam", { current_hos_vehicle: "901" });
    expect(names(filterRoster([signedIn, jane], new Map(), { ...base, units, term: "901" }))).toEqual(["sam"]);
  });

  it("still finds by name, Samsara username and a phone typed as digits", () => {
    const d = driver("x", { full_name: "LEONARD BURRELL", samsara_username: "lburrell", phone: "(312) 555-0134" });
    for (const term of ["burrell", "lburr", "555-0134"]) expect(names(filterRoster([d], new Map(), { ...base, term }))).toEqual(["x"]);
  });
});
