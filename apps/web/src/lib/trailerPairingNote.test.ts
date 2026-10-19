import { describe, expect, it } from "vitest";
import { gpsPairingNote } from "./trailerPairingNote";

describe("gpsPairingNote (TRAILER-LINK-PLAN TL4)", () => {
  it("says how old a GPS pairing is", () => {
    expect(gpsPairingNote({ assigned_vehicle_id: "v", pairing_source: "inferred", pairing_confirmed_at: "2026-10-19T14:00:00Z" })).toBe("GPS, as of 10/19/2026");
  });
  it("says when nobody knows, rather than looking current", () => {
    expect(gpsPairingNote({ assigned_vehicle_id: "v", pairing_source: "inferred", pairing_confirmed_at: null })).toBe("GPS, age unknown");
  });
  it("names a person's pairing as theirs", () => {
    expect(gpsPairingNote({ assigned_vehicle_id: "v", pairing_source: "manual", pairing_confirmed_at: "2026-10-19T14:00:00Z" })).toBe("set by hand");
  });
  it("says nothing for an unpaired trailer", () => {
    expect(gpsPairingNote({ assigned_vehicle_id: null, pairing_source: null, pairing_confirmed_at: null })).toBeNull();
  });
});
