import { describe, it, expect } from "vitest";
import {
  isTruck,
  tmsTractorPeriodsPayloadSchema,
  truckDays,
  truckOwnership,
  unitsOutsideCensus,
  type TractorPeriod,
} from "./truckDays.js";

/**
 * Truck-days, the spread basis (TRUCK-DRIVER-PNL-PLAN P2, D-TP3): a truck carries the days of a
 * period it was in service, from McLeod's own service dates.
 */
const truck = (tractor_id: string, over: Partial<TractorPeriod> = {}): TractorPeriod => ({
  tractor_id,
  company_id: "TMS",
  in_service_on: "2024-01-15",
  out_of_service_on: null,
  purchased_on: "2024-01-10",
  model_year: "2024",
  service_status: "A",
  tractor_status: "A",
  owner_id: "SILVMEIL",
  pay_owner: "D",
  ...over,
});

const JULY = ["2026-07-01", "2026-08-01"] as const;

describe("truckDays", () => {
  it("gives a truck in service all month every day of it", () => {
    const r = truckDays([truck("101")], ...JULY);
    expect(r.trucks).toEqual([{ tractor_id: "101", company_id: "TMS", ownership: "carrier", days: 31 }]);
    expect(r.days).toBe(31);
  });

  it("starts a truck bought mid-month on its in-service day — the 20th carries twelve days of July", () => {
    const r = truckDays([truck("102", { in_service_on: "2026-07-20" })], ...JULY);
    expect(r.trucks[0]!.days).toBe(12);
  });

  it("stops a truck on its out-of-service day, which it does not carry", () => {
    const r = truckDays([truck("103", { out_of_service_on: "2026-07-09" })], ...JULY);
    expect(r.trucks[0]!.days).toBe(8);
  });

  it("lists no truck whose service does not reach the period", () => {
    const r = truckDays(
      [
        truck("104", { out_of_service_on: "2026-07-01" }),
        truck("105", { in_service_on: "2026-08-01" }),
      ],
      ...JULY,
    );
    expect(r.trucks).toEqual([]);
    expect(r.days).toBe(0);
  });

  it("leaves out a reserved unit number and an undated tractor, and counts each", () => {
    const r = truckDays(
      [
        truck("106", { purchased_on: null, model_year: " ", in_service_on: "2026-07-01" }),
        truck("107", { in_service_on: null }),
        truck("108"),
      ],
      ...JULY,
    );
    expect(r.trucks.map((t) => t.tractor_id)).toEqual(["108"]);
    expect(r.excluded).toEqual({ reserved: 1, undated: 1 });
  });

  it("splits the days by whose truck it is, so lease and insurance can go over the carrier's only", () => {
    const r = truckDays(
      [
        truck("201"),
        truck("202", { pay_owner: "O", in_service_on: "2026-07-17" }),
        truck("203", { pay_owner: "B" }),
      ],
      ...JULY,
    );
    expect(r.carrierDays).toBe(31);
    expect(r.ownerOperatorDays).toBe(15 + 31);
    expect(r.days).toBe(r.carrierDays + r.ownerOperatorDays);
  });

  it("orders trucks by unit number as a person reads them", () => {
    const r = truckDays([truck("1010"), truck("99"), truck("200")], ...JULY);
    expect(r.trucks.map((t) => t.tractor_id)).toEqual(["99", "200", "1010"]);
  });

  it("counts calendar days across a daylight-saving change", () => {
    const r = truckDays([truck("301")], "2026-11-01", "2026-12-01");
    expect(r.trucks[0]!.days).toBe(30);
  });
});

describe("isTruck", () => {
  it("is a truck with a purchase date or a model year, and a reserved unit number with neither", () => {
    expect(isTruck({ purchased_on: "2024-01-10", model_year: null })).toBe(true);
    expect(isTruck({ purchased_on: null, model_year: "2027" })).toBe(true);
    expect(isTruck({ purchased_on: null, model_year: "  " })).toBe(false);
  });
});

describe("truckOwnership", () => {
  it("reads O and B as owner-operator trucks and everything else as the carrier's", () => {
    expect(truckOwnership({ pay_owner: "O" })).toBe("owner_operator");
    expect(truckOwnership({ pay_owner: "b " })).toBe("owner_operator");
    expect(truckOwnership({ pay_owner: "D" })).toBe("carrier");
    expect(truckOwnership({ pay_owner: null })).toBe("carrier");
  });
});

describe("unitsOutsideCensus", () => {
  it("names each unit that worked but is not in the census, once, as McLeod pads it", () => {
    const census = truckDays([truck("101"), truck("102", { out_of_service_on: "2026-06-01" })], ...JULY);
    expect(unitsOutsideCensus(census, ["101", "102 ", "UNK", "UNK", ""])).toEqual(["102", "UNK"]);
  });
});

describe("the wire contract", () => {
  it("takes McLeod's dates as days and refuses a timestamp", () => {
    expect(tmsTractorPeriodsPayloadSchema.safeParse({ tractors: [truck("101")] }).success).toBe(true);
    expect(
      tmsTractorPeriodsPayloadSchema.safeParse({ tractors: [truck("101", { in_service_on: "2024-01-15T00:00:00Z" })] }).success,
    ).toBe(false);
  });
});
