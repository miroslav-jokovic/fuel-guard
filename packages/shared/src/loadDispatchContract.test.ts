import { describe, expect, it } from "vitest";
import { composeLoadDispatchSms, isDispatchable, type DispatchSmsInput } from "./loadDispatchContract.js";

/**
 * The text a driver is sent (LR-D2). The API composes it for the preview AND the send, so these are
 * the properties both depend on: the carrier's clock, the first pickup and last delivery by McLeod's
 * sequence, and a body a GSM-7 segment can carry.
 */
const base: DispatchSmsInput = {
  carrierName: "Silvicom Transport",
  loadRef: "0012345",
  truck: "702",
  trailer: "5301",
  timeZone: "America/Chicago",
  stops: [
    { seq: 3, kind: "dropoff", name: "Kroger DC", city: "Chicago", state: "IL", appointmentStart: "2026-09-26T19:00:00Z" },
    { seq: 1, kind: "pickup", name: "ACME Foods", city: "Dallas", state: "TX", appointmentStart: "2026-09-25T13:00:00Z" },
    { seq: 2, kind: "dropoff", name: "Midway", city: "Tulsa", state: "OK", appointmentStart: null },
  ],
};

describe("composeLoadDispatchSms", () => {
  it("names the first pickup and the last delivery, by sequence, on the carrier's clock", () => {
    expect(composeLoadDispatchSms(base)).toBe(
      [
        "Silvicom Transport: load 0012345",
        "Truck 702, trailer 5301",
        "Pick up: ACME Foods, Dallas TX, 09/25/2026 8:00 AM",
        "Deliver: Kroger DC, Chicago IL, 09/26/2026 2:00 PM",
        "+1 more stop",
      ].join("\n"),
    );
  });

  it("says a stop has no appointment rather than inventing one", () => {
    const body = composeLoadDispatchSms({ ...base, stops: [{ ...base.stops[1]!, appointmentStart: null }] });
    expect(body).toContain("Pick up: ACME Foods, Dallas TX, no appointment");
    expect(body).not.toContain("Deliver:");
  });

  it("drops the equipment line when McLeod gave neither unit", () => {
    expect(composeLoadDispatchSms({ ...base, truck: null, trailer: null }).split("\n")[1]).toMatch(/^Pick up:/);
  });

  it("stays inside the GSM-7 alphabet a plain segment carries", () => {
    expect(composeLoadDispatchSms(base)).toMatch(/^[\x20-\x7E\n]*$/);
  });
});

describe("isDispatchable", () => {
  it("offers Dispatch on an open McLeod load only", () => {
    expect(isDispatchable({ source: "tms", status: "in_transit" })).toBe(true);
    expect(isDispatchable({ source: "tms", status: "pending_approval" })).toBe(true);
    expect(isDispatchable({ source: "tms", status: "delivered" })).toBe(false);
    expect(isDispatchable({ source: "tms", status: "canceled" })).toBe(false);
    expect(isDispatchable({ source: "manual", status: "approved" })).toBe(false);
  });
});
