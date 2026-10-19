import { describe, expect, it } from "vitest";
import { handPairingPatch, trailersOnLoadsResponseSchema } from "./trailerLinkContract.js";

describe("handPairingPatch (Q-TL3)", () => {
  it("a pairing a person changes is theirs, so the GPS run leaves it alone", () => {
    expect(handPairingPatch("veh-1", "veh-2")).toEqual({ assigned_vehicle_id: "veh-2", pairing_source: "manual", pairing_confidence: null });
    expect(handPairingPatch(null, "veh-2")).toMatchObject({ pairing_source: "manual" });
  });

  it("a pairing a person clears is nobody's, so the GPS may pair it again", () => {
    expect(handPairingPatch("veh-1", null)).toEqual({ assigned_vehicle_id: null, pairing_source: null, pairing_confidence: null });
  });

  it("an unchanged pairing keeps whatever made it", () => {
    expect(handPairingPatch("veh-1", "veh-1")).toBeNull();
    expect(handPairingPatch(null, null)).toBeNull();
  });
});

describe("trailersOnLoadsResponseSchema", () => {
  it("accepts a load with no order number", () => {
    expect(trailersOnLoadsResponseSchema.parse({ trailers: [{ trailerId: "t", vehicleId: "v", loadId: "l", ref: null }] }).trailers).toHaveLength(1);
  });
});
