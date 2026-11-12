import { describe, expect, it } from "vitest";
import { APPLICANTS_QUERY_KEYS, applicantsToQuery } from "./applicantsLinkContract.js";
import { DRIVERS_QUERY_KEYS, driversToQuery } from "./driversLinkContract.js";
import { FUEL_CARDS_QUERY_KEYS, fuelCardsToQuery } from "./fuelCardsLinkContract.js";

describe("the Applicants, Drivers and Fuel cards link contracts (F21 R4b)", () => {
  it("Applicants: everybody is written `any`, since the board opens on waiting-on-you; a stage only when named", () => {
    expect(applicantsToQuery({ waiting: null })).toEqual({ waiting: "any" });
    expect(applicantsToQuery({ waiting: "us", phase: "screening" })).toEqual({ waiting: "us", phase: "screening" });
    expect(APPLICANTS_QUERY_KEYS).toEqual({ waiting: "waiting", phase: "phase" });
  });

  it("Drivers: a File word and every status as `any`, since the roster opens on active", () => {
    expect(driversToQuery({ file: "expired", status: null })).toEqual({ file: "expired", status: "any" });
    expect(driversToQuery({ file: "attention", status: "on_leave" })).toEqual({ file: "attention", status: "on_leave" });
    expect([DRIVERS_QUERY_KEYS.file, DRIVERS_QUERY_KEYS.status]).toEqual(["file", "status"]);
  });

  it("Fuel cards: one catalogue status", () => {
    expect(fuelCardsToQuery({ status: "Hold" })).toEqual({ status: "Hold" });
    expect(FUEL_CARDS_QUERY_KEYS.status).toBe("status");
  });
});
